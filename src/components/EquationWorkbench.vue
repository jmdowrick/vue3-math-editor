<script setup lang="ts">
// The equation workbench: a list of equation lines, each a MathField, plus a
// toolbar, undo/redo, "\" command mode and live output panels.
//
// State is one EditorState ({ root, cursor }) per line. MathField runs the
// per-key editing commands and emits the new state; the workbench records
// undo history (editor/history.ts: consecutive typing is one step) and
// handles what spans lines (Enter, ↑/↓ between lines, removing an empty
// line) and command mode. The semantic AST shown in the output panels is
// parsed from the active line's layout tree.
//
// Interface (see docs/component-interface.md):
// - `cellml` prop: CellML mode. The Content MathML (output panel and "Copy
//   as") declares the CellML namespace on <math> and gives every number
//   cellml:units (its own, or dimensionless). Off by default, so other
//   consumers get plain Content MathML.
// - `equations-change` event: every line (a stable id, its CellML-mode
//   Content MathML, the variables it uses, whether it's complete), whenever
//   any line's content changes, and whether the user or the host changed
//   them. For a units checker outside the editor.
// - `issues` prop: units issues to underline, by line id and variable names.
// - `variableUnits` prop: each variable's units, shown on hover; with it,
//   numbers show their units on hover too.
// - `outputs` prop: the output panels and "Copy as" (on by default).
// - `history` prop: the workbench's own undo/redo (on by default); off, a host
//   with its own undo history gets Ctrl/Cmd+Z and Y.
// - `setMathML(xml)` and `focus()`, exposed: set every line from Content
//   MathML (a new document: no undo back past it), and focus the editor.
// - `line-commit` event: a line finished with (Enter, a new line, moving to
//   another line, focus leaving the editor), if it changed since last time.
// - `validate` prop: 'input' (default) marks problems as the user types,
//   except what is only missing on the line being typed; 'commit' marks a
//   line's problems once it is committed.
// - `readonly`, `autofocus` and `debug` (the cursor readout) props.
import { computed, nextTick, onMounted, ref, toRaw, watch } from 'vue'
import katex from 'katex'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Menu from 'primevue/menu'
import Popover from 'primevue/popover'
import Tab from 'primevue/tab'
import TabList from 'primevue/tablist'
import TabPanel from 'primevue/tabpanel'
import TabPanels from 'primevue/tabpanels'
import Tabs from 'primevue/tabs'
import Tag from 'primevue/tag'

import MathField, { type Mark, type NavigationState } from './MathField.vue'
import {
  type Command,
  type EditorState,
  emptyState,
  insertAtoms,
  namedCommand,
} from '../editor/commands'
import { cursorAtEnd, describeCursor } from '../editor/cursor'
import { EXPORT_FORMATS, type ExportFormat, contentMathML, exportRow } from '../editor/exports'
import { type EditInfo, History, OTHER_EDIT, undoGroup } from '../editor/history'
import {
  type EquationLine,
  type EquationsChangeInfo,
  type LineCommitInfo,
  type UnitsIssue,
  type VariableUnits,
  equationLine,
  unitsHintMarks,
  unitsIssueMarks,
} from '../editor/units'
import type { Row } from '../editor/layout'
import { type MathMLImport, importContentMathML } from '../editor/mathmlImport'
import { settleNames } from '../editor/names'
import { settleState } from '../editor/numberUnits'
import { parseRow } from '../editor/parse'
import { describeSelection, selectedAtoms, selectionOf } from '../editor/selection'
import { TOOLBAR, type ToolGroup } from '../editor/toolbar'
import { isProblem, markKind } from '../editor/marks'
import { renderMathJson } from '../renderers/mathjson'

const props = withDefaults(
  defineProps<{
    cellml?: boolean
    issues?: readonly UnitsIssue[]
    variableUnits?: VariableUnits
    // Names that are Greek letters' names (alpha, tau_m) drawn as the letters
    // (α, τ_m), however they were typed; off, Greek letters are spelled out.
    // Either way the names are the same (editor/names.ts).
    greekNames?: boolean
    // The Content MathML, MathJSON, LaTeX and AST panels, and "Copy as".
    outputs?: boolean
    // The workbench's own undo/redo: off, nothing is recorded, the buttons are
    // hidden and Ctrl/Cmd+Z and Y are left to the host.
    history?: boolean
    // When problems are marked: 'input', as the user types (what is only
    // missing, on the line being typed, once it is left); 'commit', once the
    // line is committed (see `line-commit`).
    validate?: 'input' | 'commit'
    // Shown, but not editable (setMathML still sets the lines).
    readonly?: boolean
    // The active line has the autofocus attribute (for a dialog's focus
    // management), and is focused when the workbench is mounted.
    autofocus?: boolean
    // The cursor and selection readout under the lines.
    debug?: boolean
  }>(),
  {
    cellml: false,
    issues: () => [],
    variableUnits: undefined,
    greekNames: true,
    outputs: true,
    history: true,
    validate: 'input',
    readonly: false,
    autofocus: false,
    debug: false,
  },
)

const emit = defineEmits<{
  'equations-change': [lines: EquationLine[], info: EquationsChangeInfo]
  'line-commit': [line: EquationLine, info: LineCommitInfo]
}>()

const exportOptions = computed(() => ({ cellml: props.cellml, greekNames: props.greekNames }))

