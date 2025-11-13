# n8n Streaming Bridge

A Node.js application that bridges n8n webhooks with Server-Sent Events (SSE) to enable real-time streaming responses to frontend applications.

## Overview

This streaming bridge allows you to:
- Connect frontend clients via SSE for real-time updates
- Forward chat messages to n8n workflows
- Stream responses from n8n back to clients in real-time
- Manage multiple concurrent streaming sessions

## Architecture

```
Frontend Client <--SSE--> Streaming Bridge <--HTTP--> n8n Webhook
```

1. Frontend connects to `/stream` endpoint and receives a session ID
2. Frontend sends messages to `/chat` endpoint with the session ID
3. Bridge forwards the request to n8n with a callback URL
4. n8n processes the request and sends chunks back to `/callback` endpoint
5. Bridge streams each chunk to the frontend via the SSE connection

## Installation

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- An n8n instance with a webhook configured

### Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd n8n-streaming-bridge
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file:
```bash
cp .env.example .env
```

4. Configure your environment variables in `.env`:
```env
PORT=3000
N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/your-webhook-id
STREAM_TIMEOUT_MS=120000
```

5. Start the server:
```bash
# Production
npm start

# Development (with auto-reload)
npm run dev
```

## API Documentation

### Health Check

Check if the server is running and view configuration.

**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "activeConnections": 3,
  "config": {
    "port": 3000,
    "n8nConfigured": true,
    "streamTimeout": 120000
  }
}
```

### Stream Endpoint

Establish an SSE connection for receiving real-time updates.

**Endpoint:** `GET /stream?userId=<userId>`

**Parameters:**
- `userId` (optional): User identifier for session tracking

**Response:** SSE stream with events:

1. Session event (immediately upon connection):
```json
{
  "type": "session",
  "sessionId": "user123-1234567890-abc123"
}
```

2. Content events (as responses arrive):
```json
{
  "type": "content",
  "content": "Streamed response text"
}
```

3. Done event (when streaming completes):
```json
{
  "type": "done",
  "message": "Stream complete"
}
```

4. Error event (if errors occur):
```json
{
  "type": "error",
  "message": "Error description",
  "error": "Error details"
}
```

5. Timeout event (if connection exceeds timeout):
```json
{
  "type": "timeout",
  "message": "Connection timeout"
}
```

### Chat Endpoint

Send a message to be processed by n8n.

**Endpoint:** `POST /chat`

**Request Body:**
```json
{
  "sessionId": "user123-1234567890-abc123",
  "email": "user@example.com",
  "message": "User's message here",
  "history": [
    {
      "role": "user",
      "content": "Previous message"
    },
    {
      "role": "assistant",
      "content": "Previous response"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Request forwarded to n8n",
  "sessionId": "user123-1234567890-abc123"
}
```

**Error Response:**
```json
{
  "error": "Error description",
  "details": "Additional error details"
}
```

### Callback Endpoint

Internal endpoint used by n8n to send responses back. This endpoint is called by the n8n workflow, not by frontend clients.

**Endpoint:** `POST /callback`

**Request Body:**
```json
{
  "session_id": "user123-1234567890-abc123",
  "response": "Content to stream to client",
  "type": "content"
}
```

For completion:
```json
{
  "session_id": "user123-1234567890-abc123",
  "response": "done",
  "type": "complete"
}
```

## Frontend Integration

### JavaScript/TypeScript Example

```javascript
class N8nStreamingClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.sessionId = null;
    this.eventSource = null;
  }

  // Connect to the SSE stream
  async connect(userId = 'anonymous') {
    return new Promise((resolve, reject) => {
      this.eventSource = new EventSource(`${this.baseUrl}/stream?userId=${userId}`);

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'session':
              this.sessionId = data.sessionId;
              console.log('Connected with session:', this.sessionId);
              resolve(this.sessionId);
              break;

            case 'content':
              this.onContent(data.content);
              break;

            case 'done':
              this.onComplete();
              break;

            case 'error':
              this.onError(data.message);
              break;

            case 'timeout':
              this.onTimeout();
              break;
          }
        } catch (error) {
          console.error('Error parsing SSE data:', error);
        }
      };

      this.eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        reject(error);
      };
    });
  }

  // Send a message
  async sendMessage(email, message, history = []) {
    if (!this.sessionId) {
      throw new Error('Not connected. Call connect() first.');
    }

    const response = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: this.sessionId,
        email,
        message,
        history,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to send message');
    }

    return response.json();
  }

  // Disconnect from the stream
  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.sessionId = null;
    }
  }

  // Override these methods to handle events
  onContent(content) {
    console.log('Received content:', content);
  }

  onComplete() {
    console.log('Stream complete');
  }

  onError(error) {
    console.error('Stream error:', error);
  }

  onTimeout() {
    console.log('Stream timeout');
  }
}

