# Validation record

## Text size setting (v0.3.0)

**Settings → Display → Text size** offers Small / Default / Large / Extra large (0.9 / 1 / 1.15 / 1.3 of the 13px baseline) plus **Reset**. The choice is stored as `Settings.fontScale`, validated by `getFontScale` (finite 0.8–1.5, otherwise 1), and included in optional configuration sync. `App` writes it to `--ama-font-scale` on `<html>`; every px font size in `globals.css`/`typeset.css` is multiplied by that variable, and Tailwind's text-size tokens (`--text-xs` … `--text-3xl`) are overridden so utility classes scale too. Spacing and layout do not scale.

Verified locally in the built unpacked extension: computed sizes changed from 11px to 14.3px (hints) and 15px to 19.5px (headings) at Extra large, 0.9 at Small; the choice survived a panel reload, Reset returned to 1, and the four settings tabs and four option cards had no horizontal overflow at 400px panel width. Unit tests cover the default, invalid stored values, config-sync round-trip, the option markup and the applied CSS variable.

## Control+K and composer focus

Per user request, macOS toggle now uses literal Control+K (`MacCtrl+K` in Chrome manifest), not Command+K. Panel key handling accepts unmodified Control+K only; Command/Alt/Shift variants do not close it. Existing Chrome installations may preserve an old command assignment; update it manually at `chrome://extensions/shortcuts` after reload. This does not claim external OS shortcut conflicts are eliminated.

Chat now focuses the composer after mount/new-session mount and when returning from another AMA view. Window-focus/visibility recovery only focuses when the document has no active control, and hidden chat views do not steal focus from settings. It never refocuses on streamed tokens or ordinary rerenders. Unit tests cover entry, cleanup, hidden-view cancellation and preserving controls; browser tests check initial/reloaded entry, return from settings and retained button/input focus. Control+K key delivery calls a stubbed close function in the browser test; actual native panel close and OS-level key delivery are not newly certified by this check. Full validation: **40 unit-test files / 110 tests**, **18 browser scenarios**, format/types/production build.

## Development HMR port collision fix

Observed another project's Node server on wildcard port 3000 while AMA WXT listened on IPv6 `::1:3000`. A direct `vite-hmr` WebSocket handshake failed at `127.0.0.1:3000` and succeeded at `[::1]:3000`, matching the reported wrong-service HTTP response. AMA now uses an explicit IPv4 listener and origin at `127.0.0.1:3197` with `strictPort: true`. A fresh WXT server started through the real `createServer` API (browser runner disabled) successfully completed a real `vite-hmr` WebSocket handshake at that address, and generated dev HTML references the new origin. Production output was audited to exclude the HMR/reload client. The already-running WXT process must be stopped/restarted: its config hot-restart retained the old port during this investigation. Then reload the existing extension and close/reopen the panel; do not uninstall or delete storage. This does not certify the user's already-open Chrome panel has reconnected.

## Verified locally

The production extension was built and exercised in a real unpacked Chromium installation using deterministic local provider, embedding, and MCP endpoints. No production API credentials or model weights were needed.

| Check | Result |
| --- | --- |
| `pnpm compile` | Passed |
| `pnpm format:check` | Passed |
| `pnpm test` | 30 files, 70 tests passed |
| `python3 -m unittest discover -s tools/embed-server -p 'test_*.py'` | 2 tests passed with a toy encoder |
| `pnpm build` | Extension directory and 1.04 MB ZIP generated |
| `pnpm test:e2e` | 13 scenarios passed |

Build outputs:
- `.output/chrome-mv3/` — load unpacked in Chrome.
- `.output/ama-0.1.0-chrome.zip` — packaged extension.

The build emits a non-fatal warning about chunks larger than 500 kB, including syntax-highlighting grammars.

## Browser coverage

The scenarios cover the feature areas in `REBUILD_SPEC.md` §19.2, but the scenario count alone is not proof of every individual acceptance assertion:

1. Grounded streaming, model listing/switching, history ordering/reopen/delete, and reload.
2. Highlight/focus/replay, safe filling, browser-derived approval labels, and original-tab approval continuation.
3. Explicit memory persistence/injection, used-memory metadata after reload, and clear shortcut.
4. Select/check, denied submission without side effects, background lookup/cleanup, plan completion, and denied access to another user's tab.
5. Image attachment and payload, full-page dimensions, restored scroll/DOM state, visible-image removal, and tab-change capture rejection.
6. MCP connection status, read execution, approved write, and server instructions.
7. Doubtful and foreign-link approvals, site scope, memory disablement, and settings navigation.
8. Relevant-reference retrieval, unrelated-reference exclusion, shared query embedding, and cross-language history search.
9. Repeated-habit suggestions, user-only extraction, confirmation before activation, and lightweight model selection.
10. Semantic contradiction/replacement/undo, paraphrase reinforcement, similar-pair merging, memory disable/delete, and back navigation.
11. User-supplied reference links, previous-chat tool results, large MCP tool filtering with built-ins retained, embedding-outage fallback, and connection testing.
12. Clipboard Markdown/feedback without learning, panel clear shortcuts, Chrome command configuration, alarm learning, and no-new-signals guard.

Unit tests additionally cover validation, privacy/sensitive-domain/incognito guards, import/export/store operations, cache invalidation, timeout/error fallbacks, relation judging, learning locks/cursors, worker-safe REST adapters for all four providers, and shared MCP connections.

## Settings fixes

- Button uses the shadcn/ui `base-nova` CVA + Base UI implementation with explicit outline/ghost foreground colors. Removed conflicting legacy classes where `button-default` meant both variant and size, and mapped Tailwind theme colors to light/dark variables.
- Two added component tests check variant/size isolation and markup. Browser scenario 13 checks Model, Memory, and Tools actions in both themes, including hover, for minimum 4.5:1 text contrast; it also verifies primary Send foreground. Screenshots: `test-results/settings-light.png` and `test-results/settings-dark.png`.
- At the user's request, the compatible default endpoint is `https://api.qnaigc.com/v1`, read from `OPENAI_BASE_URL` in the local shell configuration. No credentials were imported. Existing stored endpoints are not overwritten; users with older saved settings should change Base URL manually. The default model's availability at this endpoint has not been verified.

## Per-reply changed-file previews

Added a changed-files card after nonstreaming assistant replies, deduplicated by workspace identity/path, counting only successful create/edit/patch/delete outputs. Each successful mutation returns a lightweight receipt and saves local before/after text separately (100 operations / 30 MiB UTF-8 budget). The Base UI dialog previews literal After/Before and net diff, supports download, close/Escape, and explicitly labels historical snapshots. Deleted contents remain viewable; stale/cleared previews fail visibly without rereading disk. Settings exposes a snapshot clear action; recovery backups are unchanged. Snapshot persistence failure leaves the committed operation marked successful to avoid duplicate writes.

Local validation: **35 test files / 93 tests**, **16 browser scenarios**, formatting/types/ZIP build. Coverage includes grouping, rejected/failed/read exclusions, receipts without bodies in chat/model outputs, snapshot history persistence, retention, missing previews and storage-failure semantics. Browser real-handle tests create/modify three files (one twice), verify a three-entry list, create/delete views, before/after/net diff, literal script text with no execution, download, Escape, external disk changes not affecting old previews, reload persistence and cleared-snapshot errors. Native OS-directory interaction and subjective visual review remain unclaimed.

## Optional full-configuration Chrome sync (explicit user override)

Implemented a default-off, per-installation opt-in sync of all model/provider/MCP/embedding configuration **including API keys, tokens and headers**, fetched model lists and memory's enable flag. Explicit first-upload/first-download confirmations, status/error reporting, disable-vs-cloud-clear semantics and privacy copy replace the original unconditional local-only claim. History, memory contents/events/vectors, file previews/backups and OS handles remain local. Sync storage access is restricted to trusted extension contexts.

A background-owned serialized controller captures validated versioned snapshots, debounces uploads, records pending revisions before debounce for worker restart, retries via alarms, suppresses import echo writes and uses deterministic whole-snapshot revision ordering. gzip/base64 chunks, SHA-256 integrity, bounded decompression/schema validation and conservative quota limits reject incomplete/corrupt/oversized data without applying partial configurations or dropping fields. Chrome sync is eventual, not CAS/distributed transactions: simultaneous devices and clock skew can still overwrite a whole configuration. Explicit upload/download recovery is available. AMA adds no encryption and cannot remotely revoke copied credentials.