const equations = ref<EditorState[]>([emptyState()])
// Each line's id, parallel to `equations`: stable while the line exists, so a
// host's issues stay on the right line when lines are added or removed.
let lineCount = 0
const newLineId = () => `line-${++lineCount}`
const lineIds = ref<string[]>([newLineId()])
// Each line's MathML when last committed, by id ('' if never: an empty line
// needs no commit). A line whose MathML differs has changed since.
const committed = ref(new Map<string, string>())
// What couldn't be read when a line was imported, by id, until it's edited.
const importProblems = ref(new Map<string, readonly string[]>())
const activeIndex = ref(0)
const fieldRefs = ref<Array<InstanceType<typeof MathField> | null>>([])

// Non-null while a "\..." command is being typed (Mathfield-style).
const commandBuffer = ref<string | null>(null)

function active(): EditorState {
  return equations.value[activeIndex.value]
}

// Every state is settled first: no cursor before a number's hidden units, and
// units no longer wanted removed (editor/numberUnits.ts).
function setEquation(index: number, state: EditorState) {
  equations.value[index] = settle(state)
}

// Settled: number units (numberUnits.ts), then names (names.ts). A line no
// longer being edited has every name settled, the cursor's too.
const settle = (state: EditorState, cursorAway = false) =>
  settleNames(settleState(state), { greekNames: props.greekNames, cursorAway })

// Leaving a line, and turning Greek names on or off, settle names too.
watch(activeIndex, (_, left) => {
  const line = equations.value[left]
  if (line) equations.value[left] = settle(line, true)
})
watch(
  () => props.greekNames,
  () => {
    equations.value = equations.value.map((line, index) =>
      settle(line, index !== activeIndex.value),
    )
  },
)

function focusActive() {
  void nextTick(() => fieldRefs.value[activeIndex.value]?.focus())
}

// ---------------------------------------------------------------------------
// History (undo/redo)
// ---------------------------------------------------------------------------

interface Snapshot {
  equations: EditorState[]
  lineIds: string[]
  active: number
}

const undoHistory = new History<Snapshot>()
// History isn't reactive; bumped whenever it changes, for canUndo/canRedo.
const historyVersion = ref(0)

function takeSnapshot(): Snapshot {
  return JSON.parse(
    JSON.stringify({
      equations: equations.value,
      lineIds: lineIds.value,
      active: activeIndex.value,
    }),
  ) as Snapshot
}

// Record the state before an edit to line `line` (default: a step of its own).
function pushHistory(line = activeIndex.value, info: EditInfo = OTHER_EDIT) {
  if (!props.history) return
  undoHistory.checkpoint(takeSnapshot, undoGroup(line, info))
  historyVersion.value++
}

function restore(snapshot: Snapshot | null) {
  if (!snapshot) return
  equations.value = snapshot.equations
  lineIds.value = snapshot.lineIds
  activeIndex.value = Math.min(snapshot.active, snapshot.equations.length - 1)
  historyVersion.value++
  focusActive()
}

const undo = () => restore(undoHistory.undo(takeSnapshot()))
const redo = () => restore(undoHistory.redo(takeSnapshot()))

const canUndo = computed(() => historyVersion.value >= 0 && undoHistory.canUndo)
const canRedo = computed(() => historyVersion.value >= 0 && undoHistory.canRedo)

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function handleEdit(index: number, next: EditorState, info: EditInfo) {
  // A command that only moved the cursor (Space out of a fraction, Tab to
  // the next slot) is navigation, not an undo step.
  if (toRaw(next.root) === toRaw(equations.value[index].root)) {
    handleNavigate(index, { cursor: next.cursor, anchor: next.anchor ?? null })
    return
  }

  pushHistory(index, info)
  setEquation(index, next)
  edited(index)
}

// A line's content changed: what was said about its import no longer holds.
function edited(index: number) {
  importProblems.value.delete(lineIds.value[index])
  importNotice.value = null
}

// Cursor moves and selection changes: not recorded in undo history, but the
// next edit starts a new undo step.
function handleNavigate(index: number, { cursor, anchor }: NavigationState) {
  undoHistory.breakGroup()
  setEquation(index, { ...equations.value[index], cursor, anchor })
}

// Every line replaced, one per row (none: one empty line), each with a new id
// and what couldn't be imported for it. They count as committed.
function replaceLines(roots: readonly Row[], problems: readonly (readonly string[])[] = []) {
  const states = roots.map((root) =>
    settle({ root, cursor: cursorAtEnd(root), anchor: null }, true),
  )
  equations.value = states.length ? states : [emptyState()]
  lineIds.value = equations.value.map(() => newLineId())
  activeIndex.value = 0
  importProblems.value = new Map(
    lineIds.value.flatMap((id, index) => (problems[index]?.length ? [[id, problems[index]]] : [])),
  )
  committed.value = new Map(lines.value.map((line) => [line.id, line.mathml]))
}

// Pasted Content MathML: one equation (or expression) goes in at the caret,
// like any paste; several replace every line, one line each, as opening them
// would. Either way it is one undo step, and what couldn't be read is listed.
// What couldn't be read is kept with its line (and shown as its problem)
// until the line is edited; the notice says what happened until the next edit.
const importNotice = ref<string | null>(null)

function handleImport(index: number, result: MathMLImport) {
  if (props.readonly) return
  const count = result.equations.length

  if (count === 1) {
    handleEdit(index, insertAtoms(result.equations[0])(equations.value[index]), OTHER_EDIT)
    if (result.problems.length) importProblems.value.set(lineIds.value[index], result.problems)
  } else if (count > 1) {
    pushHistory(index)
    replaceLines(result.equations, result.lineProblems)
    // Each new line is finished with, as if typed and committed.
    for (const line of lines.value) emit('line-commit', line, { reason: 'paste' })
    focusActive()
  }

  importNotice.value =
    count > 1
      ? `Imported ${count} equations from Content MathML, replacing the lines there were.`
      : count === 0
        ? (result.problems[0] ?? 'Nothing was imported.')
        : null
}

