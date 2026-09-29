# Component interface

How an application uses the equation editor, and how a units checker connects to it.
The editor is an equation editor first: it knows no more about units than the equations
themselves say (each number's units). Units checking is done outside it, by the host
application or a separate checker, and connects only through the props and event below.
Nothing here needs libCellML.

## `EquationWorkbench`

```vue
<EquationWorkbench
  cellml
  :issues="issues"
  :variable-units="variableUnits"
  @equations-change="lines = $event"
  @line-commit="(line) => save(line)"
/>
```

### Props

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `cellml` | `boolean` | `false` | CellML mode for the Content MathML the user sees and copies: the CellML namespace is declared on `<math>`, and every number carries `cellml:units`. |
| `issues` | `UnitsIssue[]` | `[]` | Units problems to show. Each is underlined in amber on its line, the line is outlined, and the status bar shows it; the message shows on hover. |
| `variableUnits` | `Record<string, string>` | none | Each variable's units by name, shown on hover ("Vm: millivolt"). When given, numbers without units also show theirs on hover ("2: dimensionless"); numbers with units always do ("0.25: mV"). It can be large (every variable of a model), and a new object with the same entries changes nothing, so it's fine to rebuild it after every change. |
| `greekNames` | `boolean` | `true` | Names that are Greek letters' names (`alpha`, `tau_m`) are drawn as the letters (α, τ_m), however they were typed; off, every Greek letter is spelled out (`\alpha` included). The names, and so the MathML, are the same either way. |
| `typesetNames` | `boolean` | `true` | Each name's subscripts and superscripts are typeset. One underscore starts a subscript and two a superscript, so `g_Kr__max` is g with the subscript Kr and the superscript max. The name being edited is shown as typed. Off, every name is shown as typed. The names, and so the MathML, are the same either way. Copied LaTeX follows this setting too. |
| `outputs` | `boolean` | `true` | The output panels (Content MathML, MathJSON, LaTeX, AST) and the "Copy as" menu. Off, only the equation lines (and the `side` slot) show: for an application embedding the editor. |
| `history` | `boolean` | `true` | The workbench's own undo and redo. Off, nothing is recorded, the Undo and Redo buttons are hidden, and Ctrl/Cmd+Z and Ctrl/Cmd+Y are left for the host (see [Embedding](#embedding-in-an-application)). |
| `validate` | `'input' \| 'commit'` | `'input'` | When a line's problems are shown (see [Problems](#problems-and-the-status-bar)). `'input'`: as the user types, except what is only missing (`x+`, an empty slot), which waits until the line is left. `'commit'`: once the line is committed (`line-commit`); while it is edited again, they are hidden until the next commit. |
| `readonly` | `boolean` | `false` | The lines are shown but can't be edited: the toolbar is disabled, and typing, Enter, pasting and undo do nothing. `setMathML` still sets the lines. |
| `autofocus` | `boolean` | `false` | The active line has the `autofocus` attribute, so a dialog's focus management (PrimeVue `Dialog` focuses the first `[autofocus]` once it has opened) puts the caret there; it is also focused when the workbench is mounted. |
| `debug` | `boolean` | `false` | Show the cursor and selection readout under the lines ("Cursor: 0.den @ 1"). |

### Slot

`side` is shown beside the equation editor, on the right, and stays in view as the page
scrolls: the place for a units panel (see below). With it, the outputs (Content MathML,
MathJSON, LaTeX and the AST, in tabs, Content MathML first) go under the editor; without
it, they go beside it. On a narrow screen everything stacks: editor, side, outputs. Keys
typed in the side content are left alone by the workbench, so `\` and Ctrl+Z work there
as in any input.

### Methods

Through a template ref:

```vue
<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { EquationWorkbench } from 'vue3-math-editor'

const workbench = useTemplateRef('workbench')

function open(mathml: string) {
  const { problems } = workbench.value!.setMathML(mathml)
  if (problems.length) console.warn(problems)
}
</script>

<template>
  <EquationWorkbench ref="workbench" cellml />
</template>
```

| Method | Meaning |
|---|---|
| `setMathML(xml: string): MathMLImport` | Replace every line with the equations in `xml`: Content MathML with one or more `<math>` elements, or bare `<apply>`s, one line each. An empty string leaves one empty line. It is a new document: the undo history starts again, so the user can't undo back to what was there, and the lines count as committed. Returns `{ equations, problems, lineProblems }`: what couldn't be read (it was left out), in all and for each equation. Each line's problems are also shown as its problems (and make it not `complete`) until it is edited. If `xml` isn't well-formed, the lines are left as they were and `problems` says so. |
| `focus(): void` | Focus the active line. |

### Events

`equations-change` is emitted with every line whenever the content of any line changes
(not when only the cursor moves), and once when the workbench is created. Its second
argument says what changed the lines:

```ts
interface EquationsChangeInfo {
  source: 'load' | 'edit' // 'load': the workbench started, or setMathML; 'edit': the user
}
```

A host keeping its own copy of the model can use it to tell a load from an edit, so as
not to mark the model changed just because it was opened in the editor.

```ts
interface EquationLine {
  id: string          // stable for the line's lifetime: "line-1", "line-2", …
  mathml: string      // Content MathML in CellML mode, whatever the `cellml` prop
  variables: string[] // variable names used, in order of first use
  units: string[]     // units names given to numbers (dimensionless is not listed)
  complete: boolean   // ready to use: see below
}
```

The MathML is always in CellML mode here, because that is what a units checker needs:
every number has `cellml:units`, its own if the user gave it units (`0.25{mV}`), otherwise
`dimensionless`.

A line is `complete` when it isn't empty and has no problems: nothing the parser couldn't
read, no empty slot or missing operand, no units still being typed, nothing left out when
it was imported, and (in CellML mode) it is an equation. A line that isn't `complete`
should not be sent for checking or stored as the model's maths. Its MathML writes each
empty slot or missing operand as `<ci>_</ci>` (`a =` is `<apply><eq/><ci>a</ci><ci>_</ci></apply>`),
and `setMathML` and pasting read `<ci>_</ci>` back as an empty slot, so an unfinished line
can be kept and loaded again as it was.

`line-commit` is emitted when the user is done with a line, if it changed since it was
last committed (or loaded):

```ts
interface LineCommitInfo {
  reason:
    | 'enter'    // Enter, which also adds a line
    | 'new-line' // the "+ Line" button
    | 'navigate' // ↑/↓ or a click to another line
    | 'blur'     // focus left the lines (not for the toolbar or its galleries)
    | 'paste'    // a paste of several equations replaced every line: one each
}
// emitted as (line: EquationLine, info: LineCommitInfo)
```

A host that validates or stores lines can do it on `line-commit` rather than on every
`equations-change`: typically, store `line.mathml` when `line.complete`.

### Problems and the status bar

A line's problems are underlined where they are (red, or amber for units issues from
`issues`; point at one to read it), and the line is outlined. Under the lines, a status
bar one line high shows the active line's first problem, or else the first on any line,
as "Line 2: Missing right-hand side", with "+3 more" if there are others; pointing at it
lists them all, and clicking it goes to that line. It also shows the `\` command being
typed, and what a paste did ("Imported 3 equations…"). It is always there, so the lines
don't move when a problem appears or goes. When problems show at all is the `validate`
prop's choice.

### Issues

```ts
interface UnitsIssue {
  lineId: string                // the EquationLine id
  message: string               // shown on hover and in the status bar
  variables?: readonly string[] // underline every occurrence of these names in the line
  numbers?: readonly number[]   // underline these numbers (matched by value)
  units?: readonly string[]     // underline the numbers given these units (0.25{mV})
}
```

Issues are matched to lines by id, so they stay on the right line when lines are added or
removed above them. An issue naming nothing that appears in the line is shown in the
status bar but not underlined.

The types are exported from the package: `import type { EquationLine, UnitsIssue } from
'vue3-math-editor'`.

## Importing Content MathML

Pasting Content MathML into an equation imports it (see [Writing
equations](writing-equations.md)): one equation at the caret, or several replacing every
line, with numbers' `cellml:units` kept. Each imported line is reported through
`equations-change` like any other, so a units checker sees it straight away; variables'
units aren't part of the maths and are given as usual. To set the lines from the host,
use `setMathML` (above). The reader itself is exported as `importContentMathML(text)`,
returning `{ equations, problems, lineProblems }` (rows ready for the editor, and what
couldn't be read, in all and for each equation), or `null` if the text isn't well-formed
XML.

What it reads:

| | Elements |
|---|---|
| Tokens | `ci`, `cn` (with `cellml:units`, and `type="e-notation"` with `<sep/>`) |
| Constants | `pi`, `exponentiale`, `infinity`, `notanumber`, `true`, `false` |
| Arithmetic | `plus`, `minus` (one or two operands), `times`, `divide`, `power`, `root` (with `degree`), `abs` |
| Relations and logic | `eq`, `neq`, `lt`, `gt`, `leq`, `geq`, `and`, `or`, `xor`, `not` |
| Calculus | `diff` with a `bvar` (first order only) |
| Functions | `exp`, `ln`, `log` (with `logbase`), `floor`, `ceiling`, `min`, `max`, `rem` |
| Trigonometric | `sin`, `cos`, `tan`, `sec`, `csc`, `cot`, and their `arc…` inverses |
| Hyperbolic | `sinh`, `cosh`, `tanh`, `sech`, `csch`, `coth`, and their `arc…` inverses |
| Conditions | `piecewise` with `piece` and `otherwise` |

Anything else (for example a higher-order derivative, `factorial`, or a `csymbol`) is
listed in `problems` and left out, with nothing in its place: it leaves an empty slot, or
an operator missing its operand (`y = <factorial/>…` reads as `y =`), so the line is not
`complete` and says why. A `<piece>` or `<otherwise>` missing its value or condition
keeps an empty slot for it. `<ci>_</ci>` is an empty slot, and not reported. A `ci` that isn't a CellML name, or is
spelled like a function or a constant, is also reported.

## Number units

Numbers are dimensionless unless the user gives them units, typed in braces straight after
the number: `0.25{mV}`, `1e-3{per_s}`. The units show (light blue) while being typed, then
are hidden, leaving a very small light-blue triangle on the number: pointing at it shows
them ("0.25: mV"), and they are always in the line's MathML.
An issue naming numbers, by value or by their units (`numbers` or `units` in a
`UnitsIssue`), underlines only the numbers; their units stay hidden. See [Writing equations](writing-equations.md).

## Connecting a units checker

A checker's job:

1. Keep the units definitions and each variable's units (from the user's CellML units
   files, or the host's own model).
2. On `equations-change`, check each `complete` line's MathML against them.
3. Pass the problems back as `issues`, and the variables' units as `variableUnits`.

`src/units/` is such a checker, using libCellML. It is optional and separate from the
editor: nothing in it imports libcellml.js, which the host provides.

### With the vue3-libcellml.js plugin

```ts
// main.ts
import libcellmlPlugin from 'vue3-libcellml.js'
app.use(libcellmlPlugin)
```

```vue
<script setup lang="ts">
import { ref } from 'vue'
import {
  EquationWorkbench,
  type EquationLine,
  type UnitsDefinition,
  type UnitsSource,
  type VariableUnits,
  useUnitsChecker,
} from 'vue3-math-editor'

const lines = ref<EquationLine[]>([])
const sources = ref<UnitsSource[]>([]) // { name, text } of each CellML units file
const variableUnits = ref<VariableUnits>({})
const newUnits = ref<UnitsDefinition[]>([]) // units the user defines

const { issues, problems, missing, unitsNames, status, newUnitsFile } = useUnitsChecker({
  lines,
  sources,
  variableUnits,
  newUnits,
  // Optional: only report once the user has given some units.
  enabled: () => sources.value.length > 0 || Object.keys(variableUnits.value).length > 0,
})
</script>

<template>
  <EquationWorkbench
    cellml
    :issues="issues"
    :variable-units="variableUnits"
    @equations-change="lines = $event"
  />
</template>
```

`useUnitsChecker` injects `$libcellml` from the plugin. Without the plugin, `available`
is false and `issues` stays empty; nothing else changes. With it, checking starts once
libcellml.js has loaded (`ready`), and runs again 300 ms (`delay`) after the lines or
the variables' units change, or at once when the units files change (replace the
`sources` array to reload them). A line's result is cached by its MathML and its
variables' units, so only edited lines are analysed again.

| Returned | Meaning |
|---|---|
| `issues` | For the workbench's `issues` prop |
| `problems` | `{ source, message }[]`: problems reading the units files (unreadable, a name defined twice differently, units made from undefined units, imports) |
| `missing` | Variables used in the equations that have no units yet |
| `unitsNames` | Every units name the equations can use: built in, then the files' |
| `files` | Each units file as read: its name and the units kept from it (the new units last, as `'new units'`) |
| `newUnitsFile` | The new units as a CellML 2.0 file holding only them (`''` if there are none) |
| `status` | `'unavailable'` (no libcellml.js), `'loading'` or `'ready'` |
| `available`, `ready` | libcellml.js is provided; it has loaded |
| `checking` | Ready and `enabled`: issues are being reported |
| `check()` | Check now rather than after the delay |

To pass libcellml.js in directly instead of injecting it, give the loaded module as the
`libcellml` option.

`newUnits` (optional) are units the user has defined, as plain data; the checker reads
them as one more units file, generated from them (`newUnitsFile` in
`src/units/definitions.ts`), so equations can use them straight away.

`enabled` (default: always) lets an application hold off until units are in use. Without
it, a user who writes equations without units sees every variable reported as having
none; the demo checks once a units file is loaded or any variable has units.

### The units panel

`UnitsPanel` (exported; `src/units/UnitsPanel.vue`) is a ready-made panel for all this, meant for
the workbench's `side` slot. It shows the checker's status, loads units files
(any CellML file; only its units are kept), lists each file's units and problems, and
lets the user define new units, and lists the variables the equations use, with an
input for each one's units (suggesting the known units names, and marking missing and
unknown units). It takes the checker's
results as props and hands edits back through `v-model`; like the rest of `src/units/`,
it never imports libcellml.js, and without it still lets the user give units, which the
workbench then shows on hover.

```vue
<EquationWorkbench :issues="issues" :variable-units="variableUnits" @equations-change="lines = $event">
  <template #side>
    <UnitsPanel
      v-model:sources="sources"
      v-model:variable-units="variableUnits"
      v-model:new-units="newUnits"
      :lines="lines"
      :status="status"
      :checking="checking"
      :files="files"
      :problems="problems"
      :units-names="unitsNames"
      :issues="issues"
    >
      <!-- optional: more buttons beside "Load units files" -->
      <template #actions>…</template>
      <!-- optional: beside "Define units", e.g. to save the new units file -->
      <template #new-units-actions="{ definitions }">…</template>
    </UnitsPanel>
  </template>
</EquationWorkbench>
```

A units input's value is taken when it changes (Enter, or leaving the input), so a
half-typed name isn't checked.

### New units

Units the user defines are kept apart from the units files they loaded, which are never
changed. The panel's **Define units** form takes a name and what the units are made of:
parts, each a units name with an optional prefix (milli, micro, …), exponent and
multiplier, as a CellML `<unit>`. It checks the name is a CellML name that isn't taken,
that the parts are known units, and that no units end up made of themselves. New units
can be changed (a rename follows through the other new units) and removed (unless other
new units are made of them).

```ts
interface UnitsDefinition {
  name: string
  parts: { units: string; prefix?: string; exponent?: number; multiplier?: number }[]
}
```

The definitions are the host's (`v-model:new-units`), to keep with its own data. To
retrieve them as CellML, `newUnitsFile(definitions)` (or the checker's `newUnitsFile`)
writes a CellML 2.0 model holding only them, units used by others first:

```xml
<model xmlns="http://www.cellml.org/cellml/2.0#" name="new_units">
  <units name="mV_per_ms">
    <unit prefix="milli" units="volt"/>
    <unit prefix="milli" units="second" exponent="-1"/>
  </units>
</model>
```

That file loads again as a units file like any other. The demo saves it with a Download
button (`new-units.cellml`) in the `new-units-actions` slot. Writing and checking the
definitions doesn't need libCellML; without it, only the names used can't be checked.

### Without Vue

Within this repository (these classes aren't exported from the package):

```ts
import { UnitsLibrary } from './units/library'
import { UnitsChecker } from './units/check'

const library = UnitsLibrary.load(libcellml, sources)
const checker = new UnitsChecker(libcellml, library)
const issues = checker.check(lines, variableUnits)
// When done with them: checker.dispose(); library.dispose()
```

The issues the checker reports:

| Problem | Message (example) | Underlined |
|---|---|---|
| A variable without units | `x has no units` | the variable |
| An undefined units name | `No units called furlong are defined` | variables and numbers using it |
| Units that don't match | `Units don't match in t+2.0: t is in second, 2.0 is dimensionless` | the variables at fault, or the numbers where there are none |
| An argument that must be dimensionless | `t in exp(t) must be dimensionless, but is in second` | the variable |

Variables without units are reported first, then undefined units names; a line with
either isn't analysed further. Units that differ only in scale (`mV` and `volt`) don't
match. Lines that aren't
`complete` aren't checked. See *Units checking* in [the design](design.md) for how it
works.

## Embedding in an application

```sh
yarn add vue3-math-editor vue primevue katex primeicons
```

The host installs PrimeVue with a theme and imports the styles: the editor's own, and
KaTeX's and PrimeIcons', which it doesn't bundle.

```ts
import 'katex/dist/katex.min.css'
import 'primeicons/primeicons.css'
import 'vue3-math-editor/style.css'
```

An editor inside another application usually wants something like:

```vue
<EquationWorkbench
  ref="workbench"
  cellml
  :outputs="false"
  :history="false"
  validate="commit"
  autofocus
  @line-commit="(line) => line.complete && store(line)"
/>
```

with the lines loaded with `setMathML` rather than pasted.

### Toolbar

The toolbar is one row of groups, as in a word processor's equation editor: Fraction,
Power, Roots ▾, Brackets ▾ (absolute value, floor, ceiling), Functions ▾ (trigonometric,
hyperbolic and their inverses, exp, ln, log), Derivative, Piecewise and Symbols ▾
(operators, constants, relations, logic), then the line buttons. ▾ opens a gallery; a
click never takes the focus from the line. The groups are defined in
`src/editor/toolbar.ts`.

The toolbar is sticky: it stays at the top of whatever scrolls the lines (the page, or a
dialog's content) while the user scrolls through them. Set `--me-toolbar-top` to keep it
below a sticky header of the host's. Sticky positioning needs nothing between the toolbar
and that scrolling element to set `overflow`.

### Size

Equations are drawn at `--me-line-font-size` (default `1.05rem`; KaTeX draws its
display maths about 1.2 times that). Set it on an element around the workbench.

### Undo and redo

The workbench handles Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y itself, in a keydown
listener in the capture phase on its root element. A host with one undo history across
several editors can either:

- set `:history="false"`: the workbench records nothing, hides its Undo and Redo buttons
  and leaves those keys alone, so they reach the host's own listeners; or
- keep it on and catch the keys first, with a capture-phase listener on an element around
  the workbench (it runs before the workbench's), calling `preventDefault()` and
  `stopPropagation()`.

Either way, the host restores a state by calling `setMathML` with its saved MathML.

### Theming

Colours come from the PrimeVue theme's design tokens (`--p-content-background`,
`--p-text-color`, `--p-content-border-color`, `--p-text-muted-color`, …), so the
workbench follows the host's light or dark mode. Without PrimeVue's tokens it falls back
to a light theme. The accent (the active line's border, the toolbar buttons' hover) is
the editor's own blue; set `--math-editor-accent` on an element around it to change it. The output
panels are dark in both modes.

### MathML text

An `EquationLine`'s `mathml` is written the same way every time for the same equation:
the same indentation, attribute order and `<sep/>` handling. So reading lines, loading
them with `setMathML` and reading them again gives the same text. MathML written by
something else (libCellML, another editor) is generally formatted differently, even for
the same equations. Compare after normalising, or expect the first load of such MathML
to read back as different text.
