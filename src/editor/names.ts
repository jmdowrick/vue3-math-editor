// One way of writing each name. A Greek letter can be typed as \alpha (one
// atom) or spelled out (five letters), and a constant as \pi or "pi"; both
// are the same thing, so once the cursor has left a name it is settled into
// its one form:
//
// - a reserved name (a constant's MathML name, "pi", "infinity") becomes the
//   constant: always;
// - with Greek names on (the workbench's `greekNames`, default on), each word
//   of a name (the parts between underscores) that is a Greek letter's name,
//   perhaps with digits after it, becomes that letter: alpha_m is α_m,
//   tau2 is τ2. With it off, names are left as typed, and Greek letters are
//   drawn spelled out, so both forms look the same either way.
//
// While the cursor is in a name, or at its end, it is left alone, so it can be
// typed and changed letter by letter. The name itself (what the equation
// exports) is the same either way: alpha_m.
//
// Decorations (q_bar, Ca_2plus, Glc_conc, nameScripts.ts) are only drawn, so
// settling leaves them alone. A pasted accent, bracket or charge becomes its
// keyword through withNameKeyword, so that it is spelled the one way it is
// drawn.

import type { Cursor } from './cursor'
import { GREEK_NAMES, isGreekAtom, isOneName, nameRuns, reservedConstant } from './identifiers'
import { constantForSymbol } from './constants'
import { keywordSlot, nameScripts } from './nameScripts'
import { type Atom, type Row, type RowPath, childRows, row, setChildRow, symbol } from './layout'

export interface NameOptions {
  // Greek words become Greek letters (default true).
  greekNames?: boolean
  // Settle every name, the cursor's too (the line is no longer being edited).
  cursorAway?: boolean
}

interface EditorLike {
  root: Row
  cursor: Cursor
  anchor?: Cursor | null
}

// A Greek letter's name with digits after it: alpha, tau2 (not pi, the
// constant).
const GREEK_WORD = /^([A-Za-z]+?)(\d*)$/

// The Greek letter a word of a name starts with, if the word is that letter's
// name, perhaps with digits after it.
export function greekWord(word: string): string | null {
  const match = GREEK_WORD.exec(word)
  if (!match) return null
  const [, letters] = match
  return GREEK_NAMES.has(letters) && !constantForSymbol(letters) ? letters : null
}

// A name as atoms, in its settled form: alpha_m as α, _, m; pi as π.
export function nameAtoms(name: string, options: NameOptions = {}): Row {
  const constant = reservedConstant(name)
  if (constant) return [symbol(constant)]
  if (options.greekNames === false) return row(name)
  return name.split('_').flatMap((word, index): Atom[] => {
    const separator = index > 0 ? [symbol('_')] : []
    const greek = greekWord(word)
    return greek
      ? [...separator, symbol(greek), ...row(word.slice(greek.length))]
      : [...separator, ...row(word)]
  })
}

// The one name `atoms` with "_" and `keyword` (bar, 2plus, conc) put in its
// place in the decoration zone: after the base, and after any decoration of
// an earlier slot (accent, then charge, then conc). q_i with bar is q_bar_i;
// Ca_2plus with conc is Ca_2plus_conc. The name's own atoms are kept, ids and
// all, with new ones for the keyword. Null if `atoms` isn't one name, the
// name is drawn as typed (x_bar_), it already has a decoration in that slot
// or a later one (decorations are applied inside out, so x_bar with hat, or
// Glc_conc with 2plus, can't be written), or the keyword wouldn't be read as
// a decoration there (sin_x, whose base spells a function).
export function withNameKeyword(atoms: Row, keyword: string): Row | null {
  const slot = keywordSlot(keyword)
  if (slot === null || !isOneName(atoms)) return null

  const values = atoms.map((atom) => (atom as Atom & { kind: 'symbol' }).value)
  const scripts = values.includes('_') ? nameScripts(values) : null
  if (values.includes('_') && !scripts) return null

  // After the base, or the last decoration of an earlier slot.
  const decorations = [scripts?.accent, scripts?.charge, scripts?.conc]
  if (decorations.slice(slot).some(Boolean)) return null
  const last = decorations.slice(0, slot).reverse().find(Boolean)
  const at = last ? last.text[1] : (scripts?.base[1] ?? atoms.length)

  const result = [...atoms.slice(0, at), symbol('_'), ...row(keyword), ...atoms.slice(at)]

  // The keyword is read as that decoration, and the scripts are unchanged.
  const read = nameScripts(result.map((atom) => (atom as Atom & { kind: 'symbol' }).value))
  const decoration = read && [read.accent, read.charge, read.conc][slot]
  if (!decoration || decoration.separator[0] !== at) return null
  if (read.parts.length !== (scripts?.parts.length ?? 0)) return null
  return result
}

