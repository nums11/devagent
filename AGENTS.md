# Dev Agent Playbook

This repo supports the shorthand `run full agent dev harness`.

For `dev-agent`, that phrase means:
- implement the requested feature
- add or update stable `testID`s for every interaction the flow needs
- add or update the relevant Maestro flow under `.maestro/ios/`
- run the iOS verification loop until it passes
- report the exact smoke command, Maestro debug path, and any retries or fixes that were needed

## Default Verification Workflow

1. Inspect the feature area in `apps/mobile` and any required bridge logic in `apps/server`.
2. Implement the feature.
3. Add or update deterministic `testID`s in the mobile UI.
4. Add or update the relevant Maestro flow in `.maestro/ios/`.
5. Run typecheck:
   - `npm run typecheck`
6. Run the most relevant smoke flow until it passes:
   - `npm run smoke:ios:chat`
   - `npm run smoke:ios:theme`
   - `npm run smoke:ios:steer`
   - or run `maestro test .maestro/ios/<flow>.yaml` for a new feature-specific flow
7. If a harness run produces a proof video and the work was requested from inside a `dev-agent` chat, publish that video back into the conversation:
   - `npm run publish:proof-video -- <conversationId> <localPath> [message]`
8. If the flow fails:
   - inspect the latest debug output in `.maestro/tests/`
   - inspect screenshots and hierarchy output
   - patch the UI, selector, or mobile flow
   - rerun until green

## Runtime Assumptions

- Start the bridge with `npm run dev:server`
- Launch the mobile app from the repo root with `npm run ios -- --port 8081`
- Do not use `npx expo run:ios` from the repo root directly
- The mobile app workspace is `apps/mobile`
- The server workspace is `apps/server`

## Artifact Conventions

- Maestro debug output is under `.maestro/tests/<timestamp>/`
- If a task needs proof media, prefer saving it under `artifacts/ios/<timestamp>-<feature>/`
- Proof videos published into chat are stored in the Supabase Storage bucket `proof-videos`
- When reporting completion, include:
  - changed behavior
  - key files touched
  - smoke command(s) run
  - latest passing Maestro flow path
  - relevant artifact/debug paths

## Current Smoke Flows

- `.maestro/ios/chat-smoke.yaml`
- `.maestro/ios/theme-persistence-smoke.yaml`
- `.maestro/ios/steer-smoke.yaml`

## Guidance

- Prefer deterministic selectors over text matching when possible.
- For chat assertions, prefer stable message-order `testID`s over raw visible text.
- If iOS modal taps are flaky, improve the UI event wiring instead of only loosening the smoke timeout.
- Keep the mobile shell visually close to Codex desktop, but optimize interactions for touch first.
