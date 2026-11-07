# Workspace Guidelines & Rules

## 1. UI & Dialogs (Strict Rule)
- **NEVER use native browser dialogs**: `window.confirm()`, `window.alert()`, `window.prompt()` are strictly prohibited.
- **Confirmation dialogs**: Always use the in-app `<ConfirmDialog />` component from `src/components/ui/ConfirmDialog.tsx`.
- **Alerts / Notifications**: Always use in-app toasts (`src/components/ui/Toast.tsx`).
- **Modals**: Always use custom styled in-app modals (`src/components/ui/Modal.tsx`).

## 2. Version Info & Changelog Maintenance
- **Build & Milestone-Based Versioning**: Versions in `package.json` and the Version Info page (`src/components/settings/VersionInfo.tsx`) represent **actual builds / installer packages or major completed milestones**, NOT individual chat edits or small tweaks.
- **Accumulating Changes**: During ongoing development, features, improvements, and fixes accumulate under the active milestone/build.
- **Release Entry Standards**:
  - Add or update the current version at the top of `RELEASES` in `src/components/settings/VersionInfo.tsx` with `isCurrent: true`.
  - Group related improvements into clear, user-facing release items categorized into `feature`, `improvement`, or `fix`.
  - Include concise, descriptive titles and clear user-facing descriptions explaining the benefit to store operations.

## 3. Sales Forecasting Scope (User Approved)
- Preserve forecasts for 1–6 upcoming months, restocking directions, seasonal planning alerts, and period/year comparisons.
- Fix accuracy and data-quality issues within those capabilities, with explicit limitations and forecast-basis labels.
- Ask the user before changing this page's objective or removing/replacing a major capability. Do not substitute a short-term insights page for the forecasting page without approval.

