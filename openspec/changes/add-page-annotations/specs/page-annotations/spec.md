# Spec Delta

## Purpose
Let users see an assistant's explanation at the relevant positions on a visible webpage and erase its marks without changing the underlying content.

## ADDED Requirements

### Requirement: Composable viewport annotations
AMA SHALL expose `annotate_page` as a built-in tool in `@tools`. It SHALL accept batches of lines, arrows, ellipses, polylines and plain-text labels in normalized visible-viewport coordinates (top-left 0,0; bottom-right 1,1), returning an ID for each new mark. It SHALL NOT require a chart API, indexed target, or screenshot capture as a side effect.

#### Scenario: Explain a candlestick visible inside a canvas
- **WHEN** the assistant marks a candle with an ellipse, draws a line beneath a price level, and places a text label in one batch
- **THEN** all three appear at the requested viewport positions with distinct handles, even though they refer to the same canvas

### Requirement: Bounded, document-local rendering
AMA SHALL confine each call to the original active eligible webpage of the turn, reject invalid batches without partial changes, and render labels literally. The layer SHALL neither edit host content nor intercept page interaction outside its clear control. Marks SHALL NOT be restored from history on document replacement.

#### Scenario: Interact with the annotated page
- **WHEN** the user clicks through a mark, scrolls the page or drags the underlying chart
- **THEN** the original page receives normal input; marks are viewport guides, not tracked chart coordinates

#### Scenario: Wrong target or invalid coordinates
- **WHEN** the user switches tabs, the starting document is replaced, or a batch contains an out-of-range coordinate
- **THEN** the tool reports failure and draws nothing from that call on any page

#### Scenario: Label contains markup
- **WHEN** a label contains `<b>peak</b>`
- **THEN** those characters appear as literal text and no page markup is interpreted

### Requirement: Reversible marks and user-controlled clear
AMA SHALL allow the assistant to replace or remove an identified mark, or clear all annotations. While marks exist the layer SHALL offer a visible, keyboard-operable clear action. Clearing SHALL immediately remove all AMA annotation marks and their control from that document only, without a chat message, network request, or change to the underlying page.

#### Scenario: Remove a mistaken circle only
- **WHEN** the assistant removes the ID of one circle from a chart with several marks
- **THEN** only that circle disappears; erasing the last mark also dismisses the control

#### Scenario: User clears the overlay without the assistant
- **WHEN** the user activates 清除批注 by mouse or keyboard
- **THEN** all marks and the clear control disappear, the chart remains as it was, and subsequent marks start a fresh layer

#### Scenario: Clear an empty page
- **WHEN** the assistant issues clear after the user has already cleared the layer
- **THEN** the action succeeds without creating an empty layer or touching any host element
