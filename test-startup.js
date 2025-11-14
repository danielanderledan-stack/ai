// Ultra-simple test - just log and keep running
console.log('========================================');
console.log('TEST SCRIPT STARTED');
console.log('Time:', new Date().toISOString());
console.log('Node:', process.version);
console.log('PORT:', process.env.PORT);
console.log('All env vars:');
Object.keys(process.env).forEach(key => {
  if (!key.includes('SECRET') && !key.includes('KEY') && !key.includes('TOKEN')) {
    console.log(`  ${key}: ${process.env[key]}`);
  }
});
console.log('========================================');

// Start the simplest possible HTTP server
const http = require('http');
const PORT = process.env.PORT || 3000;

console.log('Creating HTTP server on port:', PORT);

const server = http.createServer((req, res) => {
  console.log('Request received:', req.method, req.url);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'alive',
    time: new Date().toISOString(),
    path: req.url
  }));
});

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('HTTP SERVER LISTENING ON 0.0.0.0:' + PORT);
  console.log('Time:', new Date().toISOString());
  console.log('========================================');
});

// Keep alive
setInterval(() => {
  console.log('[ALIVE]', new Date().toISOString(), 'Uptime:', process.uptime(), 'seconds');
}, 10000);
