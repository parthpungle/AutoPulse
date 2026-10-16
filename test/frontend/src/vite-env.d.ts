/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where "Launch dashboard" goes. Defaults to /dashboard. */
  readonly VITE_DASHBOARD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
