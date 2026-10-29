# Rule: Strict Ban on Native Browser Popups and Dialogs

## ⛔ Strictly Prohibited
- **DO NOT USE**: `window.confirm()`, `window.alert()`, `window.prompt()` under any circumstances.
- Native browser dialogs look out-of-place, break custom app theming (dark/light mode), freeze the Electron renderer process, and degrade the user experience.

## ✅ Required In-App UI Components

### 1. Confirmations
Always use the app's custom `<ConfirmDialog />` component:
- **Location**: `src/components/ui/ConfirmDialog.tsx`
- **Usage**:
  ```tsx
  import { ConfirmDialog } from '../components/ui/ConfirmDialog';

  <ConfirmDialog
      isOpen={showConfirm}
      onClose={() => setShowConfirm(false)}
      onConfirm={handleConfirmAction}
      title="Action Title"
      message="Description of the action to confirm."
      confirmText="Proceed"
      variant="primary" // 'primary' | 'danger' | 'warning'
      loading={isProcessing}
  />
  ```

### 2. Notifications & Alerts
Always use non-blocking in-app toasts:
- **Location**: `src/components/ui/Toast.tsx` / `NotificationContext`
- Never block user interaction with `window.alert()`.

### 3. Custom Input & Forms
Always use the custom styled modal component:
- **Location**: `src/components/ui/Modal.tsx`