Local checks: **39 unit-test files / 108 tests**, **18 browser scenarios**, **6 Python tests**, types/format/production ZIP. Tests cover secret-inclusive round trips, no history/memory leakage, default-off/no upload, explicit directions, imported memory enable with contents retained, malformed/incomplete/corrupt cloud data, multi-chunk quota limits, sanitized errors, stale connection/config revisions, no echo, worker-restart pending state and disable/clear ownership. An unpacked-extension browser scenario exercises real `chrome.storage.sync`, confirms upload including all credential classes, observes debounced local changes, simulates an incoming cloud snapshot, verifies local update/reload and disable/clear without history deletion.

This does **not** validate Google-account cloud delivery, real cross-device conflicts, browser sync policy/sign-in, service deletion or unpacked extension-ID portability. Same Chrome account + same extension ID + enabled Chrome extension sync are required. Upload timestamps only indicate local sync-area writes, not remote acknowledgment.

## Unified model selector

Settings and composer now reuse `ModelPicker`, including semantic shadcn trigger styling, search, selection indicator and explicit custom-ID selection. Settings scopes to its provider, including not-yet-configured providers; composer retains configured-provider groups plus the active provider. Search drafts are not saved as model choices, and custom IDs containing separators round-trip correctly.

Local verification: **37 unit-test files / 98 tests**, **17 browser scenarios**, format/types/production ZIP. Unit tests cover scoped/deduplicated/current-provider groups and shared trigger markup. The unpacked-extension browser scenario fetches models, searches/selects in settings, selects a custom ID, cancels another draft with Escape, verifies persistence and composer synchronization, then selects and actually invokes a fetched model in chat. These are deterministic local-provider tests, not live model-availability checks.

## MCP custom HTTP headers

Each server accepts an optional string-valued header map; older saved configurations need no migration. The JSON editor autosaves valid input, reports invalid drafts while retaining the last saved configuration, and disables connection testing for invalid drafts. Custom Authorization overrides Bearer Token case-insensitively; empty tokens no longer emit empty Bearer auth. Header validation rejects injection, duplicate case-insensitive names and browser/transport-owned headers without including secret values in validation errors. Connection identity includes canonical effective headers, so credential changes close old connections and equivalent ordering/case shares connections.

Local verification: **36 unit-test files / 96 tests**, **17 browser scenarios**, **6 Python tests**, format/types/production ZIP. Added header merge/precedence/validation/canonical cache/reconnect tests; a real unpacked-extension scenario verifies invalid input, autosave/reload, actual HTTP headers for connection testing and model-invoked MCP reads, and absence of configured header values in the model request. These use a local mock MCP endpoint, not live service credentials or an assertion of universal gateway compatibility.

## User-enabled scoped Danger mode

Added default-off persisted `dangerMode` in Settings → Tools, a visible chat ON notice and config-sync schema/roundtrip support with sync disclosure. A strict-true setting snapshots at the next transport request and bypasses native memory save/forget and browser cross-tab/read/write/committing-click approvals. Sensitive memory remains reference-only; Memory Off remains authoritative. Automatic learned habits activate at the existing repeated-evidence threshold, without changing sensitive/private-source exclusions. File mutations/MCP writes, workspace/owned-tab/browser-permission limits and public-search privacy remain unchanged. No UI auto-clicking existing approvals, no retry of denied actions, no retroactive cancellation of a running request.

Validation: **43 files / 131 unit/integration tests**, **21 unpacked-extension scenarios**, format/types and production ZIP. Browser scenario enables/reloads the setting, saves/forgets a synthetic credential without confirmation, fills/submits a local form, reads another existing tab, verifies MCP write still requires approval, then disables and verifies sensitive memory/submit approvals return. Unit coverage includes no intent-judge invocation, default-off/config-sync persistence, Memory Off, closed-tab ownership and evidence-threshold activation while excluding synthetic credentials. This is deterministic mock-provider/local-form validation, not a guarantee against AI errors or prompt injection; no real payment/destructive external action was performed.

