import { describe, expect, it } from 'vitest'

import {
  CLIPBOARD_MIME,
  deserializeAtoms,
  latexToRow,
  rowToLatexSource,
  serializeAtoms,
} from '../src/editor/clipboard'
import { type EditorState, insertAtoms } from '../src/editor/commands'
import {
  type Atom,
  type Row,
  childRows,
  derivative,
  fraction,
  func,
  group,
  root,
  row,
  superscript,
  symbol,
} from '../src/editor/layout'
import { parseRow } from '../src/editor/parse'
import { selectedAtoms } from '../src/editor/selection'
import { json, press, show, type } from './editorHelpers'

// The tree as text, ignoring the cursor (see editorHelpers.show).
const text = (atoms: Row) =>
  show({ root: atoms, cursor: { path: [], offset: atoms.length } }).replace('‸', '')

const pasted = (source: string) => text(latexToRow(source))

function allIds(atoms: Row): string[] {
  return atoms.flatMap((atom: Atom) => [
    atom.id,
    ...childRows(atom).flatMap(([, child]) => allIds(child)),
  ])
}

// Trees covering every atom kind, as the samples in tests/e2e/samples.ts.
const trees: Record<string, () => Row> = {
  'fraction sum': () => row('x+', fraction(row('1'), row('2')), '+3'),
  'function and power': () => row(func('sin'), group(row('x')), superscript(row('2')), '=y'),
  'power over sum': () => row('x', superscript(row('2')), '+', fraction(row('1'), row('x+1'))),
  'nested fractions': () =>
    row(fraction(row(fraction(row('a'), row('b')), '+1'), row('c')), '=', symbol('alpha')),
  'roots, abs, derivative': () =>
    row(
      root(row('x+1')),
      '+',
      root(row('y'), row('3')),
      '-',
      group(row('z'), '|'),
      '=',
      derivative(row('f'), row('t')),
    ),
  'empty slots': () => row(fraction(), '+', superscript(), func('log'), group(row('x,2'))),
  'operators and words': () =>
    row('3', symbol('·'), '4', symbol('×'), symbol('speed'), '-', symbol('%')),
  'unknown function': () => row(func('foo'), group(row('x'))),
}

describe('copying as LaTeX', () => {
  it('writes plain, readable LaTeX', () => {
    expect(rowToLatexSource(trees['fraction sum']())).toBe('x+\\frac{1}{2}+3')
    expect(rowToLatexSource(trees['function and power']())).toBe('\\sin \\left(x\\right)^{2}=y')
    expect(rowToLatexSource(trees['roots, abs, derivative']())).toBe(
      '\\sqrt{x+1}+\\sqrt[3]{y}-\\left|z\\right|=\\frac{\\mathrm{d}f}{\\mathrm{d}t}',
    )
    expect(rowToLatexSource(trees['empty slots']())).toBe(
      '\\frac{\\square}{\\square}+{}^{\\square}\\log \\left(x,2\\right)',
    )
  })

  for (const [name, build] of Object.entries(trees)) {
    it(`round-trips: ${name}`, () => {
      const tree = build()
      expect(text(latexToRow(rowToLatexSource(tree)))).toBe(text(tree))
    })
  }
})

describe('pasting LaTeX', () => {
  it('reads structures', () => {
    expect(pasted('\\frac{1}{2}')).toBe('[1/2]')
    expect(pasted('\\dfrac{a+b}{c}')).toBe('[a+b/c]')
    expect(pasted('\\sqrt{x}+\\sqrt[3]{y}')).toBe('√{x}+√[3]{y}')
    expect(pasted('\\left(x+1\\right)^{2}')).toBe('(x+1)^{2}')
    expect(pasted('\\left|x\\right|')).toBe('|x|')
    expect(pasted('\\frac{\\mathrm{d}y}{\\mathrm{d}t}')).toBe('d{y}/d{t}')
    expect(pasted('e^{i\\pi}')).toBe('e^{ipi}')
    // \pi is the constant; a plain e is the variable e (\mathrm{e} is Euler's number).
    expect(json({ root: latexToRow('e^{i\\pi}'), cursor: { path: [], offset: 0 } })).toEqual([
      'Power',
      'e',
      ['Multiply', 'i', 'Pi'],
    ])
  })

  it('reads functions, greek letters and operators', () => {
    expect(pasted('\\sin x+\\arccos(y)')).toBe('sinx+arccos(y)')
    expect(pasted('\\operatorname{foo}(x)')).toBe('foo(x)')
    expect(pasted('\\alpha+\\beta')).toBe('alpha+beta')
    expect(pasted('a\\cdot b\\times c')).toBe('a·b×c')
    expect(pasted('\\mathit{speed}')).toBe('speed')
  })

  it('ignores spacing and \\square', () => {
    expect(pasted('a\\,+\\;b\\quad')).toBe('a+b')
    expect(pasted('\\frac{\\square}{2}')).toBe('[/2]')
  })

  it('reads a subscript as part of the name', () => {
    expect(pasted('x_1+x_{2}')).toBe('x_1+x_2')
    expect(pasted('C_{Ca,i}')).toBe('C_Ca_i')
    expect(pasted('C_{\\mathit{Ca},i}')).toBe('C_Ca_i')
    expect(json({ root: latexToRow('x_1+x_{2}'), cursor: { path: [], offset: 0 } })).toEqual([
      'Add',
      'x_1',
      'x_2',
    ])
  })
})

