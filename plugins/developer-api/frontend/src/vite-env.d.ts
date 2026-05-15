/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PMTHOUSE_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