## User-controlled sensitive explicit memory

Removed the explicit `remember` credentials/card hard refusal at the user's request. Detection now triggers a save confirmation explaining local unencrypted storage and potential transmission to configured chat/embedding services. Confirmed explicit saves are references (including reinforced legacy entries), with `Private reference` as a missing-topic fallback so raw secret text is not used as a fallback catalogue label. Normal intent/foreign-link approvals and memory-off behavior remain; automatic extraction/merger exclusions are unchanged. Updated memory UI and model instructions distinguish local persistence from provider processing, and allow explicitly requested private facts without indiscriminate public-tool disclosure.

Validation: **127 unit/integration tests** and **20 unpacked-extension scenarios** passed, plus format/types/production ZIP. Added explicit credentials/card saves, approval disclosure, duplicate category correction, safe fallback label, forgetting sensitive entries and prompt tests. Browser test confirms a synthetic credential, reloads local storage, verifies absence from an unrelated new-chat prompt (embeddings off), and retrieves it via `recall_memory`. This does not certify general secret detection, semantic relevance quality or an encrypted vault. With embeddings enabled, memory text may be sent to that endpoint and relevant matches may be included in chat-model prompts; exports remain plaintext. No live provider credentials were used.

## Local embedding HTTP timeout recovery

Reproduced `TimeoutError: signal timed out` with the CPU service: real HTTP `connection test` requests took 8.3–17.1 seconds, while an isolated encoder took 56–64 ms. The single-threaded `HTTPServer` can wait on an idle browser/preconnect socket for its 30-second read timeout; a toy-encoder reproduction blocked a health request until that socket closed. Long/batched inference also blocked all following HTTP requests. Logs showed client disconnects causing repeated BrokenPipe tracebacks, not proof of failed model inference.

Changed the service to `ThreadingHTTPServer` with a nonblocking shared inference lock: health and idle sockets no longer block other connections; overlapping embedding calls return explicit 503 busy instead of queuing work past client deadlines. Inference stays serialized, and client disconnects are handled without a second error response. The already-running inference is not cancelled by a client abort. No client timeouts/model/token limits were changed.

Validation: **10 Python tests passed**, including idle sockets, health during busy inference, immediate busy response/no second encoder invocation, lock recovery after failure and disconnected writes. Restarted the actual CPU service; five 1024-d short-query requests completed in **54–57 ms** with a concurrent idle socket. Native user-extension UI was not driven; retry Test connection there. Long texts/batches can still exceed AMA's 2.5/5/10-second deadlines; this fix is not a long-input performance claim.

## DeepSeek public web tools

Added default-off independent Search/Fetch settings/key, native `web_search`/`web_fetch` tools for any chat model, bounded summaries/Markdown, source cards and configuration-sync schema support. Limits persist through tool receipts across approval continuation/reload; parallel calls consume a shared per-stream budget. Public URL checks, minimal requests, no cookies/referrers, bounded response reads, cancellation/timeouts and finite status-aware retries are covered. A real-extension test caught native `fetch` receiving the client instance as `this` (Illegal invocation); the client now invokes an unbound local function, with a dedicated regression.

Validation: **42 unit/integration files / 125 tests**, **19 unpacked-extension scenarios**, formatting/type checks and production ZIP. The new browser scenario configures and tests the independent key, reloads settings, executes model-driven search then fetch with a compatible mock chat model, expands a source link and reloads chat receipts. Requests to the official DeepSeek origin are intercepted with deterministic responses; this is not a live API/account/billing/availability check. Local Playwright's default revision was not installed; the suite used existing Chromium 1243 through `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (documented README override).

Privacy safeguards are best-effort, not general secret detection. URL validation does not resolve DNS or inspect remote redirect destinations; DeepSeek's server-side security policy is still required. Local rate spacing is per panel, not account-wide. Official service behavior, real credentials and output quality still require user validation with Test search; no new backend or MCP service is required.

## Workspace reauthorization recovery

