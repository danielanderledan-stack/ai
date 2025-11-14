// Ultra-minimal debug server to test Railway deployment
console.log('=== STARTING DEBUG SERVER ===');
console.log('Timestamp:', new Date().toISOString());
console.log('Node version:', process.version);
console.log('Platform:', process.platform);
console.log('CWD:', process.cwd());

// Test environment variables
console.log('PORT env:', process.env.PORT);
console.log('N8N_WEBHOOK_URL env:', process.env.N8N_WEBHOOK_URL ? 'SET' : 'NOT SET');
console.log('STREAM_TIMEOUT_MS env:', process.env.STREAM_TIMEOUT_MS);

const PORT = process.env.PORT || 3000;

console.log('Attempting to load express...');
try {
  const express = require('express');
  console.log('✓ Express loaded successfully');

  const app = express();
  console.log('✓ Express app created');

  // Ultra-simple health endpoint
  app.get('/health', (req, res) => {
    console.log('Health check received');
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      port: PORT,
      env: {
        node: process.version,
        n8n_configured: !!process.env.N8N_WEBHOOK_URL,
        timeout: process.env.STREAM_TIMEOUT_MS
      }
    });
  });

  app.get('/', (req, res) => {
    res.json({ message: 'Debug server is running', timestamp: new Date().toISOString() });
  });

  console.log('Routes configured');
  console.log('Attempting to listen on port:', PORT);
  console.log('Binding to: 0.0.0.0');

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('=== SERVER STARTED SUCCESSFULLY ===');
    console.log('Listening on: 0.0.0.0:' + PORT);
    console.log('Time:', new Date().toISOString());
  });

  server.on('error', (err) => {
    console.error('=== SERVER ERROR ===');
    console.error('Error:', err.message);
    console.error('Code:', err.code);
    console.error('Stack:', err.stack);
  });

  console.log('Server listen() called, waiting for callback...');

} catch (error) {
  console.error('=== FATAL ERROR DURING SETUP ===');
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}

// Process error handlers
process.on('uncaughtException', (err) => {
  console.error('=== UNCAUGHT EXCEPTION ===');
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('=== UNHANDLED REJECTION ===');
  console.error('Reason:', reason);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('=== SIGTERM RECEIVED ===');
  console.log('Time:', new Date().toISOString());
  process.exit(0);
});

console.log('=== SETUP COMPLETE, WAITING FOR SERVER TO START ===');
