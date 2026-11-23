# Tasks

## 1. Annotation operations and rendering

- [x] 1.1 Define strict coordinate, shape and operation schemas and constants for the batch, layer, text and path limits. Unit-test every shape, both viewport corners, invalid inputs and over-limit cases, including no partial mutation.
- [x] 1.2 Implement document-local SVG rendering and generated handles in a script-injectable function. Test batches, constant stroke/text sizing, literal labels, replace/remove, stale handles and page-owned elements with colliding names.
- [x] 1.3 Implement shared clear teardown, visible keyboard-operable 清除批注 control and fresh-layer creation. Test user/tool clear, last-mark removal, repeated clear and re-add; verify a clear never removes an unrelated highlighter.

## 2. Chat integration and user guidance

- [x] 2.1 Bind live execution to the turn's eligible starting capture target without taking an image or accepting tab overrides. Test tab switch, replacement document, ineligible page, success and abort with transport/tool tests.
- [x] 2.2 Register `annotate_page` in both chat tool sets and `@tools`. Verify discovery makes no injection, results return IDs, old chat history does not redraw, and annotation does not consume a capture attempt.
- [x] 2.3 Update the prompt and README with a chart example, normalized viewport coordinates, the clear action and limits after chart movement; test that prompt guidance distinguishes annotation from indexed highlight and rules out guessing an unobserved price location.

## 3. End-to-end verification

- [x] 3.1 Add a Chromium extension scenario over a canvas fixture: draw a line, circle and label, confirm alignment, pointer passthrough and keyboard clear; repeat with mouse clear and confirm no overlay remains after reload. Run the scenario plus the existing page-tool and screenshot regression tests.