Fixed a permission-recovery defect: Reauthorize previously awaited an IndexedDB read before `requestPermission`, risking loss of transient user activation, and ignored prompt/denied return values. Settings now retains the loaded handle, calls permission request directly from the click stack, reports non-granted results and exceptions, displays separate read/write states and refreshes on window focus. Tool errors distinguish connected-but-unauthorized from disconnected, with recovery steps; no automatic permission prompts from tools.

Local validation: **34 test files / 89 tests**, **16 browser scenarios**, types/format/production build. Added read-only/prompt/denied, structured error, direct-click/no-preceding-DB-await and SecurityError UI tests. Browser recovery coverage simulates permission API states on real OPFS handles and verifies actual user activation on Reauthorize; this does **not** establish native picker/OS-directory grant persistence or reproduce the user's exact permission loss. Original OS permission root cause is unconfirmed; native UI verification remains required.

## Default local workspace tools

Added native File System Access directory authorization and eight default tools, `idb` handle/backup storage, root ignore filtering, bounded literal Worker search, exact replacements and strict single-file jsdiff patches. All mutations require full diff approval, immutable preview binding, current workspace/permission checks and original-content hash validation before IO. Backups are bounded to 20 and downloadable/clearable; no recursive directory deletion, implicit parent creation or sensitive-path bypass.

Local checks: **33 test files / 86 tests**, **16 unpacked-extension browser scenarios**, format/types/build checks. New tests cover path/secret exclusions, glob behavior, binary/UTF-8/BOM limits, unique/overlapping edits, strict hunk position and CRLF behavior, permission denial, ignore filtering, no overwrite, unchanged-preview approval continuation and workspace/content conflicts. Real browser handles (OPFS, not OS-selected directories) exercise default registration, IndexedDB persistence, Worker search, create/edit/patch/delete, denial, concurrent conflict, backups and disconnect. Existing MCP filtering and settings theme tests remain passing with the new tools.

A regression caught AI SDK re-running `needsApproval` on approval resume. File tools must not overwrite the original preview in this path; tests now verify concurrent changes are still rejected after resume. Expired/reloaded previews fail closed. Native picker invocation, OS filesystem/symlink semantics, browser restart permission renewal and manual real-folder acceptance are **not yet verified**. Client prompt instructions do not certify complete resistance to prompt injection. Root-only ignore handling, bounded scans, nontransactional multiple files and remaining external check/write race are documented limitations.

## Per-reply generation statistics

Local transport metadata now records TTFT (send/preparation → first nonempty generated chunk), active-request total duration, model-only post-first-output streaming duration and provider token usage. Approval resumes accumulate while human wait is excluded; regeneration resets. Missing counts/invalid timing have no fabricated speed. Interrupted replies are locally finalized even if useChat cancels stream consumption before abort metadata delivery. Compatible models request the standard streaming usage field; live third-party gateway support is not established by deterministic tests.

Validation after this feature: **32 test files / 77 unit/integration tests**, **15 unpacked-extension browser scenarios**, formatting/type checks and production ZIP build passed. Added controlled-clock tests for reasoning/tool output, multistep rate calculation, absent usage, zero durations, approval continuation, interruption, formatting and rendering; session persistence test; browser coverage for actual requested usage, display, clipboard separation, reload, approval accumulation and stopped partial metadata. Browser provider is deterministic/local, not a production LLM speed benchmark. Python embedding tests are unchanged by this feature.

## Neutral settings theme and expanded embedding evaluation

Replaced the custom cream/green palette with the official shadcn Neutral light/dark semantic palette (`https://ui.shadcn.com/r/themes/neutral.json`). The Button remains shadcn base-nova/CVA; existing layout is custom, not a complete stock shadcn application. Removed unlayered global button typography/disabled/focus overrides so shadcn utility styles control those states. Settings tabs use a neutral segmented appearance. Browser checks cover Model/Memory/Tools in both color schemes, normal/hover, neutral colors, border/radius/size, keyboard focus ring, disabled opacity, and primary foreground. Screenshots are generated for all six settings/tab combinations; automated style checks are not a subjective visual-quality certification.

