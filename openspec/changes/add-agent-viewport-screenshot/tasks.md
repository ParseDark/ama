# Tasks

## 1. Capture and tool contract

- [x] 1.1 Add starting-document identity to the turn context and implement guarded viewport capture with focus, activation, navigation, incognito, restricted-page and cancellation checks. Verify with fake-browser tests for happy path, closed tab, wrong window, same-URL reload, switch-away-and-back during capture, abort, and listener cleanup. Leave manual capture unchanged.
- [x] 1.2 Add guarded full-page stitching using the existing capture primitives. Verify below-the-fold frames, coverage/time/size caps, partial coverage reporting, exclusive capture of the same document, and scroll/style restoration on success, cancel, and tab switch without touching a replacement document. Retain the existing manual capture regression.
- [x] 1.3 Add argument-free `capture_viewport` and `capture_full_page` schemas, catalog/live registrations, and one shared attempt per turn. Verify both bounded image outputs, catalog browsing never captures, parallel or resumed calls cannot invoke either scope twice in a turn, target overrides are not honored, and Danger mode does not widen scope.

## 2. Image delivery and feedback

- [x] 2.1 Add transient image handoff in `LocalChatTransport` with paired text receipt, one image-bearing model step, and matching same-turn approval continuation, expiry and cleanup. Verify real image fields and intact tool pairing in mocked requests for OpenAI-compatible chat, OpenAI Responses, Anthropic and Google; verify no bytes in saved chat, summaries, later turns, retries, or other tool results. Test cancellation, expired continuation, target change and model switch.
- [x] 2.2 Account for viewport and full-page image tokens in the safe input guard without embedding bytes in compaction or context diagnostics; cover a request where text fits but the image does not. Surface scoped activity, partial coverage, and capture/budget/model errors in chat and model evidence as appropriate; verify that a subsequent text question works without replaying a rejected image.
- [x] 2.3 Add intent-based visual guidance with no trigger phrases or preliminary text check, and document both scopes, no separate approval, provider disclosure, scroll behavior, limits, and unchanged manual controls in `README.md`. Verify prompt guidance and unpacked Chromium cases with varied wording and text-rich pages: the initial requests carry only text, the mock chooses either scope directly, and the next requests contain a real image showing the expected viewport or below-the-fold evidence. Check receipts, scroll restoration and reload without pixels.

## 3. Integrated verification

- [x] 3.1 Run `pnpm compile`, `pnpm format:check`, `pnpm test`, `pnpm build`, and Chromium `pnpm test:e2e` with screenshot fixtures generated outside the working tree. Confirm no manifest permission expansion and run `openspec validate add-agent-viewport-screenshot --strict`.
