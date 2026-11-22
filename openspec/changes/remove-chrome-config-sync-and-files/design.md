## Context

See [proposal.md](proposal.md) for motivation. The background worker starts `src/lib/config-sync.ts`, which listens for local and cloud changes and schedules sync alarms. Settings already persist independently through `local:settings`; memory enablement is also local. The worker's separate memory alarms still require the `alarms` permission.

Files is a subsystem spanning `src/lib/files/`, workspace settings, chat approvals and previews, both tool registries in `local-chat-transport.ts`, prompts, and the `read_file` path into the session data store. Saved transcripts can contain completed tool parts and unresolved approvals independently of the runtime registry.

## Goals / Non-Goals

**Goals:** Remove the feature implementations and their wiring, not just their UI. Preserve independently useful settings/storage, chat, and tools.

**Non-Goals:** No new import/export or file interface. No sweep of profile storage, Chrome sync storage, or disk, and no changes to browser/MCP approval policies.

## Decisions

1. **Remove the sync lifecycle at its entry points.** Delete the settings card, background registration, sync module, and dedicated tests. Keep existing local settings/memory persistence and manifest permissions still used elsewhere. Hiding the card alone would leave old installations syncing; retaining a one-shot cleanup would keep cloud access around and could delete a snapshot shared with another installation.
2. **Remove Files end-to-end.** Delete the workspace modules, search worker, settings card, diff approvals, and Changed files UI and styles. Remove registration from both the composer catalog and chat execution, and remove stale prompt, `run_js`, and compaction guidance. Keep the session data store and `idb` for existing data and code results; remove the workspace-only `diff` and `ignore` dependencies. Keeping read-only workspace access would retain the permission and filesystem machinery this change is meant to remove.
3. **Handle old workspace parts as inert history at the chat boundary.** Keep the saved transcript intact; render retired calls as historical records without previews or approval buttons. Recognize recorded built-in workspace parts before generic MCP handling. Exclude retired call/result parts as a unit from the executable model view and approval continuation so orphaned tool pairs or pending approvals cannot block the next turn. Do not register stub tools or rewrite stored chats merely to reopen them. Keep historical text available to chat history and preserve unrelated dynamic tool parts.

## Risks / Trade-offs

- [Old copies of credentials may still exist in Chrome sync] → The new version ignores them; it does not claim to erase Chrome's copies or revoke credentials.
- [Tool removal can make past messages invalid for a provider or cause an old approval to fall through to MCP UI] → Exercise completed and pending workspace records in a continued chat and verify unrelated tool approvals still work.
- [Shared data tests currently use `read_file` to seed data] → Replace that fixture with a session data record or a `run_js` result, and retain coverage of data-ID chaining and dataset size limits.

## Migration Plan

Release as an ordinary extension update with no data migration. Existing local configuration and saved chats remain in place; legacy sync snapshots and workspace data are left alone and unused. An older build could restore the removed features and act on its prior state, so rollback must not be described as preserving the new no-sync/no-workspace behavior.