// Usage example
const client = new N8nStreamingClient('http://localhost:3000');

// Connect and handle streaming responses
client.onContent = (content) => {
  // Append content to your UI
  document.getElementById('response').textContent += content;
};

client.onComplete = () => {
  console.log('Response complete!');
};

// Connect to stream
await client.connect('user123');

// Send a message
await client.sendMessage(
  'user@example.com',
  'What is the weather like?',
  []
);

// Later, disconnect
// client.disconnect();
```

### React Example

```javascript
import { useState, useEffect, useRef } from 'react';

function ChatComponent() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
  const clientRef = useRef(null);

  useEffect(() => {
    // Initialize client
    const client = new N8nStreamingClient('http://localhost:3000');

    client.onContent = (content) => {
      setCurrentResponse(prev => prev + content);
    };

    client.onComplete = () => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: currentResponse
      }]);
      setCurrentResponse('');
    };

    client.onError = (error) => {
      console.error('Stream error:', error);
    };

    // Connect
    client.connect('user123').then(() => {
      setIsConnected(true);
      clientRef.current = client;
    });

    // Cleanup on unmount
    return () => {
      client.disconnect();
    };
  }, []);

  const handleSend = async () => {
    if (!input.trim() || !isConnected) return;

    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');

    try {
      await clientRef.current.sendMessage(
        'user@example.com',
        input,
        messages
      );
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  return (
    <div>
      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={msg.role}>
            {msg.content}
          </div>
        ))}
        {currentResponse && (
          <div className="assistant streaming">
            {currentResponse}
          </div>
        )}
      </div>

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
        disabled={!isConnected}
      />

      <button onClick={handleSend} disabled={!isConnected}>
        Send
      </button>
    </div>
  );
}
```

## Deployment

### Railway

1. Install Railway CLI:
```bash
npm install -g @railway/cli
```

2. Login to Railway:
```bash
railway login
```

3. Initialize project:
```bash
railway init
```

4. Add environment variables:
```bash
railway variables set N8N_WEBHOOK_URL=<your-n8n-webhook-url>
railway variables set PORT=3000
```

5. Deploy:
```bash
railway up
```

### Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
```

Build and run:
```bash
docker build -t n8n-streaming-bridge .
docker run -p 3000:3000 \
  -e N8N_WEBHOOK_URL=<your-webhook-url> \
  n8n-streaming-bridge
```

## Testing

### Manual Testing

1. Start the server:
```bash
npm start
```

2. Test SSE connection:
```bash
curl -N http://localhost:3000/stream?userId=test
```

3. Send a test message (in another terminal):
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "<session-id-from-step-2>",
    "email": "test@example.com",
    "message": "Hello",
    "history": []
  }'
```

4. Simulate n8n callback:
```bash
curl -X POST http://localhost:3000/callback \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "<session-id>",
    "response": "Test response",
    "type": "content"
  }'
```

## n8n Integration

The streaming bridge is designed to work with your existing n8n workflow without modifications. Your n8n workflow should:

1. Receive webhook requests with this structure:
```json
{
  "email": "user@example.com",
  "chat": "User's message",
  "chat_context": "Previous conversation context",
  "session_id": "unique-session-id",
  "callback_url": "https://your-bridge.com/callback"
}
```

2. Send responses back to the `callback_url` in chunks:
```json
{
  "session_id": "unique-session-id",
  "response": "Chunk of text to stream",
  "type": "content"
}
```

3. Send a completion signal when done:
```json
{
  "session_id": "unique-session-id",
  "response": "done",
  "type": "complete"
}
```

## Configuration

### Environment Variables

- `PORT`: Server port (default: 3000)
- `N8N_WEBHOOK_URL`: Your n8n webhook endpoint (required)
- `SUPABASE_SERVICE_ROLE`: Optional Supabase service role key
- `STREAM_TIMEOUT_MS`: SSE connection timeout in milliseconds (default: 120000 = 2 minutes)

### Session Management

- Sessions are automatically cleaned up after the timeout period
- Sessions are removed when the stream completes
- Sessions are removed when clients disconnect
- Each session has a unique ID in the format: `userId-timestamp-randomChars`

## Troubleshooting

### Connection Issues

If SSE connections fail:
- Check CORS configuration
- Verify firewall/proxy settings allow SSE
- Ensure `X-Accel-Buffering` is set to `no` for nginx

### Timeout Issues

If connections timeout prematurely:
- Increase `STREAM_TIMEOUT_MS` in your `.env`
- Check that keepalive messages are being sent/received

### n8n Integration Issues

If messages aren't reaching n8n:
- Verify `N8N_WEBHOOK_URL` is correct
- Check n8n webhook logs
- Ensure the callback URL is accessible from n8n

## License

ISC

## Support

For issues and questions, please open an issue in the repository.
