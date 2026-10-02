// Copy, cut and paste (see docs/design.md).
//
// Copying puts two formats on the clipboard:
// - CLIPBOARD_MIME: the selected layout atoms as JSON, so pasting inside the
//   editor reproduces them exactly;
// - text/plain: LaTeX, for pasting into other apps (and back again).
//
// Pasting prefers CLIPBOARD_MIME and otherwise reads text/plain as LaTeX,
// which also covers plain typed maths such as "(x+1)/2" or "sin(x)^2".
// Letters are pasted as typed characters, so names follow the same rules as
// typing (identifiers.ts): "Vm_init" is one variable, "sin" a function.
// Everything here is pure; MathField wires it to the browser's clipboard
// events.
//
// A decorated name (nameScripts.ts) is copied as it is drawn, and read back
// as the same name: \bar{q}_{i} is q_bar_i, [\mathit{Glc}]_{i} is
// Glc_conc_i, {\mathit{Ca}^{2+}} is Ca_2plus. LaTeX from elsewhere is read
// the same way: an accent over one name, square brackets round one name, or
// a charge after one, is that name's keyword. There is no review for a LaTeX
// or plain-text paste, so anything else is read as it always was: the
// accent is dropped, the brackets are round and the superscript is a power.
//
// A "." that isn't a decimal point is multiplication (x.y is x·y), or a full
// stop at the end (y=x.), when pasting; see periodRole. Typing a "." is
// unchanged (numbers.ts).

import {
  GREEK_NAMES,
  bracketFunctionBefore,
  continuesName,
  functionForSpelling,
  isOneName,
  nameRuns,
  numberRuns,
  reservedConstant,
  startsName,
} from './identifiers'
import { greekWord, nameAtoms, withNameKeyword } from './names'
import {
  LATEX_ACCENTS,
  NAME_ACCENTS,
  type Range,
  accentForMark,
  chargeFromText,
  chargeWord,
  nameScripts,
} from './nameScripts'
import { constantForLatexCommand, constantForSymbol, constantForUprightText } from './constants'
import {
  CONDITION_OPERATORS,
  combinedWithEquals,
  conditionOperator,
  conditionOperatorForCommand,
} from './operators'
import {
  type Atom,
  type GroupDelimiter,
  type Row,
  childRows,
  derivative,
  fraction,
  func,
  group,
  newAtomId,
  piecewise,
  root,
  setChildRow,
  superscript,
  symbol,
  unitsAtom,
} from './layout'
import { delimiterLatex, functionLatex } from '../registry/nodes'

export const CLIPBOARD_MIME = 'application/x-semantic-math+json'

// ---------------------------------------------------------------------------
// The editor's own format
// ---------------------------------------------------------------------------

interface ClipboardPayload {
  version: 1
  atoms: Row
}

export function serializeAtoms(atoms: Row): string {
  const payload: ClipboardPayload = { version: 1, atoms }
  return JSON.stringify(payload)
}

// The atoms in a CLIPBOARD_MIME payload, with fresh ids (so pasting twice
// never duplicates an id), or null if the payload isn't valid.
export function deserializeAtoms(text: string | null | undefined): Row | null {
  if (!text) return null

  try {
    const payload = JSON.parse(text) as Partial<ClipboardPayload>
    if (payload?.version !== 1 || !isRow(payload.atoms)) return null
    return withFreshIds(payload.atoms)
  } catch {
    return null
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function isRow(value: unknown): value is Row {
  return Array.isArray(value) && value.every(isAtom)
}

function isAtom(value: unknown): value is Atom {
  if (!isObject(value) || typeof value.id !== 'string') return false

  switch (value.kind) {
    case 'symbol':
      return typeof value.value === 'string'
    case 'function':
      return typeof value.name === 'string'
    case 'fraction':
      return isRow(value.num) && isRow(value.den)
    case 'superscript':
      return isRow(value.sup)
    case 'root':
      return isRow(value.body) && (value.index === null || isRow(value.index))
    case 'group':
      return (
        isRow(value.body) &&
        DELIMITERS.includes(value.open as string) &&
        DELIMITERS.includes(value.close as string)
      )
    case 'derivative':
      return isRow(value.expr) && isRow(value.variable)
    case 'units':
      return isRow(value.units)
    case 'piecewise':
      return (
        Array.isArray(value.pieces) &&
        value.pieces.length > 0 &&
        value.pieces.every(
          (piece: unknown) => isObject(piece) && isRow(piece.value) && isRow(piece.condition),
        ) &&
        (value.otherwise === null || isRow(value.otherwise))
      )
    default:
      return false
  }
}

function withFreshIds(atoms: Row): Row {
  return atoms.map((atom) => {
    let copy = { ...atom, id: newAtomId() } as Atom
    for (const [branch, child] of childRows(atom)) {
      copy = setChildRow(copy, branch, withFreshIds(child))
    }
    return copy
  })
}

// ---------------------------------------------------------------------------
// Layout -> LaTeX (text/plain)
// ---------------------------------------------------------------------------

const OPERATOR_LATEX: Record<string, string> = {
  '·': '\\cdot ',
  '*': '\\cdot ',
  '×': '\\times ',
  '−': '-',
  // < > ≤ ≥ ≠ ∧ ∨ ⊻ ¬ (a trailing space ends a command name)
  ...Object.fromEntries(
    CONDITION_OPERATORS.map((op) => [
      op.symbol,
      op.latex.startsWith('\\') ? `${op.latex} ` : op.latex,
    ]),
  ),
}

const TEXT_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '#': '\\#',
  $: '\\$',
  '%': '\\%',
  '&': '\\&',
  _: '\\_',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}',
}

