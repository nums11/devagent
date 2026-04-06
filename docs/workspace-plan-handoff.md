# Workspace Plan Handoff

## Plan

The plan being implemented is a first-cut multi-workspace execution model for `dev-agent` so you can run parallel agent chats against `dev-agent` and `stick2it` without them colliding.

The intended design is:

1. Use `dev-agent` Supabase as the control plane.
2. Replace raw “workspace path” chat binding with named workspace instances.
3. Make each conversation bind to a `workspace_id`.
4. Store per-workspace execution metadata in `dev-agent` Supabase:
   - repo profile
   - local path / worktree path
   - branch name
   - pinned simulator UDID
   - Metro port
   - backend env label / Supabase project ref
   - sync status metadata
5. Keep Stick2It test Supabase projects as app-under-test backends only.
6. Use static simulator pinning for now, not dynamic leases.
7. Keep `/Users/team7agent/stick2it` as the base checkout and create additional worktrees for feature work.

The initial target workspace set is:

- `dev-agent-main`
- `stick2it-feature-a`
- `stick2it-feature-b`

Expected resource mapping:

- `dev-agent-main`
  - current repo path `/Users/team7agent/dev-agent`
  - one fixed simulator
  - one fixed Metro port
- `stick2it-feature-a`
  - worktree path under `/Users/team7agent/worktrees/stick2it/...`
  - current Stick2It test Supabase
  - one fixed simulator
  - one fixed Metro port
- `stick2it-feature-b`
  - second worktree path
  - second Stick2It test Supabase later
  - one fixed simulator
  - one fixed Metro port

## Decisions Already Settled

These are the design decisions already made and should be preserved:

- Workspace metadata belongs in `dev-agent` Supabase, not in Stick2It Supabase.
- Stick2It Supabase projects should only contain Stick2It runtime/test data and backend resources.
- Static simulator assignment is the right v1.
- Resources should conceptually follow active runs, but for now static pinning is enough.
- Conversation persistence and Codex thread persistence are separate from machine resource ownership.
- A conversation should be able to live forever; the workspace record is the durable execution context.

## Machine Facts Already Verified

These were already checked locally:

Stick2It repo:

- base checkout is `/Users/team7agent/stick2it`
- current branch is `main`
- remote is `git@github.com:nums11/stick2it.git`
- current worktree list only contains:
  - `/Users/team7agent/stick2it [main]`

Available simulators:

- `iPhone 17 Pro` `8657A45D-D490-4DB2-9CE5-D3463D0CF7A0`
- `iPhone 17` `D6CAAC93-11DE-4EDF-A684-A76E6A01285F`
- `iPhone 16 Pro` `A6550F0E-0B93-425E-9438-19D6974B724D`
- `iPhone 15 Pro` `446BD568-F8BA-4BFD-A09F-A97604854461`

These are enough for the current static assignment plan.

## Progress So Far

The work is partially implemented. The backend type/schema/model layer is halfway through. The API, UI, seed data, worktree creation, and verification are not complete.

Implemented or partially implemented:

1. `/Users/team7agent/dev-agent/apps/server/src/types.ts`
   Added new types:
   - `RepoProfileRecord`
   - `WorkspaceRecord`
   - `WorkspaceState`
   - `WorkspaceSyncStatus`

   Expanded `ConversationRecord` to include:
   - `workspaceId`
   - `workspaceName`
   - `workspaceSlug`
   - `workspaceBranchName`
   - `workspaceSimulatorName`
   - `workspaceSimulatorUdid`
   - `workspaceMetroPort`
   - `workspaceEnvLabel`
   - `workspaceSyncStatus`
   - `repoProfileSlug`
   - `repoProfileName`

2. `/Users/team7agent/dev-agent/apps/server/src/schemas.ts`
   `createConversationSchema` now accepts:
   - `workspaceId`

3. `/Users/team7agent/dev-agent/apps/server/src/db.ts`
   This is the most advanced part of the implementation so far.

   Added:
   - relation-aware mapping helpers
   - workspace/repo-profile select fragments
   - joined conversation selects
   - `listWorkspaces()`
   - `getWorkspace()`

   Updated conversation reads/writes so they expect:
   - `workspace_id`
   - joined workspace metadata
   - joined repo-profile metadata

   Important: this file is modified and partially integrated with the intended schema, but other layers are not yet wired to use it end-to-end.