// The host sets the lines (exposed): Content MathML with one or more <math>,
// or bare <apply>s, one line each. A new document: the undo history starts
// again, and the equations-change event says 'load'. Malformed XML leaves the
// lines as they were.
function setMathML(xml: string): MathMLImport {
  const result = importContentMathML(xml)
  if (!result) {
    return {
      equations: [],
      problems: ["The MathML isn't well-formed XML, so nothing was loaded"],
      lineProblems: [],
    }
  }

  changeSource = 'load'
  replaceLines(result.equations, result.lineProblems)
  commandBuffer.value = null
  importNotice.value = null
  undoHistory.clear()
  historyVersion.value++
  return result
}

defineExpose({ setMathML, focus: focusActive })

onMounted(() => {
  if (props.autofocus) focusActive()
})

// Run a command on the active line (toolbar buttons, command mode).
function run(command: Command) {
  if (props.readonly) return
  const state = active()
  const next = command(state)

  if (next !== state) {
    pushHistory()
    setEquation(activeIndex.value, next)
    edited(activeIndex.value)
  }

  focusActive()
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

// The active line is committed first (Enter, or the "+ Line" button).
function addLineAfterActive(reason: 'enter' | 'new-line') {
  if (props.readonly) return
  commitLine(activeIndex.value, reason)
  pushHistory()
  const index = activeIndex.value + 1
  equations.value.splice(index, 0, emptyState())
  lineIds.value.splice(index, 0, newLineId())
  activeIndex.value = index
  focusActive()
}

function moveToLine(index: number) {
  if (index < 0 || index >= equations.value.length) return
  if (index !== activeIndex.value) commitLine(activeIndex.value, 'navigate')
  undoHistory.breakGroup()
  activeIndex.value = index
  focusActive()
}

// ↑/↓ and moving within the workbench commit through moveToLine; a click
// on another line lands here.
function handleLineFocus(index: number) {
  if (index === activeIndex.value) return
  commitLine(activeIndex.value, 'navigate')
  activeIndex.value = index
}

// Focus leaving the lines for anywhere but another line or a toolbar gallery.
const stackEl = ref<HTMLElement | null>(null)
function handleFocusOut(event: FocusEvent) {
  const to = event.relatedTarget as Element | null
  if (to && (stackEl.value?.contains(to) || to.closest('[data-me-popover]'))) return
  commitLine(activeIndex.value, 'blur')
}

// A line is finished with: the event, if it changed since it was last
// committed (or loaded).
function commitLine(index: number, reason: LineCommitInfo['reason']) {
  const line = lines.value[index]
  if (!line || (committed.value.get(line.id) ?? '') === line.mathml) return
  committed.value.set(line.id, line.mathml)
  emit('line-commit', line, { reason })
}

function removeActiveLine() {
  if (props.readonly || equations.value.length <= 1) return

  pushHistory()
  equations.value.splice(activeIndex.value, 1)
  lineIds.value.splice(activeIndex.value, 1)
  activeIndex.value = Math.max(0, activeIndex.value - 1)
  // Continue at the end of the line above.
  const state = active()
  setEquation(activeIndex.value, { ...state, cursor: cursorAtEnd(state.root), anchor: null })
  focusActive()
}

// ---------------------------------------------------------------------------
// Keyboard: command mode and shortcuts (capture phase, before MathField)
// ---------------------------------------------------------------------------

function commitCommand() {
  const name = (commandBuffer.value ?? '').trim()
  commandBuffer.value = null
  if (name) run(namedCommand(name))
}

function handleCommandModeKey(event: KeyboardEvent) {
  if (/^[a-zA-Z0-9]$/.test(event.key)) {
    commandBuffer.value += event.key
  } else if (event.key === 'Backspace') {
    commandBuffer.value = commandBuffer.value ? commandBuffer.value.slice(0, -1) : null
  } else if (['Enter', ' ', 'Tab', '('].includes(event.key)) {
    commitCommand()
  } else if (event.key === 'Escape') {
    commandBuffer.value = null
  } else {
    return
  }

  event.preventDefault()
  event.stopPropagation()
}

function handleCaptureKeydown(event: KeyboardEvent) {
  // Keys in the host's side content (its own inputs) are its own.
  if ((event.target as Element | null)?.closest?.('[data-role="side"]')) return

  if (commandBuffer.value !== null) {
    handleCommandModeKey(event)
    return
  }

  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    const key = event.key.toLowerCase()

    if ((key === 'z' || key === 'y') && props.history) {
      event.preventDefault()
      event.stopPropagation()
      if (props.readonly) return
      if (key === 'y' || event.shiftKey) redo()
      else undo()
    }

    return
  }

  if (event.key === '\\' && !event.altKey && !props.readonly) {
    event.preventDefault()
    event.stopPropagation()
    commandBuffer.value = ''
  }
}

// ---------------------------------------------------------------------------
// Keyboard: keys MathField didn't use (bubble phase)
// ---------------------------------------------------------------------------

