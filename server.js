require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const STREAM_TIMEOUT_MS = process.env.STREAM_TIMEOUT_MS || 120000; // 2 minutes default

// Middleware
app.use(cors());
app.use(express.json());

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
  const userId = req.query.userId || 'anonymous';
  const sessionId = generateSessionId(userId);

  log(`New SSE connection request`, { userId, sessionId });

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send session ID to client
  res.write(`data: ${JSON.stringify({ type: 'session', sessionId })}\n\n`);

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
});

// Chat Endpoint - Forward messages to n8n
app.post('/chat', async (req, res) => {
  const { message, history, email, sessionId } = req.body;

  log(`Chat request received`, { email, sessionId, messageLength: message?.length });

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
        type: 'error',
        message: 'Failed to process request',
        error: error.message
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
      // Send completion signal
      connection.response.write(`data: ${JSON.stringify({
        type: 'done',
        message: 'Stream complete'
      })}\n\n`);

      log(`Stream completed`, { session_id });

      // Close connection and cleanup
      connection.response.end();
      cleanupSession(session_id);

    } else if (response) {
      // Stream content to client
      connection.response.write(`data: ${JSON.stringify({
        type: 'content',
        content: response
      })}\n\n`);

      log(`Content streamed`, {
        session_id,
        contentLength: response.length
      });
    }

    // Acknowledge receipt to n8n
    res.json({
      success: true,
      message: 'Callback processed'
    });

  } catch (error) {
    log(`Error processing callback`, {
      session_id,
      error: error.message
    });

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

// Start server
app.listen(PORT, () => {
  log(`n8n Streaming Bridge Server started`, {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    n8nConfigured: !!N8N_WEBHOOK_URL,
    streamTimeout: `${STREAM_TIMEOUT_MS}ms`
  });

  if (!N8N_WEBHOOK_URL) {
    log('WARNING: N8N_WEBHOOK_URL is not configured. Set it in your .env file.');
  }
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
