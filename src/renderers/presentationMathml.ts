// Layout rows -> Presentation MathML, for pasting into Word ("Copy as Word
// equation"). Word turns Presentation MathML pasted as plain text into one of
// its equations; it doesn't read Content MathML (renderers/mathml.ts) or
// LaTeX reliably.
//
// It is written to read back the same (presentationImport.ts), with nothing
// to ask: a derivative's d is ⅆ, Word's differential d; a name's superscript
// parts are upright, as parts of a name rather than a power; Euler's number
// is an upright e. A name of several letters is italic, as the editor draws
// it, rather than MathML's default upright. A number in scientific notation
// is written as Word would show it, 1.5×10^{−3}. Units are left out, as on
// screen.
//
// A decorated name is written as it is drawn: an accent as <mover> with its
// spacing mark (q̄), a charge as a number and sign first in the superscript
// (Ca²⁺), a concentration as square brackets with the scripts outside
// ([Glc]ᵢ). A digit superscript part is upright, <mi mathvariant="normal">1</mi>,
// so it reads back as part of the name and not as a power.

import { constantForSymbol } from '../editor/constants'
import { nameRuns, numberRuns } from '../editor/identifiers'
import type { NumberRun } from '../editor/numbers'
import type { Atom, Row } from '../editor/layout'
import { nameAtoms } from '../editor/names'
import { NAME_ACCENTS, type Range, nameScripts } from '../editor/nameScripts'
import { conditionOperator } from '../editor/operators'
import { greekCharacter } from '../editor/unicodeMath'
import { getFunctionDefinition } from '../registry/nodes'

const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML'

// How brackets are written: <mfenced>, as Word's own MathML writes them, or
// <mo> fences in an <mrow>.
const FENCES: 'mfenced' | 'mo' = 'mfenced'
// How several lines are written: one <math> with a one-column table, a line
// a row (Word recognises MathML only at the start of what's pasted), or a
// <math> each.
const SEVERAL_LINES: 'table' | 'separate' = 'table'
// Word's differential d, so a derivative reads back as one.
const DIFFERENTIAL = '<mo>ⅆ</mo>'

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// The MathML for a row, without <math>: one element, or several in a row.
export function rowToPresentationMathML(row: Row): string {
  if (row.length === 0) return '<mrow/>'

  const names = new Map(nameRuns(row).map((run) => [run.start, run]))
  const numbers = new Map(numberRuns(row).map((run) => [run.start, run]))
  const pieces: string[] = []
  // A function's name was written: function application (U+2061) goes before
  // its argument, after any power (sin²(x)).
  let applying = false

  for (let i = 0; i < row.length; ) {
    const atom = row[i]

    if (atom.kind === 'superscript') {
      // Attaches to what's before it; with nothing suitable, an empty base.
      const previous = row[i - 1]
      const base =
        previous && !isOperatorAtom(previous) && pieces.length > 0 ? pieces.pop()! : '<mrow/>'
      pieces.push(`<msup>${base}${wrapped(atom.sup)}</msup>`)
      i++
      continue
    }
    if (atom.kind === 'units') {
      i++
      continue
    }
    if (applying) {
      pieces.push('<mo>&#x2061;</mo>')
      applying = false
    }

    const number = numbers.get(i)
    if (number) {
      pieces.push(numberMathML(number))
      i = number.end
      continue
    }

    const name = names.get(i)
    const functionName = name?.functionName ?? (atom.kind === 'function' ? atom.name : null)
    if (functionName) {
      // sin(x)^2 as Word, and maths, write it: sin²(x).
      const end = name ? name.end : i + 1
      const [argument, power] = [row[end], row[end + 1]]
      if (argument?.kind === 'group' && argument.open === '(' && power?.kind === 'superscript') {
        pieces.push(
          `<msup>${functionMathML(functionName)}${wrapped(power.sup)}</msup><mo>&#x2061;</mo>${atomMathML(argument)}`,
        )
        i = end + 2
        continue
      }
      pieces.push(functionMathML(functionName))
      applying = true
      i = end
      continue
    }
    if (name) {
      pieces.push(nameMathML(name.name))
      i = name.end
      continue
    }

    pieces.push(atomMathML(atom as Exclude<Atom, { kind: 'superscript' | 'units' | 'function' }>))
    i++
  }

  return pieces.join('')
}

