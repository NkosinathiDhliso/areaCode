/// <reference types="vite/client" />

// App version/build injected by Vite `define` (see vite.config.ts). Used by the
// HD-3 diagnostics readout. Neither value is a secret.
declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string
