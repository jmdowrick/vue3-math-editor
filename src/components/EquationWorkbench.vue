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
// - `outputs` prop: the output panels and "Copy as" (on by default), which
//   copies the selection, the active line, or the lines selected by
//   Shift/Ctrl/Cmd+clicking their numbers.
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, toRaw, watch } from 'vue'
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
import { contentStable } from './contentStable'
import {
  type Command,
  type EditorState,
  commandSuggestions,
  emptyState,
  insertAtoms,
  namedCommand,
} from '../editor/commands'
import { cursorAtEnd, describeCursor } from '../editor/cursor'
import {
  EXPORT_FORMATS,
  type ExportFormat,
  contentMathML,
  exportRow,
  exportRows,
} from '../editor/exports'
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
import { TOOLBAR, type ToolGroup, type ToolSection } from '../editor/toolbar'
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
    // Names with their subscripts and superscripts typeset: g_Kr__max as g
    // with Kr below and max above (editor/nameScripts.ts); off, as typed.
    // Either way the names are the same.
    typesetNames?: boolean
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
    typesetNames: true,
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

const exportOptions = computed(() => ({
  cellml: props.cellml,
  greekNames: props.greekNames,
  typesetNames: props.typesetNames,
}))

// Shallow: each line's state is an immutable value, replaced whole, so it
// needn't be reactive itself. Deep reactivity would put every read of a line
// tree (parsing, drawing, marks, export) through a proxy, which on a large
// component costs seconds. So the array is replaced, never changed in place:
// changing it in place wouldn't update anything.
const equations = shallowRef<EditorState[]>([emptyState()])

// The lines with line `index` replaced.
const withLine = (index: number, state: EditorState) =>
  equations.value.map((line, i) => (i === index ? state : line))

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
  equations.value = withLine(index, settle(state))
}

// Settled: number units (numberUnits.ts), then names (names.ts). A line no
// longer being edited has every name settled, the cursor's too.
const settle = (state: EditorState, cursorAway = false) =>
  settleNames(settleState(state), { greekNames: props.greekNames, cursorAway })