function symbolLatex(value: string, options: LatexOptions = {}): string {
  if (value in OPERATOR_LATEX) return OPERATOR_LATEX[value]
  if (/^[A-Za-z0-9.+\-=,]$/.test(value)) return value
  const constant = constantForSymbol(value)
  if (constant) return /[a-z]$/i.test(constant.latex) ? `${constant.latex} ` : constant.latex
  if (GREEK_NAMES.has(value) && options.greekNames !== false) return `\\${value} `
  if (/^[A-Za-z]+$/.test(value)) return `\\mathit{${value}}`
  return `\\text{${Array.from(value, (c) => TEXT_ESCAPES[c] ?? c).join('')}}`
}

const isOperatorAtom = (atom: Atom | undefined) =>
  atom?.kind === 'symbol' &&
  (/^[+\-−=,·*×]$/.test(atom.value) || conditionOperator(atom.value) !== undefined)

// Plain, readable LaTeX for a row (no editor markup). A name of more than
// one character is written \mathit{Vm\_init} so LaTeX treats it as one
// variable; a function spelling as the function (\sin). An empty row is
// written as \square, which latexToRow reads back as an empty row. A number
// in scientific notation is written 1\mathrm{e}{-08}: upright e, and the
// exponent braced so its sign gets no operator spacing.
export interface LatexOptions {
  // Greek letters as \alpha (default), or spelled out, as on screen.
  greekNames?: boolean
  // Names' subscripts and superscripts typeset (default), as on screen:
  // g_Kr__max as {g_{\mathit{Kr}}^{\mathit{max}}}. Off, as typed.
  typesetNames?: boolean
}

export function rowToLatexSource(row: Row, options: LatexOptions = {}): string {
  const runs = new Map(nameRuns(row).map((run) => [run.start, run]))
  const scientific = new Map(
    numberRuns(row)
      .filter((run) => run.exponent !== null)
      .map((run) => [run.start, run]),
  )
  let out = ''

  for (let i = 0; i < row.length; ) {
    const number = scientific.get(i)
    if (number) {
      const chars = row
        .slice(number.start, number.end)
        .map((atom) => (atom as { value: string }).value.replace('−', '-'))
      const e = chars.findIndex((c) => c === 'e' || c === 'E')
      out += `${chars.slice(0, e).join('')}\\mathrm{${chars[e]}}{${chars.slice(e + 1).join('')}}`
      i = number.end
      continue
    }

    const run = runs.get(i)

    if (run) {
      out += nameLatex(run.name, run.functionName, options)
      i = run.end
      continue
    }

    out += atomLatex(row[i], row[i - 1], options)
    i++
  }

  return out.trim() || '\\square'
}

function nameLatex(name: string, functionName: string | null, options: LatexOptions): string {
  if (functionName) {
    return functionLatex(functionName)
  }

  const constant = reservedConstant(name)
  if (constant) return symbolLatex(constant)

  const typeset = options.typesetNames !== false ? typesetNameLatex(name, options) : null
  if (typeset) return typeset

  // With Greek names, each Greek word as its letter: alpha_m is \alpha\_m.
  const words = name.split('_')
  const greek = options.greekNames !== false && words.some((word) => greekWord(word))
  if (greek) {
    return words
      .map((word) => {
        const letter = greekWord(word)
        // A space ends the command (\alpha x), unless digits do (\alpha2).
        if (letter) return `\\${letter}${word.slice(letter.length) || ' '}`
        // One letter as it is, and the empty word of "__" as nothing.
        return word.length <= 1 ? word : `\\mathit{${word}}`
      })
      .join('\\_')
  }

  return name.length === 1 ? name : `\\mathit{${name.replace(/_/g, '\\_')}}`
}

// A name with its scripts typeset (nameScripts.ts): V_{m}, C_{\mathit{Ca},i},
// \alpha_{m}. One with a superscript is braced, {g_{\mathit{Kr}}^{\mathit{max}}},
// so that pasting reads it back as the name, not a power. A digit
// superscript part is upright, {\kappa_{m}^{\mathrm{1}}}, for the same
// reason ({x^{2}} is a power). Decorations are written as they are drawn:
// {\bar{q}_{i}^{\mathit{Glc}}}, \overline{\mathit{Glc}} over a longer base,
// [\mathit{Glc}]_{i} and {\mathit{Ca}^{2+}}, with a charge before any other
// superscript ({\mathit{Ca}^{2+,\mathit{max}}}) or inside the brackets
// ([\mathit{Ca}^{2+}]_{i}). Null for a name drawn as typed.
function typesetNameLatex(name: string, options: LatexOptions): string | null {
  const values = nameAtoms(name, options).map((atom) => (atom as { value: string }).value)
  const scripts = nameScripts(values)
  if (!scripts) return null

  const word = ([start, end]: Range) => nameWordLatex(values.slice(start, end), options)
  const script = (role: 'sub' | 'sup') =>
    scripts.parts
      .filter((part) => part.role === role)
      .map((part) => {
        const latex = word(part.text)
        return role === 'sup' && /^[0-9]+$/.test(latex) ? `\\mathrm{${latex}}` : latex
      })

  let core = word(scripts.base)
  if (scripts.accent) {
    const accent = NAME_ACCENTS[scripts.accent.kind]
    const single = scripts.base[1] - scripts.base[0] === 1
    core = `\\${single ? accent.latex : accent.copyWide}{${core}}`
  }

  const charge = scripts.charge
    ? `${scripts.charge.count > 1 ? scripts.charge.count : ''}${scripts.charge.sign}`
    : ''
  if (scripts.conc) core = `[${core}${charge ? `^{${charge}}` : ''}]`

  const sub = script('sub').join(',')
  const sup = [...(charge && !scripts.conc ? [charge] : []), ...script('sup')].join(',')
  const latex = `${core}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''}`
  return sup ? `{${latex}}` : latex
}