The actual CPU model was evaluated with 24 synthetic references and 68 queries, including 56 positives, 8 unrelated and 4 related-topic unknown-fact questions. 1024-d top-1: **52/56 (92.9%)**; recall@3: **56/56**; negation-heavy top-1: **6/10**. The default picker retains extraneous references (target-label precision 40.6% under the single-target labels). No defaults were tuned. See [methodology, limitations, failures and threshold comparisons](benchmarks/README.md), plus the full reproducible JSON report.

## Actual Jina CPU inference (Intel Mac)

The official merged `jinaai/jina-embeddings-v5-text-small-retrieval` ONNX graph, external weights (~2.4 GB) and tokenizer were downloaded from ModelScope and verified against pinned SHA-256 hashes. No downloaded Python model code is executed. ONNX Runtime 1.23.2 uses only CPUExecutionProvider, six threads, and a 2048-token input cap. On this i5-13600KF / 64 GB host:

- HTTP smoke test passed: health, no CORS, 1024 dimensions, unit vector.
- Small English/Chinese retrieval sanity test: 4/4 top-1 (scores 0.555, 0.561, 0.509, 0.686). Not a general quality benchmark.
- All seven Matryoshka dimensions passed shape/normalization checks.
- Five warm HTTP requests each: English short query median 58 ms (max 70 ms), Chinese short query median 60 ms (max 64 ms), ~1,080-character document median 430 ms (max 446 ms).
- Process RSS approximately 1.9 GiB. A long input truncated to 2048 tokens took ~11.6 s before disabling idle thread spinning. Long or queued requests can exceed the extension's 2.5 s query timeout.
- CPU-venv tests: 4 passed (2 pooling/math, 2 HTTP contract). Standard dependency-free Python skips the 2 CPU math tests.
- Service started manually, loopback-only at `127.0.0.1:8765`; no autostart. Model license CC BY-NC 4.0. Model/environment directories are gitignored.

See `tools/embed-server/README.md` for reproducible setup and stop commands. This validates actual CPU inference independently of the extension's mock-endpoint E2E suite; the live CPU endpoint has not been tested through Ego's extension UI.

## Checks still requiring another environment or manual review

- **Actual Jina/MLX inference:** this host is Intel (`x86_64`) without MLX. The complete inspected upstream source matches the adapter's constructor and `encode` signature, but that does not establish runtime, weight-loading, quality, latency, or memory compatibility. Run `smoke_test.py` and `eval_memory.py` on Apple Silicon after downloading and reviewing the model code/weights.
- **Live services:** local mock tests do not establish compatibility with every OpenAI, Anthropic, Gemini, compatible gateway, or real MCP deployment. Test your configured service before relying on it.
- **GitHub Actions:** both the [main-branch build](https://github.com/ParseDark/ama/actions/runs/38855698704) and [tag release](https://github.com/ParseDark/ama/actions/runs/38855702906) passed on Ubuntu with Node 24 and pnpm 9.15.9. They ran the 68 unit/integration tests, 12 Chromium scenarios, Python contract tests, formatting, type checks, and packaging. The [v0.1.0 release](https://github.com/ParseDark/ama/releases/tag/v0.1.0) contains `ama-0.1.0-chrome.zip`. No Chrome Web Store publication was performed.
- **Ego browser:** opened `chrome://extensions`, enabled developer mode, and invoked Load unpacked in task space 2. The Extensions CDP loading method was unavailable. Control was handed to the user for native folder selection; AMA functionality in Ego is not yet verified. The Playwright results above are independent of Ego.
- **CI portability:** headless Linux Chromium can return an empty OS shortcut binding. The suite verifies manifest shortcut declarations on every platform, assigned bindings on macOS, and actual panel keyboard handling. Actions artifacts explicitly include the hidden `.output` directory.
- **Manual browser/visual acceptance:** OS-level keyboard delivery and panel open/close gestures, sticky-header appearance exactly once in the stitched image, accessibility review, and real-page behavior still merit manual verification. Automated tests verify screenshot dimensions/restoration, not a complete pixel-level visual comparison.
- The broad implementation and green regression suite are not a security certification or a claim that every possible page/action is safe. Approve consequential actions carefully.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm compile
pnpm test
python3 -m unittest discover -s tools/embed-server -p 'test_*.py'
pnpm format:check
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

For an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable path. See `README.md` and `tools/embed-server/README.md` for installation and configuration.