4. Migration file created:
   `/Users/team7agent/dev-agent/supabase/migrations/20260406204500_add_repo_profiles_and_workspace_runtime_metadata.sql`

   Current contents:
   - creates `public.dev_agent_repo_profiles`
   - adds these columns to `public.dev_agent_workspaces`:
     - `slug`
     - `repo_profile_id`
     - `branch_name`
     - `simulator_name`
     - `simulator_udid`
     - `metro_port`
     - `env_label`
     - `supabase_project_ref`
     - `state`
     - `sync_status`
     - `behind_count`
     - `ahead_count`
     - `last_synced_main_sha`
     - `last_sync_checked_at`
     - `sort_order`
   - backfills `slug`
   - adds indexes

   Important: this migration is not finished. It does not yet:
   - add or backfill `workspace_id` support in conversations
   - seed repo profiles
   - seed the initial workspace rows
   - encode the actual three workspace assignments

5. `/Users/team7agent/dev-agent/apps/server/src/index.ts`
   Current status:
   - one earlier change already exists to broadcast socket events to all clients
   - the intended next patch was to:
     - add `GET /api/workspaces`
     - change `POST /api/conversations` to resolve `workspaceId` into the workspace path
   - that patch was interrupted and did not land

6. `/Users/team7agent/dev-agent/apps/mobile/App.tsx`
   No actual workspace-model conversion has been completed yet.

   Current state:
   - the file still fundamentally uses the older raw path / quick-pick / validate-directory flow
   - the file already had a large unrelated diff in progress before this workspace work
   - because of that, it needs careful editing to avoid trampling existing changes

## What Is Not Done Yet

These are the remaining pieces for the next agent.

### A. Finish the Supabase migration

Update `/Users/team7agent/dev-agent/supabase/migrations/20260406204500_add_repo_profiles_and_workspace_runtime_metadata.sql` to finish the schema.

It still needs:

- likely add `workspace_id` to `dev_agent_conversations` if not already present in schema
- ensure `workspace_id` has the proper FK to `dev_agent_workspaces`
- seed `dev_agent_repo_profiles`
  - `dev-agent`
  - `stick2it`
- seed `dev_agent_workspaces`
  - `dev-agent-main`
  - `stick2it-feature-a`
  - `stick2it-feature-b`

Recommended seeded values:

- `dev-agent-main`
  - repo profile: `dev-agent`
  - local path: `/Users/team7agent/dev-agent`
  - branch name: `main`
  - simulator: choose one pinned device
  - Metro port: dedicated value
  - env label: probably null or `local`
  - supabase project ref: null or control-plane marker
- `stick2it-feature-a`
  - repo profile: `stick2it`
  - local path: target worktree path
  - branch name: `agent/feature-a`
  - simulator: pinned device
  - Metro port: dedicated value
  - env label: current Stick2It test env label
  - supabase project ref: current Stick2It test ref
- `stick2it-feature-b`
  - repo profile: `stick2it`
  - local path: second worktree path
  - branch name: `agent/feature-b`
  - simulator: pinned device
  - Metro port: dedicated value
  - env label: placeholder until second test env exists
  - supabase project ref: placeholder/null until provided

### B. Finish server API wiring

Update `/Users/team7agent/dev-agent/apps/server/src/index.ts`.

Needed changes:

- import `listWorkspaces` and `getWorkspace`
- add `GET /api/workspaces`
- update `POST /api/conversations`
  - if `workspaceId` is present, fetch workspace
  - use `workspace.localPath` as `workspacePath`
  - force mode to `workspace`
  - store both `workspaceId` and `workspacePath`
- keep current general-chat path working when no workspace is selected

Also verify `/Users/team7agent/dev-agent/apps/server/src/codexBridge.ts` continues to work unchanged, since it still reads `conversation.workspacePath`. That is acceptable for now as long as `workspacePath` is properly populated from the selected workspace.

### C. Finish DB layer validation

The changes in `/Users/team7agent/dev-agent/apps/server/src/db.ts` need to be sanity-checked against the actual Supabase relation return shape.

The current implementation added helper logic for relation arrays vs objects. The next agent should verify:

- select aliases and FK names are correct
- the nested joins work in the actual Supabase query layer
- TypeScript still passes after schema/API updates

### D. Create the actual Stick2It worktrees

No worktree has been created yet.

Needed commands are conceptually:

```bash
git -C /Users/team7agent/stick2it fetch origin
git -C /Users/team7agent/stick2it worktree add /Users/team7agent/worktrees/stick2it/feature-a -b agent/feature-a origin/main
git -C /Users/team7agent/stick2it worktree add /Users/team7agent/worktrees/stick2it/feature-b -b agent/feature-b origin/main
```