// A word of a typeset name, as atom values: x, 12, \mathit{Kr}, \alpha, \tau2.
// It is always followed by _, ^, a comma or a brace, so a command needs no
// space after it.
function nameWordLatex(values: string[], options: LatexOptions): string {
  const [first, ...rest] = values
  if (first.length > 1 && GREEK_NAMES.has(first) && options.greekNames !== false) {
    return `\\${first}${rest.join('')}`
  }
  const text = values.join('')
  return text.length === 1 || /^[0-9]+$/.test(text) ? text : `\\mathit{${text}}`
}

function atomLatex(atom: Atom, previous: Atom | undefined, options: LatexOptions): string {
  switch (atom.kind) {
    case 'symbol':
      return symbolLatex(atom.value, options)
    case 'function':
      return functionLatex(atom.name)
    case 'fraction':
      return `\\frac{${rowToLatexSource(atom.num, options)}}{${rowToLatexSource(atom.den, options)}}`
    case 'superscript': {
      // Attaches to the atom before it; with nothing suitable, an empty base.
      const base = previous && !isOperatorAtom(previous) ? '' : '{}'
      return `${base}^{${rowToLatexSource(atom.sup, options)}}`
    }
    case 'root':
      return atom.index
        ? `\\sqrt[${rowToLatexSource(atom.index, options)}]{${rowToLatexSource(atom.body, options)}}`
        : `\\sqrt{${rowToLatexSource(atom.body, options)}}`
    case 'group': {
      // \left( … \right), \left| … \right|, \left\lfloor … \right\rfloor, …
      const open = delimiterLatex(atom.open)
      const close = delimiterLatex(atom.close)
      const space = (d: string) => (/[a-z]$/.test(d) ? ' ' : '')
      return `\\left${open}${space(open)}${rowToLatexSource(atom.body, options)}\\right${close}${space(close)}`
    }
    case 'derivative':
      return `\\frac{\\mathrm{d}${rowToLatexSource(atom.expr, options)}}{\\mathrm{d}${rowToLatexSource(atom.variable, options)}}`
    case 'units':
      // Left out, as on screen: a number's units are hidden (numberUnits.ts).
      // The editor's own clipboard format keeps them.
      return ''
    case 'piecewise': {
      const lines = atom.pieces.map(
        ({ value, condition }) =>
          `${rowToLatexSource(value, options)} & ${rowToLatexSource(condition, options)}`,
      )
      if (atom.otherwise)
        lines.push(`${rowToLatexSource(atom.otherwise, options)} & \\text{otherwise}`)
      return `\\begin{cases}${lines.join(' \\\\ ')}\\end{cases}`
    }
  }
}

// ---------------------------------------------------------------------------
// LaTeX or plain text -> layout
// ---------------------------------------------------------------------------

type Token = (
  | { kind: 'command'; name: string }
  | { kind: 'char'; value: string }
  | { kind: 'open' } // {
  | { kind: 'close' } // }
) & {
  // Whitespace, or a spacing command (\, \quad), comes straight before it.
  space?: true
  // That whitespace has a line break in it.
  newline?: true
}

// Spacing commands, which count as space round a "." (periodRole).
const SPACES = new Set([',', ';', ':', '!', ' ', 'quad', 'qquad'])

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let space = false
  let newline = false
  let i = 0

  const push = (token: Token) => {
    if (space) token.space = true
    if (newline) token.newline = true
    tokens.push(token)
    space = token.kind === 'command' && SPACES.has(token.name)
    newline = false
  }

  while (i < text.length) {
    const char = text[i]

    if (char === '\\') {
      const word = /^[A-Za-z]+/.exec(text.slice(i + 1))
      if (word) {
        push({ kind: 'command', name: word[0] })
        i += 1 + word[0].length
      } else {
        // A control symbol: \, \; \! \{ \} \| \\ …
        push({ kind: 'command', name: text[i + 1] ?? '' })
        i += 2
      }
      continue
    }

    if (char === '{') push({ kind: 'open' })
    else if (char === '}') push({ kind: 'close' })
    else if (/\s/.test(char)) {
      space = true
      newline ||= /[\n\r]/.test(char)
    } else {
      // A letter with an accent as one character (ā, â) is the letter and
      // the accent's combining mark, as q̄ is.
      const marked = char.normalize('NFD')
      if (/^[A-Za-z].$/u.test(marked) && accentForMark(marked.slice(1))) {
        push({ kind: 'char', value: marked[0] })
        push({ kind: 'char', value: marked.slice(1) })
      } else {
        push({ kind: 'char', value: char })
      }
    }
    i++
  }

  return tokens
}

const DELIMITERS = ['(', ')', '|', '⌊', '⌋', '⌈', '⌉']
const TEXT_COMMANDS = new Set(['text', 'textrm', 'textnormal', 'textit', 'mbox', 'mathrm'])
const CASES_ENVIRONMENTS = new Set(['cases', 'dcases', 'rcases'])
const SPACING = new Set([',', ';', ':', '!', ' ', 'quad', 'qquad', 'displaystyle', 'textstyle'])
const OPERATOR_CHARS = new Set(['+', '-', '−', '=', ',', '·', '*', '×'])

// Where a row being read should stop.
interface Stop {
  close?: boolean // at "}"
  char?: string // at this character (")" or "|" or "]")
  right?: boolean // at \right
  command?: string // at this command (\rfloor)
  operator?: boolean // before a top-level operator (a fraction's denominator)
  closing?: boolean // before ")" or "]", or "|" when inside |…| (likewise)
}

// After a ".", what ends the sentence: nothing more of the expression
// follows, so the "." is a full stop.
const SENTENCE_END_CHARS = new Set([
  ')', ']', '&', '=', ',', '+', '-', '−', '·', '*', '×', '<', '>', '/', '^', "'",
]) // prettier-ignore
const SENTENCE_END_COMMANDS = new Set([
  'right', 'end', '\\', 'cdot', 'times', 'ast', 'rfloor', 'rceil', 'rbrack',
]) // prettier-ignore

