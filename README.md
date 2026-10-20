# AMA — Ask Me Anything about this page

A local-first Chrome MV3 side-panel assistant. Read the current page as Markdown, chat with your chosen provider, attach screenshots, highlight controls, and carry out approved browser tasks. No application backend is required.

## Build and install

Use **Node 24** and **pnpm 9**:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

In `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `.output/chrome-mv3/`. Building also creates `.output/ama-0.1.0-chrome.zip`. Use a recent Chrome version supporting `chrome.sidePanel.close` for shortcut toggling.

Open AMA using the toolbar icon or **⌃K / Ctrl+K**. In Settings → Model, choose OpenAI, Anthropic, Google Gemini, or an OpenAI-compatible API, enter your endpoint/key/model, and optionally **Fetch** available models. The compatible URL defaults to `https://api.qnaigc.com/v1`, taken from the local shell's `OPENAI_BASE_URL` (no API key is bundled). Choose a model supported by that service using **Fetch**, or enter its model ID. Existing saved settings are preserved; update Base URL manually if you previously saved another endpoint. Settings save automatically.

```sh
pnpm dev          # WXT development build
pnpm compile      # TypeScript checks
pnpm test         # unit/integration regression suite
pnpm build        # production extension + ZIP
pnpm test:e2e     # built extension, local deterministic mock APIs
```

### Development server / HMR connection errors

`pnpm dev` produces `.output/chrome-mv3-dev/` and requires the dev server to remain running. AMA binds development HTTP/WebSocket traffic explicitly to **`127.0.0.1:3197`**, with a strict port check. This avoids `localhost` IPv4/IPv6 ambiguity when another project already uses port 3000. If 3197 is occupied, WXT fails visibly rather than silently selecting another port. Change host/port/origin together in `wxt.config.ts` if needed.

If Chrome reports `[wxt] Failed to connect to dev server`, restart `pnpm dev`, reload AMA in `chrome://extensions`, then close/reopen the side panel to discard its old HMR address. For everyday use without a running dev server, use `pnpm build` and load `.output/chrome-mv3/` instead. Production builds contain no WXT HMR client. **Do not uninstall AMA to clear an HMR error**: uninstalling can delete local settings/history. Reloading the existing installation preserves them; loading from a different path may create a separate extension ID/storage.

For E2E, first run `pnpm exec playwright install chromium` and `pnpm build`. If using a separately installed Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium`.

## Features

- **Page grounding:** fresh Markdown and selected text on each request; indexed controls; Readability and GFM tables. Restricted pages such as `chrome://` cannot be scripted.
- **Chat:** streaming Markdown/code/reasoning, stop/retry, searchable provider/model picker, assistant Markdown copy, saved sessions and history search.
- **Screenshots:** visible area or scroll-and-stitch full page (12,000 CSS px capture cap; output ≤1,280 × 8,000). Capture is user-initiated; do not change the active tab until it finishes.
- **Browser tools:** highlight, fill, select, check, click; multi-step plans and background lookup tabs. Committing clicks and access to other user tabs require approval. The assistant may close only tabs it opened.
- **Web search:** optional DeepSeek Search & Fetch with any chat model; bounded public-web lookups, Markdown fetching and expandable source cards. Independent key, off by default.
- **MCP:** Streamable-HTTP servers with optional bearer tokens and per-server custom HTTP headers; Logseq preset; read/write approval handling; optional semantic tool filtering.
- **Memory:** explicit remember/forget, intent checks, site/global scope, preferences and references, duplicate/contradiction handling, undo, editing, pin/disable/delete, import/export, similar-pair merging. Learned habits remain suggestions until confirmed; Memory shows what learning has noticed so far.
- **Chat configuration:** configure MCP servers, the chat model, embeddings, memory and DeepSeek web search by asking the assistant. Every change shows an approval card with the exact change, stored secrets are never echoed back, and Danger mode, configuration sync and the file workspace stay manual.
- **Context meter:** a ring beside Send shows the used window; its popup breaks the prompt into system, tools, page, memory, earlier messages, this reply's tool steps and output, with last-step tokens and cost when the provider's `/models` supplies limits and prices.
- **Learning:** memory judges answer through a forced tool call (reliable through gateways), failed extractions are retried instead of silently dropped, and an upgrade re-learns chats that an older version processed.
- **Optional embeddings:** reference retrieval, semantic history search, memory dedupe, and large MCP tool-set filtering. **Off by default**; failures fall back gracefully. Any compatible embeddings endpoint can be configured.

