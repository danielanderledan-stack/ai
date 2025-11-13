# n8n Streaming Bridge

A Node.js application that bridges n8n webhooks with Server-Sent Events (SSE) to enable real-time streaming responses to frontend applications.

## Overview

This streaming bridge allows you to:
- Connect frontend clients via SSE for real-time updates
- Forward chat messages to n8n workflows
- Stream responses from n8n back to clients in real-time
- Manage multiple concurrent streaming sessions
- Built-in rate limiting for security
- CORS support for Figma sites and localhost

## Architecture

```
Figma Frontend <--SSE--> Railway Bridge <--HTTP--> n8n Webhook
```

1. Frontend connects to `/stream` endpoint and receives a session ID
2. Frontend sends messages to `/chat` endpoint with the session ID
3. Bridge forwards the request to n8n with a callback URL
4. n8n processes the request and sends chunks back to `/callback` endpoint
5. Bridge streams each chunk to the frontend via the SSE connection

## Quick Start

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file:
```bash
cp .env.example .env
```

3. Configure your environment variables in `.env`:
```env
PORT=3000
N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/your-webhook-id
STREAM_TIMEOUT_MS=120000
```

4. Start the server:
```bash
npm start
```

## Railway Deployment

### Setup Steps

1. **Install Railway CLI:**
```bash
npm install -g @railway/cli
```

2. **Login to Railway:**
```bash
railway login
```

3. **Initialize project:**
```bash
railway init
```

4. **Set environment variables:**
```bash
railway variables set N8N_WEBHOOK_URL=<your-n8n-webhook-url>
railway variables set PORT=3000
railway variables set STREAM_TIMEOUT_MS=120000
```

5. **Deploy:**
```bash
railway up
```

6. **Get your deployment URL:**
```bash
railway domain
```

### Railway Configuration

The application is configured to work with:
- **Frontend Origin:** `https://pod-chroma-42458729.figma.site`
- **CORS:** Enabled for Figma site and localhost
- **Rate Limiting:** 60 requests per minute per IP
- **Session Timeout:** 2 minutes (configurable)

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
{ "type": "session", "sessionId": "user123-1234567890-abc123" }
```

2. Content events (as responses arrive from n8n):
```json
{ "content": "Streamed response text" }
```

3. Done event (when streaming completes):
```json
{ "done": true }
```

4. Error event (if errors occur):
```json
{ "error": true, "message": "Error description" }
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

**Required Fields:**
- `sessionId` - Active session ID from `/stream` connection
- `email` - User email for identification
- `message` - User's message
- `history` - Conversation history (can be empty array)

**Response:**
```json
{
  "success": true,
  "message": "Request forwarded to n8n",
  "sessionId": "user123-1234567890-abc123"
}
```

### Callback Endpoint

Internal endpoint used by n8n to send responses back. This endpoint is called by the n8n workflow, not by frontend clients.

**Endpoint:** `POST /callback`

**Request Body (for content):**
```json
{
  "session_id": "user123-1234567890-abc123",
  "response": "Content to stream to client",
  "type": "content"
}
```

**Request Body (for completion):**
```json
{
  "session_id": "user123-1234567890-abc123",
  "response": "done",
  "type": "complete"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Callback processed",
  "session_id": "user123-1234567890-abc123"
}
```

## Frontend Integration

### JavaScript/TypeScript Client

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

          // Handle session initialization
          if (data.type === 'session') {
            this.sessionId = data.sessionId;
            console.log('Connected with session:', this.sessionId);
            resolve(this.sessionId);
            return;
          }

          // Handle content streaming
          if (data.content) {
            this.onContent(data.content);
          }

          // Handle completion
          if (data.done) {
            this.onComplete();
          }

          // Handle errors
          if (data.error) {
            this.onError(data.message);
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
}

// Usage example for Figma site
const client = new N8nStreamingClient('https://your-railway-app.up.railway.app');

// Set up event handlers
client.onContent = (content) => {
  // Append content to your UI
  document.getElementById('response').textContent += content;
};

client.onComplete = () => {
  console.log('Response complete!');
};

client.onError = (error) => {
  console.error('Error:', error);
};

// Connect and send a message
async function chat() {
  await client.connect('user123');
  await client.sendMessage(
    'user@example.com',
    'What is the weather like?',
    []
  );
}

chat();
```

### React Hook Example

```javascript
import { useState, useEffect, useRef } from 'react';

function useChatStream(baseUrl) {
  const [isConnected, setIsConnected] = useState(false);
  const [currentMessage, setCurrentMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const clientRef = useRef(null);

  useEffect(() => {
    const client = new N8nStreamingClient(baseUrl);

    client.onContent = (content) => {
      setCurrentMessage(prev => prev + content);
    };

    client.onComplete = () => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: currentMessage
      }]);
      setCurrentMessage('');
    };

    client.onError = (error) => {
      console.error('Stream error:', error);
    };

    client.connect('user123').then(() => {
      setIsConnected(true);
      clientRef.current = client;
    });

    return () => {
      client.disconnect();
    };
  }, [baseUrl]);

  const sendMessage = async (email, message) => {
    if (!clientRef.current || !isConnected) {
      throw new Error('Not connected');
    }

    setMessages(prev => [...prev, { role: 'user', content: message }]);

    await clientRef.current.sendMessage(email, message, messages);
  };

  return {
    isConnected,
    currentMessage,
    messages,
    sendMessage
  };
}

