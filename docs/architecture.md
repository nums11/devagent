# Architecture

## Summary

Dev Agent is a phone-accessible Codex control app. It separates conversation state, Codex execution, and mobile UI into clear layers:

- Expo mobile app for chat and live updates
- Node server running on the Mac mini
- Codex SDK for persistent local Codex threads
- Supabase for auth, metadata, and artifact indexing

## Why This Exists

The goal is not only "submit jobs to Codex." It is to preserve an ongoing relationship with the same Codex thread while allowing the thread to become repo-aware when needed.

That means the app must support:

- plain chat
- workspace-bound chat
- execution-oriented runs
- resumable conversations

## Core Flow

1. The phone sends a message to the server.
2. The server looks up the conversation and Codex thread ID.
3. The server starts or resumes a Codex SDK thread.
4. The server calls `runStreamed()` and forwards events to the phone over WebSocket.
5. The server stores the user message, run metadata, final response, and raw event log.

## Modes

### Chat mode

- no workspace required
- useful for planning, questions, and iteration

### Workspace mode

- conversation is bound to a local repo path on the Mac mini
- Codex runs with a configured working directory
- the same thread continues over time

### Harness mode

- same conversation, but prompts can ask Codex to run repo workflows
- later this will include full Maestro/Xcode/local-Supabase loops

## Backend Responsibilities

- conversation CRUD
- Codex thread lifecycle
- streaming events to clients
- persistence of messages and runs
- workspace policy enforcement

## Mobile Responsibilities

- auth
- conversation list
- conversation detail screen
- live event stream
- run and artifact status

## Persistence

Supabase should store:

- users
- devices
- workspaces
- conversations
- messages
- runs
- artifacts

Codex thread IDs should be stored so `resumeThread(threadId)` can continue the same thread later.

## Security

- only authenticated app users can talk to the backend
- workspace access is allowlisted
- backend should run on the Mac mini or another trusted host
- production repo actions or deploy-like flows should remain explicitly gated

## Near-Term MVP

1. Chat from phone
2. Keep Codex thread continuity
3. Stream progress events
4. Bind a conversation to one workspace
5. Show final response and event timeline

## Later Phases

- background push notifications
- artifact gallery
- multi-workspace support
- full agent dev harness integration
- branch / commit / PR controls