The chat composer automatically receives the cursor when opened or when returning to chat. Focus is not moved on streaming updates, and settings/search/approval controls keep their focus.

### Shortcuts

**macOS uses Control+K (⌃K), not Command+K.** Chrome's manifest spelling is `MacCtrl+K`; `Ctrl+K` alone is mapped to Command on macOS. Existing installations may retain the previous binding: after reloading, open `chrome://extensions/shortcuts` and set AMA → Toggle the AMA side panel to **Control+K** manually if necessary. Side-panel keyboard handling uses Control+K too and leaves Command+K untouched.

| Shortcut                              | Action                                       |
| ------------------------------------- | -------------------------------------------- |
| ⌃K / Ctrl+K                           | Toggle panel (close when panel focused)      |
| ⌥⇧L on macOS / Ctrl+Shift+L elsewhere | Clear current chat and its saved history     |
| ⌘⇧L / Ctrl+Shift+L inside panel       | Also clear                                   |
| Enter / Shift+Enter                   | Send / newline; IME composition is respected |

## Privacy and safety

Settings, keys, messages, memories, and vector caches use **`chrome.storage.local`** by default. **Optional configuration sync includes all settings AND credentials in `chrome.storage.sync` when explicitly enabled** (see below). History, memory text, vectors and files remain local. Neither local persistence nor AMA's gzip encoding is encryption; AMA adds no encryption to Chrome's sync service. Requests go directly to the LLM, embedding endpoint, or MCP server you configure: page text and screenshots are sent to the selected LLM; semantic features send relevant text to the selected embedding endpoint. Choose trusted services and take care on sensitive pages.

Page text and tool output are untrusted data, not instructions. Browser-derived labels are used in approvals. Automatic learning consumes user messages, approvals and stop events—not assistant/page/tool text—and excludes incognito and sensitive-domain signals. Incognito exchanges are not indexed for history search. In normal mode, explicit saves may include personal/sensitive information you ask AMA to remember. Potential credentials/card-like data require a confirmation with storage/provider disclosure, then save as references (not always-injected preferences); no content-based hard refusal. Foreign links still require confirmation in normal mode; Danger mode skips native memory confirmations. Automatic learning remains conservative and never intentionally extracts credentials, health or financial details. Memory contents are not uploaded by configuration sync, but relevant recall is sent to your chat model and semantic matching may send memory text to the configured embedding service; local storage is not encryption or a secrets vault. Copying an answer does not teach a habit.

AMA requests broad tab/scripting/host permissions to support user-selected pages and direct API calls. Review approvals before allowing changes. Local persistence does not eliminate model mistakes or malicious page content; keep destructive actions under human supervision.

## Chrome configuration sync (including keys)

In **Settings → Model → Chrome configuration sync**, choose explicitly:

- **Enable · upload this device**: replace the cloud snapshot with all current configuration and credentials.
- **Enable · use cloud config**: replace local configuration and credentials with the cloud snapshot. Use this on another device after uploading from the first.

Off by default, enabled separately on each installation. Requires Chrome extension sync, the same Chrome account **and the same extension ID**. An unpacked extension may have a different ID on another machine; signing into Chrome alone does not guarantee sync. Chrome manages delivery; a local upload timestamp is not proof of delivery to another device. No new AMA backend/account.

Includes provider choice, all provider keys/URLs/current and fetched model lists, complete embedding settings/token, DeepSeek web-search settings/key, all MCP servers/tokens/custom headers, and memory's enabled switch. This is deliberately **all configuration, including secrets**, per user request. Secrets leave the device through Chrome sync, with no extra AMA encryption/secret-vault guarantees. Never enable on untrusted profiles. Sync storage is restricted to trusted extension contexts. Excludes chat/history, memory contents, events/vectors, screenshots, file previews/backups and OS workspace handles/permissions; those still need local setup.

Subsequent local edits upload after about 5 seconds (alarm fallback if the worker suspends); remote events update local configuration. Conflicts use a whole-snapshot last-revision rule (device timestamp, then revision ID), not per-field merging or distributed transactions. Concurrent/offline edits or skewed clocks can overwrite another device; explicit Upload/Use cloud lets you choose a winner. Imported model URLs and enabled MCP settings immediately become active, so only share a trusted Chrome profile.

