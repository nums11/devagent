#!/usr/bin/env node

const [, , conversationId, localPath, ...contentParts] = process.argv;

if (!conversationId || !localPath) {
  console.error('Usage: node scripts/publish-proof-image.mjs <conversationId> <localPath> [message]');
  process.exit(1);
}

const apiUrl = (process.env.DEV_AGENT_API_URL || 'http://localhost:4242').replace(/\/+$/, '');
const content = contentParts.join(' ').trim();

const response = await fetch(`${apiUrl}/api/conversations/${conversationId}/proof-image`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    localPath,
    ...(content ? { content } : {})
  })
});

const payload = await response.json();

if (!response.ok) {
  console.error(payload.error || 'Failed to publish proof image.');
  process.exit(1);
}

console.log(JSON.stringify(payload, null, 2));