describe('names', () => {
  const typed = (keys: string) => type(keys).root

  it('are copied as one italic LaTeX name, functions as the function', () => {
    expect(rowToLatexSource(typed('Vm_init=2Vm'))).toBe(
      '\\mathit{Vm}_{\\mathit{init}}=2\\mathit{Vm}',
    )
    expect(rowToLatexSource(typed('Vm_init'), { typesetNames: false })).toBe('\\mathit{Vm\\_init}')
    expect(rowToLatexSource(typed('x*sin(t)'))).toBe('x\\cdot \\sin \\left(t\\right)')
    expect(rowToLatexSource(typed('cost'))).toBe('\\mathit{cost}')
  })

  it('round-trip through LaTeX as typed characters', () => {
    for (const keys of ['Vm_init=2Vm', 'x*sin(t)', 'cost+x2', 'V1_a^2']) {
      const tree = typed(keys)
      expect(text(latexToRow(rowToLatexSource(tree))), keys).toBe(text(tree))
      const plain = rowToLatexSource(tree, { typesetNames: false })
      expect(text(latexToRow(plain)), keys).toBe(text(tree))
    }
  })

  it('are copied with their subscripts and superscripts typeset', () => {
    expect(rowToLatexSource(typed('V_m'))).toBe('V_{m}')
    expect(rowToLatexSource(typed('C_Ca_i'))).toBe('C_{\\mathit{Ca},i}')
    // Braced, so that pasting reads the superscript as part of the name.
    expect(rowToLatexSource(typed('g_Kr__max'))).toBe('{g_{\\mathit{Kr}}^{\\mathit{max}}}')
    expect(rowToLatexSource(typed('g_Kr__max^2'))).toBe('{g_{\\mathit{Kr}}^{\\mathit{max}}}^{2}')
    expect(rowToLatexSource(typed('x__a__b'))).toBe('{x^{a,b}}')
    // A number part upright, as a number.
    expect(rowToLatexSource(typed('x_a_12'))).toBe('x_{a,12}')
    // Drawn as typed: three underscores in a row.
    expect(rowToLatexSource(typed('a___b'))).toBe('\\mathit{a\\_\\_\\_b}')
  })

  it('with subscripts and superscripts round-trip through LaTeX', () => {
    for (const keys of ['V_m', 'C_Ca_i', 'g_Kr__max', 'k__max^2', 'x_a__b__c', 'a___b+x_1^2']) {
      const tree = typed(keys)
      expect(text(latexToRow(rowToLatexSource(tree))), keys).toBe(text(tree))
    }
  })

  it('pasted with a superscript stay a power unless braced as a name', () => {
    expect(pasted('x_1^2')).toBe('x_1^{2}')
    expect(pasted('g_{Kr}^{max}')).toBe('g_Kr^{max}')
    expect(pasted('{g_{Kr}^{max}}')).toBe('g_Kr__max')
    expect(pasted('{C^{a,b}}')).toBe('C__a__b')
    // A braced power (a digit first) is still a power.
    expect(pasted('{x^{2}}')).toBe('x^{2}')
  })

  it('in pasted plain text follow the typing rules', () => {
    const json1 = (source: string) =>
      json({ root: latexToRow(source), cursor: { path: [], offset: 0 } })
    expect(json1('Vm_init + 2Vm')).toEqual(['Add', 'Vm_init', ['Multiply', 2, 'Vm']])
    expect(json1('cost')).toEqual('cost')
    expect(json1('sin(x)')).toEqual(['Sin', 'x'])
  })
})

