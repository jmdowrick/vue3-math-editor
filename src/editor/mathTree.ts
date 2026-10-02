// Maths as laid out, before it is read: the neutral tree that Word's equations
// (OMML, ommlReader.ts) and Presentation MathML (presentationMathmlReader.ts)
// are both read into, so that what they mean is worked out in one place
// (presentationImport.ts).
//
// It keeps what layout formats say and the editor's layout tree doesn't:
// whether text is italic or upright (an upright d is a differential, an
// italic one may be a variable), runs of text as written, before they are
// split into names, numbers and operators, and accents over what they are on
// (a bar or hat over a name is part of the name, nameScripts.ts).

import { NAME_ACCENTS, accentForMark } from './nameScripts'

export type TextStyle = 'italic' | 'upright'

export type MathNode =
  // A run of text. `token` is what Presentation MathML says it is (an
  // identifier, number, operator or text); OMML doesn't say. `explicit`: the
  // style was written out (OMML's m:sty or m:nor, MathML's mathvariant),
  // rather than being the format's default, so an upright 1 there is meant
  // to be upright.
  | {
      kind: 'text'
      text: string
      style: TextStyle
      token?: 'mi' | 'mn' | 'mo' | 'mtext'
      explicit?: true
    }
  // `bar` false: stacked without a fraction bar (a binomial coefficient).
  | { kind: 'fraction'; num: MathNode[]; den: MathNode[]; bar: boolean }
  | { kind: 'scripts'; base: MathNode[]; sub: MathNode[] | null; sup: MathNode[] | null }
  | { kind: 'radical'; body: MathNode[]; index: MathNode[] | null }
  // Delimiters round one or more items ('' for none), separated by
  // `separator`.
  | { kind: 'fenced'; open: string; close: string; separator: string; items: MathNode[][] }
  // A function applied to its argument: sin x, log_b x, sin² x.
  | { kind: 'function'; name: MathNode[]; argument: MathNode[] }
  // A mark over or under its base: x̄, κ̂, V̇. `mark` is the character as
  // written (combining or spacing); `what` names it for a message, if it
  // can't be read ("a dot accent").
  | {
      kind: 'accent'
      base: MathNode[]
      mark: string
      position: 'over' | 'under'
      what: string
    }
  // Rows of cells: a matrix, an equation array, a table.
  | { kind: 'table'; rows: MathNode[][][] }
  // Something the editor can't write: `what` names it ("a sum"), `written`
  // is the fragment as written, in a short linear form.
  | { kind: 'unsupported'; what: string; written: string }

export const text = (value: string, style: TextStyle = 'italic'): MathNode => ({
  kind: 'text',
  text: value,
  style,
})

// The nodes as plain, linear text, the way Word writes an equation as text:
// (a+b)/c, x_i^2, √(x), for naming a fragment in a message.
export function linearText(nodes: readonly MathNode[]): string {
  return nodes.map(linearNode).join('')
}

// Spacing accent marks, as the combining marks that go after a letter in
// text: ¯ as U+0305, so x̅ reads as x with a bar.
const COMBINING: Record<string, string> = {
  '˙': '\u0307',
  '¨': '\u0308',
  '¯': '\u0305',
  '‾': '\u0305',
  '^': '\u0302',
  ˆ: '\u0302',
  '~': '\u0303',
  '˜': '\u0303',
  ˇ: '\u030c',
  _: '\u0332',
}

function linearNode(node: MathNode): string {
  const grouped = (nodes: readonly MathNode[]) => {
    const inner = linearText(nodes)
    return nodes.length === 1 && nodes[0].kind === 'text' && inner.length <= 1
      ? inner
      : `(${inner})`
  }

  switch (node.kind) {
    case 'text':
      return node.text
    case 'fraction':
      return `${grouped(node.num)}/${grouped(node.den)}`
    case 'scripts':
      return (
        linearText(node.base) +
        (node.sub ? `_${grouped(node.sub)}` : '') +
        (node.sup ? `^${grouped(node.sup)}` : '')
      )
    case 'radical':
      return node.index
        ? `√(${linearText(node.index)}&${linearText(node.body)})`
        : `√${grouped(node.body)}`
    case 'fenced':
      return `${node.open}${node.items.map(linearText).join(node.separator)}${node.close}`
    case 'function':
      return `${linearText(node.name)}${grouped(node.argument)}`
    case 'accent':
      return `${grouped(node.base)}${COMBINING[node.mark] ?? node.mark}`
    case 'table':
      return node.rows.map((cells) => cells.map(linearText).join(' & ')).join('; ')
    case 'unsupported':
      return node.written
  }
}

