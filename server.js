require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const STREAM_TIMEOUT_MS = process.env.STREAM_TIMEOUT_MS || 120000; // 2 minutes default

// CORS Configuration - Allow Figma site and localhost
app.use(cors({
  origin: ['https://pod-chroma-42458729.figma.site', 'http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Simple rate limiting store
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per minute per IP

// Rate limiting middleware
const rateLimit = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return next();
  }

  const record = rateLimitStore.get(ip);

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + RATE_LIMIT_WINDOW;
    return next();
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    log(`Rate limit exceeded`, { ip });
    return res.status(429).json({
      error: 'Too many requests. Please try again later.'
    });
  }

  record.count++;
  next();
};

// Apply rate limiting to all routes
app.use(rateLimit);

// Clean up rate limit store periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW);

// In-memory store for active SSE connections
const activeConnections = new Map();

// Utility function: Generate session ID
const generateSessionId = (userId) => {
  const timestamp = Date.now();
  const randomChars = Math.random().toString(36).substring(2, 8);
  return `${userId}-${timestamp}-${randomChars}`;
};

// Utility function: Log with timestamp
const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
};

// Utility function: Clean up session
const cleanupSession = (sessionId) => {
  const connection = activeConnections.get(sessionId);
  if (connection) {
    clearTimeout(connection.timeout);
    activeConnections.delete(sessionId);
    log(`Session cleaned up: ${sessionId}`);
  }
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    activeConnections: activeConnections.size,
    config: {
      port: PORT,
      n8nConfigured: !!N8N_WEBHOOK_URL,
      streamTimeout: STREAM_TIMEOUT_MS
    }
  });
});

// SSE Stream Endpoint
app.get('/stream', (req, res) => {
  try {
    const userId = req.query.userId || 'anonymous';
    const sessionId = generateSessionId(userId);
    const origin = req.get('origin') || req.get('referer') || 'unknown';

    log(`New SSE connection request`, {
      userId,
      sessionId,
      origin,
      userAgent: req.get('user-agent')
    });

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    log(`SSE headers set for session ${sessionId}`);

    // Send session ID to client
    res.write(`data: ${JSON.stringify({ type: 'session', sessionId })}\n\n`);
    res.flushHeaders();

    log(`Initial session data sent for ${sessionId}`);

    // Set up timeout
    const timeout = setTimeout(() => {
      log(`Session timeout`, { sessionId });
      res.write(`data: ${JSON.stringify({ type: 'timeout', message: 'Connection timeout' })}\n\n`);
      res.end();
      cleanupSession(sessionId);
    }, STREAM_TIMEOUT_MS);

    // Store connection
    activeConnections.set(sessionId, {
      response: res,
      userId,
      timeout,
      createdAt: Date.now()
    });

    log(`Active connection stored`, {
      sessionId,
      totalConnections: activeConnections.size
    });

    // Handle client disconnect
    req.on('close', () => {
      log(`Client disconnected`, { sessionId });
      cleanupSession(sessionId);
    });

    // Send keepalive every 30 seconds
    const keepaliveInterval = setInterval(() => {
      if (activeConnections.has(sessionId)) {
        res.write(`:keepalive\n\n`);
      } else {
        clearInterval(keepaliveInterval);
      }
    }, 30000);

    // Clean up interval on disconnect
    req.on('close', () => {
      clearInterval(keepaliveInterval);
    });

  } catch (error) {
    log(`Error in /stream endpoint`, {
      error: error.message,
      stack: error.stack
    });

    try {
      res.status(500).json({
        error: 'Failed to establish stream',
        details: error.message
      });
    } catch (resError) {
      log(`Failed to send error response`, { error: resError.message });
    }
  }
});

