# Proposal

## Why

AMA reads the current page as text, but Markdown extraction omits visual content such as canvas and SVG charts. A question like “这个图表什么意思？” should let AMA look at the chart without making the user stop and attach a screenshot manually.

## What Changes

- Add built-in `capture_viewport` and `capture_full_page` tools. The assistant chooses based on the visual evidence and page coverage relevant to the request, not keywords, exact phrasing, or a preliminary text-only attempt. Both deliver actual image input to the configured chat model in the same reply, without a screenshot button click or separate approval.
- Limit both tools to the active web tab that started the turn. Viewport capture does not scroll; full-page capture temporarily scrolls the main document and restores its position. Bound full-page coverage and disclose when only part of the page was captured. Neither tool switches tabs or captures the desktop. Both refuse incognito and restricted pages and discard captures when the target changes.
- Show capture activity in chat. Keep automatic image bytes transient; the saved transcript contains a short tool receipt, not another screenshot attachment.
- Keep the existing manual Visible area and Full page buttons. If automatic capture is unavailable or the model cannot accept images, explain the limitation instead of guessing.

## Capabilities

### New Capabilities

- `page-visual-context`: On-demand viewport and full-page visual evidence for the current chat reply.

### Modified Capabilities

## Impact

Native tools and `@tools`, turn/tab tracking, Chromium viewport capture and full-page stitching, provider-neutral model message preparation, context budgeting, tool activity UI, and Chromium regression tests. No new Chrome permissions, external vision service, provider switch, or data migration.