// Characters drawn differently in LaTeX than as themselves.
const LATEX_CHARACTERS: Record<string, string> = {
  ⅆ: '\\mathrm{d}',
  ⅇ: '\\mathrm{e}',
  '∂': '\\partial ',
  '−': '-',
  '⋅': '\\cdot ',
  '·': '\\cdot ',
  '×': '\\times ',
  '∞': '\\infty ',
  '≤': '\\leq ',
  '≥': '\\geq ',
  '≠': '\\neq ',
  '∧': '\\land ',
  '∨': '\\lor ',
  '¬': '\\lnot ',
  '{': '\\{',
  '}': '\\}',
  '&': '',
  '#': '\\#',
  '%': '\\%',
  _: '\\_',
  '⁡': '',
  '⁢': '',
}

const DELIMITER_LATEX: Record<string, string> = {
  '': '.',
  '{': '\\{',
  '}': '\\}',
  '⌊': '\\lfloor ',
  '⌋': '\\rfloor ',
  '⌈': '\\lceil ',
  '⌉': '\\rceil ',
  '‖': '\\|',
  '⟨': '\\langle ',
  '⟩': '\\rangle ',
}

// The nodes as LaTeX, drawn as they were written (for KaTeX): italic runs of
// several letters in the word italic, upright ones upright.
export function treeLatex(nodes: readonly MathNode[]): string {
  return nodes.map(nodeLatex).join('') || '{}'
}

function textLatex(node: MathNode & { kind: 'text' }): string {
  const chars = Array.from(node.text)
  const letters = /^[A-Za-z]+$/.test(node.text)
  if (letters && node.style === 'upright') return `\\mathrm{${node.text}}`
  if (letters && chars.length > 1) return `\\mathit{${node.text}}`
  return chars
    .map((char) => {
      if (char in LATEX_CHARACTERS) return LATEX_CHARACTERS[char]
      if (/^[A-Za-z]$/.test(char) && node.style === 'upright') return `\\mathrm{${char}}`
      return char
    })
    .join('')
}

function nodeLatex(node: MathNode): string {
  const group = (nodes: readonly MathNode[]) => `{${treeLatex(nodes)}}`
  switch (node.kind) {
    case 'text':
      return textLatex(node)
    case 'fraction':
      return node.bar
        ? `\\frac${group(node.num)}${group(node.den)}`
        : `\\genfrac{}{}{0pt}{}${group(node.num)}${group(node.den)}`
    case 'scripts':
      return (
        `{${treeLatex(node.base)}}` +
        (node.sub ? `_${group(node.sub)}` : '') +
        (node.sup ? `^${group(node.sup)}` : '')
      )
    case 'radical':
      return node.index
        ? `\\sqrt[${treeLatex(node.index)}]${group(node.body)}`
        : `\\sqrt${group(node.body)}`
    case 'fenced': {
      const open = DELIMITER_LATEX[node.open] ?? node.open
      const close = DELIMITER_LATEX[node.close] ?? node.close
      const separator = node.separator === '|' ? '\\mid ' : node.separator
      return `\\left${open}${node.items.map(treeLatex).join(separator)}\\right${close}`
    }
    case 'function':
      return `\\operatorname{${linearText(node.name)}}${group(node.argument)}`
    case 'accent': {
      const kind = node.position === 'over' ? accentForMark(node.mark) : null
      const wide = linearText(node.base).length > 1
      if (kind) return `\\${NAME_ACCENTS[kind][wide ? 'wide' : 'latex']}${group(node.base)}`
      const combining = COMBINING[node.mark] ?? node.mark
      if (node.position === 'under') {
        return combining === '\u0332'
          ? `\\underline${group(node.base)}`
          : `\\underset{\\text{${node.mark}}}${group(node.base)}`
      }
      if (combining === '\u0307') return `\\dot${group(node.base)}`
      if (combining === '\u0308') return `\\ddot${group(node.base)}`
      return `\\overset{\\text{${node.mark}}}${group(node.base)}`
    }
    case 'table':
      return `\\begin{matrix}${node.rows.map((cells) => cells.map(treeLatex).join(' & ')).join(' \\\\ ')}\\end{matrix}`
    case 'unsupported':
      return `\\text{${node.written.replace(/[\\{}#$%&_^~]/g, '')}}`
  }
}
