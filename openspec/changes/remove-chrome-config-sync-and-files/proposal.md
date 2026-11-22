## Why

Chrome configuration sync and the local file workspace add settings, permission prompts, and recovery paths that AMA no longer needs to support. Removing both simplifies the extension while preserving its core browser and chat workflows.

## What Changes

- **BREAKING:** Remove Chrome configuration sync from Settings and the background worker. Configuration and credentials remain in the current Chrome profile; AMA no longer uploads, downloads, or follows Chrome sync snapshots. Do not migrate or clean up legacy sync data.
- **BREAKING:** Remove the Files workspace settings, all eight built-in workspace tools, file approvals, backups/preview controls, and the Changed files viewer. AMA no longer connects to a local directory. Do not modify actual disk files or purge legacy storage on upgrade.
- Keep saved chats, screenshot attachments, browser tools, MCP tools, and sandboxed code/data workflows. A saved chat containing old workspace tool records must still be readable and usable; a pending local file operation must not be resumable.

## Capabilities

### New Capabilities

- `local-configuration`: Configuration is persistent within the current Chrome profile and is not synchronized by AMA.
- `native-tool-scope`: AMA's built-in tools do not access a local file workspace; historic workspace records do not grant tool access.

### Modified Capabilities

None. The project has no published OpenSpec baseline for these behaviors.

## Impact

Settings and background sync, tool registration and discovery, prompts, saved-chat rendering and continuation, workspace source and dependencies, and the corresponding documentation and tests. No backend, replacement file interface, migration, or release work is in scope.