describe('decorated names', () => {
  const typed = (keys: string) => type(keys).root

  // The example names (nameScripts.ts), and how each is copied.
  const copies: Array<[string, string]> = [
    ['q_bar_i__Glc', '{\\bar{q}_{i}^{\\mathit{Glc}}}'],
    ['kappa_hat_m__GLUT2', '{\\hat{\\kappa}_{m}^{\\mathit{GLUT2}}}'],
    ['x_tilde', '\\tilde{x}'],
    ['x_check', '\\check{x}'],
    ['Glc_bar', '\\overline{\\mathit{Glc}}'],
    ['Glc_check', '\\check{\\mathit{Glc}}'],
    ['Glc_conc_i', '[\\mathit{Glc}]_{i}'],
    ['Ca_2plus', '{\\mathit{Ca}^{2+}}'],
    ['Na_plus', '{\\mathit{Na}^{+}}'],
    ['Cl_minus', '{\\mathit{Cl}^{-}}'],
    ['Ca_2plus_conc_i', '[\\mathit{Ca}^{2+}]_{i}'],
    ['Ca_2plus__max', '{\\mathit{Ca}^{2+,\\mathit{max}}}'],
    ['kappa_m__1', '{\\kappa_{m}^{\\mathrm{1}}}'],
    ['x_a__12', '{x_{a}^{\\mathrm{12}}}'],
    ['g_Na_bar', 'g_{\\mathit{Na},\\mathit{bar}}'],
    ['x_i_bar', 'x_{i,\\mathit{bar}}'],
    ['x_hat_bar', '\\hat{x}_{\\mathit{bar}}'],
    ['Ca_conc_2plus', '[\\mathit{Ca}]_{\\mathit{2plus}}'],
    ['x__bar', '{x^{\\mathit{bar}}}'],
    ['sin_bar', '\\mathit{sin}_{\\mathit{bar}}'],
  ]

  it('are copied as they are drawn', () => {
    for (const [keys, latex] of copies) expect(rowToLatexSource(typed(keys)), keys).toBe(latex)
    // With Greek names off, a wide accent over the spelled-out letter.
    expect(rowToLatexSource(typed('kappa_hat'), { greekNames: false })).toBe(
      '\\widehat{\\mathit{kappa}}',
    )
    // Braced whenever there is a superscript, so a power stays a power of
    // the name.
    expect(rowToLatexSource(typed('Ca_2plus^2'))).toBe('{\\mathit{Ca}^{2+}}^{2}')
    expect(rowToLatexSource(typed('Ca_2plus_conc^2'))).toBe('[\\mathit{Ca}^{2+}]^{2}')
    // Off, as typed.
    expect(rowToLatexSource(typed('q_bar_i__Glc'), { typesetNames: false })).toBe(
      '\\mathit{q\\_bar\\_i\\_\\_Glc}',
    )
  })

  it('round-trip through LaTeX', () => {
    const names = [
      ...copies.map(([keys]) => keys),
      'Ca_2plus^2',
      'y=q_bar_i__Glc*Glc_conc_o',
      // A keyword as a part after a charge: the charge is read first.
      'x_plus_bar',
      'Ca_2plus_bar',
      'x_plus_minus',
      'x_plus_plus',
      'x_2plus_minus',
      'x_bar_plus_i',
      'x__1__2',
      'x_bar__1__2',
    ]
    for (const keys of names) {
      const tree = typed(keys)
      for (const options of [{}, { greekNames: false }, { typesetNames: false }]) {
        const latex = rowToLatexSource(tree, options)
        expect(text(latexToRow(latex)), `${keys} ${latex}`).toBe(text(tree))
      }
    }
  })

  it('are read from LaTeX and plain text from elsewhere', () => {
    expect(pasted('\\bar{q}_i')).toBe('q_bar_i')
    expect(pasted('\\bar q_i')).toBe('q_bar_i')
    expect(pasted('\\overline{Glc}')).toBe('Glc_bar')
    expect(pasted('\\hat{\\kappa}_m')).toBe('kappa_hat_m')
    expect(pasted('\\widetilde{x}+\\check{y}')).toBe('x_tilde+y_check')
    expect(pasted('[Glc]_i')).toBe('Glc_conc_i')
    expect(pasted('\\left[Glc\\right]_i')).toBe('Glc_conc_i')
    expect(pasted('\\lbrack Glc\\rbrack')).toBe('Glc_conc')
    expect(pasted('Ca^{2+}')).toBe('Ca_2plus')
    expect(pasted('Ca^2+')).toBe('Ca_2plus')
    expect(pasted('Ca^2+_i')).toBe('Ca_2plus_i')
    // A charge in the same scripts as a subscript goes before it.
    expect(pasted('x_{bar}^{+}')).toBe('x_plus_bar')
    expect(pasted('Ca_i^{2+}')).toBe('Ca_2plus_i')
    expect(pasted('x_{bar}')).toBe('x_bar')
    expect(pasted('Cl^-')).toBe('Cl_minus')
    expect(pasted('Cl^{−}+Na^+')).toBe('Cl_minus+Na_plus')
    expect(pasted('[Ca^{2+}]_i')).toBe('Ca_2plus_conc_i')
    expect(pasted('[Ca^2+]_i')).toBe('Ca_2plus_conc_i')
    expect(pasted('{Ca^{2+,max}}')).toBe('Ca_2plus__max')
    expect(pasted('{\\kappa_{m}^{\\mathrm{1}}}')).toBe('kappa_m__1')
    // Plain Unicode: a combining mark, or a letter with its accent.
    expect(pasted('q̄_i')).toBe('q_bar_i')
    expect(pasted('x̂')).toBe('x_hat')
    expect(pasted('ā')).toBe('a_bar')
  })

  it('end where a decoration ends the name', () => {
    expect(pasted('\\bar{x}y')).toBe('x_bar·y')
    expect(pasted('x\\bar{y}')).toBe('x·y_bar')
    expect(pasted('[Glc]_i x')).toBe('Glc_conc_i·x')
    expect(pasted('[Glc]2')).toBe('Glc_conc·2')
    expect(pasted('{g_{Kr}^{max}}x')).toBe('g_Kr__max·x')
  })

  it('pasted otherwise keep their powers and brackets', () => {
    expect(pasted('x^{-1}')).toBe('x^{-1}')
    expect(pasted('x^-1')).toBe('x^{-}1')
    expect(pasted('x^2+1')).toBe('x^{2}+1')
    expect(pasted('{x^{2}}')).toBe('x^{2}')
    expect(pasted('x_1^{+2}')).toBe('x_1^{+2}')
    expect(pasted('[x+y]')).toBe('(x+y)')
    expect(pasted('[2]')).toBe('(2)')
    expect(pasted('\\sin^{+}')).toBe('sin^{+}')
    // An accent over anything but one name is dropped, as is a combining
    // mark with nothing to go on.
    expect(pasted('\\bar{x+y}')).toBe('x+y')
    expect(pasted('\\hat{\\sin}x')).toBe('sinx')
    expect(pasted('2̄+x_ī')).toBe('2+x_i')
    // \mathrm{12} on its own is the number's digits.
    expect(pasted('\\mathrm{12}')).toBe('12')
  })
})

