## Purpose

Persist AMA configuration within the current Chrome profile without replicating it through Chrome sync.

## ADDED Requirements

### Requirement: Configuration persists locally
AMA SHALL persist settings and credentials within the current Chrome profile and continue to use the existing local configuration after an update.

#### Scenario: Existing local configuration survives the update
- **GIVEN** the profile has local configuration and previously enabled Chrome configuration sync
- **WHEN** the updated extension starts
- **THEN** its saved local configuration and credentials remain in effect, even if a different snapshot exists in Chrome sync

#### Scenario: Settings still save and reload
- **WHEN** a user changes a model setting or credential and reloads AMA
- **THEN** AMA uses the saved value in the current profile

### Requirement: AMA does not synchronize configuration through Chrome
AMA SHALL NOT expose configuration sync controls or read, upload, download, or delete legacy configuration snapshots in Chrome sync storage.

#### Scenario: Old sync state and cloud events have no effect
- **GIVEN** a profile contains old sync state and an existing sync snapshot
- **WHEN** AMA starts, settings change, or Chrome delivers an update to the old snapshot
- **THEN** AMA does not fetch, apply, write, or remove sync snapshots
- **AND** model settings offer no controls to enable or manage Chrome configuration sync
