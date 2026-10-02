// Presentation MathML, read into the neutral tree (mathTree.ts): what Word puts
// on the clipboard as text when "Copy MathML to the clipboard as plain text"
// is on (<mml:math …>), and what many other tools write. Unlike Content
// MathML (mathmlImport.ts), it says how maths looks, not what it means; what
// it means is worked out in presentationImport.ts.
//
// Each <math> is one equation, as is each row of a one-column table that
// makes up a whole <math> (as the editor's "Copy as Word equation" writes
// several lines).
//
// A token's mathvariant makes its style explicit (mathTree.ts): without one,
// a one-character <mi> is italic and a longer one upright, which says
// nothing about what the writer meant.

import { type MathNode, type TextStyle, linearText } from './mathTree'
import { attributeOf, childElements, decodeNamedEntities, nameOf, parseXml } from './markup'

const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML'

const PREFIX = /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<([A-Za-z_][\w.-]*:)?math\b/
const PRESENTATION =
  /<([A-Za-z_][\w.-]*:)?(mi|mn|mo|mtext|mrow|mfrac|msub|msup|msubsup|msqrt|mroot|mfenced|mtable|mover|munder|munderover)\b/
const CONTENT = /<([A-Za-z_][\w.-]*:)?(apply|ci|cn|csymbol)\b/

// Whether pasted text is Presentation MathML: a <math> with presentation
// elements in it, and no content ones (which would make it Content MathML).
export function looksLikePresentationMathML(text: string): boolean {
  return PREFIX.test(text) && PRESENTATION.test(text) && !CONTENT.test(text)
}

// The equations in Presentation MathML text, or null if it isn't
// well-formed XML.
export function presentationMathMLEquations(text: string): MathNode[][] | null {
  const body = decodeNamedEntities(text.replace(/^\s*<\?xml[^>]*\?>/, ''))
  // Wrapped, so a <math> without its namespace, or with Word's mml: prefix
  // undeclared, reads the same.
  const doc = parseXml(
    `<wrapper xmlns="${MATHML_NAMESPACE}" xmlns:mml="${MATHML_NAMESPACE}" xmlns:m="urn:m">${body}</wrapper>`,
  )
  if (!doc) return null

  const maths = childElements(doc.documentElement).filter((el) => nameOf(el) === 'math')
  return maths.flatMap(equationsOf)
}

// A <math>'s equations: itself, or each row of the one-column table it is.
function equationsOf(math: Element): MathNode[][] {
  let content = significant(math)
  while (content.length === 1 && ['mrow', 'semantics', 'mstyle'].includes(nameOf(content[0]))) {
    content = significant(content[0]).filter((el) => !nameOf(el).startsWith('annotation'))
  }
  const only = content.length === 1 ? content[0] : undefined
  if (only && nameOf(only) === 'mtable') {
    const rows = tableRows(only)
    if (rows.length > 0 && rows.every((cells) => cells.length === 1)) {
      return rows.map((cells) => cells[0])
    }
  }
  return [nodes(math)]
}

const significant = (el: Element) => childElements(el).filter((c) => nameOf(c) !== 'mspace')

// The maths in each child element.
function nodes(el: Element | undefined): MathNode[] {
  return el ? childElements(el).flatMap(element) : []
}

// Each child element on its own: an <msub>'s base and subscript, say.
const argumentsOf = (el: Element) => childElements(el).map((c) => element(c))

const textOf = (el: Element) => (el.textContent ?? '').trim()

// The explicit flag, for a token with a mathvariant.
const explicit = (el: Element) =>
  attributeOf(el, 'mathvariant') !== null ? { explicit: true as const } : {}