describe('pasting a period', () => {
  const json1 = (source: string) =>
    json({ root: latexToRow(source), cursor: { path: [], offset: 0 } })

  it('reads it as multiplication, a decimal point or a full stop', () => {
    const table: Array<[string, string]> = [
      ['x.y', 'x·y'],
      ['1.5', '1.5'],
      ['.5', '.5'],
      ['x+.5', 'x+.5'],
      ['(.5)', '(.5)'],
      ['x.5', 'x·5'],
      ['2.x', '2·x'],
      ['3 . 2', '3·2'],
      ['1. 5', '1·5'],
      ['3 .2', '3·2'],
      ['x\\,.\\,y', 'x·y'],
      ['1.2.3', '1.2·3'],
      ['x^2.y', 'x^{2}·y'],
      ['x^2.5', 'x^{2.5}'],
      ['x^2 .5', 'x^{2}·5'],
      ['k_1.5', 'k_1·5'],
      ['k_1.[Glc]_o', 'k_1·Glc_conc_o'],
      ['[Glc]_i.[Glc]_o', 'Glc_conc_i·Glc_conc_o'],
      ['\\kappa.(x+1)', 'kappa·(x+1)'],
      ['y=x.', 'y=x'],
      ['y=x.}', 'y=x'],
      ['(x.)', '(x)'],
      ['x.=y', 'x=y'],
      ['x.+y', 'x+y'],
      ['x.\\cdot y', 'x·y'],
      ['x.\\leq y', 'x≤y'],
      ['1.e-3', '1.e-3'],
      ['2.E5', '2.E5'],
      ['1.\\mathrm{e}{-3}', '1.e-3'],
      ['2.e', '2·e'],
      ['5.{mV}', '5.{mV}'],
      ['5.\\,\\mathrm{mV}', '5.{mV}'],
      ['a/b.c', '[a/b]·c'],
      ['a/b*c', '[a/b]·c'],
      ['x./y', '[x/y]'],
      ['x.^2', 'x^{2}'],
    ]
    for (const [source, read] of table) expect(pasted(source), source).toBe(read)
  })

  it('is multiplication only when pasted: a typed period is left as it is', () => {
    expect(pasted('x.y')).toBe('x·y')
    const typed = type('x.y')
    expect(show(typed)).toBe('x.y‸')
    expect(parseRow(typed.root).diagnostics.map((d) => d.message)).toEqual(['Malformed number "."'])
  })

  it('ends a sentence at a line break', () => {
    expect(pasted('y=2.\n(x)')).toBe('y=2(x)')
    expect(pasted('y=2.(x)')).toBe('y=2·(x)')
  })

  it('keeps numbers numbers', () => {
    expect(json1('1.e-3')).toBe(0.001)
    expect(json1('2.5\\cdot x')).toEqual(['Multiply', 2.5, 'x'])
    expect(json1('x.y')).toEqual(['Multiply', 'x', 'y'])
    expect(json1('1.2.3')).toEqual(['Multiply', 1.2, 3])
    expect(json1('x^2.5')).toEqual(['Power', 'x', 2.5])
  })
})

