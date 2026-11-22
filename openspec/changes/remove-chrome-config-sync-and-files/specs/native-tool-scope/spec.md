## Purpose

Define AMA's built-in tool boundary without connecting to a user-selected local file workspace.

## ADDED Requirements

### Requirement: No built-in local workspace access
AMA SHALL NOT expose a local workspace picker, permission or recovery controls, or built-in tools that list, find, search, read, create, edit, patch, or delete workspace files.

#### Scenario: Workspace features are absent from settings and chat
- **WHEN** a user opens Tools settings, opens `@tools`, or sends a chat request
- **THEN** AMA offers no local workspace controls or built-in workspace tools
- **AND** AMA does not request workspace access or alter files in a previously connected folder

#### Scenario: Tools unrelated to the native workspace remain available
- **WHEN** a user attaches a screenshot or uses browser tools, configured MCP tools, or sandboxed code and chat data tools
- **THEN** those workflows are still available under their existing settings and approval rules

### Requirement: Saved workspace records are historical only
AMA SHALL keep existing conversations with workspace tool records readable and usable without exposing workspace previews or letting saved workspace calls resume execution.

#### Scenario: Reopen a chat with a completed workspace operation
- **WHEN** the user opens a saved chat containing a completed workspace call and sends another message
- **THEN** the transcript can be displayed and the new turn can proceed
- **AND** AMA does not show the Changed files viewer or re-execute the workspace call

#### Scenario: Reopen a chat with a pending workspace approval
- **WHEN** the user opens a saved chat with an old workspace approval request
- **THEN** the retired operation cannot be approved or executed
- **AND** the user can continue chatting without clearing their history
