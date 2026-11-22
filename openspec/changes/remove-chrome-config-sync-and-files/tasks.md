## 1. Remove Chrome configuration sync

- [x] 1.1 Remove the Model settings card, sync worker registration, sync module, and sync-only styles/copy; keep local settings and memory alarms. Replace sync-only tests with an extension regression that seeds differing local and legacy sync snapshots, verifies local save/reload and no cloud access or update, and confirms the card is absent.
- [x] 1.2 Remove feature instructions and outdated sync claims from README and `REBUILD_SPEC.md`; verify current privacy guidance says configuration remains in the profile and does not imply that legacy Chrome copies are deleted.

## 2. Remove the local Files workspace

- [x] 2.1 Make saved built-in workspace tool parts inert in the transcript UI and continuation path without rewriting stored chat. Add regression coverage for completed and pending records: history remains visible, no retired approval can be submitted, a new turn succeeds, and an unrelated MCP approval remains actionable.
- [x] 2.2 Remove Files settings, picker/recovery controls, Changed files UI/styles, the workspace implementation and search worker, and the eight tools from both model execution and composer discovery. Remove obsolete workspace-only tests and fixtures. Verify in the extension that Settings and `@tools` no longer expose Files and provider requests offer no retired tools, while screenshot, browser and MCP flows still pass.
- [x] 2.3 Remove file-specific instructions and compaction/data-tool hints. Replace `read_file` data fixtures with session data or `run_js` outputs; verify data-ID chaining, bounded previews and size policy still pass. Remove `diff` and `ignore` direct dependencies and refresh the lockfile; confirm `idb` remains available to session storage.
- [x] 2.4 Update README, `REBUILD_SPEC.md`, and `docs/ai-data-store.md` to reflect the surviving tools and data flow; verify no current instructions recommend connecting a folder or calling a retired workspace tool.

## 3. Verify the integrated extension

- [x] 3.1 Run `pnpm compile`, `pnpm format:check`, `pnpm test`, `pnpm build`, and `pnpm test:e2e`. Check the production bundle no longer contains the legacy background sync entry point or Files search worker, and confirm the git diff excludes unrelated screenshot changes.