function element(el: Element): MathNode[] {
  const name = nameOf(el)
  switch (name) {
    case 'mi': {
      const text = textOf(el)
      if (!text) return []
      // A one-character identifier is italic, a longer one upright, unless
      // mathvariant says otherwise (MathML's defaults).
      const variant = attributeOf(el, 'mathvariant')
      const style: TextStyle = variant
        ? /italic/.test(variant)
          ? 'italic'
          : 'upright'
        : Array.from(text).length === 1
          ? 'italic'
          : 'upright'
      return [{ kind: 'text', text, style, token: 'mi', ...explicit(el) }]
    }
    case 'mn':
      return textOf(el)
        ? [{ kind: 'text', text: textOf(el), style: 'upright', token: 'mn', ...explicit(el) }]
        : []
    case 'mo':
      return textOf(el)
        ? [{ kind: 'text', text: textOf(el), style: 'upright', token: 'mo', ...explicit(el) }]
        : []
    case 'mtext':
    case 'ms':
      return textOf(el)
        ? [{ kind: 'text', text: textOf(el), style: 'upright', token: 'mtext' }]
        : []
    case 'mspace':
    case 'mphantom':
    case 'annotation':
    case 'annotation-xml':
    case 'none':
    case 'mprescripts':
      return []
    case 'math':
    case 'mrow':
    case 'mstyle':
    case 'mpadded':
    case 'menclose':
    case 'merror':
    case 'mtd':
      return nodes(el)
    case 'semantics': {
      // Its first child is the maths; the rest annotate it.
      const [first] = childElements(el)
      return first ? element(first) : []
    }
    case 'mfrac': {
      const [num, den] = argumentsOf(el)
      const thickness = attributeOf(el, 'linethickness')
      return [
        {
          kind: 'fraction',
          num: num ?? [],
          den: den ?? [],
          bar: !(thickness !== null && /^0(\.0*)?([a-z]+)?$/.test(thickness.trim())),
        },
      ]
    }
    case 'msup': {
      const [base, sup] = argumentsOf(el)
      return [{ kind: 'scripts', base: base ?? [], sub: null, sup: sup ?? [] }]
    }
    case 'msub': {
      const [base, sub] = argumentsOf(el)
      return [{ kind: 'scripts', base: base ?? [], sub: sub ?? [], sup: null }]
    }
    case 'msubsup': {
      const [base, sub, sup] = argumentsOf(el)
      return [{ kind: 'scripts', base: base ?? [], sub: sub ?? [], sup: sup ?? [] }]
    }
    case 'msqrt':
      return [{ kind: 'radical', body: nodes(el), index: null }]
    case 'mroot': {
      const [body, index] = argumentsOf(el)
      return [{ kind: 'radical', body: body ?? [], index: index ?? [] }]
    }
    case 'mfenced': {
      const separators = (attributeOf(el, 'separators') ?? ',').replace(/\s/g, '')
      return [
        {
          kind: 'fenced',
          open: attributeOf(el, 'open') ?? '(',
          close: attributeOf(el, 'close') ?? ')',
          separator: separators.slice(0, 1),
          items: argumentsOf(el),
        },
      ]
    }
    case 'mtable':
      return [{ kind: 'table', rows: tableRows(el) }]
    case 'munder':
    case 'mover':
    case 'munderover':
      return [underOver(el)]
    case 'mmultiscripts':
      return [unsupported('a prescript', linearText(nodes(el)))]
    default:
      return [unsupported(`the MathML element <${name}>`, linearText(nodes(el)))]
  }
}

function tableRows(el: Element): MathNode[][][] {
  return childElements(el)
    .filter((row) => nameOf(row) === 'mtr' || nameOf(row) === 'mlabeledtr')
    .map((row) =>
      childElements(row)
        .filter((cell) => nameOf(cell) === 'mtd')
        .map(nodes),
    )
}

const LARGE_OPERATORS: Record<string, string> = {
  '∑': 'a sum',
  '∏': 'a product (∏)',
  '∫': 'an integral',
  '∬': 'an integral',
  '∭': 'an integral',
  '∮': 'an integral',
}

// Something above or below its base: a sum or integral's limits, a limit, an
// accent. A <mover> or <munder> of a base and one character is an accent
// (x̄ is <mover><mi>x</mi><mo>¯</mo></mover>), for presentationImport.ts to
// read as part of a name if it can; the rest is nothing the editor writes.
function underOver(el: Element): MathNode {
  const [base, ...rest] = argumentsOf(el)
  const baseText = linearText(base ?? [])
  const written = `${baseText}${rest.map((part) => `(${linearText(part)})`).join('')}`
  if (LARGE_OPERATORS[baseText]) return unsupported(LARGE_OPERATORS[baseText], written)
  if (baseText === 'lim') return unsupported('a limit', written)

  const [over] = rest
  const name = nameOf(el)
  const mark = rest.length === 1 && over.length === 1 && over[0].kind === 'text' ? over[0].text : ''
  if (name !== 'munderover' && Array.from(mark).length === 1) {
    const position = name === 'mover' ? 'over' : 'under'
    return { kind: 'accent', base: base ?? [], mark, position, what: accentName(mark, position) }
  }
  return unsupported('an accent or a limit', written)
}

// The marks that draw a bar under something. A list rather than a regex
// character class, since the combining marks can't sit in one.
const UNDERBARS = ['_', '\u0332', '¯', '\u0305', '\u0304', '‾']

// An accent's name, for a message: spacing or combining forms alike (˙ or
// U+0307 is a dot). One character under something may be a limit's (max
// over x).
function accentName(mark: string, position: 'over' | 'under'): string {
  if (mark === '˙' || mark === '\u0307') return 'a dot accent'
  if (mark === '¨' || mark === '\u0308') return 'a double dot accent'
  if (position === 'under') {
    return UNDERBARS.includes(mark) ? 'an underbar' : 'an accent or a limit'
  }
  return 'an accent'
}

const unsupported = (what: string, written: string): MathNode => ({
  kind: 'unsupported',
  what,
  written: written.trim(),
})
