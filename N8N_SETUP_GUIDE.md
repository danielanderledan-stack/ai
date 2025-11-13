# n8n Workflow Setup Guide

This guide explains how to configure your n8n workflow (`n8n-workflow.json`) to work with the Railway streaming bridge.

## Workflow Overview

Your n8n workflow implements an intelligent routing system with 4 complexity levels:

### Flow Diagram

```
User Message → Webhook → Edit Fields → Basic LLM Chain (Classifier)
                                              ↓
                                           Switch
                                              ↓
        ┌──────────────┬──────────────┬──────────────┬──────────────┐
        ↓              ↓              ↓              ↓              ↓
    L (Low)        M (Medium)     H (High)       T (Task)
    Dumb AI        Normal AI      Smart AI       Complex Flow
        ↓              ↓              ↓              ↓
   Respond        Respond        Respond       HTTP Request1
                                                     ↓
                                                Smart AI1 (Orchestrator)
                                                     ↓
                                             Code in JavaScript (Parse JSON)
                                                     ↓
                                                Split Out → Loop Over Items
                                                     ↓
                                            Execute Task Workflow
                                                     ↓
                                                HTTP Request2
                                                     ↓
                                            (Stream to client)
```

### Complexity Levels

1. **L (Low)** - Simple acknowledgments
   - Uses lightweight model: `meta-llama/llama-3-8b-instruct`
   - Returns immediately via `Respond to Webhook`

2. **M (Medium)** - Standard responses
   - Uses model: `openai/gpt-oss-20b`
   - Returns immediately via `Respond to Webhook1`

3. **H (High)** - Complex responses
   - Uses model: `openai/gpt-oss-120b`
   - Returns immediately via `Respond to Webhook2`

4. **T (Task)** - Multi-step workflow orchestration
   - Uses `anthropic/claude-3.5-sonnet` to generate a JSON workflow
   - Executes tasks in parallel or sequential order
   - **Streams results** back to client via callbacks

## Critical Configuration Changes Needed

### 1. Update Railway App URL (REQUIRED)

Both `HTTP Request1` and `HTTP Request2` nodes currently have placeholder URLs:

**Current:**
```
https://your-railway-app.railway.app/callback
```

**What you need to do:**
1. Deploy your streaming bridge to Railway
2. Get your Railway app URL (e.g., `https://n8n-streaming-bridge-production.up.railway.app`)
3. In n8n workflow editor, update **both** HTTP Request nodes:
   - `HTTP Request1` (line 871 in JSON)
   - `HTTP Request2` (line 902 in JSON)

**Updated URL should be:**
```
https://YOUR-RAILWAY-APP.up.railway.app/callback
```

### 2. Remove Bearer Authentication Header (REQUIRED)

`HTTP Request1` currently includes a Bearer token that must be removed.

**Current (HTTP Request1):**
```json
"headerParameters": {
  "parameters": [
    {
      "name": "Content-Type",
      "value": "application/json"
    },
    {
      "name": "Bearer",
      "value": "eyJhbGciOiJIUzI1NiIs..."
    }
  ]
}
```

**What you need to do:**
1. Open `HTTP Request1` node in n8n editor
2. Go to "Headers" section
3. **Delete** the "Bearer" header
4. Keep only "Content-Type: application/json"

**After fix:**
```json
"headerParameters": {
  "parameters": [
    {
      "name": "Content-Type",
      "value": "application/json"
    }
  ]
}
```

### 3. Add "type" Field to Callback Bodies (REQUIRED)

Both HTTP Request nodes are missing the `type` field that tells the streaming bridge how to handle the response.

**Current body:**
```json
{
  "session_id": "{{$node['Webhook'].json.body.session_id}}",
  "response": "{{ JSON.stringify($json.text) }}"
}
```

**What you need to do:**

For **HTTP Request1** (sends acknowledgment):
```json
{
  "session_id": "{{$node['Webhook'].json.body.session_id}}",
  "response": "{{ JSON.stringify($json.text) }}",
  "type": "content"
}
```

For **HTTP Request2** (sends task results):
```json
{
  "session_id": "{{$node['Webhook'].json.body.session_id}}",
  "response": "{{ JSON.stringify($json.text) }}",
  "type": "content"
}
```

### 4. Add Completion Signal (REQUIRED)

After sending the final content, you need to signal that streaming is complete.

**Add a new HTTP Request node after HTTP Request2:**

**Node configuration:**
- **Method:** POST
- **URL:** `https://YOUR-RAILWAY-APP.up.railway.app/callback`
- **Headers:**
  - Content-Type: `application/json`
- **Body:**
```json
{
  "session_id": "{{$node['Webhook'].json.body.session_id}}",
  "response": "done",
  "type": "complete"
}
```

This tells the client that the streaming response is finished.

## Step-by-Step Fix Instructions

### Option 1: Import Updated Workflow (Recommended)

I will create an updated version of your workflow with all fixes applied. You can then:
1. Import the fixed workflow into n8n
2. Update the Railway URL to your actual deployment URL
3. Activate the workflow

### Option 2: Manual Fixes in n8n Editor

1. **Open your n8n workflow** in the editor

