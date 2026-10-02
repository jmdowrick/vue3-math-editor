// Word's equations, from what Word puts on the clipboard as HTML: each one is
// OMML (Office Math Markup Language, the maths in a .docx), inside a
// conditional comment, with a picture of it as a fallback for other apps:
//
//   <!--[if gte msEquation 12]><m:oMathPara><m:oMath>…</m:oMath></m:oMathPara><![endif]-->
//   <![if !msEquation]><img src=…><![endif]>
//
// The OMML is taken out of the raw text, not a parsed document, because an
// HTML parser would lower-case its element names and drop the comments. It is
// tidied into XML (Word's HTML isn't: unquoted attributes, &nbsp;, <span> and
// <i> round the runs) and read into the neutral tree (mathTree.ts); if it
// still isn't well-formed, it is read as HTML instead.
//
// Each m:oMath is one equation, and so is each line of an equation array
// (m:eqArr) that makes up a whole m:oMath. Accents (m:acc, and m:bar over or
// under) are kept as accent nodes, for presentationImport.ts to read as part
// of a name if it can (x̄ is x_bar). Elements the editor can't write (sums,
// integrals, limits, matrices) are kept as `unsupported` nodes, named, for
// presentationImport.ts to report.

import { type MathNode, type TextStyle, linearText } from './mathTree'
import { attributeOf, child, childElements, decodeNamedEntities, nameOf, parseXml } from './markup'

export const OMML_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

export interface WordEquations {
  equations: MathNode[][]
  // Text outside the equations (a paragraph around them) was left out.
  textLeftOut: boolean
  problems: string[]
}

const CONDITIONAL = /<!--\[if gte msEquation 12\]>([\s\S]*?)<!\[endif\]-->/gi
// oMath[\s>], not oMath\b: \b would also match oMathPara.
const BARE = /<m:oMathPara[\s>][\s\S]*?<\/m:oMathPara>|<m:oMath[\s>][\s\S]*?<\/m:oMath>/gi
const FALLBACK = /<!\[if !msEquation\]>[\s\S]*?<!\[endif\]>/gi