const isDigitToken = (token: Token | undefined) =>
  token?.kind === 'char' && /^[0-9]$/.test(token.value)
const isSignToken = (token: Token | undefined) =>
  token?.kind === 'char' && /^[+\-−]$/.test(token.value)
const isSpacing = (token: Token | undefined) => token?.kind === 'command' && SPACING.has(token.name)

// The text of a row of plain symbols, or null if it holds anything else.
function symbolText(atoms: Row): string | null {
  let text = ''
  for (const atom of atoms) {
    if (atom.kind !== 'symbol') return null
    text += atom.value
  }
  return text
}

// The name the atoms end with (not a function's spelling), if any.
function endingName(atoms: Row): { start: number; end: number } | null {
  const runs = nameRuns(atoms)
  const last = runs[runs.length - 1]
  return last && last.end === atoms.length && !last.functionName ? last : null
}

// Whether the atoms end with a number that has no "." and no exponent: 1,
// not 1.5 or 1e5. A "." straight after it can still be a decimal point.
function endsWithWholeNumber(atoms: Row): boolean {
  const runs = numberRuns(atoms)
  const last = runs[runs.length - 1]
  return (
    !!last && last.end === atoms.length && last.exponent === null && !last.mantissa.includes('.')
  )
}

class LatexReader {
  private index = 0
  // \mathrm{d} markers, to recognise \frac{\mathrm{d}…}{\mathrm{d}…}.
  private readonly uprightD = new WeakSet<Atom>()
  // The digits of \mathrm{12}: upright, so a superscript part of a braced
  // name ({\kappa_{m}^{\mathrm{1}}}), not a power.
  private readonly uprightDigits = new WeakSet<Atom>()
  // The last atom of a name that is complete: decorated (\bar{x}, [Glc]) or
  // braced ({g_{Kr}^{max}}). A letter or digit straight after it is another
  // factor (\bar{x}y is x_bar·y), not more of the name; an underscore is
  // still its subscript.
  private readonly closedNames = new WeakSet<Atom>()
  // The subscript read last: the row it went in, where it starts, its last
  // atom, and the token after it (for a superscript straight after it).
  private subscript: { atoms: Row; start: number; end: Atom; index: number } | null = null
  // How many |…| are open, so a "|" closes rather than opens.
  private absDepth = 0
  // How many \begin{cases} are open, so "&", "\\" and \end end a cell.
  private casesDepth = 0

  constructor(private readonly tokens: Token[]) {}