2. **Fix HTTP Request1:**
   - Click on the `HTTP Request1` node
   - In the "URL" field, replace:
     ```
     https://your-railway-app.railway.app/callback
     ```
     with your actual Railway URL
   - Under "Headers", remove the "Bearer" header (keep only Content-Type)
   - Under "Body" → "JSON", update to:
     ```json
     {
       "session_id": "{{$node['Webhook'].json.body.session_id}}",
       "response": "{{ JSON.stringify($json.text) }}",
       "type": "content"
     }
     ```

3. **Fix HTTP Request2:**
   - Click on the `HTTP Request2` node
   - Update URL to your Railway URL
   - Under "Body" → "JSON", update to:
     ```json
     {
       "session_id": "{{$node['Webhook'].json.body.session_id}}",
       "response": "{{ JSON.stringify($json.text) }}",
       "type": "content"
     }
     ```

4. **Add Completion Signal:**
   - After `HTTP Request2`, add a new "HTTP Request" node
   - Name it "HTTP Request - Complete"
   - Configure:
     - Method: POST
     - URL: `https://YOUR-RAILWAY-APP.up.railway.app/callback`
     - Headers: Content-Type: application/json
     - Body:
       ```json
       {
         "session_id": "{{$node['Webhook'].json.body.session_id}}",
         "response": "done",
         "type": "complete"
       }
       ```

5. **Connect the nodes:**
   - Connect `HTTP Request2` → `HTTP Request - Complete`

6. **Save and Activate**

## Expected Data Flow

### Request from Railway Bridge to n8n

```json
{
  "email": "user@example.com",
  "chat": "User's message",
  "chat_context": "role: message\nrole: message...",
  "session_id": "user123-1234567890-abc123",
  "callback_url": "https://your-railway-app.up.railway.app/callback"
}
```

### Response from n8n to Railway Bridge

**1. Initial Acknowledgment (for T-level tasks):**
```json
{
  "session_id": "user123-1234567890-abc123",
  "response": "I'll have my team work on that right away...",
  "type": "content"
}
```

**2. Task Results:**
```json
{
  "session_id": "user123-1234567890-abc123",
  "response": "The actual generated content from the AI...",
  "type": "content"
}
```

**3. Completion Signal:**
```json
{
  "session_id": "user123-1234567890-abc123",
  "response": "done",
  "type": "complete"
}
```

## Testing Your Configuration

### 1. Test the Webhook

```bash
curl -X POST https://your-n8n-instance.com/webhook/0bcd9cd7-c2a6-4ae5-9f84-db24327562fb \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "chat": "Write me an essay about cows",
    "chat_context": "",
    "session_id": "test-1234567890-abc123",
    "callback_url": "https://your-railway-app.up.railway.app/callback"
  }'
```

### 2. Monitor n8n Executions

- Go to n8n → Executions tab
- Watch the workflow execute
- Check for any errors in HTTP Request nodes

### 3. Check Railway App Logs

```bash
railway logs
```

Look for:
- `Callback received` logs
- `Content streamed` logs
- `Stream completed` logs

### 4. Test End-to-End with Figma Site

1. Open your Figma site: `https://pod-chroma-42458729.figma.site`
2. Send a message that would trigger a T-level task (e.g., "Write me an essay")
3. Watch for:
   - Initial acknowledgment message
   - Streaming content appearing
   - Completion indicator

## Common Issues and Solutions

### Issue: "Session not found or expired"

**Cause:** The session_id in the callback doesn't match an active SSE connection.

**Solution:**
- Ensure the Railway bridge is receiving the session_id correctly from frontend
- Check that the session hasn't timed out (default: 2 minutes)
- Verify n8n is passing the correct session_id in callbacks

### Issue: "401 Unauthorized" or "403 Forbidden"

**Cause:** Bearer token is still present in headers.

**Solution:**
- Remove the Bearer header from HTTP Request nodes
- The Railway bridge doesn't use authentication

### Issue: Content not streaming to client

**Cause:** Missing or incorrect "type" field in callback body.

**Solution:**
- Add `"type": "content"` to all content callbacks
- Add `"type": "complete"` to completion callback

### Issue: Client never receives completion signal

**Cause:** No completion callback being sent.

**Solution:**
- Add the completion HTTP Request node
- Ensure it runs after the final content callback

## Webhook URL

Your webhook is configured with ID: `0bcd9cd7-c2a6-4ae5-9f84-db24327562fb`

**Webhook URL format:**
```
https://your-n8n-instance.com/webhook/0bcd9cd7-c2a6-4ae5-9f84-db24327562fb
```

Make sure this URL is set in your Railway app's environment variables:
```bash
railway variables set N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/0bcd9cd7-c2a6-4ae5-9f84-db24327562fb
```

## Next Steps

1. ✅ Deploy Railway app and get the URL
2. ✅ Update both HTTP Request nodes with the Railway URL
3. ✅ Remove Bearer header from HTTP Request1
4. ✅ Add "type" field to both HTTP Request nodes
5. ✅ Add completion HTTP Request node
6. ✅ Set N8N_WEBHOOK_URL in Railway environment variables
7. ✅ Test the complete flow
8. ✅ Deploy to production

## Support

If you encounter issues:
1. Check Railway app logs: `railway logs`
2. Check n8n execution logs
3. Use the test client (`test-client.html`) for debugging
4. Verify all environment variables are set correctly

## Additional Resources

- Railway Bridge README: `/README.md`
- Test Client: `test-client.html`
- Environment Config: `.env.example`
