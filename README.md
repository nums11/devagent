# Dev Agent

Phone-first Codex control app.

This project is a separate control plane for Codex, not part of the Stick2It app itself.

## Goals

- Chat with Codex from a phone without needing the Codex desktop app open
- Preserve ongoing Codex threads instead of spawning a brand new task every turn
- Support a plain chat mode first
- Grow into a workspace-aware mode that can talk to local repos on the Mac mini
- Eventually support execution-heavy flows like "run full agent dev harness"

## Project Layout

- `apps/server`
  - Node server that wraps the Codex SDK and exposes a mobile-friendly API
- `apps/mobile`
  - Expo app for chat, conversation history, and live Codex event streaming
- `supabase`
  - Schema and migrations for auth, conversations, runs, and artifacts metadata
- `docs`
  - Architecture, rollout plan, and operational notes

## Local Development

1. Install dependencies:

```bash
cd /Users/team7agent/dev-agent
npm install
```

2. Start the Codex bridge:

```bash
npm run dev:server
```

3. Start the Expo app:

```bash
npm run dev:mobile
```

4. Or launch the iOS simulator app directly:

```bash
open -a Simulator
npm run ios
```

Use the repo-root workspace scripts as the only supported launch path.
Do not run `npx expo run:ios` from `/Users/team7agent/dev-agent`, because the old root Expo scaffold has been removed on purpose.

## Current Working State

Today the app is wired up far enough to test the end-to-end loop:

- the mobile app can create a conversation
- new chats can stay unbound for general chat or be explicitly bound to a local repo directory
- it can connect to the local WebSocket bridge
- the server can start or resume a Codex thread
- Codex events stream back into the app
- conversations, messages, and runs are persisted in the linked Supabase project
- the final assistant response is reflected back into the app UI
- there is no auth gate yet

## Quick Test

In one terminal:

```bash
cd /Users/team7agent/dev-agent
npm run dev:server
```

In a second terminal:

```bash
cd /Users/team7agent/dev-agent
open -a Simulator
npm run ios
```

Then in the app:

1. Tap `New Chat`
2. Either leave it as a general chat or pick / validate a repo directory
3. Tap `Start New Chat`
4. Type a short prompt like `Reply exactly hello from phone`
5. Tap `Send`
6. Watch the status change to `Codex turn completed`
7. Check the live activity timeline for the completed run

Optional automated smoke:

```bash
cd /Users/team7agent/dev-agent
npm run smoke:ios
```

The Maestro flow lives at [/Users/team7agent/dev-agent/.maestro/ios/chat-smoke.yaml](/Users/team7agent/dev-agent/.maestro/ios/chat-smoke.yaml).

The live datastore is now the linked Supabase project. The mobile app still talks to the local Node bridge for Codex execution, but the bridge persists conversations, messages, and runs to Supabase instead of local SQLite.

## Proof Media In Chat

When a feature run produces proof media, the server can publish that artifact directly into a chat conversation as an assistant message attachment.

From the repo root:

```bash
npm run publish:proof-video -- <conversationId> <localPath> "Proof video attached."
npm run publish:proof-image -- <conversationId> <localPath> "Simulator screenshot attached."
```

That flow:
- uploads proof videos into the Supabase Storage bucket `proof-videos`
- uploads proof screenshots into the Supabase Storage bucket `proof-images`
- creates an assistant message in the target conversation
- broadcasts the new message over WebSocket so an open mobile chat can update live

If you add or update this feature locally, rebuild the iOS app once because inline playback uses `expo-video`:

```bash
npm run ios -- --port 8081
```

## Environment

The server expects:

- `PORT`
- `CODEX_WORKSPACE_ROOT`
- `CODEX_DEFAULT_MODEL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DEV_AGENT_ALLOWED_ORIGIN`

The mobile app expects:

- `EXPO_PUBLIC_DEV_AGENT_API_URL`
- `EXPO_PUBLIC_DEV_AGENT_WS_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

See [architecture.md](/Users/team7agent/dev-agent/docs/architecture.md) for the intended production shape.
