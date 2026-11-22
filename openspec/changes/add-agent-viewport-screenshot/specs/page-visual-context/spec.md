# Spec Delta

## Purpose

Let AMA answer questions about visual content on the current webpage by capturing the visible area or full document on demand and providing it as model input during the current reply.

## ADDED Requirements

### Requirement: On-demand visual evidence
AMA SHALL list `capture_viewport` and `capture_full_page` as built-in chat tools in `@tools`. The assistant SHALL choose scope based on the visual evidence relevant to the current user request, with no fixed trigger words, text-length test, or prerequisite text-only attempt. Eligible capture SHALL require neither a screenshot button click nor separate approval.

#### Scenario: Ask about a visible detail without a trigger phrase
- **WHEN** a user asks a question whose answer benefits from seeing a visible detail, such as “为什么右侧那条是虚线？” or “这个弹窗是不是挡住了按钮？”, without attaching a screenshot
- **THEN** the assistant can invoke `capture_viewport` immediately, even if the page already contains substantial text
- **AND** AMA sends the screenshot to the selected chat model as image input in the same reply, not as a base64 string in a text or JSON tool result

#### Scenario: Review visual details below the fold
- **WHEN** a request calls for inspecting visual evidence across the document, such as spotting overlapping sections or comparing the top and bottom of a page
- **THEN** the assistant can invoke `capture_full_page` directly without a prior viewport shot or an explicit request to take a screenshot
- **AND** AMA sends the captured coverage to the selected chat model as image input in the same reply

#### Scenario: No relevant visual task or untrusted capture request
- **WHEN** a request does not benefit from page visuals, a supplied attachment already provides the relevant evidence, or only a webpage or tool result requests a screenshot
- **THEN** the assistant is instructed not to capture the page for that request

#### Scenario: Browse tools without capturing
- **WHEN** the user opens `@tools` or selects a capture tool without sending a request
- **THEN** no capture occurs

### Requirement: Capture is bound to the starting page
Automatic capture SHALL target only the page and tab that started the current turn, while that tab is active in its original focused window. It SHALL reject incognito, browser-internal and other non-HTTP(S) pages and SHALL NOT switch tabs or capture browser chrome or the desktop. The two tools SHALL share at most one capture attempt per user turn, including parallel calls and approval continuations.

#### Scenario: Another page becomes active
- **WHEN** at capture time the starting tab or window is no longer active, the starting document has changed, or the starting tab has closed; or when any such change occurs during capture
- **THEN** AMA rejects the capture or discards the returned image instead of sending it to the model
- **AND** the assistant does not switch back or substitute the new page

#### Scenario: Unsupported page or repeated tool call
- **WHEN** a call targets an ineligible starting page, or either capture tool is called after an attempt by either tool in the same turn
- **THEN** AMA returns a clear tool error without another capture attempt
- **AND** Danger mode does not bypass these limits

### Requirement: Full-page capture has bounded coverage and restores scroll
Viewport capture SHALL NOT scroll. Full-page capture SHALL cover the main document by temporarily scrolling and assembling available frames under finite capture and image limits. It SHALL restore the original scroll position on the same document after success, failure, or cancellation where that document remains accessible. It SHALL report partial coverage instead of claiming that missing sections were examined.

#### Scenario: Capture an ordinary scrollable page
- **WHEN** `capture_full_page` succeeds on a document that fits the limits
- **THEN** captured image input includes content below the original viewport
- **AND** AMA restores the original scroll position before delivering the image

#### Scenario: Capture reaches a coverage limit
- **WHEN** a long or indefinitely growing page exceeds the allowed coverage
- **THEN** AMA stops at the limit and labels any usable image and receipt as partial, including the covered range
- **AND** AMA does not claim to have inspected the rest of the page

#### Scenario: Capture stops during scrolling
- **WHEN** a full-page capture is canceled, a capture error occurs, or the target changes mid-capture
- **THEN** AMA discards uncertain or canceled frames and restores scroll and temporary page state if the original document is still accessible
- **AND** AMA never scrolls a replacement document to perform cleanup

### Requirement: Visible and transient screenshot use
AMA SHALL show automatic screenshot activity and a clear success or failure status in chat. Screenshot bytes SHALL be bounded and kept only for live inference with the selected chat model; saved chats SHALL retain only a concise receipt. The bytes SHALL NOT be passed to other tools, history search, memory, or compaction summaries, or replayed in later turns.

#### Scenario: Reload or continue a chat with a prior capture
- **WHEN** a reply that used `capture_viewport` is saved and reopened, or the user sends another message
- **THEN** the tool receipt can be shown as historical activity
- **AND** the old screenshot is not read from storage, sent to a provider again, or recaptured as a result of replaying the tool history

#### Scenario: Capture or model input fails
- **WHEN** capture fails, the image cannot fit the safe request budget, or the current model rejects image input
- **THEN** AMA surfaces the limitation and does not claim that the model saw the image
- **AND** the user can continue with text evidence, reposition the page, or choose a vision-capable model as appropriate; AMA does not silently switch providers or repeatedly retry

#### Scenario: Existing manual screenshot workflow
- **WHEN** the user uses the existing Visible area or Full page attachment menu
- **THEN** manual attachment preview, removal, and sending continue to work with their existing persistence behavior