// Usage in component
function ChatComponent() {
  const { isConnected, currentMessage, messages, sendMessage } = useChatStream(
    'https://your-railway-app.up.railway.app'
  );

  const [input, setInput] = useState('');

  const handleSend = () => {
    if (input.trim()) {
      sendMessage('user@example.com', input);
      setInput('');
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
        {currentMessage && (
          <div className="assistant streaming">
            {currentMessage}
          </div>
        )}
      </div>

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={!isConnected}
      />
      <button onClick={handleSend} disabled={!isConnected}>
        Send
      </button>
    </div>
  );
}
```

## n8n Integration

### Webhook Configuration

Your n8n workflow should:

1. **Receive webhook POST requests** with this structure:
```json
{
  "email": "user@example.com",
  "chat": "User's message",
  "chat_context": "role: message\nrole: message...",
  "session_id": "user123-1234567890-abc123",
  "callback_url": "https://your-railway-app.up.railway.app/callback"
}
```

2. **Process the message** using your AI/LLM workflow

3. **Send responses** back to the callback URL as they're generated:

**For each content chunk:**
```javascript
// HTTP Request Node configuration
POST {{$node["Webhook"].json["callback_url"]}}
Headers:
  Content-Type: application/json
Body:
{
  "session_id": "{{$node["Webhook"].json["session_id"]}}",
  "response": "{{$json.chunk}}",
  "type": "content"
}
```

**When streaming is complete:**
```javascript
POST {{$node["Webhook"].json["callback_url"]}}
Headers:
  Content-Type: application/json
Body:
{
  "session_id": "{{$node["Webhook"].json["session_id"]}}",
  "response": "done",
  "type": "complete"
}
```

### Important Notes for n8n

- **No Authorization headers needed** - The Railway app doesn't require authentication tokens
- **Keep Content-Type**: `application/json`
- **Always include session_id** in callbacks
- **Use the callback_url** provided in the webhook payload
- **Send "done" signal** when streaming is complete

## Security Features

### CORS Configuration

The application is configured to accept requests from:
- `https://pod-chroma-42458729.figma.site` (Production Figma site)
- `http://localhost:3000` (Local development)
- `http://127.0.0.1:3000` (Local development)

To add more origins, update `server.js:14`:
```javascript
app.use(cors({
  origin: [
    'https://pod-chroma-42458729.figma.site',
    'http://localhost:3000',
    'https://your-other-domain.com'  // Add here
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
```

### Rate Limiting

Built-in rate limiting:
- **Default:** 60 requests per minute per IP
- **Window:** 60 seconds
- **Response:** 429 Too Many Requests

Configure in environment variables:
```env
RATE_LIMIT_MAX_REQUESTS=60
RATE_LIMIT_WINDOW=60000
```

### Session Management

- Sessions expire after 2 minutes (configurable via `STREAM_TIMEOUT_MS`)
- Automatic cleanup on disconnect
- Keepalive every 30 seconds
- Session ID format: `userId-timestamp-randomChars`

## Testing

### Manual Testing

1. **Start the server:**
```bash
npm start
```

2. **Test health endpoint:**
```bash
curl http://localhost:3000/health
```

3. **Test SSE connection:**
```bash
curl -N http://localhost:3000/stream?userId=test
```

4. **Open test client:**
```bash
# Open test-client.html in your browser
```

### Using the Test Client

The included `test-client.html` provides a UI for testing:
1. Open `test-client.html` in a browser
2. Enter server URL (e.g., `http://localhost:3000`)
3. Click "Connect" to establish SSE connection
4. Enter messages and test the flow

## Troubleshooting

### CORS Issues

If you see CORS errors from your Figma site:
1. Verify your Figma site URL is in the CORS origin list
2. Check that credentials are enabled
3. Ensure your Railway deployment has the correct URL

### Connection Timeouts

If connections timeout:
- Increase `STREAM_TIMEOUT_MS` in environment variables
- Check network/proxy settings
- Verify keepalive messages are working

### n8n Integration Issues

If n8n callbacks fail:
1. Check that `callback_url` is accessible from n8n
2. Verify `session_id` is being passed correctly
3. Check n8n HTTP Request node headers (should NOT have Authorization)
4. Review Railway app logs for callback errors

### Rate Limiting

If you hit rate limits:
- Increase `RATE_LIMIT_MAX_REQUESTS`
- Adjust `RATE_LIMIT_WINDOW`
- Consider implementing API keys for trusted clients

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3000 | Server port |
| `N8N_WEBHOOK_URL` | Yes | - | n8n webhook endpoint URL |
| `STREAM_TIMEOUT_MS` | No | 120000 | SSE connection timeout (2 minutes) |
| `RATE_LIMIT_MAX_REQUESTS` | No | 60 | Max requests per window |
| `RATE_LIMIT_WINDOW` | No | 60000 | Rate limit window in ms |

## Architecture Details

### Session Flow

1. Client connects to `/stream`
2. Server generates unique session ID
3. Session stored in memory with response stream
4. Client receives session ID via SSE
5. Client sends chat messages with session ID
6. Server validates session exists
7. Message forwarded to n8n
8. n8n calls back with chunks
9. Chunks streamed to client via SSE
10. Session cleaned up on completion or timeout

### Memory Management

- Active connections stored in Map
- Automatic cleanup on disconnect
- Timeout-based session expiry
- Rate limit store cleaned every minute

## License

ISC

## Support

For issues and questions, please open an issue in the repository.