// One element for a row, as a script, a fraction's part or a table cell
// needs.
const wrapped = (row: Row) => `<mrow>${rowToPresentationMathML(row)}</mrow>`

// A <math> for one row; for several, one with a row each (empty ones left
// out).
export function presentationMathMLDocument(rows: readonly Row[]): string {
  const filled = rows.filter((row) => row.length > 0)
  const math = (body: string) => `<math xmlns="${MATHML_NAMESPACE}" display="block">${body}</math>`
  if (filled.length <= 1) return math(rowToPresentationMathML(filled[0] ?? []))
  if (SEVERAL_LINES === 'separate') {
    return filled.map((row) => math(rowToPresentationMathML(row))).join('\n')
  }
  const lines = filled.map((row) => `<mtr><mtd>${rowToPresentationMathML(row)}</mtd></mtr>`)
  return math(`<mtable columnalign="left">${lines.join('')}</mtable>`)
}

const OPERATORS: Record<string, string> = {
  '-': '−',
  '−': '−',
  '·': '⋅',
  '*': '⋅',
}

const isOperatorAtom = (atom: Atom) =>
  atom.kind === 'symbol' &&
  (/^[+\-−=,·*×]$/.test(atom.value) || conditionOperator(atom.value) !== undefined)

function functionMathML(name: string): string {
  return `<mi>${escape(getFunctionDefinition(name)?.latexName ?? name)}</mi>`
}

function numberMathML(number: NumberRun): string {
  if (number.exponent === null) return `<mn>${number.mantissa}</mn>`
  const sign = /^[+-]/.test(number.exponent) ? number.exponent[0] : ''
  const digits = number.exponent.slice(sign.length)
  const signMathML = sign ? `<mo>${sign === '-' ? '−' : '+'}</mo>` : ''
  return `<mrow><mn>${number.mantissa}</mn><mo>×</mo><msup><mn>10</mn><mrow>${signMathML}<mn>${digits}</mn></mrow></msup></mrow>`
}

// A word of a name, as atom values: one letter italic (MathML's default),
// several in italic too (as the editor draws them), digits as a number;
// upright for a superscript part, digits included (an upright 1 is part of
// the name, where a number would be read as a power).
function wordMathML(values: readonly string[], upright = false): string {
  const text = values.map((value) => greekCharacter(value) ?? value).join('')
  if (upright) return `<mi mathvariant="normal">${escape(text)}</mi>`
  if (/^[0-9]+$/.test(text)) return `<mn>${text}</mn>`
  if (Array.from(text).length === 1) return `<mi>${escape(text)}</mi>`
  return `<mi mathvariant="italic">${escape(text)}</mi>`
}

// A charge as Word writes one: 2+ as a number then the sign, + alone.
function chargeMathML({ count, sign }: { count: number; sign: '+' | '-' }): string[] {
  const mark = `<mo>${sign === '+' ? '+' : '−'}</mo>`
  return count === 1 ? [mark] : [`<mn>${count}</mn>`, mark]
}

// A name, typeset with its decorations and parts (nameScripts.ts): g_Kr__max
// as g with the subscript Kr and the superscript max; q_bar_i as q with an
// accent over it, then the subscript; Ca_2plus as Ca with the superscript
// 2+; Glc_conc_i as [Glc] with the subscript outside the brackets.
function nameMathML(name: string): string {
  const values = nameAtoms(name).map((atom) => (atom as { value: string }).value)
  const scripts = nameScripts(values)
  if (!scripts) return wordMathML(values)

  const word = ([start, end]: Range, upright = false) =>
    wordMathML(values.slice(start, end), upright)
  const one = (elements: string[]) =>
    elements.length === 1 ? elements[0] : `<mrow>${elements.join('')}</mrow>`
  const joined = (words: string[]) => one(words.flatMap((w, i) => (i ? ['<mo>,</mo>', w] : [w])))
  const subs = scripts.parts.filter((part) => part.role === 'sub').map((part) => word(part.text))
  const sups = scripts.parts
    .filter((part) => part.role === 'sup')
    .map((part) => word(part.text, true))

  let base = word(scripts.base)
  if (scripts.accent) {
    const mark = NAME_ACCENTS[scripts.accent.kind].mathml
    base = `<mover accent="true">${base}<mo>${escape(mark)}</mo></mover>`
  }
  // The charge goes first in the superscript, before a comma and the
  // superscript parts; inside the brackets of a concentration, [Ca²⁺]ᵢ.
  const charge = scripts.charge ? chargeMathML(scripts.charge) : []
  let sup = sups.length ? joined(sups) : ''
  if (scripts.conc) {
    if (charge.length) base = `<msup>${base}${one(charge)}</msup>`
    base = fenced('[', ']', base)
  } else if (charge.length) {
    sup = one(sups.length ? [...charge, '<mo>,</mo>', ...sups] : charge)
  }

  const sub = subs.length ? joined(subs) : ''
  if (sub && sup) return `<msubsup>${base}${sub}${sup}</msubsup>`
  if (sub) return `<msub>${base}${sub}</msub>`
  if (sup) return `<msup>${base}${sup}</msup>`
  return base
}

