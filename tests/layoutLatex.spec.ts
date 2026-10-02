import katex from 'katex'
import { describe, expect, it } from 'vitest'

import { allPositions } from '../src/editor/cursor'
import {
  type Atom,
  type Row,
  childRows,
  derivative,
  fraction,
  func,
  group,
  piecewise,
  root,
  row,
  superscript,
  symbol,
} from '../src/editor/layout'
import {
  KATEX_EDITOR_OPTIONS,
  decodeRowPath,
  encodeRowPath,
  rowToLatex,
} from '../src/renderers/layoutLatex'

function allAtoms(tree: Row): Atom[] {
  return tree.flatMap((atom) => [atom, ...childRows(atom).flatMap(([, child]) => allAtoms(child))])
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('row path encoding', () => {
  it('round-trips every row path', () => {
    const tree = row(
      'x',
      superscript(row('2')),
      '+',
      fraction(row(root(row('y'), row('3'))), row('1')),
    )
    for (const { path } of allPositions(tree)) {
      expect(decodeRowPath(encodeRowPath(path))).toEqual(path)
    }
  })

  it('rejects malformed encodings', () => {
    expect(decodeRowPath('x/1.num')).toBeNull()
    expect(decodeRowPath('r/one.num')).toBeNull()
    expect(decodeRowPath(null)).toBeNull()
  })
})

describe('rowToLatex', () => {
  it('tags every atom and every row exactly once', () => {
    const tree = row(
      func('sin'),
      group(row('x')),
      superscript(row('2')),
      '=',
      fraction(row('1'), row()),
      derivative(row('f'), row('t')),
    )
    const latex = rowToLatex(tree)

    for (const atom of allAtoms(tree)) {
      expect(countOf(latex, `{atom=${atom.id}}`)).toBe(1)
    }

    const rows = new Set(allPositions(tree).map(({ path }) => encodeRowPath(path)))
    for (const encoded of rows) {
      expect(countOf(latex, `{row=${encoded}}`)).toBe(1)
    }
  })

  it('keeps operator spacing classes', () => {
    const [x, plus, one, eq] = row('x+1=')
    const latex = rowToLatex([x, plus, one, eq])
    expect(latex).toContain(`\\mathbin{\\htmlData{atom=${plus.id}}{+}}`)
    expect(latex).toContain(`\\mathrel{\\htmlData{atom=${eq.id}}{=}}`)
  })

  it('attaches a superscript to the previous atom, or an empty base after an operator', () => {
    const [x, sup] = row('x', superscript(row('2')))
    expect(rowToLatex([x, sup])).toContain(
      `{\\htmlData{atom=${x.id}}{x}}^{\\htmlData{atom=${sup.id}}`,
    )

    const [plus, lone] = row('+', superscript(row('2')))
    expect(rowToLatex([plus, lone])).toContain(`{}^{\\htmlData{atom=${lone.id}}`)
  })

  it('marks only the active empty row', () => {
    const tree = row(fraction())
    const latex = rowToLatex(tree, { activeRow: [{ atom: 0, branch: 'den' }] })
    expect(countOf(latex, 'me-ph-active')).toBe(1)
    expect(countOf(latex, '{me-ph}')).toBe(1)
    expect(latex.indexOf('me-ph-active')).toBeGreaterThan(latex.indexOf('row=r/0.den'))
  })

  it('keeps a name together and draws a function name upright', () => {
    const vm = row('Vm')
    // In \\mathit, TeX's italic for words, so it reads as one name.
    expect(rowToLatex(vm)).toContain(
      `{\\htmlData{atom=${vm[0].id}}{\\mathit{V}}\\htmlData{atom=${vm[1].id}}{\\mathit{m}}}`,
    )

    const sin = row('sin')
    expect(rowToLatex(sin)).toContain(
      `\\mathop{\\htmlData{atom=${sin[0].id}}{\\mathrm{s}}\\htmlData{atom=${sin[1].id}}{\\mathrm{i}}\\htmlData{atom=${sin[2].id}}{\\mathrm{n}}}`,
    )
    expect(rowToLatex(row('cost'))).not.toContain('mathrm')
  })

  it('attaches an exponent to the whole name', () => {
    const [v, m, sup] = row('Vm', superscript(row('2')))
    expect(rowToLatex([v, m, sup])).toContain(
      `{{\\htmlData{atom=${v.id}}{\\mathit{V}}\\htmlData{atom=${m.id}}{\\mathit{m}}}}^{\\htmlData{atom=${sup.id}}`,
    )
  })

  it('typesets the subscripts and superscripts of a name', () => {
    const [g, u1, k, r, u2, u3, m, a, x] = row('g_Kr__max')
    const tagged = (atom: Atom, body: string) => `\\htmlData{atom=${atom.id}}{${body}}`
    const latex = rowToLatex([g, u1, k, r, u2, u3, m, a, x])
    expect(latex).toContain(
      `{{${tagged(g, 'g')}}_{${tagged(u1, '')}${tagged(k, '\\mathit{K}')}${tagged(r, '\\mathit{r}')}}` +
        `^{${tagged(u2, '')}${tagged(u3, '')}${tagged(m, '\\mathit{m}')}${tagged(a, '\\mathit{a}')}${tagged(x, '\\mathit{x}')}}}`,
    )

    // A second part's underscore is drawn as the comma.
    const [c, s1, ca, cb, s2, i] = row('C_Ca_i')
    expect(rowToLatex([c, s1, ca, cb, s2, i])).toContain(
      `_{${tagged(s1, '')}${tagged(ca, '\\mathit{C}')}${tagged(cb, '\\mathit{a}')}${tagged(s2, ',')}${tagged(i, 'i')}}`,
    )

    expect(rowToLatex([symbol('alpha'), ...row('_m')])).toContain('{\\alpha}}_{')

    // A number part upright, as a number.
    const [, , one, two] = row('x_12')
    expect(rowToLatex(row('x_').concat([one, two]))).toContain(
      `${tagged(one, '1')}${tagged(two, '2')}`,
    )

    for (const name of ['g_Kr__max', 'C_Ca_i', 'x__a__b_c_d', 'Vm_init']) {
      const tree = row(name, superscript(row('2')))
      expect(() =>
        katex.renderToString(rowToLatex(tree), { ...KATEX_EDITOR_OPTIONS, throwOnError: true }),
      ).not.toThrow()
    }
  })

  it('draws a name as typed while it is being edited, or with typesetting off', () => {
    const tree = row('V_m+1')
    const typeset = rowToLatex(tree)
    expect(typeset).not.toContain('\\_')
    expect(rowToLatex(tree, { typesetNames: false })).toContain('\\_')
    for (const offset of [0, 2, 3]) {
      expect(rowToLatex(tree, { cursors: [{ path: [], offset }] }), `${offset}`).toContain('\\_')
    }
    expect(rowToLatex(tree, { cursors: [{ path: [], offset: 5 }, null] })).toBe(typeset)
    // In another row: not this name.
    expect(rowToLatex(tree, { cursors: [{ path: [{ atom: 0, branch: 'sup' }], offset: 0 }] })).toBe(
      typeset,
    )
    // Three underscores in a row, or one at the end.
    expect(rowToLatex(row('a___b'))).toContain('\\_')
    expect(rowToLatex(row('V_'))).toContain('\\_')
  })

  it('attaches an exponent to a whole typeset name', () => {
    const tree = row('V_m', superscript(row('2')))
    const sup = tree[3]
    const latex = rowToLatex(tree)
    expect(latex).toMatch(/^\\htmlData\{row=r\}\{\{\\htmlData\{name=/)
    expect(latex).toContain(`}}}^{\\htmlData{atom=${sup.id}}`)
  })

  it('wraps a typeset name for its right edge', () => {
    const [v, ...rest] = row('V_m')
    const latex = rowToLatex([v, ...rest])
    expect(latex).toContain(`\\htmlData{name=${v.id}}{`)
    expect(countOf(latex, '{name=')).toBe(1)
    // Not a name drawn as typed.
    expect(rowToLatex(row('Vm'))).not.toContain('{name=')
  })

  it('renders greek names, other words and unusual glyphs', () => {
    expect(rowToLatex([symbol('alpha')])).toContain('{\\alpha}')
    expect(rowToLatex([symbol('speed')])).toContain('{\\mathit{speed}}')
    expect(rowToLatex([symbol('%')])).toContain('{\\text{\\%}}')
  })
})

// ---------------------------------------------------------------------------
// Decorated names (editor/nameScripts.ts)
// ---------------------------------------------------------------------------

// A name's atoms, with a leading Greek word as one atom (kappa_hat is κ, _,
// h, a, t).
function nameRow(name: string): Row {
  const greek = /^(kappa|alpha)(?=_|$)/.exec(name)
  return greek ? [symbol(greek[1]), ...row(name.slice(greek[1].length))] : row(name)
}

// KaTeX's strict mode, except for the \htmlData and \htmlClass the editor
// relies on.
const STRICT = {
  ...KATEX_EDITOR_OPTIONS,
  throwOnError: true,
  strict: (code: string) => (code === 'htmlExtension' ? 'ignore' : 'error'),
}

const DECORATED = [
  'q_bar_i__Glc',
  'kappa_hat_m__GLUT2',
  'x_tilde',
  'x_check',
  'Glc_bar',
  'Glc_conc_i',
  'Ca_2plus',
  'Na_plus',
  'Cl_minus',
  'Ca_2plus_conc_i',
  'Ca_2plus__max',
  'Ca_12minus_conc',
  'x_hat_plus_conc__a_b',
  'kappa_m__1',
  'g_Na_bar',
  'x_i_bar',
  'x_hat_bar',
  'Ca_conc_2plus',
  'x__bar',
  'sin_bar',
]

describe('decorated names', () => {
  const tagged = (atom: Atom, body: string) => `\\htmlData{atom=${atom.id}}{${body}}`

  it('renders every example in strict mode, with every atom tagged once', () => {
    for (const name of DECORATED) {
      for (const greekNames of [true, false]) {
        const tree = [...nameRow(name), ...row('+1')]
        const latex = rowToLatex(tree, { greekNames })
        expect(() => katex.renderToString(latex, STRICT), `${name}: ${latex}`).not.toThrow()
        for (const atom of tree) {
          expect(countOf(latex, `{atom=${atom.id}}`), `${name} ${atom.value}`).toBe(1)
        }
        expect(latex, name).not.toContain('\\_')
        expect(countOf(latex, '{name='), name).toBe(1)
      }
    }
  })

  it('draws a decorated name as typed while the caret is in it or at either end', () => {
    for (const name of DECORATED) {
      const atoms = nameRow(name)
      const tree = [...atoms, ...row('+1')]
      const typeset = rowToLatex(tree)
      for (const offset of [0, 1, atoms.length - 1, atoms.length]) {
        const latex = rowToLatex(tree, { cursors: [{ path: [], offset }] })
        expect(latex, `${name} @ ${offset}`).toContain('\\_')
        expect(latex, `${name} @ ${offset}`).not.toContain('{name=')
      }
      expect(rowToLatex(tree, { cursors: [{ path: [], offset: tree.length }] })).toBe(typeset)
      expect(rowToLatex(tree, { typesetNames: false })).toContain('\\_')
    }
  })

  it('puts the accent of a one-atom base inside its tag, with the scripts after it', () => {
    const [q, s1, b, a, r, s2, i, s3, s4, g, l, c] = row('q_bar_i__Glc')
    const latex = rowToLatex([q, s1, b, a, r, s2, i, s3, s4, g, l, c])
    const empty = [s1, b, a, r].map((atom) => tagged(atom, '')).join('')
    expect(latex).toContain(
      `\\htmlData{name=${q.id}}{{{${tagged(q, '\\bar{q}')}${empty}}_{${tagged(s2, '')}${tagged(i, 'i')}}` +
        `^{${tagged(s3, '')}${tagged(s4, '')}${tagged(g, '\\mathit{G}')}${tagged(l, '\\mathit{l}')}${tagged(c, '\\mathit{c}')}}}}`,
    )

    // KaTeX hangs the scripts on the accented base, not on an empty box.
    const rendered = katex.renderToString(latex, STRICT)
    const html = rendered.slice(rendered.indexOf('katex-html'))
    const base = html.indexOf(`data-atom="${q.id}"`)
    const scripts = html.indexOf('msupsub')
    expect(html.indexOf('mord accent')).toBeGreaterThan(base)
    expect(html.slice(html.indexOf(`data-atom="${r.id}"`), scripts)).toMatch(
      /^data-atom="[^"]+"><\/span><\/span><span class="$/,
    )

    expect(rowToLatex(nameRow('kappa_hat_m'))).toContain('{\\hat{\\kappa}}')
    expect(rowToLatex(row('x_tilde'))).toContain('{\\tilde{x}}')
    expect(rowToLatex(row('x_check'))).toContain('{\\check{x}}')
  })

  it('draws the wide accent over a longer base, or a Greek letter spelled out', () => {
    const glc = row('Glc_bar')
    const [g, l, c] = glc
    expect(rowToLatex(glc)).toContain(
      `{\\overline{${tagged(g, '\\mathit{G}')}${tagged(l, '\\mathit{l}')}${tagged(c, '\\mathit{c}')}}`,
    )
    expect(rowToLatex(row('Vm_hat'))).toContain('\\widehat{')
    expect(rowToLatex(row('Vm_tilde'))).toContain('\\widetilde{')
    expect(rowToLatex(row('Vm_check'))).toContain('\\widecheck{')

    const kappa = nameRow('kappa_hat')
    expect(rowToLatex(kappa, { greekNames: false })).toContain(
      tagged(kappa[0], '\\widehat{\\mathit{kappa}}'),
    )
  })

  it('draws a charge first in the superscript, with the sign on its first letter', () => {
    const atoms = row('Ca_2plus__max')
    const [, , s1, two, p, l, u, s, s2, s3] = atoms
    expect(rowToLatex(atoms)).toContain(
      `^{${tagged(s1, '')}${tagged(two, '2')}${tagged(p, '{+}')}${tagged(l, '')}${tagged(u, '')}${tagged(s, '')}` +
        `${tagged(s2, '')}${tagged(s3, ',')}`,
    )

    const minus = row('Cl_minus')
    expect(rowToLatex(minus)).toContain(`${tagged(minus[3], '{-}')}${tagged(minus[4], '')}`)
    expect(rowToLatex(row('Ca_12minus'))).toMatch(/\{1\}\\htmlData\{atom=[^}]+\}\{2\}/)
  })

  it('draws a concentration in untagged square brackets, with its charge inside', () => {
    const atoms = row('Ca_2plus_conc_i')
    const latex = rowToLatex(atoms)
    expect(latex).toMatch(/\\left\[\{\{\\htmlData\{atom=[^}]+\}\{\\mathit\{C\}\}/)
    expect(latex).toContain(`${tagged(atoms[4], '{+}')}`)
    expect(latex.indexOf('{+}')).toBeLessThan(latex.indexOf('\\right]'))
    expect(latex).toMatch(/\\right\]_\{\\htmlData\{atom=[^}]+\}\{\}\\htmlData\{atom=[^}]+\}\{i\}\}/)

    expect(rowToLatex(row('Glc_conc'))).toMatch(/\\left\[.*\\right\]\}\}\}$/)
  })

  it('leaves misplaced keywords and function bases as ordinary scripts', () => {
    expect(rowToLatex(row('g_Na_bar'))).not.toContain('\\bar')
    expect(rowToLatex(row('x_i_bar'))).toContain('\\mathit{b}')
    expect(rowToLatex(row('Ca_conc_2plus'))).not.toContain('{+}')
    expect(rowToLatex(row('sin_bar'))).not.toContain('overline')
    expect(rowToLatex(row('x__bar'))).not.toContain('\\bar')
    const hat = rowToLatex(row('x_hat_bar'))
    expect(hat).toContain('\\hat{x}')
    expect(hat).toContain('\\mathit{b}')
  })
})