  readAll(): Row {
    const atoms: Row = []
    while (this.peek()) {
      atoms.push(...this.readRow({}))
      this.next() // skip a stray "}", ")" or \right
    }
    return atoms
  }

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }

  private next(): Token | undefined {
    return this.tokens[this.index++]
  }

  // Whether the row being read, `atoms` so far, stops here.
  private atStop(stop: Stop, atoms: Row): boolean {
    const token = this.peek()
    if (!token) return true
    if (this.casesDepth > 0 && this.atCellEnd()) return true
    if (stop.close && token.kind === 'close') return true
    if (stop.right && token.kind === 'command' && token.name === 'right') return true
    if (stop.command && token.kind === 'command' && token.name === stop.command) return true
    if (token.kind === 'char') {
      if (stop.char && token.value === stop.char) return true
      if (stop.operator && OPERATOR_CHARS.has(token.value)) return true
      // A "." that is multiplication, like "*": a/b.c is (a/b)·c.
      if (stop.operator && token.value === '.' && this.periodRole(this.index, atoms) === 'times') {
        return true
      }
      if (stop.closing && [')', ']'].includes(token.value)) return true
      if (stop.closing && token.value === '|' && this.absDepth > 0) return true
    }
    return false
  }

  // What the "." token at `at` is, after `before` (the row read so far):
  // - a full stop, dropped, when nothing follows it: the end, a closing
  //   bracket or brace, an operator (= + - / ^ …), \right, \end, \\, & or a
  //   line break (y=x., x./y);
  // - a decimal point after a whole number when an exponent (1.e-3) or units
  //   (5.{mV}, 5.\,\mathrm{mV}) follow;
  // - multiplication when there is space on either side (3 . 2, 1. 5);
  // - a decimal point before a digit at the start, after an operator, or
  //   after a whole number (.5, x+.5, 1.5);
  // - multiplication otherwise: x.y, x.5, 2.x, 1.2.3 (1.2·3), x^2.y and
  //   k_1.[Glc]_o.
  private periodRole(at: number, before: Row): 'full stop' | 'decimal' | 'times' {
    const period = this.tokens[at]
    const following = this.tokens[at + 1]
    let next = at + 1
    while (isSpacing(this.tokens[next])) next++
    const after = this.tokens[next]

    if (!after || following?.newline || after.kind === 'close') return 'full stop'
    if (after.kind === 'char') {
      if (SENTENCE_END_CHARS.has(after.value) || conditionOperator(after.value)) return 'full stop'
      if (after.value === '|' && this.absDepth > 0) return 'full stop'
    }
    if (
      after.kind === 'command' &&
      (SENTENCE_END_COMMANDS.has(after.name) || conditionOperatorForCommand(after.name))
    ) {
      return 'full stop'
    }

    const whole = endsWithWholeNumber(before)
    if (whole && !period?.space && (this.exponentAt(at + 1) || this.unitsAt(at + 1))) {
      return 'decimal'
    }

    if (period?.space || after.space || next > at + 1) return 'times'

    const last = before[before.length - 1]
    if (isDigitToken(after) && (!last || isOperatorAtom(last) || whole)) return 'decimal'
    return 'times'
  }

  // Whether an exponent starts at token `at`: e or E, or \mathrm{e} (as
  // rowToLatexSource writes it), then a sign, a digit or a brace.
  private exponentAt(at: number): boolean {
    const token = this.tokens[at]
    if (token?.space) return false
    const isE = (t: Token | undefined) => t?.kind === 'char' && /^[eE]$/.test(t.value)
    let rest = at + 1

    if (token?.kind === 'command' && token.name === 'mathrm') {
      const [open, e, close] = this.tokens.slice(at + 1, at + 4)
      if (open?.kind !== 'open' || !isE(e) || close?.kind !== 'close') return false
      rest = at + 4
      if (this.tokens[rest]?.kind === 'open') return true
    } else if (!isE(token)) {
      return false
    }

    return isSignToken(this.tokens[rest]) || isDigitToken(this.tokens[rest])
  }

  // Whether a number's units start at token `at`: {mV}, or \,\mathrm{mV}.
  private unitsAt(at: number): boolean {
    const token = this.tokens[at]
    if (token?.kind === 'open') return !token.space
    const next = this.tokens[at + 1]
    return (
      token?.kind === 'command' &&
      token.name === ',' &&
      next?.kind === 'command' &&
      next.name === 'mathrm'
    )
  }

  // Inside cases: "&" (next column), "\\" (next line) or \end.
  private atCellEnd(): boolean {
    const token = this.peek()
    if (token?.kind === 'char') return token.value === '&'
    return token?.kind === 'command' && (token.name === '\\' || token.name === 'end')
  }

  // \begin{cases} … \end{cases}, after the \begin{cases}: "value & condition"
  // lines separated by \\. A condition of \text{otherwise} (or "else") makes
  // that line the otherwise; a leading \text{if} (for, when) is dropped.
  private readCases(): Atom {
    const pieces: Array<[Row, Row]> = []
    let otherwise: Row | null = null
    this.casesDepth++

    for (;;) {
      const value = this.readRow({})
      let condition: Row = []
      let isOtherwise = false

      if (this.peek()?.kind === 'char') {
        this.next() // "&"
        const word = this.readConditionWord()
        isOtherwise = word === 'otherwise'
        condition = this.readRow({})
        const spelled = condition.map((a) => (a.kind === 'symbol' ? a.value : '?')).join('')
        if (/^(otherwise|else)$/.test(spelled)) {
          isOtherwise = true
          condition = []
        }
      }

      if (isOtherwise) otherwise = value
      else if (value.length > 0 || condition.length > 0) pieces.push([value, condition])

      const token = this.next()
      if (!token || token.kind !== 'command' || token.name !== '\\') {
        if (token?.kind === 'command' && token.name === 'end') this.readText()
        break
      }
    }

    this.casesDepth--
    return piecewise(pieces.length > 0 ? pieces : [[[], []]], otherwise)
  }

  // A word at the start of a condition cell, in \text{…}: "otherwise" (or
  // "else"), or "if", "for", "when" (dropped); anything else is left unread.
  private readConditionWord(): 'otherwise' | 'if' | null {
    const token = this.peek()
    if (token?.kind !== 'command' || !TEXT_COMMANDS.has(token.name)) return null

    const start = this.index
    this.next()
    const word = this.readText().trim().replace(/[,:]$/, '').toLowerCase()
    if (word === 'otherwise' || word === 'else') return 'otherwise'
    if (['if', 'for', 'when'].includes(word)) return 'if'

    this.index = start
    return null
  }

  // Read atoms until a stop (not consumed).
  private readRow(stop: Stop): Row {
    const atoms: Row = []

    while (!this.atStop(stop, atoms)) {
      const token = this.next()!
      const count = atoms.length
      const last = atoms[count - 1]

      switch (token.kind) {
        case 'open': {
          // {mV} (or {units: mV}, as CellML Text writes it) straight after a
          // number is its units.
          if (endsWithNumber(atoms)) {
            this.index-- // back to the "{" for readText
            atoms.push(unitsFromText(this.readText().replace(/^units:/, '')))
            break
          }
          const body = this.readRow({ close: true })
          const read = this.bracedName(body)
          if (read !== body) this.closedNames.add(read[read.length - 1])
          atoms.push(...read)
          this.next() // "}"
          break
        }
        case 'close':
          break // unmatched: ignore
        case 'char':
          this.readChar(token.value, atoms)
          break
        case 'command':
          this.readCommand(token.name, atoms)
          break
      }

      // A letter or digit straight after a complete name is another factor:
      // [Glc]_i x is Glc_conc_i·x.
      const first = atoms[count]
      if (
        last &&
        atoms[count - 1] === last &&
        this.closedNames.has(last) &&
        continuesName(first) &&
        !(first.kind === 'symbol' && first.value === '_')
      ) {
        atoms.splice(count, 0, symbol('·'))
      }
    }

    return atoms
  }

  // A name read whole (decorated): after a "·" if it would otherwise run on
  // from the name before it (x\bar{y} is x·y_bar), and complete.
  private pushName(atoms: Row, name: Row): void {
    if (endingName(atoms) && continuesName(name[0])) atoms.push(symbol('·'))
    atoms.push(...name)
    this.closedNames.add(name[name.length - 1])
  }

  // The name the atoms end with, given `keyword` (a combining accent over
  // it, or a charge after it) in place, as complete. False, with nothing
  // changed, if there is no such name or it can't take the keyword.
  private decorateEnd(atoms: Row, keyword: string, unscripted = false): boolean {
    const run = endingName(atoms)
    if (!run) return false
    const name = atoms.slice(run.start)
    if (unscripted && name.some((atom) => atom.kind === 'symbol' && atom.value === '_')) {
      return false
    }
    const named = withNameKeyword(name, keyword)
    if (!named) return false
    atoms.splice(run.start, atoms.length - run.start, ...named)
    this.closedNames.add(named[named.length - 1])
    return true
  }

  // Square brackets round `body`: round exactly one name, its concentration
  // ([Glc] is Glc_conc); otherwise round brackets.
  private pushSquare(atoms: Row, body: Row): void {
    const named = isOneName(body) ? withNameKeyword(body, 'conc') : null
    if (named) this.pushName(atoms, named)
    else this.pushBrackets(atoms, body, '[')
  }

  // After ^ and its script: whether the script is a charge on the name
  // before it (Ca^{2+}, Cl^-, Ca^2+), which is then that name's keyword
  // (Ca_2plus). A braced script, or a lone sign not followed by a digit
  // (x^-1 is left as it was), or digits then one sign at the end of the
  // name's group (Ca^2+], Ca^2+_i).
  private readCharge(atoms: Row, script: Row, braced: boolean): boolean {
    const text = symbolText(script)
    if (text === null) return false

    let written: string | null = null
    let sign = false
    if (braced) written = text
    else if (/^[+-]$/.test(text) && !isDigitToken(this.peek())) written = text
    else if (/^[0-9]+$/.test(text) && isSignToken(this.peek())) {
      const after = this.tokens[this.index + 1]
      const ends =
        !after ||
        after.kind === 'close' ||
        (after.kind === 'char' && [']', ')', '_'].includes(after.value)) ||
        (after.kind === 'command' && after.name === 'right')
      if (ends) {
        written = text + (this.peek() as { value: string }).value
        sign = true
      }
    }

    const charge = written === null ? null : chargeFromText(written)
    if (!charge || !this.decorateEnd(atoms, chargeWord(charge.count, charge.sign))) return false
    if (sign) this.next()
    return true
  }

  private readChar(char: string, atoms: Row): void {
    switch (char) {
      case '(':
        this.pushBrackets(atoms, this.readUntilChar(')'), '(')
        return
      case '[':
        this.pushSquare(atoms, this.readUntilChar(']'))
        return
      case '|': {
        this.absDepth++
        const body = this.readUntilChar('|')
        this.absDepth--
        atoms.push(group(body, '|'))
        return
      }
      case ')':
      case ']':
        return // unmatched: ignore
      case '^': {
        const subscript = this.subscript
        const scripted =
          subscript?.atoms === atoms &&
          subscript.index === this.index - 1 &&
          atoms[atoms.length - 1] === subscript.end
        const braced = this.peek()?.kind === 'open'
        const script = this.readScript('sup')
        // x_{bar}^{+}: a charge goes straight after the base, before the
        // subscript just read, so that a subscript which is a keyword (bar,
        // minus) stays a part after it, as the editor writes x_plus_bar.
        if (scripted) {
          const parts = atoms.splice(subscript.start)
          const charged = this.readCharge(atoms, script, braced)
          atoms.push(...parts)
          if (charged) {
            this.closedNames.add(atoms[atoms.length - 1])
            return
          }
        }
        if (!this.readCharge(atoms, script, braced)) atoms.push(superscript(script))
        return
      }
      case '_': {
        // A name's subscript (nameScripts.ts): x_{12} is the name x_12, and
        // C_{Ca,i}, with two, is C_Ca_i. A complete name stays complete with
        // it ([Glc]_i).
        const closed = this.closedNames.has(atoms[atoms.length - 1])
        const start = atoms.length
        atoms.push(symbol('_'), ...commasAsUnderscores(this.readScript('sub'), 1))
        if (closed) this.closedNames.add(atoms[atoms.length - 1])
        this.subscript = { atoms, start, end: atoms[atoms.length - 1], index: this.index }
        return
      }
      case '.': {
        const role = this.periodRole(this.index - 1, atoms)
        if (role !== 'full stop') atoms.push(symbol(role === 'decimal' ? '.' : '·'))
        return
      }
      case '/':
        atoms.push(this.readInfixFraction(atoms))
        return
      case '*':
        atoms.push(symbol('·'))
        return
      case '=': {
        // Plain text "<=", ">=", "!=" (and "==") are one operator.
        const previous = atoms[atoms.length - 1]
        const value = previous?.kind === 'symbol' ? previous.value : ''
        const combined = combinedWithEquals(value === '!' ? '¬' : value)
        if (combined) atoms[atoms.length - 1] = symbol(combined)
        else if (value !== '=') atoms.push(symbol('='))
        return
      }
      case '!':
        atoms.push(symbol('¬'))
        return
      case '&': {
        // "&" or "&&" is ∧ (LaTeX tables aren't read).
        const previous = atoms[atoms.length - 1]
        if (!(previous?.kind === 'symbol' && previous.value === '∧')) atoms.push(symbol('∧'))
        return
      }
      default: {
        // A combining accent (q̄, as plain text) over a name with no scripts
        // yet is that name's keyword (q_bar); any other combining mark is
        // dropped rather than kept as a character of its own.
        if (/^\p{M}$/u.test(char)) {
          const accent = accentForMark(char)
          if (accent) this.decorateEnd(atoms, accent, true)
          return
        }
        atoms.push(symbol(char === '−' ? '-' : char))
      }
    }
  }

  // Brackets round `body`. Round brackets straight after floor or ceil(ing)
  // written as a name (typed letters, \operatorname{floor}) are that
  // function's brackets instead: "floor(x)" is ⌊x⌋. Square brackets (other
  // than a concentration, pushSquare) are round.
  private pushBrackets(atoms: Row, body: Row, open: GroupDelimiter | '['): void {
    const bracket = open === '(' ? bracketFunctionBefore(atoms, atoms.length) : null

    if (bracket) {
      atoms.splice(bracket.start, atoms.length - bracket.start, group(body, bracket.open))
    } else {
      atoms.push(group(body, open === '[' ? '(' : open))
    }
  }

  private readUntilChar(close: string): Row {
    const body = this.readRow({ char: close })
    this.next() // the closing character (if any)
    return body
  }

  // "a/b" in plain text: the operand before the slash (back to the previous
  // operator, as when typing "/") over the operand after it (up to the next
  // operator).
  private readInfixFraction(atoms: Row): Atom {
    let start = atoms.length
    while (start > 0 && !isOperatorAtom(atoms[start - 1])) start--

    let numerator = atoms.splice(start)
    const only = numerator[0]
    if (numerator.length === 1 && only.kind === 'group' && only.open === '(') numerator = only.body

    let denominator = this.readRow({ operator: true, closing: true, close: true, right: true })
    const single = denominator[0]
    if (denominator.length === 1 && single.kind === 'group' && single.open === '(') {
      denominator = single.body
    }

    return fraction(numerator, denominator)
  }

  // The argument of ^ or _: a braced group, one command, a run of digits, or
  // one character. A superscript's digits take one "." straight before
  // another digit (x^2.5); a subscript's take none (k_1.x is k_1·x).
  private readScript(role: 'sub' | 'sup'): Row {
    const token = this.peek()
    if (!token) return []

    if (isDigitToken(token)) {
      let digits = ''
      let point = role === 'sub'
      for (;;) {
        const next = this.peek()
        const after = this.tokens[this.index + 1]
        if (isDigitToken(next)) {
          digits += (this.next() as { value: string }).value
        } else if (
          !point &&
          next?.kind === 'char' &&
          next.value === '.' &&
          !next.space &&
          isDigitToken(after) &&
          !after?.space
        ) {
          point = true
          digits += (this.next() as { value: string }).value
        } else {
          break
        }
      }
      return Array.from(digits, (d) => symbol(d))
    }

    return this.readArgument()
  }

  // A macro argument: {…}, or a single token.
  private readArgument(): Row {
    const token = this.peek()
    if (!token) return []

    if (token.kind === 'open') {
      this.next()
      const body = this.readRow({ close: true })
      this.next()
      return body
    }

    const atoms: Row = []
    this.next()
    if (token.kind === 'char') this.readChar(token.value, atoms)
    else if (token.kind === 'command') this.readCommand(token.name, atoms)
    return atoms
  }

  // The raw text of a {…} argument (for \mathrm, \text, \operatorname).
  private readText(): string {
    if (this.peek()?.kind !== 'open') {
      const token = this.next()
      return token?.kind === 'char' ? token.value : ''
    }

    this.next()
    let text = ''
    let depth = 0

    while (this.peek()) {
      const token = this.next()!
      if (token.kind === 'close' && depth === 0) break
      if (token.kind === 'open') depth++
      if (token.kind === 'close') depth--
      if (token.kind === 'char') text += token.value
      if (token.kind === 'command') text += token.name.length === 1 ? token.name : ''
    }

    return text
  }

  private readCommand(name: string, atoms: Row): void {
    // 0.25\,\mathrm{mV}: a number's units (copying no longer writes them, but
    // LaTeX from elsewhere, or from earlier, may).
    const next = this.peek()
    if (
      name === ',' &&
      endsWithNumber(atoms) &&
      next?.kind === 'command' &&
      next.name === 'mathrm'
    ) {
      this.next()
      atoms.push(unitsFromText(this.readText()))
      return
    }

    if (SPACING.has(name)) return

    // \leq, \land, \lnot, … (\not= then reads as ≠, see readChar).
    const operator = conditionOperatorForCommand(name)
    if (operator) {
      atoms.push(symbol(operator.symbol))
      return
    }

    switch (name) {
      case 'begin': {
        const environment = this.readText()
        if (CASES_ENVIRONMENTS.has(environment)) atoms.push(this.readCases())
        return
      }
      case 'end':
        this.readText() // a stray \end
        return
      case 'frac':
      case 'dfrac':
      case 'tfrac': {
        const num = this.readArgument()
        const den = this.readArgument()
        const d = (r: Row) => r[0] !== undefined && this.uprightD.has(r[0])
        atoms.push(d(num) && d(den) ? derivative(num.slice(1), den.slice(1)) : fraction(num, den))
        return
      }

      case 'sqrt': {
        let index: Row | null = null
        if (this.peek()?.kind === 'char' && (this.peek() as { value: string }).value === '[') {
          this.next()
          index = this.readUntilChar(']')
        }
        atoms.push(root(this.readArgument(), index))
        return
      }

      case 'left': {
        const delimiter = this.next()
        const name =
          delimiter?.kind === 'char'
            ? delimiter.value
            : delimiter?.kind === 'command'
              ? delimiter.name
              : ''
        const body = this.readRow({ right: true })
        this.next() // \right
        this.next() // its delimiter
        if (name === '[' || name === 'lbrack') {
          this.pushSquare(atoms, body)
          return
        }
        const open = name === '|' ? '|' : name === 'lfloor' ? '⌊' : name === 'lceil' ? '⌈' : '('
        this.pushBrackets(atoms, body, open)
        return
      }

      // \lbrack x \rbrack, as [x].
      case 'lbrack': {
        const body = this.readRow({ command: 'rbrack', char: ']' })
        this.next() // \rbrack or ]
        this.pushSquare(atoms, body)
        return
      }
      case 'rbrack':
        return // unmatched

      // \lfloor x \rfloor and \lceil x \rceil without \left/\right.
      case 'lfloor':
      case 'lceil': {
        const body = this.readRow({ command: name === 'lfloor' ? 'rfloor' : 'rceil' })
        this.next() // \rfloor, \rceil
        atoms.push(group(body, name === 'lfloor' ? '⌊' : '⌈'))
        return
      }
      case 'rfloor':
      case 'rceil':
        return // unmatched

      case 'right':
        return // unmatched

      case 'cdot':
      case 'ast':
        atoms.push(symbol('·'))
        return
      case 'times':
        atoms.push(symbol('×'))
        return
      case 'square':
      case 'Box':
        return // an empty slot
      case '{':
      case '}':
      case '|':
        atoms.push(symbol(name))
        return

      case 'mathrm':
      case 'operatorname':
      case 'mathit':
      case 'text':
      case 'textrm':
      case 'mathbf': {
        const text = this.readText()
        this.readNamed(name, text, atoms)
        return
      }
    }

    // \bar{q}, \overline{Glc}, \hat{\kappa}: an accent over one name is its
    // keyword (q_bar). Over anything else it is dropped.
    if (name in LATEX_ACCENTS) {
      const argument = this.readArgument()
      const named = isOneName(argument) ? withNameKeyword(argument, LATEX_ACCENTS[name]) : null
      if (named) this.pushName(atoms, named)
      else {
        if (endingName(atoms) && continuesName(argument[0])) atoms.push(symbol('·'))
        atoms.push(...argument)
      }
      return
    }

    const spelled = functionForSpelling(name)
    if (spelled) {
      atoms.push(func(spelled))
      return
    }

    const constant = constantForLatexCommand(name)
    atoms.push(symbol(constant ?? name)) // \pi, \infty (constants), \alpha, …
  }

  private readNamed(command: string, text: string, atoms: Row): void {
    if (!text) return

    // The e of a number in scientific notation, as rowToLatexSource writes
    // it (1\mathrm{e}{-08}): straight before a brace. An upright E likewise.
    if (command === 'mathrm' && (text === 'E' || (text === 'e' && this.peek()?.kind === 'open'))) {
      atoms.push(symbol(text))
      return
    }

    // \mathrm{e} otherwise is Euler's number; \mathrm{NaN}, \mathrm{true}, …
    const constant = command === 'mathrm' ? constantForUprightText(text) : undefined
    if (constant) {
      atoms.push(symbol(constant))
      return
    }

    if (command === 'mathrm' && text === 'd') {
      const d = symbol('d')
      this.uprightD.add(d)
      atoms.push(d)
      return
    }

    // \mathrm{1}: upright digits, a superscript part of a braced name
    // ({\kappa_{m}^{\mathrm{1}}} is kappa_m__1).
    if (command === 'mathrm' && /^[0-9]+$/.test(text)) {
      for (const digit of text) {
        const atom = symbol(digit)
        this.uprightDigits.add(atom)
        atoms.push(atom)
      }
      return
    }

    if (command === 'operatorname' || command === 'mathrm') {
      atoms.push(func(functionForSpelling(text) ?? text))
      return
    }

    if (command === 'text' || command === 'textrm') {
      atoms.push(...Array.from(text, (c) => symbol(c)))
      return
    }

    atoms.push(...Array.from(text, (c) => symbol(c))) // \mathit{Vm_init}: typed characters
  }
  // A braced name with a superscript, as typesetNameLatex writes one:
  // {g_{\mathit{Kr}}^{\mathit{max}}} is the name g_Kr__max, not g_Kr to the
  // power max. Each superscript has to start with a letter, or be upright
  // digits ({\kappa_{m}^{\mathrm{1}}}), so that a braced power from
  // elsewhere, {x^{2}}, stays a power. A charge may come first
  // ({\mathit{Ca}^{2+,\mathit{max}}} is Ca_2plus__max). Anything else is
  // returned as it is.
  private bracedName(atoms: Row): Row {
    const last = atoms[atoms.length - 1]
    if (last?.kind !== 'superscript' || atoms.length < 2) return atoms

    let base = atoms.slice(0, -1)
    let sup = last.sup
    const comma = sup.findIndex((atom) => atom.kind === 'symbol' && atom.value === ',')
    const charge = comma > 0 ? chargeFromText(symbolText(sup.slice(0, comma)) ?? '') : null
    if (charge) {
      const named = withNameKeyword(base, chargeWord(charge.count, charge.sign))
      if (!named) return atoms
      base = named
      sup = sup.slice(comma + 1)
    }

    const name = [...base, symbol('_'), symbol('_'), ...commasAsUnderscores(sup, 2)]
    const runs = nameRuns(name)
    if (runs.length !== 1 || runs[0].start !== 0 || runs[0].end !== name.length) return atoms
    if (runs[0].functionName) return atoms

    const scripts = nameScripts(name.map((atom) => (atom as { value: string }).value))
    const letterFirst = scripts?.parts
      .filter((part) => part.role === 'sup')
      .every((part) => startsName(name[part.text[0]]) || this.uprightDigits.has(name[part.text[0]]))
    return letterFirst ? name : atoms
  }
}

// Whether the atoms read so far end with a number (not the digits of a name).
function endsWithNumber(atoms: Row): boolean {
  const runs = numberRuns(atoms)
  return runs.length > 0 && runs[runs.length - 1].end === atoms.length
}

// A script's commas as underscores: `count` of them (1 between subscripts,
// 2 between superscripts).
export function commasAsUnderscores(atoms: Row, count: number): Row {
  return atoms.flatMap((atom) =>
    atom.kind === 'symbol' && atom.value === ','
      ? Array.from({ length: count }, () => symbol('_'))
      : [atom],
  )
}

// A units atom holding a name typed as characters.
function unitsFromText(text: string): Atom {
  return unitsAtom(Array.from(text.trim(), (c) => symbol(c)))
}

// Read LaTeX (or plain typed maths) into layout atoms.
export function latexToRow(text: string): Row {
  return new LatexReader(tokenize(text)).readAll()
}