// Whether clipboard HTML has Word's equations in it.
export function hasWordMath(html: string): boolean {
  return /\[if gte msEquation|<m:oMath[\s>]/i.test(html)
}

// The equations in Word's clipboard HTML, or null if it has none.
export function wordEquationsFromHtml(html: string): WordEquations | null {
  if (!hasWordMath(html)) return null

  let blocks = Array.from(html.matchAll(CONDITIONAL), (match) => match[1])
  let rest = html.replace(CONDITIONAL, ' ')
  if (blocks.length === 0) {
    blocks = Array.from(html.matchAll(BARE), (match) => match[0])
    rest = html.replace(BARE, ' ')
  }

  const equations: MathNode[][] = []
  const problems: string[] = []
  for (const block of blocks) {
    const root = parseBlock(block)
    if (!root) {
      problems.push("A Word equation couldn't be read, so it was left out")
      continue
    }
    for (const oMath of descendants(root, 'omath')) equations.push(...equationsOf(oMath))
  }

  return { equations, textLeftOut: hasText(rest), problems }
}

// ---------------------------------------------------------------------------
// From Word's HTML to a parsed element
// ---------------------------------------------------------------------------

// Quoted attribute values, as XML needs: m:val=p -> m:val="p".
const quoteAttributes = (attributes: string) =>
  attributes.replace(/([\w:-]+)=([^\s"'>/]+)/g, '$1="$2"')

function tidy(block: string): string {
  return decodeNamedEntities(
    block
      // Every tag that isn't OMML (<span>, <i>, <w:rPr>, …), keeping the text
      // inside it.
      .replace(/<(?!\/?m:)[^>]*>/g, '')
      .replace(
        /<(m:\w+)((?:\s[^>]*?)?)(\/?)>/g,
        (_, tag: string, attributes: string, close: string) =>
          `<${tag}${quoteAttributes(attributes)}${close}>`,
      ),
  )
}

function parseBlock(block: string): Element | null {
  const tidied = tidy(block)
  const xml = parseXml(
    `<root xmlns:m="${OMML_NAMESPACE}" xmlns:w="urn:w" xmlns:o="urn:o" xmlns:v="urn:v">${tidied}</root>`,
  )
  if (xml) return xml.documentElement

  // As HTML: lenient, but it doesn't know self-closed elements, so <m:e/>
  // would swallow what follows it.
  const expanded = tidied.replace(/<(m:\w+)([^>]*?)\/>/g, '<$1$2></$1>')
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${expanded}`, 'text/html')
  return descendants(doc.body, 'omath').length > 0 ? doc.body : null
}

// Elements under `el` with this name, in document order, not looking inside
// one found.
function descendants(el: Element, name: string): Element[] {
  return childElements(el).flatMap((c) => (nameOf(c) === name ? [c] : descendants(c, name)))
}

// Whether the HTML outside the equations has any text.
function hasText(html: string): boolean {
  const text = html
    .replace(FALLBACK, ' ')
    .replace(/<head[\s>][\s\S]*?<\/head>/gi, ' ')
    .replace(/<style[\s>][\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
  return /\S/.test(decodeNamedEntities(text).replace(/\u00a0/g, ' '))
}

// ---------------------------------------------------------------------------
// OMML to the tree
// ---------------------------------------------------------------------------

// An m:oMath's equations: itself, or each line of the equation array (or
// one-column matrix) it consists of.
function equationsOf(oMath: Element): MathNode[][] {
  const content = childElements(oMath).filter((el) => !isProperty(el))
  const only = content.length === 1 ? content[0] : undefined
  if (only && nameOf(only) === 'eqarr') {
    return childElements(only)
      .filter((el) => nameOf(el) === 'e')
      .map(nodes)
  }
  if (only && nameOf(only) === 'm') {
    const rows = matrixRows(only)
    if (rows.every((cells) => cells.length === 1)) return rows.map((cells) => cells[0])
  }
  return [nodes(oMath)]
}

// Properties (m:rPr, m:fPr, m:ctrlPr, …): how something is drawn, not maths.
const isProperty = (el: Element) => nameOf(el).endsWith('pr')

// The maths inside a container element (m:e, m:num, m:sup, …), or nothing.
function nodes(el: Element | undefined): MathNode[] {
  if (!el) return []
  const out: MathNode[] = []
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 1) {
      out.push(...element(node as Element))
    } else if (node.nodeType === 3 && /\S/.test(node.textContent ?? '')) {
      // Text outside a run, left by a tag that was taken out.
      out.push({ kind: 'text', text: node.textContent!.trim(), style: 'italic' })
    }
  }
  return out
}

const valueOf = (el: Element | undefined, name: string): string | null => {
  const property = el && child(el, name)
  return property ? (attributeOf(property, 'val') ?? '') : null
}

const isOn = (value: string | null) => value !== null && !/^(0|off|false)$/i.test(value)

function element(el: Element): MathNode[] {
  const name = nameOf(el)
  if (isProperty(el)) return []
  const properties = child(el, `${name}pr`)

  switch (name) {
    case 'r':
      return run(el)
    case 't':
      return [{ kind: 'text', text: el.textContent ?? '', style: 'italic' }]
    case 'f':
      return [
        {
          kind: 'fraction',
          num: nodes(child(el, 'num')),
          den: nodes(child(el, 'den')),
          bar: valueOf(properties, 'type') !== 'noBar',
        },
      ]
    case 'ssup':
      return [scripts(el, false, true)]
    case 'ssub':
      return [scripts(el, true, false)]
    case 'ssubsup':
      return [scripts(el, true, true)]
    case 'rad': {
      const index = nodes(child(el, 'deg'))
      const hidden = isOn(valueOf(properties, 'deghide'))
      return [
        {
          kind: 'radical',
          body: nodes(child(el, 'e')),
          index: hidden || index.length === 0 ? null : index,
        },
      ]
    }
    case 'd': {
      const open = valueOf(properties, 'begchr')
      const close = valueOf(properties, 'endchr')
      const separator = valueOf(properties, 'sepchr')
      return [
        {
          kind: 'fenced',
          open: open ?? '(',
          close: close ?? ')',
          separator: separator ?? '|',
          items: childElements(el)
            .filter((c) => nameOf(c) === 'e')
            .map(nodes),
        },
      ]
    }
    case 'func':
      return [
        { kind: 'function', name: nodes(child(el, 'fname')), argument: nodes(child(el, 'e')) },
      ]
    case 'eqarr':
      return [
        {
          kind: 'table',
          rows: childElements(el)
            .filter((c) => nameOf(c) === 'e')
            .map((e) => [nodes(e)]),
        },
      ]
    case 'm':
      return [{ kind: 'table', rows: matrixRows(el) }]
    case 'nary':
      return [nary(el, properties)]
    case 'acc': {
      // Word's default accent is a hat.
      const mark = valueOf(properties, 'chr') || '\u0302'
      const what =
        mark === '\u0307' ? 'a dot accent' : mark === '\u0308' ? 'a double dot accent' : 'an accent'
      return [{ kind: 'accent', base: nodes(child(el, 'e')), mark, position: 'over', what }]
    }
    case 'bar': {
      // Over its base only with pos top; Word's default is under.
      const over = valueOf(properties, 'pos') === 'top'
      return [
        {
          kind: 'accent',
          base: nodes(child(el, 'e')),
          mark: over ? '\u0305' : '\u0332',
          position: over ? 'over' : 'under',
          what: over ? 'a bar' : 'an underbar',
        },
      ]
    }
    case 'groupchr':
      return [unsupported('a brace over or under', linearText(nodes(child(el, 'e'))))]
    case 'limlow':
    case 'limupp': {
      const base = linearText(nodes(child(el, 'e')))
      const limit = linearText(nodes(child(el, 'lim')))
      return [unsupported('a limit', `${base}${name === 'limlow' ? '_' : '^'}(${limit})`)]
    }
    case 'spre':
      return [
        unsupported(
          'a prescript',
          `_(${linearText(nodes(child(el, 'sub')))})^(${linearText(nodes(child(el, 'sup')))})${linearText(nodes(child(el, 'e')))}`,
        ),
      ]
    case 'box':
    case 'borderbox':
      // A box round its contents changes how they're drawn, not what they are.
      return nodes(child(el, 'e'))
    case 'phant':
      // Invisible spacing.
      return []
    case 'omath':
    case 'omathpara':
    case 'e':
    case 'num':
    case 'den':
    case 'sub':
    case 'sup':
    case 'deg':
    case 'fname':
    case 'lim':
      return nodes(el)
    default:
      return [
        unsupported(
          `Word's maths element ${el.localName.replace(/^.*:/, '')}`,
          el.textContent ?? '',
        ),
      ]
  }
}

// A run: its text, italic unless it is plain (m:sty p, or b for bold) or
// normal text (m:nor), which is upright. Either property makes its style
// explicit: Word writes none on what is typed into an equation, so a digit
// marked upright was meant to be (the editor's own "Copy as Word equation"
// marks the digits of a name's superscript so).
function run(el: Element): MathNode[] {
  const texts = childElements(el).filter((c) => nameOf(c) === 't')
  const text = texts.length
    ? texts.map((t) => t.textContent ?? '').join('')
    : Array.from(el.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent ?? '')
        .join('')
  if (!text) return []

  const properties = child(el, 'rpr')
  const normal = !!properties && !!child(properties, 'nor')
  const sty = valueOf(properties, 'sty')
  const style: TextStyle = normal || sty === 'p' || sty === 'b' ? 'upright' : 'italic'
  return [
    {
      kind: 'text',
      text,
      style,
      ...(normal && { token: 'mtext' as const }),
      ...((normal || sty !== null) && { explicit: true as const }),
    },
  ]
}

function scripts(el: Element, sub: boolean, sup: boolean): MathNode {
  return {
    kind: 'scripts',
    base: nodes(child(el, 'e')),
    sub: sub ? nodes(child(el, 'sub')) : null,
    sup: sup ? nodes(child(el, 'sup')) : null,
  }
}

function matrixRows(el: Element): MathNode[][][] {
  return childElements(el)
    .filter((c) => nameOf(c) === 'mr')
    .map((row) =>
      childElements(row)
        .filter((c) => nameOf(c) === 'e')
        .map(nodes),
    )
}

const NARY: Record<string, string> = {
  '∑': 'a sum',
  '∏': 'a product (∏)',
  '∐': 'a coproduct',
  '⋃': 'a union',
  '⋂': 'an intersection',
}

function nary(el: Element, properties: Element | undefined): MathNode {
  const operator = valueOf(properties, 'chr') || '∫'
  const sub = linearText(nodes(child(el, 'sub')))
  const sup = linearText(nodes(child(el, 'sup')))
  const body = linearText(nodes(child(el, 'e')))
  const written = `${operator}${sub ? `_(${sub})` : ''}${sup ? `^(${sup})` : ''} ${body}`.trim()
  return unsupported(NARY[operator] ?? 'an integral', written)
}

const unsupported = (what: string, written: string): MathNode => ({
  kind: 'unsupported',
  what,
  written: written.trim(),
})