const key = (path: RowPath) => path.map((s) => `${s.atom}.${s.branch}`).join('/')

// Whether a cursor is in the name at atoms [start, end) of the row at `path`,
// or at either end of it: the name is being edited.
export function cursorInName(
  cursor: Cursor | null | undefined,
  path: RowPath,
  start: number,
  end: number,
): boolean {
  return (
    !!cursor && key(cursor.path) === key(path) && cursor.offset >= start && cursor.offset <= end
  )
}

// Replacements in one row: atoms [start, end) became `count` atoms.
type Replacements = Map<string, Array<{ start: number; end: number; count: number }>>

// The state with every name the cursor isn't in (or at the end of) settled.
// Returns the same state when nothing changes.
export function settleNames<S extends EditorLike>(state: S, options: NameOptions = {}): S {
  const replaced: Replacements = new Map()
  const root = settleRow(state.root, [], state, options, replaced)
  if (replaced.size === 0) return state
  return {
    ...state,
    root,
    cursor: shifted(state.cursor, replaced),
    anchor: state.anchor ? shifted(state.anchor, replaced) : state.anchor,
  }
}

function settleRow(
  atoms: Row,
  path: RowPath,
  state: EditorLike,
  options: NameOptions,
  replaced: Replacements,
): Row {
  const here = key(path)
  const edited = (start: number, end: number) =>
    !options.cursorAway &&
    (cursorInName(state.cursor, path, start, end) || cursorInName(state.anchor, path, start, end))

  const changes: Array<{ start: number; end: number; atoms: Row }> = []
  for (const run of nameRuns(atoms)) {
    if (run.functionName || edited(run.start, run.end)) continue
    const current = atoms.slice(run.start, run.end)
    const settled = nameAtoms(run.name, options)
    const same =
      settled.length === current.length &&
      settled.every(
        (atom, i) =>
          atom.kind === 'symbol' &&
          current[i].kind === 'symbol' &&
          atom.value === (current[i] as Atom & { kind: 'symbol' }).value,
      )
    // Greek letters already in the name stay as they are with Greek names off.
    const keepGreek = options.greekNames === false && current.some(isGreekAtom)
    if (!same && !keepGreek) changes.push({ start: run.start, end: run.end, atoms: settled })
  }

  // Structures' own rows.
  let result = atoms
  let childChanged = false
  const withChildren = atoms.map((atom, index) => {
    let next = atom
    for (const [branch, child] of childRows(atom)) {
      const settled = settleRow(child, [...path, { atom: index, branch }], state, options, replaced)
      if (settled !== child) next = setChildRow(next, branch, settled)
    }
    if (next !== atom) childChanged = true
    return next
  })
  if (childChanged) result = withChildren

  if (changes.length === 0) return result

  const out: Row = []
  let at = 0
  for (const change of changes) {
    out.push(...result.slice(at, change.start), ...change.atoms)
    at = change.end
  }
  out.push(...result.slice(at))
  replaced.set(
    here,
    changes.map((change) => ({
      start: change.start,
      end: change.end,
      count: change.atoms.length,
    })),
  )
  return out
}

// A cursor with the replaced runs taken into account (it is never inside
// one, unless every name was settled; then it goes to the run's end).
function shifted(cursor: Cursor, replaced: Replacements): Cursor {
  const move = (index: number, list: Array<{ start: number; end: number; count: number }>) => {
    let delta = 0
    for (const change of list) {
      if (index >= change.end) delta += change.end - change.start - change.count
      else if (index > change.start) return change.start - delta + change.count
      else break
    }
    return index - delta
  }

  const path: RowPath = []
  for (let depth = 0; depth < cursor.path.length; depth++) {
    const list = replaced.get(key(cursor.path.slice(0, depth)))
    const segment = cursor.path[depth]
    path.push({ ...segment, atom: list ? move(segment.atom, list) : segment.atom })
  }
  const list = replaced.get(key(cursor.path))
  return { path, offset: list ? move(cursor.offset, list) : cursor.offset }
}