// ---------------------------------------------------------------------------
// KaTeX accepts everything we produce
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Includes LaTeX special characters, which must be escaped, the letters of
// "sin", so runs sometimes spell a function name, and e/E, so some runs are
// numbers in scientific notation.
const GLYPHS = Array.from('xysinsin2.+-=*,?{}^_\\%&#~$eE<>≤≥≠∧∨⊻¬')

function randomRow(rand: () => number, depth: number): Row {
  const length = Math.floor(rand() * 6)
  const atoms: Atom[] = []
  const child = () => randomRow(rand, depth - 1)

  for (let i = 0; i < length; i++) {
    switch (depth > 0 ? Math.floor(rand() * 10) : 0) {
      case 1:
        atoms.push(fraction(child(), child()))
        break
      case 2:
        atoms.push(superscript(child()))
        break
      case 3:
        atoms.push(root(child(), rand() < 0.5 ? child() : null))
        break
      case 4:
        atoms.push(group(child(), rand() < 0.5 ? '(' : '|'))
        break
      case 5:
        atoms.push(derivative(child(), child()))
        break
      case 6:
        atoms.push(func(rand() < 0.5 ? 'sin' : 'asin'))
        break
      case 7:
        atoms.push(
          piecewise(
            Array.from({ length: 1 + Math.floor(rand() * 3) }, (): [Row, Row] => [
              child(),
              child(),
            ]),
            rand() < 0.5 ? child() : null,
          ),
        )
        break
      default:
        atoms.push(symbol(GLYPHS[Math.floor(rand() * GLYPHS.length)]))
    }
  }

  return atoms
}

describe('KaTeX compatibility', () => {
  it('renders any layout tree without a parse error', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const tree = randomRow(mulberry32(seed), 3)
      const latex = rowToLatex(tree, { activeRow: [] })
      expect(
        () => katex.renderToString(latex, { ...KATEX_EDITOR_OPTIONS, throwOnError: true }),
        latex,
      ).not.toThrow()
    }
  })

  it('emits data-atom and data-row attributes for every atom and row', () => {
    const tree = row('x', superscript(row('2')), '+', fraction(row('1'), row('x+1')))
    const html = katex.renderToString(rowToLatex(tree), KATEX_EDITOR_OPTIONS)

    for (const atom of allAtoms(tree)) {
      expect(html).toContain(`data-atom="${atom.id}"`)
    }
    expect(html).toContain('data-row="r/3.den"')
  })
})
