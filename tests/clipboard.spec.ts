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
