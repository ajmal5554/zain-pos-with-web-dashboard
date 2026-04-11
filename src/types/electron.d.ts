import { ElectronAPI } from '../electron/preload';

type PosLeaveGuard = {
    isActive: () => boolean;
    confirmLeave: () => boolean;
};

declare global {
    interface Window {
        electronAPI: ElectronAPI;
        posLeaveGuard?: PosLeaveGuard;
    }
}
