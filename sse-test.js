// SSE streaming test server
console.log('Starting SSE test server...');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const activeConnections = new Map();

console.log('✓ Express loaded, configuring routes...');

// Health check
app.get('/health', (req, res) => {
  console.log('Health check');
  res.json({
    status: 'ok',
    connections: activeConnections.size
  });
});

// Simple SSE endpoint
app.get('/stream', (req, res) => {
  console.log('SSE connection request');
  const sessionId = `session-${Date.now()}`;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send session ID
  res.write(`data: ${JSON.stringify({ sessionId })}\n\n`);

  // Store connection
  activeConnections.set(sessionId, { response: res });
  console.log('SSE connection established:', sessionId);

  // Cleanup on disconnect
  req.on('close', () => {
    activeConnections.delete(sessionId);
    console.log('SSE connection closed:', sessionId);
  });
});

console.log('✓ Routes configured, starting server...');

app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('SSE TEST SERVER STARTED');
  console.log('Port:', PORT);
  console.log('Time:', new Date().toISOString());
  console.log('========================================');
});

setInterval(() => {
  console.log('[ALIVE] Connections:', activeConnections.size);
}, 15000);
