# Design

## Context
`src/lib/highlight.ts` locates an indexed element, scrolls/focuses it and removes its outline after six seconds or pointer-down. That is useful for controls, but cannot represent several points within a canvas. `capture_viewport` can supply a downsized image; normalized coordinates avoid mistaking image pixels for CSS pixels. The in-flight `add-agent-viewport-screenshot` change owns capture semantics; annotations do not extend them.

## Goals / Non-Goals
**Goals:** Add a reversible drawing vocabulary independent of page structure. Keep clearing available even when chat is closed or offline.

**Non-goals:** No arbitrary HTML, selectors, CSS or JS from the model. No finance-specific inputs, chart adapters, tracking, manual sketch editor, annotation persistence or automatic screenshot verification.

## Decisions
- Use one `annotate_page` tool with a strict discriminated input: `add(shapes[])`, `replace(id,shape)`, `remove(id)`, `clear()`. Points are finite fractions in [0,1]; lines/arrows and ellipse bounding boxes take two corners, paths take points, labels take a position and text. Underlining is a line. Offer a small color palette; cap batches at 32, marks per layer at 128, points per path at 128 and labels at 160 characters. Validate the entire operation before rendering. Return generated opaque IDs in input order; unknown IDs are errors. Do not reuse IDs after a clear. A raw drawing program or markup string would offer more freedom but no useful bound on behavior.
- Register the tool for both definition-only and live tool sets in `local-chat-transport.ts`; expose it in the composer. Use `verifyCaptureTarget` and `inCaptureDocument` from `capture-target.ts`, not the tab-override path in `page-tools.ts`. Bind execution to the turn's starting target, check eligibility before injection and recheck visibility/URL in the injected function before committing. No screenshot is taken by drawing. Prompt: use current viewport evidence for image placement, not a full-page image as if it were the viewport. If data establishes a price but not its visible location, explain the limitation rather than guessing.
- Keep an extension-owned host reference and mark map in the isolated world of the top document. Create the layer lazily, with a shadow root, fixed pointer-transparent SVG and native HTML clear button as its only pointer-interactive child. Convert fractions to viewport CSS geometry, with constant-size strokes and text. Construct allowlisted SVG nodes directly; set labels via `textContent`. Do not look up or remove a host by a globally guessable page ID. Unlike `highlightElement`, do not focus, scroll or time out on draw.
- Have both clear paths use the same local teardown (remove the owned host and release handles). The button has an accessible name, keyboard focus indicator and does not steal focus on insertion. Clearing an empty layer succeeds. Do not mount it when opening a saved chat. Keep historical tool receipts descriptive, not executable.

## Risks / Trade-offs
- Chart or viewport changes after analysis → marks describe a snapshot, not live prices. Keep the clear action visible and explain this in the tool guide; do not promise alignment after interaction.
- Host CSS, pointer capture, or a page deleting the host → isolate overlay styles, test click-through in Chromium, and discard disconnected host state on the next operation.
- Stale IDs or untrusted labels → reject unknown handles before mutation and render plain text only. A clear affects neither the site nor AMA's existing transient highlight.

## Migration Plan
Additive extension update, no permissions or storage migration. Roll back by removing tool registration, prompt and injection path; any existing document-local layer can still be cleared or discarded by reloading the page.
