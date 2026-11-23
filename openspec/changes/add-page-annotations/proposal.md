# Proposal

## Why
AMA can inspect a visible chart, but its timed highlight targets an entire indexed element, not a point inside a canvas. Users want to see where an explanation applies, and to erase the explanation without changing the page beneath it.

## What Changes
- Add a built-in `annotate_page` tool for composing lines (including underlines), arrows, ellipses, polylines and plain-text labels over the starting webpage. Return handles for later removal or replacement.
- Give the annotation layer its own visible, accessible **清除批注** action that works immediately without a model call. The tool can also clear all marks on request.
- Place marks relative to the current viewport, not to a DOM element, instrument, time or price. No tracking after a chart is dragged, no raw HTML, no editing the page's content.

## Capabilities

### New Capabilities
- `page-annotations`: Reversible, viewport-relative visual explanations on the current page.

### Modified Capabilities

## Impact
Page-tool registration and execution in the side panel, composer discovery, prompt guidance, an injected overlay renderer, tests and README. Reuse existing Chrome scripting permissions. No change to existing highlight, capture limits, screenshot persistence or approval rules for other page tools.
