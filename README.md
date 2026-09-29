# vue3-math-editor

A semantic equation editor for Vue 3: equations are edited WYSIWYG, rendered with KaTeX,
and exported as MathJSON, Content MathML (optionally ready for CellML 2.0) and LaTeX.

## Documentation

See [docs/](docs/README.md):

- [Writing equations](docs/writing-equations.md): how to use the editor, and how input is
  interpreted.
- [Equation editor design](docs/design.md): how it works inside.
- [Component interface](docs/component-interface.md): using the editor in an application,
  and checking units with libCellML.

The demo (`yarn dev`) checks units with libCellML through the
[vue3-libcellml.js](https://github.com/hsorby/vue3-libcellml.js) plugin: load a CellML
units file (or press Example), give the variables units, and problems are underlined as
you type. Open it with `?nolibcellml` to run it without the plugin, and `?cellml` for
CellML-mode MathML.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Using it in an application

```sh
yarn add vue3-math-editor vue primevue katex primeicons
```

```ts
// main.ts: install PrimeVue with a theme, and import the styles
import 'katex/dist/katex.min.css'
import 'primeicons/primeicons.css'
import 'vue3-math-editor/style.css'
```

```vue
<script setup lang="ts">
import { EquationWorkbench, type EquationLine } from 'vue3-math-editor'
</script>
```

See [Component interface](docs/component-interface.md) for the props, events and the
units checker.

## Project Setup

```sh
corepack enable                     # once: yarn comes from package.json's packageManager
yarn install
yarn playwright install chromium    # once, for the browser tests
```

### Compile and Hot-Reload for Development

```sh
yarn dev
```

### Build

```sh
yarn build        # the library, into dist/ (what is published to npm)
yarn build:demo   # the demo application, into dist-demo/
```

### Run the Tests

```sh
yarn test         # unit tests (Vitest)
yarn test:e2e     # browser tests (Playwright)
```

### Lint with [ESLint](https://eslint.org/)

```sh
yarn lint
```

## License

[Apache-2.0](LICENSE)