function handleUnusedKey(event: KeyboardEvent) {
  if (event.defaultPrevented) return

  switch (event.key) {
    case 'Enter':
      event.preventDefault()
      addLineAfterActive('enter')
      return
    case 'ArrowUp':
      event.preventDefault()
      moveToLine(activeIndex.value - 1)
      return
    case 'ArrowDown':
      event.preventDefault()
      moveToLine(activeIndex.value + 1)
      return
    case 'Backspace':
      // Only reaches here when there is nothing left to delete on the line.
      if (active().root.length === 0) {
        event.preventDefault()
        removeActiveLine()
      }
      return
  }
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

// A group opens its gallery in one shared popover (teleported to the body,
// so marked for handleFocusOut); a click on an item runs it and closes it.
const gallery = ref<InstanceType<typeof Popover> | null>(null)
const galleryGroup = ref<ToolGroup | null>(null)

function openGroup(group: ToolGroup, event: Event) {
  if (group.command) {
    run(group.command)
    return
  }
  if (galleryGroup.value?.id !== group.id) gallery.value?.hide()
  galleryGroup.value = group
  void nextTick(() => gallery.value?.toggle(event))
}

function runFromGallery(command: Command) {
  gallery.value?.hide()
  run(command)
}

function buttonHtml(latex: string): string {
  return katex.renderToString(latex, { throwOnError: false, strict: 'ignore' })
}

// ---------------------------------------------------------------------------
// Output panels
// ---------------------------------------------------------------------------

// Every line is parsed: each line's diagnostics are marked in its field, and
// the active line's AST feeds the output panels. Results are cached by row, so
// moving the cursor (which keeps the row) doesn't re-parse or hand MathField
// new marks.
const parseCache = new WeakMap<Row, ReturnType<typeof parseRow>>()
function parseLine(root: Row) {
  if (root.length === 0) return null
  let result = parseCache.get(root)
  if (!result) {
    result = parseRow(root)
    parseCache.set(root, result)
  }
  return result
}
const parsedLines = computed(() => equations.value.map((equation) => parseLine(equation.root)))
const parsed = computed(() => parsedLines.value[activeIndex.value] ?? null)

// A problem found outside the parse: in CellML mode, a line that isn't an
// equation (only equations may be written at the top level of <math>).
const NOT_AN_EQUATION = 'A CellML line must be an equation (… = …)'
function cellmlProblem(root: Row, index: number): (Mark & { incomplete: true }) | null {
  const ast = parsedLines.value[index]?.ast
  if (!props.cellml || !ast || ast.type === 'Equal') return null
  return { message: NOT_AN_EQUATION, atomIds: root.map((atom) => atom.id), incomplete: true }
}

// Each line's marks: its parse problems, the host's units issues for it, and
// units hints if the host gave variable units, in three sets: all of them,
// all but what is only missing (incomplete), and the hints alone. Cached by
// row, and rebuilt when the issues, units or mode change, so moving the
// cursor hands MathField the same arrays.
interface LineMarkSets {
  all: Mark[]
  complete: Mark[]
  hints: Mark[]
}
const issuesByLine = computed(() => {
  const byLine = new Map<string, UnitsIssue[]>()
  for (const issue of props.issues) {
    byLine.set(issue.lineId, [...(byLine.get(issue.lineId) ?? []), issue])
  }
  return byLine
})
const marksCache = computed(() => {
  // Read here so the cache is replaced when any changes.
  void issuesByLine.value
  void props.variableUnits
  void props.cellml
  return new WeakMap<Row, LineMarkSets>()
})
const markSets = computed(() =>
  equations.value.map((equation, index) => {
    const root = equation.root
    let sets = marksCache.value.get(root)
    if (!sets) {
      const cellml = cellmlProblem(root, index)
      const problems: Array<Mark & { incomplete?: true }> = [
        ...(parsedLines.value[index]?.diagnostics ?? []),
        ...(cellml ? [cellml] : []),
        ...unitsIssueMarks(root, issuesByLine.value.get(lineIds.value[index]) ?? []),
      ]
      const hints = unitsHintMarks(root, props.variableUnits ?? null)
      sets = {
        all: [...problems, ...hints],
        complete: [...problems.filter((mark) => !mark.incomplete), ...hints],
        hints,
      }
      marksCache.value.set(root, sets)
    }
    return sets
  }),
)

// Which of a line's problems show (see the `validate` prop). In 'commit'
// mode, a line's show while it is as last committed; in 'input' mode, all
// do, but what is only missing waits until the line is left.
function shownSet(index: number): keyof LineMarkSets {
  if (props.validate === 'commit') {
    const line = lines.value[index]
    return (committed.value.get(line.id) ?? '') === line.mathml ? 'all' : 'hints'
  }
  return index === activeIndex.value ? 'complete' : 'all'
}
const lineMarks = computed(() => markSets.value.map((sets, index) => sets[shownSet(index)]))

// Each line's shown problems, for its outline and the status bar: its marks'
// and what couldn't be imported.
interface LineProblem {
  line: number
  message: string
  kind: 'error' | 'units'
}
const lineProblems = computed(() =>
  lineMarks.value.map((marks, index): LineProblem[] => {
    const imported =
      shownSet(index) === 'hints' ? [] : (importProblems.value.get(lineIds.value[index]) ?? [])
    const problems: LineProblem[] = [
      ...imported.map((message) => ({ line: index, message, kind: 'error' as const })),
      ...marks.filter(isProblem).map((mark) => ({
        line: index,
        message: mark.message,
        kind: markKind(mark) === 'units' ? ('units' as const) : ('error' as const),
      })),
    ]
    // Once each: a units issue underlines every place a variable appears.
    return problems.filter(
      (problem, at) => problems.findIndex((other) => other.message === problem.message) === at,
    )
  }),
)
const rowProblemClass = (index: number) => {
  const problems = lineProblems.value[index]
  if (!problems.length) return null
  return problems.some((problem) => problem.kind === 'error') ? 'has-error' : 'has-units-issue'
}

// The status bar: the command being typed; else the active line's first
// problem, or the first anywhere, and how many more; else the import notice.
const status = computed(() => {
  if (commandBuffer.value !== null) return { kind: 'command' as const, text: commandBuffer.value }
  const all = lineProblems.value.flat()
  const first = lineProblems.value[activeIndex.value][0] ?? all[0]
  if (first) {
    return {
      kind: first.kind,
      text: `Line ${first.line + 1}: ${first.message}`,
      more: all.length - 1,
      line: first.line,
    }
  }
  if (importNotice.value) return { kind: 'info' as const, text: importNotice.value }
  return null
})

// Every shown problem, one a line, on hover.
const statusTitle = computed(() =>
  lineProblems.value
    .flat()
    .map((problem) => `Line ${problem.line + 1}: ${problem.message}`)
    .join('\n'),
)

function goToStatusLine() {
  const line = status.value?.line
  if (line !== undefined) moveToLine(line)
}

// Every line for the `equations-change` event, emitted when any line's
// content (not just its cursor) changes.
const lineCache = computed(() => {
  void importProblems.value.size
  void props.cellml
  return new WeakMap<Row, EquationLine>()
})
const lines = computed(() =>
  equations.value.map((equation, index) => {
    const id = lineIds.value[index]
    let line = lineCache.value.get(equation.root)
    if (!line || line.id !== id) {
      const other =
        (importProblems.value.get(id)?.length ?? 0) + (cellmlProblem(equation.root, index) ? 1 : 0)
      line = equationLine(id, equation.root, parsedLines.value[index], other)
      lineCache.value.set(equation.root, line)
    }
    return line
  }),
)
let lastEmitted = ''
// What the next change is: the first (the lines the workbench starts with) is
// a load, as is setMathML's.
let changeSource: EquationsChangeInfo['source'] = 'load'
watch(
  lines,
  (current) => {
    const source = changeSource
    changeSource = 'edit'
    const key = JSON.stringify(current)
    if (key === lastEmitted) return
    lastEmitted = key
    emit('equations-change', current, { source })
  },
  { immediate: true },
)

const ast = computed(() => parsed.value?.ast ?? null)
// The same LaTeX as copying and "Copy as LaTeX" produce.
const latex = computed(() =>
  ast.value ? exportRow(active().root, 'latex', exportOptions.value) : '',
)
const mathjson = computed(() => (ast.value ? renderMathJson(ast.value) : ''))
const mathml = computed(() => (ast.value ? contentMathML(active().root, exportOptions.value) : ''))
const cursorLabel = computed(() => describeCursor(active().cursor))
const selectionLabel = computed(() => {
  const selection = selectionOf(active())
  return selection ? describeSelection(selection) : null
})

const isCopyingMathJson = ref(false)
// The output tab showing: Content MathML first, as the output that matters most.
const outputTab = ref<'mathml' | 'mathjson' | 'latex' | 'ast'>('mathml')

function fallbackCopyText(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

async function writeClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // Permission refused or not a secure context: fall back below.
  }

  fallbackCopyText(text)
}

