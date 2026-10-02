import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The library build (yarn build:lib): src/index.ts as an ES module in dist/,
// with the components' styles in dist/style.css. Vue, PrimeVue (and its
// @primeuix/utils) and KaTeX are peer dependencies, left for the host to
// provide. The demo builds with vite.config.js instead, into dist-demo/.
export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'math-field',
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // public/ (the demo's favicon) isn't part of the library.
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'vue3-math-editor',
      cssFileName: 'style',
    },
    rolldownOptions: {
      external: ['vue', 'katex', /^primevue(\/|$)/, /^@primeuix\/utils(\/|$)/],
    },
  },
})
