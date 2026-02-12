# @naap/plugin-build

Shared Vite/build configuration for NAAP plugins. Plugins import `createPluginConfig` from `@naap/plugin-build/vite`.

## Build requirement

**This package must be built before plugin builds.** Node ESM cannot load `.ts` files; plugins resolve `@naap/plugin-build/vite` to `dist/vite.js`.

- `bin/vercel-build.sh` and `bin/build-plugins.sh` build it automatically.
- For manual builds: `npx tsc -p packages/plugin-build/tsconfig.json`

## Exports

Package exports point to `dist/`, not `src/`. Do not change exports to `.ts` — CI and local plugin builds will fail.