async function copyMathJson() {
  if (!mathjson.value) return

  isCopyingMathJson.value = true

  try {
    await writeClipboard(mathjson.value)
  } finally {
    window.setTimeout(() => {
      isCopyingMathJson.value = false
    }, 1200)
  }
}

// ---------------------------------------------------------------------------
// Copy as LaTeX / MathJSON / Content MathML (toolbar menu)
// ---------------------------------------------------------------------------

const copyMenu = ref<InstanceType<typeof Menu> | null>(null)
// The format just copied, shown on the button for a moment.
const copiedFormat = ref<string | null>(null)
let copiedTimer: number | undefined

const hasSelection = computed(() => selectionOf(active()) !== null)
const canCopyAs = computed(() => active().root.length > 0)

const copyAsLabel = computed(() => {
  if (copiedFormat.value) return `Copied ${copiedFormat.value}`
  return hasSelection.value ? 'Copy selection as' : 'Copy as'
})

// The selection if there is one, otherwise the whole active equation.
async function copyAs(format: ExportFormat, label: string) {
  const state = active()
  const atoms = selectionOf(state) ? selectedAtoms(state) : state.root

  if (atoms.length > 0) {
    await writeClipboard(exportRow(atoms, format, exportOptions.value))
    copiedFormat.value = label
    window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => (copiedFormat.value = null), 1500)
  }

  focusActive()
}

const copyAsItems = computed(() =>
  EXPORT_FORMATS.map(({ format, label }) => {
    const shown = format === 'mathml' && props.cellml ? `${label} (CellML)` : label
    return { label: shown, command: () => copyAs(format, shown) }
  }),
)

function toggleCopyMenu(event: Event) {
  copyMenu.value?.toggle(event)
}
</script>