// Chat Endpoint - Forward messages to n8n
app.post('/chat', async (req, res) => {
  const { message, history, email, sessionId } = req.body;
  const origin = req.get('origin') || req.get('referer') || 'unknown';

  log(`Chat request received`, {
    email,
    sessionId,
    messageLength: message?.length,
    origin,
    hasHistory: !!history,
    historyLength: history?.length || 0
  });

  // Validate required fields
  if (!message || !sessionId || !email) {
    log(`Invalid chat request - missing required fields`);
    return res.status(400).json({
      error: 'Missing required fields: message, sessionId, and email are required'
    });
  }

  // Verify active stream connection exists
  if (!activeConnections.has(sessionId)) {
    log(`Invalid session ID`, { sessionId });
    return res.status(400).json({
      error: 'Invalid or expired session ID. Please reconnect to the stream.'
    });
  }

  // Verify n8n webhook URL is configured
  if (!N8N_WEBHOOK_URL) {
    log(`N8N_WEBHOOK_URL not configured`);
    return res.status(500).json({
      error: 'Server configuration error: N8N webhook URL not configured'
    });
  }

  try {
    // Prepare chat context from history
    const chatContext = history && Array.isArray(history)
      ? history.map(h => `${h.role}: ${h.content}`).join('\n')
      : '';

    // Construct callback URL
    const callbackUrl = `${req.protocol}://${req.get('host')}/callback`;

    // Prepare payload for n8n
    const n8nPayload = {
      email,
      chat: message,
      chat_context: chatContext,
      session_id: sessionId,
      callback_url: callbackUrl
    };

    log(`Forwarding to n8n`, {
      webhookUrl: N8N_WEBHOOK_URL,
      sessionId,
      callbackUrl
    });

    // Forward to n8n webhook
    const n8nResponse = await axios.post(N8N_WEBHOOK_URL, n8nPayload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout for n8n response
    });

    log(`n8n response received`, {
      sessionId,
      status: n8nResponse.status
    });

    res.json({
      success: true,
      message: 'Request forwarded to n8n',
      sessionId
    });

  } catch (error) {
    log(`Error forwarding to n8n`, {
      sessionId,
      error: error.message,
      stack: error.stack
    });

    // Send error to SSE stream if connection still active
    const connection = activeConnections.get(sessionId);
    if (connection) {
      connection.response.write(`data: ${JSON.stringify({
        error: true,
        message: 'Failed to process request: ' + error.message
      })}\n\n`);
    }

    res.status(500).json({
      error: 'Failed to forward request to n8n',
      details: error.message
    });
  }
});

// Callback Endpoint - Receive responses from n8n and stream to client
app.post('/callback', (req, res) => {
  const { session_id, response, type } = req.body;

  log(`Callback received`, {
    session_id,
    type,
    responseLength: response?.length
  });

  // Validate session ID
  if (!session_id) {
    log(`Callback missing session_id`);
    return res.status(400).json({
      error: 'session_id is required'
    });
  }

  // Get active connection
  const connection = activeConnections.get(session_id);

  if (!connection) {
    log(`Callback for invalid/expired session`, { session_id });
    return res.status(404).json({
      error: 'Session not found or expired'
    });
  }

  try {
    // Handle different response types
    if (type === 'complete' || response === 'done' || response === '[DONE]') {
      // Send completion signal in simplified format
      connection.response.write(`data: ${JSON.stringify({ done: true })}\n\n`);

      log(`Stream completed`, { session_id });

      // Close connection and cleanup
      connection.response.end();
      cleanupSession(session_id);

    } else if (response) {
      // Stream content to client in simplified format
      connection.response.write(`data: ${JSON.stringify({ content: response })}\n\n`);

      log(`Content streamed`, {
        session_id,
        contentLength: response.length
      });
    }

    // Acknowledge receipt to n8n
    res.json({
      success: true,
      message: 'Callback processed',
      session_id
    });

  } catch (error) {
    log(`Error processing callback`, {
      session_id,
      error: error.message,
      stack: error.stack
    });

    // Try to send error to client if connection still exists
    try {
      if (connection && connection.response) {
        connection.response.write(`data: ${JSON.stringify({
          error: true,
          message: error.message
        })}\n\n`);
      }
    } catch (writeError) {
      log(`Failed to write error to client`, { writeError: writeError.message });
    }

    res.status(500).json({
      error: 'Failed to process callback',
      details: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  log(`Unhandled error`, {
    error: err.message,
    stack: err.stack,
    path: req.path
  });

  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path
  });
});

// Start server - Listen on 0.0.0.0 for Railway compatibility
const server = app.listen(PORT, '0.0.0.0', () => {
  log(`n8n Streaming Bridge Server started`, {
    port: PORT,
    host: '0.0.0.0',
    environment: process.env.NODE_ENV || 'development',
    n8nConfigured: !!N8N_WEBHOOK_URL,
    streamTimeout: `${STREAM_TIMEOUT_MS}ms`
  });

  if (!N8N_WEBHOOK_URL) {
    log('WARNING: N8N_WEBHOOK_URL is not configured. Set it in your .env file.');
  }
});

// Handle server errors
server.on('error', (error) => {
  log('Server error', {
    error: error.message,
    code: error.code,
    stack: error.stack
  });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('SIGTERM received, closing server...');

  // Close all active connections
  activeConnections.forEach((connection, sessionId) => {
    connection.response.write(`data: ${JSON.stringify({
      type: 'shutdown',
      message: 'Server is shutting down'
    })}\n\n`);
    connection.response.end();
    cleanupSession(sessionId);
  });

  process.exit(0);
});

process.on('SIGINT', () => {
  log('SIGINT received, closing server...');

  // Close all active connections
  activeConnections.forEach((connection, sessionId) => {
    connection.response.write(`data: ${JSON.stringify({
      type: 'shutdown',
      message: 'Server is shutting down'
    })}\n\n`);
    connection.response.end();
    cleanupSession(sessionId);
  });

  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log('UNCAUGHT EXCEPTION - Server will exit', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  log('UNHANDLED PROMISE REJECTION - Server will exit', {
    reason: reason,
    promise: promise
  });
  process.exit(1);
});