function symbolMathML(value: string): string {
  const constant = constantForSymbol(value)
  if (constant) {
    switch (constant.symbol) {
      case 'pi':
        return '<mi>π</mi>'
      case 'infinity':
        return '<mi>∞</mi>'
      case 'exponentiale':
        return '<mi mathvariant="normal">e</mi>'
      case 'notanumber':
        return '<mi mathvariant="normal">NaN</mi>'
      default:
        return `<mi mathvariant="normal">${constant.symbol}</mi>`
    }
  }
  if (value in OPERATORS) return `<mo>${OPERATORS[value]}</mo>`
  if (/^[+=,×]$/.test(value) || conditionOperator(value)) return `<mo>${escape(value)}</mo>`
  if (/^[0-9.]$/.test(value)) return `<mn>${value}</mn>`
  return `<mi>${escape(greekCharacter(value) ?? value)}</mi>`
}

function fenced(open: string, close: string, content: string): string {
  if (FENCES === 'mo') return `<mrow><mo>${open}</mo>${content}<mo>${close}</mo></mrow>`
  const attributes = open === '(' && close === ')' ? '' : ` open="${open}" close="${close}"`
  return `<mfenced${attributes}><mrow>${content}</mrow></mfenced>`
}

// A derivative's expression, bracketed unless it is one name, number or
// bracket: ⅆV, ⅆ(x+y).
function derivativeExpression(expr: Row): string {
  const names = nameRuns(expr)
  const numbers = numberRuns(expr)
  const single =
    expr.length === 0 ||
    (expr.length === 1 && expr[0].kind === 'group') ||
    (names.length === 1 && names[0].start === 0 && names[0].end === expr.length) ||
    (numbers.length === 1 && numbers[0].start === 0 && numbers[0].end === expr.length)
  const content = rowToPresentationMathML(expr)
  return single ? content : fenced('(', ')', content)
}

function atomMathML(atom: Exclude<Atom, { kind: 'superscript' | 'units' | 'function' }>): string {
  switch (atom.kind) {
    case 'symbol':
      return symbolMathML(atom.value)
    case 'fraction':
      return `<mfrac>${wrapped(atom.num)}${wrapped(atom.den)}</mfrac>`
    case 'root':
      return atom.index
        ? `<mroot>${wrapped(atom.body)}${wrapped(atom.index)}</mroot>`
        : `<msqrt>${rowToPresentationMathML(atom.body)}</msqrt>`
    case 'group':
      return fenced(atom.open, atom.close, rowToPresentationMathML(atom.body))
    case 'derivative':
      return `<mfrac><mrow>${DIFFERENTIAL}${derivativeExpression(atom.expr)}</mrow><mrow>${DIFFERENTIAL}${rowToPresentationMathML(atom.variable)}</mrow></mfrac>`
    case 'piecewise': {
      const line = (value: Row, condition: string) =>
        `<mtr><mtd>${rowToPresentationMathML(value)}</mtd><mtd>${condition}</mtd></mtr>`
      const lines = atom.pieces.map(({ value, condition }) =>
        line(value, rowToPresentationMathML(condition)),
      )
      if (atom.otherwise) lines.push(line(atom.otherwise, '<mtext>otherwise</mtext>'))
      return `<mrow><mo>{</mo><mtable columnalign="left left">${lines.join('')}</mtable></mrow>`
    }
  }
}