// Leaving a line, and turning Greek names on or off, settle names too.
watch(activeIndex, (_, left) => {
  const line = equations.value[left]
  if (line) equations.value = withLine(left, settle(line, true))
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

// The shortcut modifier, as the platform names it (Ctrl and Cmd both work).
const isMac = /mac/i.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform,
)
const modKey = isMac ? '⌘' : 'Ctrl'
const altKey = isMac ? '⌥' : 'Alt'

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

// A line's content changed: what was said about its import no longer holds,
// and the lines selected are no longer.
function edited(index: number) {
  importProblems.value.delete(lineIds.value[index])
  importNotice.value = null
  clearLineSelection()
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
  clearLineSelection()
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

// Whether the sticky toolbar is stuck: its top has left the panel's, so the
// panel's top edge has scrolled away and the toolbar draws it instead. Any
// scroller may move it (the page, a dialog, a host's box), so every scroll is
// heard, on capture, and measured at most once a frame.
const panelEl = ref<HTMLElement | null>(null)
const toolbarEl = ref<HTMLElement | null>(null)
const toolbarStuck = ref(false)
let stuckFrame = 0
function updateStuck() {
  stuckFrame = 0
  if (!panelEl.value || !toolbarEl.value) return
  const offset =
    toolbarEl.value.getBoundingClientRect().top - panelEl.value.getBoundingClientRect().top
  toolbarStuck.value = offset > 0.5
  // The command list follows the caret.
  if (commandBuffer.value !== null) placeCommandList()
}
function scheduleStuck() {
  if (!stuckFrame) stuckFrame = requestAnimationFrame(updateStuck)
}

onMounted(() => {
  if (props.autofocus) focusActive()
  document.addEventListener('scroll', scheduleStuck, { capture: true, passive: true })
  window.addEventListener('resize', scheduleStuck, { passive: true })
  updateStuck()

  // Refitted when the room changes, and when a button's size does (KaTeX's
  // fonts loading, the host's font size).
  if (typeof ResizeObserver !== 'undefined' && toolsEl.value) {
    toolsObserver = new ResizeObserver(fitTools)
    toolsObserver.observe(toolsEl.value)
    for (const button of toolsEl.value.children) toolsObserver.observe(button)
  }
  fitTools()
})

onBeforeUnmount(() => {
  document.removeEventListener('scroll', scheduleStuck, { capture: true })
  window.removeEventListener('resize', scheduleStuck)
  if (stuckFrame) cancelAnimationFrame(stuckFrame)
  toolsObserver?.disconnect()
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
  equations.value = [
    ...equations.value.slice(0, index),
    emptyState(),
    ...equations.value.slice(index),
  ]
  lineIds.value.splice(index, 0, newLineId())
  activeIndex.value = index
  focusActive()
}

function moveToLine(index: number) {
  if (index < 0 || index >= equations.value.length) return
  if (index !== activeIndex.value) commitLine(activeIndex.value, 'navigate')
  clearLineSelection()
  undoHistory.breakGroup()
  activeIndex.value = index
  focusActive()
}

// ↑/↓ and moving within the workbench commit through moveToLine; a click
// on another line lands here.
function handleLineFocus(index: number) {
  if (index === activeIndex.value) return
  commandBuffer.value = null
  clearLineSelection()
  commitLine(activeIndex.value, 'navigate')
  activeIndex.value = index
}

// Focus leaving the lines for anywhere but another line or a toolbar gallery.
const stackEl = ref<HTMLElement | null>(null)
function handleFocusOut(event: FocusEvent) {
  const to = event.relatedTarget as Element | null
  if (to && (stackEl.value?.contains(to) || to.closest('[data-me-popover]'))) return
  // A command half typed is dropped, not left waiting.
  commandBuffer.value = null
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
  const removed = activeIndex.value
  equations.value = equations.value.filter((_, i) => i !== removed)
  lineIds.value.splice(activeIndex.value, 1)
  activeIndex.value = Math.max(0, activeIndex.value - 1)
  // Continue at the end of the line above.
  const state = active()
  setEquation(activeIndex.value, { ...state, cursor: cursorAtEnd(state.root), anchor: null })
  focusActive()
}

// ---------------------------------------------------------------------------
// Reordering lines: Alt+↑/↓, or dragging a line by its number
// ---------------------------------------------------------------------------

const canReorder = computed(() => !props.readonly && equations.value.length > 1)

// Line `from` moved to `to`, as one undo step, and made the active line. Its
// id goes with it, and its content doesn't change, so it isn't committed; the
// line that was active is, if it's another, as moving to another line would.
function moveLine(from: number, to: number) {
  const count = equations.value.length
  if (!canReorder.value || from === to || Math.min(from, to) < 0 || Math.max(from, to) >= count) {
    return
  }

  if (from !== activeIndex.value) {
    commitLine(activeIndex.value, 'navigate')
    const left = activeIndex.value
    equations.value = withLine(left, settle(equations.value[left], true))
  }
  pushHistory()
  const order = equations.value.map((_, index) => index)
  order.splice(to, 0, ...order.splice(from, 1))
  equations.value = order.map((index) => equations.value[index])
  lineIds.value = order.map((index) => lineIds.value[index])
  activeIndex.value = to
  focusActive()
}

// The line being dragged, and where it would land: before or after a line.
const dragFrom = ref<number | null>(null)
const dropTarget = ref<{ index: number; after: boolean } | null>(null)

// Where the dragged line lands, once it's out of the list, if it moves.
function landing(): number | null {
  if (dragFrom.value === null || !dropTarget.value) return null
  const { index, after } = dropTarget.value
  const to = index + (after ? 1 : 0)
  const at = to > dragFrom.value ? to - 1 : to
  return at === dragFrom.value ? null : at
}

function handleDragStart(index: number, event: DragEvent) {
  if (!canReorder.value || !event.dataTransfer) return
  dragFrom.value = index
  event.dataTransfer.effectAllowed = 'move'
  // Something must be set for Firefox to drag at all.
  event.dataTransfer.setData('text/plain', `Line ${index + 1}`)
  // The whole line is what's dragged, held where it was picked up.
  const row = (event.currentTarget as HTMLElement).closest('.equation-row')
  if (row) {
    const box = row.getBoundingClientRect()
    event.dataTransfer.setDragImage(row, event.clientX - box.left, event.clientY - box.top)
  }
}

function handleDragOver(index: number, event: DragEvent) {
  // Only a line being dragged; anything else dropped is the field's.
  if (dragFrom.value === null) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropTarget.value = { index, after: event.clientY > box.top + box.height / 2 }
}

function handleDrop(event: DragEvent) {
  if (dragFrom.value === null) return
  event.preventDefault()
  const from = dragFrom.value
  const to = landing()
  clearDrag()
  if (to !== null) moveLine(from, to)
}

function clearDrag() {
  dragFrom.value = null
  dropTarget.value = null
}

// The line drawn where the dragged line would land (none where it wouldn't
// move).
function dropClass(index: number) {
  if (landing() === null || dropTarget.value?.index !== index) return null
  return dropTarget.value.after ? 'drop-after' : 'drop-before'
}

// ---------------------------------------------------------------------------
// Selecting lines, for "Copy as": Shift+click a line's number for the lines
// from the active one to it, Ctrl/Cmd+click to add or remove one
// ---------------------------------------------------------------------------

// By id, so the selection goes with lines that move; a line removed leaves it.
const selectedLineIds = ref(new Set<string>())
// The selected lines' indexes, in order.
const selectedLines = computed(() =>
  lineIds.value.flatMap((id, index) => (selectedLineIds.value.has(id) ? [index] : [])),
)
const hasLineSelection = computed(() => selectedLines.value.length > 0)
const isLineSelected = (index: number) => selectedLineIds.value.has(lineIds.value[index])

function clearLineSelection() {
  if (selectedLineIds.value.size) selectedLineIds.value = new Set()
}

const selectsLines = (event: MouseEvent) => event.shiftKey || event.metaKey || event.ctrlKey

// A Shift/Ctrl/Cmd press on a line's number. A plain press is left to drag
// the line by.
function handleLabelMousedown(index: number, event: MouseEvent) {
  if (!props.outputs || !selectsLines(event)) return
  // Focus stays in the active line, and no drag starts.
  event.preventDefault()
  const ids = lineIds.value
  if (event.shiftKey) {
    const [from, to] = [activeIndex.value, index].sort((a, b) => a - b)
    selectedLineIds.value = new Set(ids.slice(from, to + 1))
    return
  }
  // The selection starts with the active line.
  const next = new Set(
    selectedLineIds.value.size ? selectedLineIds.value : [ids[activeIndex.value]],
  )
  if (next.has(ids[index])) next.delete(ids[index])
  else next.add(ids[index])
  selectedLineIds.value = next
}

// Any other press in the lines (into a line, or to drag one) clears them.
function handleStackMousedown(event: MouseEvent) {
  const onLabel = (event.target as Element | null)?.closest?.('[data-role="line-handle"]')
  if (!(onLabel && selectsLines(event))) clearLineSelection()
}

// What a line's number does, on hover.
const labelTitle = computed(() => {
  const parts = [
    canReorder.value && `Drag to reorder (${altKey}+↑/↓)`,
    props.outputs && `Shift+click or ${modKey}+click to select lines to copy`,
  ]
  return parts.filter(Boolean).join(' · ') || undefined
})

// ---------------------------------------------------------------------------
// Keyboard: command mode and shortcuts (capture phase, before MathField)
// ---------------------------------------------------------------------------

// What is typed, as it's typed.
function commitCommand() {
  const name = (commandBuffer.value ?? '').trim()
  commandBuffer.value = null
  if (name) run(namedCommand(name))
}

// The command list, while a command is typed: what it may be, the one it is
// exactly first. One is chosen (highlighted) once anything is typed, so Tab
// or Enter completes it; with nothing typed, only once ↓ picks one.
const suggestions = computed(() =>
  commandBuffer.value === null ? [] : commandSuggestions(commandBuffer.value),
)
const highlighted = ref(-1)
watch(commandBuffer, (typed) => {
  highlighted.value = typed && suggestions.value.length ? 0 : -1
  if (typed !== null) void nextTick(placeCommandList)
})

function chooseCommand(index: number) {
  const choice = suggestions.value[index]
  if (!choice) return commitCommand()
  commandBuffer.value = null
  run(namedCommand(choice.name))
}

function moveHighlight(step: number) {
  const count = suggestions.value.length
  if (count) highlighted.value = (highlighted.value + step + count) % count
}

// Under the caret, or over it near the bottom of the window. Teleported to
// the body, so nothing around the workbench clips it or moves it.
const commandListStyle = ref<Record<string, string>>({})
function placeCommandList() {
  const caret = fieldRefs.value[activeIndex.value]?.caretRect()
  if (!caret) return
  const left = Math.max(8, Math.min(caret.left - 8, window.innerWidth - 336))
  commandListStyle.value =
    caret.bottom < window.innerHeight * 0.6
      ? { left: `${left}px`, top: `${caret.bottom + 6}px` }
      : { left: `${left}px`, bottom: `${window.innerHeight - caret.top + 6}px` }
}

function handleCommandModeKey(event: KeyboardEvent) {
  if (/^[a-zA-Z0-9]$/.test(event.key)) {
    commandBuffer.value += event.key
  } else if (event.key === 'Backspace') {
    commandBuffer.value = commandBuffer.value ? commandBuffer.value.slice(0, -1) : null
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    chooseCommand(highlighted.value)
  } else if (event.key === ' ' || event.key === '(') {
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

  // Escape clears the lines selected first, then (MathField) the selection.
  if (event.key === 'Escape' && hasLineSelection.value) {
    event.preventDefault()
    event.stopPropagation()
    clearLineSelection()
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

  // Alt+↑/↓: move the line up or down.
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault()
    moveLine(activeIndex.value, activeIndex.value + (event.key === 'ArrowUp' ? -1 : 1))
    return
  }

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

// The tool groups that fit in the toolbar, in order; the rest are in "More ▾"
// (a gallery like the others: a group that is one button is an item there,
// and a group with a gallery its sections). The tools take the room the line
// and copy buttons leave, and every button is measured, shown or not, so what
// fits doesn't depend on what is shown.
const toolsEl = ref<HTMLElement | null>(null)
const moreEl = ref<HTMLElement | null>(null)
const visibleTools = ref(TOOLBAR.length)
let toolsObserver: ResizeObserver | null = null

function fitTools() {
  const group = toolsEl.value
  const more = moreEl.value
  if (!group || !more) return
  const width = (el: Element) => el.getBoundingClientRect().width
  const room = width(group) + 0.5
  const gap = parseFloat(getComputedStyle(group).columnGap) || 0
  const widths = [...group.querySelectorAll('[data-tool]')].map(width)
  const fits = (count: number, withMore: boolean) => {
    const items = [...widths.slice(0, count), ...(withMore ? [width(more)] : [])]
    return items.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, items.length - 1) <= room
  }

  let count = widths.length
  if (!fits(count, false)) {
    count--
    while (count > 0 && !fits(count, true)) count--
  }
  visibleTools.value = count
}

const moreGroup = computed((): ToolGroup | null => {
  const hidden = TOOLBAR.slice(visibleTools.value)
  if (!hidden.length) return null
  const sections: ToolSection[] = []
  for (const group of hidden) {
    if (group.command) {
      // One-button groups next to each other share a section.
      const item = { latex: group.latex, title: group.title, command: group.command }
      const last = sections.at(-1)
      if (last && !last.label) last.items.push(item)
      else sections.push({ items: [item] })
    } else {
      for (const section of group.sections ?? []) {
        sections.push({ label: section.label ?? group.title, items: section.items })
      }
    }
  }
  return { id: 'more', title: 'More tools', latex: '', sections }
})

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
// The host's issues and variable units, replaced only when their content
// changes (contentStable.ts): a host passing an equal new object, as it may
// after every commit, rebuilds no marks.
const hostIssues = contentStable(() => props.issues)
const hostVariableUnits = contentStable(() => props.variableUnits ?? null)
const issuesByLine = computed(() => {
  const byLine = new Map<string, UnitsIssue[]>()
  for (const issue of hostIssues.value) {
    byLine.set(issue.lineId, [...(byLine.get(issue.lineId) ?? []), issue])
  }
  return byLine
})
const marksCache = computed(() => {
  // Read here so the cache is replaced when any changes.
  void issuesByLine.value
  void hostVariableUnits.value
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
      const hints = unitsHintMarks(root, hostVariableUnits.value)
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

// The status bar: the active line's first problem, or the first anywhere, and
// how many more; else the import notice; else nothing, and no bar.
const status = computed(() => {
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

// A line's shown problems, one a line, for the icon beside its number.
const lineProblemsText = (index: number) =>
  lineProblems.value[index].map((problem) => problem.message).join('\n')

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
const canCopyAs = computed(() =>
  hasLineSelection.value
    ? selectedLines.value.some((index) => equations.value[index].root.length > 0)
    : active().root.length > 0,
)

const copyAsLabel = computed(() => {
  if (copiedFormat.value) return `Copied ${copiedFormat.value}`
  const count = selectedLines.value.length
  if (count > 1) return `Copy ${count} lines as`
  if (count === 1) return `Copy line ${selectedLines.value[0] + 1} as`
  return hasSelection.value ? 'Copy selection as' : 'Copy as'
})

// The lines selected, as one document (exportRows), if any are; otherwise the
// selection if there is one, or the whole active equation.
async function copyAs(format: ExportFormat, label: string) {
  const rows = hasLineSelection.value
    ? selectedLines.value.map((index) => equations.value[index].root)
    : [selectionOf(active()) ? selectedAtoms(active()) : active().root]

  if (rows.some((row) => row.length > 0)) {
    await writeClipboard(exportRows(rows, format, exportOptions.value))
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
  <!-- The container its layout follows: it fits the room the host gives it,
       whatever the window's size. -->
  <div class="me-workbench">
    <section
      class="editor-grid"
      :class="{ 'has-side': !!$slots.side, 'no-outputs': !outputs, readonly }"
      @keydown.capture="handleCaptureKeydown"
    >
      <div ref="panelEl" class="editor-panel">
        <!-- Sticky: it stays in view while the lines scroll under it. -->
        <div
          ref="toolbarEl"
          class="toolbar"
          :class="{ stuck: toolbarStuck }"
          role="toolbar"
          aria-label="Equation tools"
        >
          <div ref="toolsEl" class="toolbar-group toolbar-tools">
            <button
              v-for="(group, index) in TOOLBAR"
              :key="group.id"
              type="button"
              class="tool-button"
              :class="{ 'has-gallery': !!group.sections, overflowed: index >= visibleTools }"
              :title="group.title"
              :data-role="`toolbar-${group.id}`"
              data-tool
              :aria-haspopup="group.sections ? 'true' : undefined"
              :disabled="readonly"
              @mousedown.prevent
              @click="openGroup(group, $event)"
            >
              <span v-html="buttonHtml(group.latex)"></span>
              <i
                v-if="group.sections"
                class="pi pi-chevron-down tool-chevron"
                aria-hidden="true"
              ></i>
            </button>
            <!-- The groups that don't fit. Always there, to be measured. -->
            <button
              ref="moreEl"
              type="button"
              class="tool-button has-gallery"
              :class="{ overflowed: !moreGroup }"
              title="More tools"
              aria-label="More tools"
              aria-haspopup="true"
              data-role="toolbar-more"
              :disabled="readonly"
              @mousedown.prevent
              @click="moreGroup && openGroup(moreGroup, $event)"
            >
              <i class="pi pi-ellipsis-h" aria-hidden="true"></i>
              <i class="pi pi-chevron-down tool-chevron" aria-hidden="true"></i>
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
              :title="`Undo (${modKey}+Z)`"
              aria-label="Undo"
              data-role="undo"
              :disabled="readonly || !canUndo"
              @mousedown.prevent
              @click="undo"
            />
            <!-- PrimeIcons has no redo: undo, mirrored. -->
            <Button
              v-if="props.history"
              icon="pi pi-undo"
              class="redo-button"
              size="small"
              text
              :title="`Redo (${modKey}+Shift+Z)`"
              aria-label="Redo"
              data-role="redo"
              :disabled="readonly || !canRedo"
              @mousedown.prevent
              @click="redo"
            />
          </div>

          <div v-if="outputs" class="toolbar-group toolbar-copy">
            <Button
              icon="pi pi-copy"
              :label="copyAsLabel"
              size="small"
              text
              title="Copy the selection, the whole equation, or the lines selected (Shift+click their numbers), as LaTeX, MathJSON or Content MathML"
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

        <!-- While a "\…" command is typed: it, and what it may be. -->
        <Teleport to="body">
          <div
            v-if="commandBuffer !== null"
            class="command-list"
            data-me-popover
            data-role="command-list"
            :style="commandListStyle"
            @mousedown.prevent
          >
            <span class="command-chip" data-role="command"
              ><span class="command-slash">\</span>{{ commandBuffer
              }}<span class="command-caret"></span
            ></span>
            <ul
              v-if="suggestions.length"
              class="command-options"
              role="listbox"
              aria-label="Commands"
            >
              <li
                v-for="(suggestion, index) in suggestions"
                :key="suggestion.name"
                class="command-option"
                :class="{ highlighted: index === highlighted }"
                role="option"
                :aria-selected="index === highlighted"
                :data-command="suggestion.name"
                @click="chooseCommand(index)"
              >
                <span class="command-preview" v-html="buttonHtml(suggestion.latex)"></span>
                <span class="command-name">\{{ suggestion.name }}</span>
                <span class="command-title">{{ suggestion.title }}</span>
              </li>
            </ul>
            <p class="command-hint">
              <template v-if="suggestions.length"
                ><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Tab</kbd> insert ·
              </template>
              <kbd>Space</kbd> as typed · <kbd>Esc</kbd> cancel
            </p>
          </div>
        </Teleport>

        <div
          ref="stackEl"
          class="equations-stack"
          @mousedown="handleStackMousedown"
          @keydown="handleUnusedKey"
          @focusout="handleFocusOut"
        >
          <div
            v-for="(equation, index) in equations"
            :key="lineIds[index]"
            class="equation-row"
            :class="[
              {
                active: index === activeIndex,
                dragging: index === dragFrom,
                'line-selected': isLineSelected(index),
              },
              rowProblemClass(index),
              dropClass(index),
            ]"
            :data-line="index"
            :data-line-id="lineIds[index]"
            :data-selected="isLineSelected(index) || undefined"
            @focusin="handleLineFocus(index)"
            @dragover="handleDragOver(index, $event)"
            @drop="handleDrop"
          >
            <!-- The line's number, and what's wrong with it: the handle to drag
                 it by. -->
            <div
              class="equation-label"
              data-role="line-handle"
              :draggable="canReorder ? 'true' : undefined"
              :title="labelTitle"
              @mousedown="handleLabelMousedown(index, $event)"
              @dragstart="handleDragStart(index, $event)"
              @dragend="clearDrag"
            >
              <span class="line-number">{{ index + 1 }}</span>
              <i
                v-if="rowProblemClass(index)"
                class="pi line-problem"
                :class="
                  rowProblemClass(index) === 'has-error'
                    ? 'pi-exclamation-circle'
                    : 'pi-exclamation-triangle'
                "
                role="img"
                :aria-label="lineProblemsText(index)"
                :title="lineProblemsText(index)"
                data-role="line-problem"
                :data-kind="rowProblemClass(index) === 'has-error' ? 'error' : 'units'"
              ></i>
            </div>

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
              :typeset-names="typesetNames"
              @navigate="handleNavigate(index, $event)"
              @edit="(state, info) => handleEdit(index, state, info)"
              @import="handleImport(index, $event)"
            />
          </div>
        </div>

        <!-- The bar shows only when there is a problem or a notice. It is under
           the lines, so they don't move when it appears or goes. The live
           region around it is always there (and takes no room), so what
           appears in it is announced. -->
        <div role="status">
          <div
            v-if="status"
            class="status-bar"
            :class="`status-${status.kind}`"
            data-role="status"
            :data-kind="status.kind"
            :title="statusTitle || undefined"
            @mousedown.prevent
            @click="goToStatusLine"
          >
            <span class="status-text">{{ status.text }}</span>
            <span v-if="status.more" class="status-more">+{{ status.more }} more</span>
          </div>
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
            ><kbd>End</kbd> start/end · <kbd>Tab</kbd> next empty slot · <kbd>Space</kbd> step out
            of a fraction, exponent or bracket · <kbd>Enter</kbd> new line (in a piecewise: new
            piece; <kbd>Backspace</kbd> in an empty piece removes it; <code>\otherwise</code> adds
            one) · <kbd>{{ altKey }}</kbd
            >+<kbd>↑</kbd><kbd>↓</kbd> move the line up/down, or drag it by its number<template
              v-if="outputs"
            >
              · <kbd>Shift</kbd>+click or <kbd>{{ modKey }}</kbd
              >+click line numbers to select lines for "Copy as"</template
            >
          </p>
          <p class="key-hint">
            Select with <kbd>Shift</kbd>+<kbd>←</kbd><kbd>→</kbd>, <kbd>Shift</kbd>+<kbd>Home</kbd
            ><kbd>End</kbd>, <kbd>{{ modKey }}</kbd
            >+<kbd>A</kbd> or by dragging · <code>/</code>, <code>^</code>, <code>(</code>,
            <code>|</code>, <code>\sqrt</code>, <code>\sin</code>, … or a toolbar button then wraps
            the selection · typing replaces it · <kbd>Esc</kbd> clears it · <kbd>{{ modKey }}</kbd
            >+<kbd>C</kbd>/<kbd>X</kbd>/<kbd>V</kbd> copy, cut and paste (copies as LaTeX for other
            apps; pastes LaTeX or plain text such as <code>(x+1)/2</code>)
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
              · <kbd>{{ modKey }}</kbd
              >+<kbd>Z</kbd> undo</template
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
  </div>
</template>

<style scoped>
.me-workbench {
  container-type: inline-size;
}

/* Colours follow the host's PrimeVue theme (light or dark), with light
   fallbacks. The accent (and the caret, selection and focus drawn from it),
   the problem colours and number units' colour are the editor's own unless
   the host sets --math-editor-accent, -danger, -warn or -units. MathField
   draws with these too. The gallery and the command list are teleported out
   of the grid, so they get them as well. */
.editor-grid,
.gallery,
.command-list {
  --me-accent: var(--math-editor-accent, #2563eb);
  --me-surface: var(--p-content-background, #ffffff);
  --me-subtle: var(--p-content-hover-background, #f1f5f9);
  --me-border: var(--p-content-border-color, #e2e8f0);
  --me-border-strong: var(--p-form-field-border-color, #cbd5e1);
  --me-text: var(--p-text-color, #0f172a);
  --me-muted: var(--p-text-muted-color, #64748b);
  /* Notices: a tint of the colour behind, text part way to the theme's. */
  --me-warn: var(--math-editor-warn, #d97706);
  --me-caution: var(--math-editor-warn, #ea580c);
  --me-danger: var(--math-editor-danger, #dc2626);
  --me-units: var(--math-editor-units, #60a5fa);
  /* Tooltips, the output panels and the command chip: dark in both modes. */
  --me-tip-bg: #1e293b;
  --me-tip-text: #f8fafc;
  --me-code-bg: #0f172a;
  --me-code-text: #e2e8f0;
}

.editor-grid {
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
  top: var(--me-side-top, calc(var(--me-toolbar-top, 0px) + 1rem));
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
  /* Over the panel's side padding, so no line shows beside it, and over its
     top border, which it draws itself once stuck (the transparent border lets
     the panel's show through until then). */
  margin: -1px -1rem 0.6rem;
  padding: 0.5rem 1rem;
  border-top: 1px solid transparent;
  border-bottom: 1px solid var(--me-border);
  border-radius: calc(0.75rem - 1px) calc(0.75rem - 1px) 0 0;
  background: var(--me-surface);
  background-clip: padding-box;
}

/* Stuck: the panel's top edge has scrolled away. */
.toolbar.stuck {
  border-top-color: var(--me-border);
  border-radius: 0;
}

.toolbar-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
}

.toolbar-tools {
  /* The room the other groups leave, whatever the tools' own width: what
     fits is worked out from it (fitTools), the rest go in "More ▾". */
  flex: 1 1 0;
  min-width: 4.5rem;
  flex-wrap: nowrap;
  position: relative;
}

/* In "More ▾": kept, out of the way, to be measured. */
.tool-button.overflowed {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
}

.toolbar-lines :deep(.p-button) {
  width: 2rem;
  height: 2rem;
  padding: 0;
}

.redo-button :deep(.p-button-icon) {
  transform: scaleX(-1);
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
  position: relative;
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

/* The number, over the problem icon if there is one: as wide either way, so
   the line doesn't move when a problem appears. */
.equation-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1rem;
  min-width: 2.1rem;
  padding: 0 0.35rem;
  color: var(--me-muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  border-right: 1px solid var(--me-border);
  border-radius: calc(0.65rem - 1px) 0 0 calc(0.65rem - 1px);
  user-select: none;
}

.equation-label[draggable='true'] {
  cursor: grab;
}

.equation-label[draggable='true']:hover {
  background: var(--me-subtle);
}

.line-problem {
  font-size: 0.7rem;
  color: var(--me-danger);
}

.line-problem.pi-exclamation-triangle {
  color: var(--me-warn);
}

/* A line selected (for "Copy as"): tinted, its number more so. */
.equation-row.line-selected {
  background: color-mix(in srgb, var(--me-accent) 6%, var(--me-surface));
}

.equation-row.line-selected .equation-label {
  background: color-mix(in srgb, var(--me-accent) 16%, var(--me-surface));
  color: var(--me-accent);
}

/* A line being dragged, and where it would land: a line in the gap. */
.equation-row.dragging {
  opacity: 0.5;
}

.equation-row.drop-before::before,
.equation-row.drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  border-radius: 1px;
  background: var(--me-accent);
  pointer-events: none;
}

/* Halfway across the 0.6rem gap between lines, outside the border. */
.equation-row.drop-before::before {
  top: calc(-0.3rem - 2px);
}

.equation-row.drop-after::after {
  bottom: calc(-0.3rem - 2px);
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

/* The command list: over everything, the host's dialogs included. */
.command-list {
  position: fixed;
  z-index: 1300;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: max-content;
  min-width: 17.5rem;
  max-width: 20rem;
  padding: 0.4rem;
  border: 1px solid var(--me-border);
  border-radius: 0.55rem;
  background: var(--me-surface);
  color: var(--me-text);
  box-shadow: 0 6px 24px rgba(15, 23, 42, 0.14);
  font-size: 0.8rem;
}

.command-list .command-chip {
  align-self: flex-start;
}

/* One grid, its rows sharing its columns (subgrid): the previews' column is
   as wide as the widest (an inverse trig function, "otherwise"), so none runs
   into its name, and the names line up. */
.command-options {
  display: grid;
  grid-template-columns: minmax(2.4rem, max-content) max-content minmax(0, 1fr);
  column-gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.command-option {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  align-items: center;
  min-height: 1.9rem;
  padding: 0.1rem 0.4rem;
  border-radius: 0.35rem;
  cursor: pointer;
}

.command-option:hover {
  background: var(--me-subtle);
}

.command-option.highlighted {
  background: color-mix(in srgb, var(--me-accent) 12%, var(--me-surface));
}

.command-preview {
  text-align: center;
  font-size: 0.85rem;
}

.command-name {
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
}

.command-title {
  justify-self: end;
  color: var(--me-muted);
  font-size: 0.72rem;
}

.command-hint {
  margin: 0;
  padding: 0.3rem 0.4rem 0;
  border-top: 1px solid var(--me-border);
  color: var(--me-muted);
  font-size: 0.7rem;
  white-space: nowrap;
}

.command-hint kbd {
  padding: 0 0.25rem;
  border: 1px solid var(--me-border-strong);
  border-radius: 0.25rem;
  background: var(--me-subtle);
  font-family: inherit;
  font-size: 0.65rem;
}

.command-chip {
  display: inline-flex;
  align-items: center;
  height: 1.6rem;
  padding: 0 0.6rem;
  border-radius: 0.45rem;
  background: var(--me-code-bg);
  color: var(--me-code-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 0.9rem;
}

.command-slash {
  color: var(--me-units);
}

.command-caret {
  width: 2px;
  height: 1em;
  margin-left: 2px;
  background: var(--me-code-text);
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
  background: var(--me-code-bg);
  color: var(--me-code-text);
  padding: 0.85rem;
  font-size: 0.83rem;
  line-height: 1.35;
}

/* Narrow (the workbench's own width, not the window's): one column. */
@container (max-width: 900px) {
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