Snapshots use gzip/base64 with a checksum, versioned chunks (each below Chrome's ~8 KiB item quota), bounded to 45,000 encoded characters and 1 MiB decoded data to leave room for safe replacement under the ~100 KiB total quota. Large/invalid/incomplete snapshots and quota/network errors keep local settings and show errors; no credential fields or model lists are silently dropped. Writes are debounced; throttling may delay sync.

**Disable sync** stops this device but retains local and cloud data. **Clear cloud config** requires this device disabled and removes AMA sync keys, not local settings; disable other devices first or they can upload again. This is not a guarantee of immediate deletion from Chrome's service/backups. It cannot remotely revoke previously copied API keys—rotate keys with providers if necessary.

## Shared model selector

Model settings and the chat composer use the same searchable selector, selected-model indicator and shadcn-styled trigger. Settings scopes the list to the provider being configured; chat groups configured providers. Fetch refreshes the provider list as before. To use an unlisted model, type its ID in the search box and select **Use “…”** (for the current provider). Typing alone or pressing Escape does not change the saved model. Choices persist and appear in both places; reopening clears the search. Provider keys, URLs and fetched lists are preserved when selecting a model.

## Danger mode

Enable **Settings → Tools → Danger mode** to trust the AI without native memory/browser approval prompts. **Off by default**, saved across reloads and included in optional configuration sync (a cloud download can enable it on another device). An ON notice stays visible in chat.

- `remember` / `forget` run directly, including sensitive saves, foreign links and uncertain save intent. Memory Off still blocks storage/recall. Sensitive saves stay references rather than always-injected preferences. Repeated automatically learned habits activate at the normal evidence threshold without confirmation; automatic extraction still excludes sensitive content and private-domain/incognito signals.
- Browser `read_tab`, `fill`, `select`, `check`, `click` run without approval, including other user tabs and submit/pay/delete-like buttons. This can expose private data or cause irreversible changes. Only enable if you accept AI mistakes and prompt-injection risk; it is not a safety guarantee.
- File mutations and MCP writes **still require approval**. Workspace boundaries, public-web privacy restrictions, tool budgets, only-closing-assistant-owned-tabs and browser/OS/site authentication remain in force.
- Changes apply on the next transport request, not retroactively to a running reply. Stop a running reply before switching. Existing approval cards still need a decision; enabling does not automatically accept pending/denied actions. Disabling restores approvals for subsequent requests, but does not undo actions or deactivate previously accepted memories.

## Public web search (DeepSeek)

In **Settings → Tools → Web search**, enable **Use web search**, enter an **official DeepSeek API key**, and optionally click **Test search**. The key is independent of the chat provider/gateway: Claude, OpenAI, Gemini and compatible chat models can all call the same web tools. Missing key or disabled settings do not register the tools. Existing settings require no migration.

- `web_search` calls `POST https://api.deepseek.com/v1/tools/search`, with 5 results by default (maximum 10), `need_content: false`. Queries support `site:`, `-site:`, quoted phrases, `lang:`, `after:` and `before:`. Queries are limited to 1–128 Unicode characters. Short snippets appear in expandable source cards; bounded longer summaries go to the model. No automatic remote favicon requests.
- `web_fetch` calls `POST https://api.deepseek.com/v1/tools/fetch` only when more detail is needed, returns Markdown capped at 24,000 characters and marks truncation. Each response is limited to 2 MiB before JSON parsing. Results retain source URLs for Markdown citations and source cards, including after chat reload.
- At most **3 searches + 3 fetches per user turn**, including failed tool attempts and approval continuations. Concurrent calls share the same budget; saved tool receipts preserve counts across reload. Regeneration/new user turns start a fresh budget. Each HTTP call has a 25-second timeout and at most one retry for 408/429/5xx; 401/402 and other permanent errors are not retried. Calls are spaced locally; this cannot enforce an account-wide quota across devices.
- Enabling allows automatic read-only public searches, not automatic background indexing. **Queries and fetched URLs are sent to DeepSeek; results are sent to the configured chat model.** Only send minimal public terms, not private page/file/chat contents. Obvious credential assignments/keys and unsafe URLs are rejected, but these checks are not general secret detection or a formal prompt-injection guarantee. Search/fetched content is untrusted data, never authority to run tools.
- Fetch uses DeepSeek's remote reader, **not the browser's cookies/login**. Use AMA's browser tools and normal approvals for authenticated or interactive pages. Public HTTP(S) URL validation rejects IP literals, local/internal host suffixes, credential-bearing URLs, nonstandard ports and common sensitive query parameters; fragments are removed. It does not resolve DNS or control remote redirects; DeepSeek's server-side security policy remains necessary. Some legitimate URLs are conservatively rejected.
- DeepSeek currently lists **$0.75 / 1,000 successful nonempty requests** for each API, plus chat-model token costs. The test button sends `DeepSeek` and may incur one search fee. See [official documentation](https://api-docs.deepseek.com/guides/search) for current billing/limits. Keys are stored locally without encryption and included in optional Chrome configuration sync, just like other configured credentials.

Automated tests use mocked API responses, including requests to the real API origin intercepted inside an unpacked Chromium extension. No live DeepSeek key/account/billing has been validated by this suite; use Test search for your account before relying on it.

## MCP custom headers

In **Settings → Tools → MCP servers**, each server has a **Headers (JSON)** field:

```json
{
  "X-API-Key": "your-key",
  "X-Workspace-ID": "your-workspace"
}
```

Valid JSON objects with string values save automatically. Header names are case-insensitive; an explicit `Authorization` header overrides the existing Token field (which otherwise sends `Bearer <token>`). An empty Token with no custom Authorization sends no auth header. `{}` clears custom headers. Changing effective headers reconnects the server; Test connection uses the same headers as normal MCP requests. Existing saved servers without headers continue working.

Invalid JSON/headers are not saved, Test connection is disabled, and the last valid saved headers remain in use until corrected. Browser/transport-owned headers (for example Cookie, Host, Content-Type, Accept and MCP session headers) are rejected. This is not a way to bypass browser CORS/cookie rules. Header values are visible in the editor, stored in `chrome.storage.local` without encryption (and included in Chrome sync if enabled), and sent to the configured MCP endpoint, not injected into chat-model prompts. Use trusted endpoints, preferably HTTPS for remote credentials.

## Configuring AMA from chat

Once the chat model works, you can configure the rest conversationally. The assistant has `get_settings`, `add_mcp_server`, `update_mcp_server`, `remove_mcp_server`, `switch_model`, `set_embeddings`, `set_memory_enabled` and `set_web_search`.

- **Every write asks first.** An amber **Settings approval** card states the exact change — for example `Add MCP server “Recap” https://…` or `Change MCP server “Recap”: switch off` — with **Deny / Allow**. Unrelated settings stay untouched.
- **Adding a server tests it.** The URL must be `http(s)` without embedded credentials. If the connection succeeds the server is saved enabled and the reply reports `Connected MCP server Recap · N tools`; otherwise it is saved switched off with the connection error, so it cannot slow every message. A missing name is derived from the first host label (`recap-service.example.com` → `Recap Service`); numeric hosts and `localhost` keep `host:port`.
- **Secrets are write-only.** Stored tokens and keys are never returned to the model or shown in tool results; `get_settings` reports only `hasToken`. A token you paste into chat is part of the saved conversation and is sent to the model again when the conversation continues. Use the Settings fields for secrets you do not want in chat. Configuration saved this way is still included in optional Chrome configuration sync, just like the corresponding Settings fields.
- **API keys and provider base URLs stay in Settings.** They can be neither read nor changed from chat. The embeddings endpoint/model/token and the DeepSeek key are changed only in Settings; chat can switch embeddings or web search on/off.
- **Changes apply to the next message.** A newly added or changed MCP server reconnects then, so its tools, web search, embeddings and memory recall become active from the next reply, not the reply that saved them. Settings updated by a tool appear immediately in Settings because both use the same local store.
- **Not tool-configurable:** Danger mode (**Settings → Tools**), Chrome configuration sync (**Settings → Model**) and the local file workspace (**Settings → Tools → Files → Choose workspace**, which needs a user gesture). The assistant is told to point you there instead of claiming it changed them.
- MCP server names are case-insensitively unique and at most 40 characters. Matching accepts an exact name, the same URL, then a substring of the name or URL. Only `http(s)` URLs without embedded credentials are accepted, and headers use the same reserved-name/value validation as the Settings editor. Header values are never echoed.
- Writes are serialized, so parallel tool calls cannot drop a change, and they still participate in the existing configuration sync.

## Context meter

After a reply, a small ring and `used / limit` text appear between the model picker and Send/Stop. The limit comes from the provider's `/models` (`max_input_tokens`, `context_length`, …); run **Settings → Model → Fetch** to load limits, output caps and USD-per-million prices.

If `/models` does not list the current model (common for custom ids and gateway aliases), the meter falls back to the bundled **models.dev** catalog generated from `@opencode-ai/models` into `src/lib/model-catalog-data.ts` (about 220 KB; regenerate with `pnpm models:generate`). Catalog limits are marked in the popup because they can be the model's native window (for example `claude-haiku-5-5` is 1M there) while a gateway caps it lower (for example, some report 100k). A later Fetch prefers the gateway's own numbers whenever it returns them, then the popup shows no catalog warning.

Hover to see the total, a colour-coded breakdown and the last step's input/output/cached tokens. The provider reports only totals, so the split of the prompt is estimated from the system prompt, tool definitions, page, memory and earlier messages, then scaled to the first step's real input. This reply's tool steps and output are real. Cost uses the long-context prices above the model's threshold. At 80%/95% the meter turns amber/red and the popup suggests clearing the chat (`⌥⇧L`).

## Learning from chats

Automatic learning reads only your user messages, approvals and stop events (never assistant text, page content or tool output), skips incognito and sensitive-domain signals, and turns repeated habits into suggestions. The judges (extraction, intent, relation, classification) answer through a **forced tool call** whose arguments must match a schema; `response_format` JSON is ignored by some gateways and produced malformed answers that were silently treated as "nothing learned".

If a model returns an unusable answer, learning tries the next configured model and reports `failed` without advancing its cursors, so the same signals are retried on a later run. On the first run after upgrading from a version that lost results, the stored cursors are reset once (the run count is kept) so earlier chats are learned again.

**Memory → Noticed so far** shows when learning last ran and the habits it has noticed but not yet suggested, for example `Prefers short answers · seen 1 of 2`, with **No** and **Remember**. A habit becomes the suggestion banner after two sightings; confirming it makes it an explicit, active memory. An empty result simply means nothing new was noticed.

## Local workspace file tools

Eight tools are registered by default (not filtered with remote MCP tools): `list_files`, `find_files`, `search_files`, `read_file`, `create_file`, `edit_file`, `patch_file`, `delete_file`. They have **no disk access until you choose a directory** in **Settings → Tools → Files → Choose workspace**. Chrome may ask for permission again after restart; click Reauthorize and accept the browser prompt. Settings shows separate read/write states: `prompt`/`denied` means the folder remains connected but is not authorized. If the prompt does not appear in the side panel, use Open AMA in tab, open Settings → Tools → Files there and Reauthorize (or select the same folder again). Retrying a model tool cannot grant browser permission. No native helper or file MCP service is required.

- Only relative paths inside the selected directory. Traversal, common credential paths and root `.gitignore` exclusions are blocked. Built-in exclusions include `.git`, `node_modules`, build output and Python environments. Nested `.gitignore` files are **not** interpreted in this first version. The denylist is not secret detection: choose a narrow project directory, never your home folder.
- List/find traverses at most 10,000 entries / depth 20, collecting at most 2,000 files. Globs support `**/`, `**`, `*`, `?`; no brace expansion or regex. No persistent content index yet.
- Literal single-line search runs in a cancellable bundled Worker, with a 15-second search timeout, 8 MiB scan budget, at most 100 matching lines and one occurrence per line. UTF-8 text only, at most 1 MiB/file. Truncated/skipped counts are returned; no match is not a complete-project guarantee.
- Read returns bounded line ranges (up to 500 lines / 30,000 characters). **File text and search excerpts go to the configured model provider.** Treat page/file instructions as untrusted; prompt safeguards are not a formal prompt-injection guarantee.
- Create never overwrites and never makes missing parent directories. Edit requires unique nonoverlapping exact replacements against the original file. Unified patches are single-file, require matching paths and original hunk positions/context, with no fuzzy matching. Diff generation has a complexity/time budget.
- Every mutation requires an approval card showing the workspace, actual relative path and diff. The preview is kept only in memory (15 minutes, at most 30); after expiry or panel reload, deny/reissue it. Execution uses that approved snapshot, not a newly generated preview. A changed workspace/permission/file hash rejects the write. Browser APIs cannot eliminate the final check/write race with external programs or make multi-file edits transactional.
- Before edit/delete, original text is backed up in IndexedDB (latest 20, up to about 20 MiB text before encoding/storage overhead). Settings provides backup download/clear. Backup failure prevents modification. Backups remain after Disconnect and are not encrypted by AMA. Delete is file-only, never recursive. Disconnect removes the directory handle; it does not erase browser-granted permissions or chat/backup contents.

### Reply file previews

Completed assistant replies include a **Changed files** list, counting unique workspace/path pairs from successful file mutations only. Multiple operations on one file are grouped. Click a path to open an in-panel dialog with **After / Before / Diff**, net action, and download; deleted files default to their original text. The viewer shows literal text (no rendered HTML/scripts), supports keyboard dismissal/focus management, and does not access disk or send another model request.

Snapshots preserve the first/last saved states in that reply, not the current disk content. They live in a separate IndexedDB store (latest **100 operations**, up to **30 MiB UTF-8 text**, plus storage overhead) and survive chat reload/Disconnect. Tool results/chat history contain only lightweight receipts; snapshot bodies are not added to model context. **Settings → Tools → Files → Chat file previews → Clear file previews** clears snapshots without changing files/backups/chat. Old/cleared snapshots report unavailable rather than silently reading a newer disk version. Display is capped at 100,000 characters; download retains full saved content. Snapshots are local but unencrypted; storage failure does not turn a successful disk write into a failed operation. Recovery backups remain separate. Older operations performed before this feature have no preview receipts.

Libraries: native File System Access API + `idb` + `ignore` + `diff` (jsdiff). Automated browser tests use real OPFS-backed handles; native OS folder selection, external-drive behavior and restart permission persistence remain manual checks.

## Per-reply performance statistics

Assistant replies show **TTFT**, output **tok/s**, and **Total**, with an expandable **Tokens** section for provider-reported input/output usage. Statistics persist with chat history and are excluded from copied answer text.

- TTFT is measured locally from send/transport start (including page/memory preparation) to the first generated text, reasoning or tool chunk, not necessarily the first visible answer word.
- Speed is summed provider output tokens divided by summed model streaming time after first output, excluding tool execution and human approval waits. Output tokens can include reasoning/tool arguments, depending on the provider.
- Total sums active request elapsed time; approval continuations accumulate into one reply while human waiting is excluded. Regeneration starts fresh.
- Compatible endpoints are asked for streaming usage via `stream_options.include_usage`. Missing usage or unusable timings show `—`; characters/chunks are never counted as tokens. Gateways must accept this standard optional field.
- Stopped/failed replies retain partial timings and never claim complete token accounting. Streaming snapshots are updated at first output and step boundaries, not as a live stopwatch. These are client-observed timings, not server-side inference benchmarks.

## Local embedding server

See [`tools/embed-server/README.md`](tools/embed-server/README.md). It is optional, manually started, loopback-only, and has no CORS or request-text logging. Intel Mac can use the tested **ONNX CPU backend**; MLX requires Apple Silicon and model-code review. Both require separate downloads; model weights are not bundled, and the license is **CC BY-NC 4.0**. The HTTP contract tests run without MLX:

```sh
python3 -m unittest discover -s tools/embed-server -p 'test_*.py'
```

## Release

Repository: [ParseDark/ama](https://github.com/ParseDark/ama).

- **Every push to `main` and pull request:** `.github/workflows/build.yml` runs formatting, TypeScript, unit tests, Python HTTP-contract tests, builds the ZIP, runs the unpacked-extension browser suite, and uploads the ZIP as an Actions artifact (30-day retention). It can also be started manually.
- **Version tags:** bump `package.json`, commit, tag `vX.Y.Z`, then push the tag. `.github/workflows/release.yml` checks tag/version agreement, runs the same checks, and creates/updates a GitHub Release with the ZIP attached. Manual dispatch accepts an existing tag.
- Both workflows use pnpm 9.15.9, Node 24, and the public npm registry with the frozen lockfile. No release is published by a local build.

Download the latest versioned package from [Releases](https://github.com/ParseDark/ama/releases). CI also uploads development builds to the [Actions page](https://github.com/ParseDark/ama/actions).

## Specification and validation

[`REBUILD_SPEC.md`](REBUILD_SPEC.md) is the design/acceptance reference. The current regression suite passes **179 unit/integration tests, 25 unpacked-extension browser scenarios, and 2 Python HTTP-contract tests**, along with TypeScript, formatting, and the production build. See [`docs/VALIDATION.md`](docs/VALIDATION.md) for coverage, reproduction commands, and remaining manual/external checks.

Tests use fake browser APIs, AI SDK mock models, an actual unpacked Chromium extension and local provider mocks; they need no real API credentials. Automated HTTP embedding tests use a toy encoder, **not** the production model. Separately, actual Jina ONNX CPU inference passed local smoke/retrieval/latency checks (see the server README). MLX inference and live provider/MCP compatibility still need validation in their respective environments. The [v0.2.0 release](https://github.com/ParseDark/ama/releases/tag/v0.2.0) is built and published by GitHub Actions; both the main-branch build and tag-release workflows pass the full automated suite.

## License

MIT. See [LICENSE](LICENSE).
