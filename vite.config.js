import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// The demo application (`yarn dev`, `yarn build:demo`). The library that is
// published to npm is built with vite.lib.config.js (`yarn build`).
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'math-field',
        },
      },
    }),
    vueDevTools(),
  ],
  // libcellml.js finds its WebAssembly next to itself (new URL(…,
  // import.meta.url)), which pre-bundling would break.
  optimizeDeps: {
    exclude: ['vue3-libcellml.js', 'libcellml.js'],
  },
  build: {
    outDir: 'dist-demo',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // The demo application. The library (what is published) builds into dist/
  // with vite.lib.config.js; keeping them apart means neither overwrites the
  // other.
  build: {
    outDir: 'dist-demo',
  },
})