Before doing this:

- ensure `/Users/team7agent/worktrees/stick2it` exists
- decide whether `feature-a` should point to the existing current test Supabase immediately
- `feature-b` can be seeded with placeholder env metadata until the new Supabase project is provided

### E. Replace mobile raw-path selection with workspace selection

Update `/Users/team7agent/dev-agent/apps/mobile/App.tsx`.

Current behavior:

- hardcoded workspace quick picks
- optional custom directory input
- `/api/workspaces/validate` flow
- conversation creation posts `workspacePath`

Target behavior:

- load workspaces from `GET /api/workspaces`
- keep a `General chat` option
- select a named workspace row instead of typing a path
- show metadata in the picker:
  - workspace name
  - repo/profile
  - branch
  - simulator
  - env label
- on create conversation, post `workspaceId`
- keep general chat sending `workspaceId: null`

Also update conversation labels to show:

- `workspaceName`
- maybe branch/simulator/env summary in thread metadata or top bar

The existing path validator may either:

- be removed from the new chat sheet, or
- be left only for admin/debug use

For this feature, named workspace selection is the main goal.

### F. Update Maestro coverage

Existing relevant flow:

- `/Users/team7agent/dev-agent/.maestro/ios/workspace-validation-smoke.yaml`

Right now it still validates a typed path:

- taps `workspace-path-input`
- enters `/Users/team7agent/dev-agent`
- presses `validate-workspace-button`

That will need to change once the picker becomes workspace-instance based.

Likely replacement:

- open new chat
- choose `dev-agent-main` workspace row by deterministic `testID`
- start new chat
- assert composer is visible

Add or update `testID`s for:

- workspace list container
- each workspace row
- selected workspace row
- workspace metadata labels if needed

Per repo instructions, stable deterministic `testID`s are required for interactions.

### G. Run verification

Nothing has been verified yet for this feature.

Once implementation is complete, run:

- `npm run typecheck`
- most relevant smoke:
  - likely `npm run smoke:ios:workspace`
  - and possibly `npm run smoke:ios:chat` to confirm general chat still works

If the workspace flow changes enough, update the smoke path accordingly.

Need to report:

- exact smoke command
- latest passing Maestro flow path
- Maestro debug path under `.maestro/tests/<timestamp>/`
- any retries/fixes

## Important Current State / Risks

1. There are pre-existing unrelated local changes in this repo.
   The next agent should not overwrite them casually.

2. The biggest in-progress files are:
   - `/Users/team7agent/dev-agent/apps/mobile/App.tsx`
   - `/Users/team7agent/dev-agent/apps/server/src/index.ts`

3. `/Users/team7agent/dev-agent/apps/mobile/App.tsx` already has a large diff unrelated to this task, so edits should be narrow and careful.

4. The server model is currently ahead of the API/UI.
   That means the next agent should probably finish backend integration first, then mobile, then verification.

## Recommended Next Sequence For A New Agent

1. Inspect current diffs in:
   - `/Users/team7agent/dev-agent/apps/server/src/types.ts`
   - `/Users/team7agent/dev-agent/apps/server/src/schemas.ts`
   - `/Users/team7agent/dev-agent/apps/server/src/db.ts`
   - `/Users/team7agent/dev-agent/apps/server/src/index.ts`
   - `/Users/team7agent/dev-agent/apps/mobile/App.tsx`

2. Finish the migration:
   - conversation `workspace_id`
   - repo profile seed
   - workspace seed rows

3. Finish server routes:
   - `GET /api/workspaces`
   - workspace-aware `POST /api/conversations`

4. Create Stick2It worktrees on disk.

5. Update mobile new-chat UI to use server-backed workspace selection.

6. Add/update `testID`s.

7. Update `.maestro/ios/workspace-validation-smoke.yaml`.

8. Run:
   - `npm run typecheck`
   - `npm run smoke:ios:workspace`

9. If smoke fails:
   - inspect `.maestro/tests/...`
   - patch selectors/UI
   - rerun until green

## Short Handoff Summary

The workspace architecture is decided. Backend types/schema/db mapping are partially in place. A new migration file exists but is incomplete. The API route layer, mobile picker, workspace seeds, Stick2It worktree creation, and all verification are still outstanding. The next agent should finish backend first, then mobile, then Maestro/typecheck.
