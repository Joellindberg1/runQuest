// Bridge for imperative sidebar control from the onboarding system.
// AppLayout registers open/close on mount. OnboardingOrchestrator calls
// open() before onboarding_v1 on mobile so sidebar elements are visible.
type Fn = () => void;

let _open: Fn | null = null;
let _close: Fn | null = null;

export const sidebarBridge = {
  register(open: Fn, close: Fn) {
    _open = open;
    _close = close;
  },
  open() { _open?.(); },
  close() { _close?.(); },
};