<template>
  <section
    class="editor-grid"
    :class="{ 'has-side': !!$slots.side, 'no-outputs': !outputs, readonly }"
    @keydown.capture="handleCaptureKeydown"
  >
    <div class="editor-panel">
      <!-- Sticky: it stays in view while the lines scroll under it. -->
      <div class="toolbar" role="toolbar" aria-label="Equation tools">
        <div class="toolbar-group">
          <button
            v-for="group in TOOLBAR"
            :key="group.id"
            type="button"
            class="tool-button"
            :class="{ 'has-gallery': !!group.sections }"
            :title="group.title"
            :data-role="`toolbar-${group.id}`"
            :aria-haspopup="group.sections ? 'true' : undefined"
            :disabled="readonly"
            @mousedown.prevent
            @click="openGroup(group, $event)"
          >
            <span v-html="buttonHtml(group.latex)"></span>
            <i v-if="group.sections" class="pi pi-chevron-down tool-chevron" aria-hidden="true"></i>
          </button>
        </div>

        <div class="toolbar-group toolbar-lines">
          <Button
            icon="pi pi-plus"
            size="small"
            text
            title="Add equation line (Enter)"
            aria-label="Add equation line"
            data-role="add-line"
            :disabled="readonly"
            @mousedown.prevent
            @click="addLineAfterActive('new-line')"
          />
          <Button
            icon="pi pi-trash"
            size="small"
            text
            severity="danger"
            title="Remove equation line"
            aria-label="Remove equation line"
            :disabled="readonly || equations.length <= 1"
            @mousedown.prevent
            @click="removeActiveLine"
          />
          <Button
            v-if="props.history"
            icon="pi pi-undo"
            size="small"
            text
            title="Undo (Ctrl+Z)"
            :disabled="readonly || !canUndo"
            @mousedown.prevent
            @click="undo"
          />
          <Button
            v-if="props.history"
            icon="pi pi-refresh"
            size="small"
            text
            title="Redo (Ctrl+Shift+Z)"
            :disabled="readonly || !canRedo"
            @mousedown.prevent
            @click="redo"
          />
        </div>

        <div v-if="outputs" class="toolbar-group">
          <Button
            icon="pi pi-copy"
            :label="copyAsLabel"
            size="small"
            text
            title="Copy the selection, or the whole equation, as LaTeX, MathJSON or Content MathML"
            aria-haspopup="true"
            aria-controls="copy-as-menu"
            data-role="copy-as"
            :disabled="!canCopyAs"
            @mousedown.prevent
            @click="toggleCopyMenu"
          />
          <Menu id="copy-as-menu" ref="copyMenu" :model="copyAsItems" :popup="true" />
        </div>
      </div>

      <Popover ref="gallery" data-me-popover data-role="gallery" class="me-gallery">
        <div v-if="galleryGroup" class="gallery">
          <div
            v-for="(section, sectionIndex) in galleryGroup.sections"
            :key="sectionIndex"
            class="gallery-section"
          >
            <div v-if="section.label" class="gallery-label">{{ section.label }}</div>
            <div class="gallery-items">
              <button
                v-for="item in section.items"
                :key="item.title"
                type="button"
                class="tool-button"
                :title="item.title"
                @mousedown.prevent
                @click="runFromGallery(item.command)"
              >
                <span v-html="buttonHtml(item.latex)"></span>
              </button>
            </div>
          </div>
        </div>
      </Popover>

      <div
        ref="stackEl"
        class="equations-stack"
        @keydown="handleUnusedKey"
        @focusout="handleFocusOut"
      >
        <div
          v-for="(equation, index) in equations"
          :key="lineIds[index]"
          class="equation-row"
          :class="[{ active: index === activeIndex }, rowProblemClass(index)]"
          :data-line="index"
          :data-line-id="lineIds[index]"
          @focusin="handleLineFocus(index)"
        >
          <div class="equation-label">{{ index + 1 }}</div>

          <MathField
            :ref="(el) => (fieldRefs[index] = el as InstanceType<typeof MathField> | null)"
            class="equation-field"
            :model-value="equation.root"
            :cursor="equation.cursor"
            :anchor="equation.anchor ?? null"
            :active="index === activeIndex"
            :readonly="readonly"
            :autofocus="autofocus && index === activeIndex ? true : undefined"
            :marks="lineMarks[index]"
            :greek-names="greekNames"
            @navigate="handleNavigate(index, $event)"
            @edit="(state, info) => handleEdit(index, state, info)"
            @import="handleImport(index, $event)"
          />
        </div>
      </div>

      <!-- Always there, one line high, so the lines never move when a problem
           appears or goes. -->
      <div
        class="status-bar"
        :class="status ? `status-${status.kind}` : null"
        data-role="status"
        :data-kind="status?.kind"
        :title="statusTitle || undefined"
        role="status"
        @mousedown.prevent
        @click="goToStatusLine"
      >
        <template v-if="status?.kind === 'command'">
          <span class="command-chip" data-role="command"
            ><span class="command-slash">\</span>{{ status.text }}<span class="command-caret"></span
          ></span>
        </template>
        <template v-else-if="status">
          <span class="status-text">{{ status.text }}</span>
          <span v-if="status.more" class="status-more">+{{ status.more }} more</span>
        </template>
      </div>

      <p v-if="debug" class="focus-meta">
        Cursor: <span data-role="cursor">{{ cursorLabel }}</span>
        <template v-if="selectionLabel">
          · Selection: <span data-role="selection">{{ selectionLabel }}</span>
        </template>
      </p>

      <details class="key-help" data-role="key-help">
        <summary>Keys and typing</summary>
        <p class="key-hint">
          <kbd>←</kbd><kbd>→</kbd> move through every position · <kbd>↑</kbd
          ><kbd>↓</kbd> numerator/denominator, else previous/next line · <kbd>Home</kbd
          ><kbd>End</kbd> start/end · <kbd>Tab</kbd> next empty slot · <kbd>Space</kbd> step out of
          a fraction, exponent or bracket · <kbd>Enter</kbd> new line (in a piecewise: new piece;
          <kbd>Backspace</kbd> in an empty piece removes it; <code>\otherwise</code> adds one)
        </p>
        <p class="key-hint">
          Select with <kbd>Shift</kbd>+<kbd>←</kbd><kbd>→</kbd>, <kbd>Shift</kbd>+<kbd>Home</kbd
          ><kbd>End</kbd>, <kbd>Ctrl</kbd>+<kbd>A</kbd> or by dragging · <code>/</code>,
          <code>^</code>, <code>(</code>, <code>|</code>, <code>\sqrt</code>, <code>\sin</code>, …
          or a toolbar button then wraps the selection · typing replaces it · <kbd>Esc</kbd> clears
          it · <kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>X</kbd>/<kbd>V</kbd> copy, cut and paste (copies as
          LaTeX for other apps; pastes LaTeX or plain text such as <code>(x+1)/2</code>)
        </p>
        <p class="key-hint">
          Type letters, numbers and <code>+ − * = ,</code> where the caret is · conditions:
          <code>&lt; &gt; &lt;= &gt;= !=</code>, <code>&amp;</code> (∧), <code>!</code> (¬),
          <code>\or</code> (∨) · <code>/</code> makes a fraction of what's before the caret ·
          <code>^</code> exponent · <code>( )</code> and <code>| |</code> brackets ·
          <code>0.25{mV}</code> a number's units · letters, digits and <code>_</code> with no
          operator between them are one name (<code>Vm_init</code>); multiply names with
          <code>*</code> (<code>a*b</code>) · a name spelling a function (<code>sin</code>,
          <code>cosh</code>, …) is that function · <code>\</code> commands (<code
            >\frac \sqrt \root \abs \dd \cases \sin \pi \e \inf \alpha</code
          >
          …) · <kbd>Backspace</kbd>/<kbd>Delete</kbd> delete<template v-if="props.history">
            · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo</template
          >
        </p>
      </details>
    </div>

    <!-- The host's side content, beside the editor (a units panel, say); the
         outputs then go under the editor. Without it, the outputs go beside. -->
    <aside v-if="$slots.side" class="side-column" data-role="side">
      <slot name="side" />
    </aside>

    <Card v-if="outputs" class="output-card" data-role="outputs">
      <template #content>
        <Tabs v-model:value="outputTab">
          <TabList>
            <Tab value="mathml" data-role="tab-mathml">
              Content MathML
              <Tag
                v-if="cellml"
                class="tab-tag"
                severity="secondary"
                value="CellML"
                data-role="cellml-mode"
              />
            </Tab>
            <Tab value="mathjson" data-role="tab-mathjson">MathJSON</Tab>
            <Tab value="latex" data-role="tab-latex">LaTeX</Tab>
            <Tab value="ast" data-role="tab-ast">AST</Tab>
          </TabList>
          <TabPanels>
            <TabPanel value="mathml">
              <pre data-role="mathml">{{ mathml }}</pre>
            </TabPanel>
            <TabPanel value="mathjson">
              <div class="output-actions">
                <Button
                  icon="pi pi-copy"
                  :label="isCopyingMathJson ? 'Copied' : 'Copy MathJSON'"
                  size="small"
                  text
                  :disabled="!mathjson"
                  @click="copyMathJson"
                />
              </div>
              <pre data-role="mathjson">{{ mathjson }}</pre>
            </TabPanel>
            <TabPanel value="latex">
              <pre data-role="latex">{{ latex }}</pre>
            </TabPanel>
            <TabPanel value="ast">
              <pre data-role="ast">{{ ast ? JSON.stringify(ast, null, 2) : '' }}</pre>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </template>
    </Card>
  </section>
</template>

<style scoped>
/* Colours follow the host's PrimeVue theme (light or dark), with light
   fallbacks. The accent is the editor's own blue unless the host sets
   --math-editor-accent. The gallery is teleported out of the grid, so it
   gets them too. */
.editor-grid,
.gallery {
  --me-accent: var(--math-editor-accent, #2563eb);
  --me-surface: var(--p-content-background, #ffffff);
  --me-subtle: var(--p-content-hover-background, #f1f5f9);
  --me-border: var(--p-content-border-color, #e2e8f0);
  --me-border-strong: var(--p-form-field-border-color, #cbd5e1);
  --me-text: var(--p-text-color, #0f172a);
  --me-muted: var(--p-text-muted-color, #64748b);
  /* Notices: a tint of the colour behind, text part way to the theme's. */
  --me-warn: #d97706;
  --me-caution: #ea580c;
  --me-danger: #dc2626;

  max-width: 1240px;
  margin: 0 auto;
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  grid-template-areas: 'editor outputs';
  align-items: start;
  outline: none;
}

/* With side content: it takes the right, and the outputs go under the editor. */
.editor-grid.has-side {
  grid-template-rows: auto 1fr;
  grid-template-areas:
    'editor side'
    'outputs side';
}

/* Without outputs: the editor alone, or beside the side content. */
.editor-grid.no-outputs {
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: 'editor';
}

.editor-grid.no-outputs.has-side {
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  grid-template-rows: auto;
  grid-template-areas: 'editor side';
}

.editor-panel {
  grid-area: editor;
  min-width: 0;
  padding: 0 1rem 0.85rem;
  border: 1px solid var(--me-border);
  border-radius: 0.75rem;
  background: var(--me-surface);
  color: var(--me-text);
}

.output-card {
  grid-area: outputs;
  min-width: 0;
}

.side-column {
  grid-area: side;
  align-self: start;
  position: sticky;
  top: 1rem;
  min-width: 0;
}

.toolbar {
  /* Stays at the top of whatever scrolls the lines (the page, a dialog). */
  position: sticky;
  top: var(--me-toolbar-top, 0);
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.75rem;
  margin: 0 0 0.6rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--me-border);
  background: var(--me-surface);
}

.toolbar-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
}

.toolbar-lines :deep(.p-button) {
  width: 2rem;
  height: 2rem;
  padding: 0;
}

.tool-button {
  min-width: 2rem;
  height: 2rem;
  padding: 0 0.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--me-border-strong);
  border-radius: 0.45rem;
  background: var(--me-surface);
  color: var(--me-text);
  font-size: 0.72rem;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    background 0.12s ease,
    box-shadow 0.12s ease;
}

.tool-button:disabled {
  opacity: 0.45;
  cursor: default;
}

.tool-chevron {
  margin-left: 0.2rem;
  font-size: 0.55rem;
  color: var(--me-muted);
}

.tool-button:hover:not(:disabled) {
  border-color: var(--me-accent);
  background: color-mix(in srgb, var(--me-accent) 8%, var(--me-surface));
}

.tool-button:active {
  box-shadow: inset 0 1px 3px rgba(15, 23, 42, 0.15);
}

.gallery {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 22rem;
}

.gallery-label {
  margin-bottom: 0.25rem;
  color: var(--me-muted);
  font-size: 0.72rem;
}

.gallery-items {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.gallery .tool-button {
  min-width: 2.4rem;
  font-size: 0.8rem;
}

.equations-stack {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.equation-row {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
  border: 1px solid var(--me-border);
  border-radius: 0.65rem;
  background: var(--me-surface);
  color: var(--me-text);
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}

.equation-row.active {
  border-color: var(--me-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--me-accent) 12%, transparent);
}

/* A line with problems: outlined (red, or amber for units only). */
.equation-row.has-error {
  border-color: var(--me-danger);
}

.equation-row.has-units-issue {
  border-color: var(--me-warn);
}

.equation-row.active.has-error {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--me-danger) 14%, transparent);
}

.equation-row.active.has-units-issue {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--me-warn) 16%, transparent);
}

.equation-label {
  display: flex;
  align-items: center;
  padding: 0 0.4rem 0 0.65rem;
  color: var(--me-muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  border-right: 1px solid var(--me-border);
}

.equation-field {
  flex: 1;
  min-width: 0;
}

/* The active line's border already shows focus. */
.equation-field.focused {
  box-shadow: none;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 1.75rem;
  margin-top: 0.5rem;
  padding: 0 0.6rem;
  border-radius: 0.45rem;
  font-size: 0.8rem;
  white-space: nowrap;
  overflow: hidden;
}

.status-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-more {
  flex: none;
  opacity: 0.75;
}

.status-error,
.status-units {
  cursor: pointer;
}

.status-error {
  background: color-mix(in srgb, var(--me-danger) 12%, var(--me-surface));
  color: color-mix(in srgb, var(--me-danger) 55%, var(--me-text));
}

.status-units {
  background: color-mix(in srgb, var(--me-caution) 14%, var(--me-surface));
  color: color-mix(in srgb, var(--me-caution) 55%, var(--me-text));
}

.status-info {
  background: color-mix(in srgb, var(--me-accent) 8%, var(--me-surface));
  color: color-mix(in srgb, var(--me-accent) 45%, var(--me-text));
}

.status-command {
  padding: 0;
}

.command-chip {
  display: inline-flex;
  align-items: center;
  height: 100%;
  padding: 0 0.6rem;
  border-radius: 0.45rem;
  background: #0f172a;
  color: #e2e8f0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 0.9rem;
}

.command-slash {
  color: #7dd3fc;
}

.command-caret {
  width: 2px;
  height: 1em;
  margin-left: 2px;
  background: #e2e8f0;
  animation: chip-blink 1s step-end infinite;
}

@keyframes chip-blink {
  50% {
    opacity: 0;
  }
}

.focus-meta {
  margin: 0.75rem 0 0;
  color: var(--me-muted);
  font-size: 0.8rem;
}

.output-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.25rem;
}

.tab-tag {
  margin-left: 0.4rem;
  font-size: 0.7rem;
  padding: 0.05rem 0.35rem;
}

.key-help {
  margin-top: 0.75rem;
}

.key-help summary {
  cursor: pointer;
  width: fit-content;
  color: var(--me-muted);
  font-size: 0.85rem;
}

.key-hint {
  margin: 0.5rem 0 0;
  color: var(--me-muted);
  font-size: 0.8rem;
  line-height: 1.5;
}

.key-hint kbd {
  display: inline-block;
  padding: 0 0.3rem;
  margin: 0 0.08rem;
  border: 1px solid var(--me-border-strong);
  border-bottom-width: 2px;
  border-radius: 0.3rem;
  background: var(--me-subtle);
  font-size: 0.72rem;
  font-family: inherit;
}

.key-hint code {
  background: var(--me-subtle);
  border-radius: 0.25rem;
  padding: 0.05rem 0.3rem;
}

.output-card pre {
  margin: 0;
  max-height: 28rem;
  overflow: auto;
  border-radius: 0.55rem;
  background: #0f172a;
  color: #e2e8f0;
  padding: 0.85rem;
  font-size: 0.83rem;
  line-height: 1.35;
}

@media (max-width: 900px) {
  .editor-grid,
  .editor-grid.has-side,
  .editor-grid.no-outputs.has-side {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: none;
    grid-template-areas: 'editor' 'side' 'outputs';
  }

  .side-column {
    position: static;
  }
}
</style>
