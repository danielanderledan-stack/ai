// Absolute minimal Express server for Railway testing
console.log('Starting minimal Express test...');
console.log('Time:', new Date().toISOString());
console.log('Node:', process.version);
console.log('PORT:', process.env.PORT);

const express = require('express');
console.log('✓ Express loaded');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('✓ App created, configuring routes...');

app.get('/health', (req, res) => {
  console.log('Health check hit');
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/', (req, res) => {
  console.log('Root hit');
  res.json({ message: 'Minimal Express server' });
});

console.log('✓ Routes configured, starting listener...');

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('✓✓✓ SERVER STARTED SUCCESSFULLY ✓✓✓');
  console.log('Port:', PORT);
  console.log('Host: 0.0.0.0');
  console.log('Time:', new Date().toISOString());
  console.log('========================================');
});

server.on('error', (err) => {
  console.error('SERVER ERROR:', err);
  process.exit(1);
});

// Keep alive logging
setInterval(() => {
  console.log('[ALIVE]', new Date().toISOString());
}, 15000);

process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  process.exit(0);
});

console.log('✓ Setup complete, waiting for server start callback...');