describe('pasting plain text', () => {
  it('reads what you would type', () => {
    expect(pasted('2x+1')).toBe('2x+1')
    expect(pasted('sin(x)')).toBe('sin(x)')
    expect(pasted('x^2+1')).toBe('x^{2}+1')
    expect(pasted('x^10')).toBe('x^{10}')
    expect(pasted('|x|+|y|')).toBe('|x|+|y|')
    expect(pasted('3*4')).toBe('3·4')
  })

  it('turns a slash into a fraction of the operands either side', () => {
    expect(pasted('1/2')).toBe('[1/2]')
    expect(pasted('y=(x+1)/(x-1)+3')).toBe('y=[x+1/x-1]+3')
    expect(pasted('a+2b/c')).toBe('a+[2b/c]')
    expect(pasted('|1/x|')).toBe('|[1/x]|')
  })

  it('never throws on arbitrary input', () => {
    for (const input of [
      '',
      '}{',
      '\\',
      '\\left',
      '(((',
      ')))',
      '^^',
      '//',
      '\\frac',
      '||||',
      '\\sqrt[',
    ]) {
      expect(() => latexToRow(input)).not.toThrow()
    }
  })
})

describe('the editor clipboard format', () => {
  it('round-trips atoms exactly, with fresh ids', () => {
    const tree = trees['roots, abs, derivative']()
    const copy = deserializeAtoms(serializeAtoms(tree))!
    expect(text(copy)).toBe(text(tree))

    const ids = allIds(copy)
    expect(new Set([...ids, ...allIds(tree)]).size).toBe(ids.length * 2)
  })

  it('rejects anything else', () => {
    expect(deserializeAtoms(null)).toBeNull()
    expect(deserializeAtoms('not json')).toBeNull()
    expect(deserializeAtoms('{"version":2,"atoms":[]}')).toBeNull()
    expect(deserializeAtoms('{"version":1,"atoms":[{"kind":"bogus","id":"a"}]}')).toBeNull()
    expect(
      deserializeAtoms('{"version":1,"atoms":[{"kind":"fraction","id":"a","num":[]}]}'),
    ).toBeNull()
  })

  it('has a namespaced MIME type', () => {
    expect(CLIPBOARD_MIME).toMatch(/^application\/x-/)
  })
})

describe('pasting into the equation', () => {
  it('inserts at the cursor and moves past what was pasted', () => {
    const state = type('y=')
    const next = insertAtoms(latexToRow('\\frac{1}{2}'))(state)
    expect(show(next)).toBe('y=[1/2]‸')
  })

  it('replaces the selection', () => {
    const state = press(type('y=a+b'), 'Shift+ArrowLeft', 'Shift+ArrowLeft', 'Shift+ArrowLeft')
    expect(show(insertAtoms(latexToRow('\\sqrt{c}'))(state))).toBe('y=√{c}‸')
  })

  it('pastes inside a structure', () => {
    expect(show(insertAtoms(row('x+1'))(type('1/')))).toBe('[1/x+1‸]')
  })

  it('copy then paste reproduces the selection', () => {
    const source: EditorState = press(type('1/x', ' ', '+y'), 'SelectAll')
    const copied = serializeAtoms(selectedAtoms(source))
    const target = type('z=')
    const next = insertAtoms(deserializeAtoms(copied)!)(target)
    expect(show(next)).toBe('z=[1/x]+y‸')
  })

  it('inserting nothing over a selection removes it', () => {
    const state = press(type('ab'), 'Shift+ArrowLeft')
    expect(show(insertAtoms([])(state))).toBe('a‸')
  })
})
