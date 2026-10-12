import katex from 'katex'
import { describe, expect, it } from 'vitest'

import { variableAtAtom } from '../src/editor/identifiers'
import { type Row, childRows, row, symbol } from '../src/editor/layout'
import { settleNames } from '../src/editor/names'
import { parseRow } from '../src/editor/parse'
import { equationLine, unitsIssueMarks } from '../src/editor/units'
import { KATEX_EDITOR_OPTIONS, rowToLatex } from '../src/renderers/layoutLatex'
import { type } from './editorHelpers'

// The workbench's `variable-click`: MathField reports the atom a click landed
// on (the innermost [data-atom], or a typeset name's [data-name]), and the
// workbench names the variable it is part of (variableAtAtom), if the line has
// that variable.

// A line no longer being edited: every name settled, the cursor's too.
const settled = (keys: string) => settleNames(type(keys), { cursorAway: true }).root

// Every atom at any depth, in order, with its value (symbols) or kind.
function allAtoms(root: Row): Array<{ id: string; text: string }> {
  return root.flatMap((atom) => [
    { id: atom.id, text: atom.kind === 'symbol' ? atom.value : atom.kind },
    ...childRows(atom).flatMap(([, child]) => allAtoms(child)),
  ])
}

// The variable each atom is part of: "x→x" for a variable's atom, "+→-" for
// any other.
const clicks = (root: Row) =>
  allAtoms(root).map(({ id, text }) => `${text}→${variableAtAtom(root, id) ?? '-'}`)

// The line's variables, as in the equations-change event.
const variables = (root: Row) => equationLine('line-1', root, parseRow(root)).variables

describe('variableAtAtom', () => {
  it('names the variable for every atom of a name, nothing for the rest', () => {
    const root = settled('Vm=2*Vm_init+g')
    expect(clicks(root)).toEqual([
      'V→Vm',
      'm→Vm',
      '=→-',
      '2→-',
      '·→-',
      'V→Vm_init',
      'm→Vm_init',
      '_→Vm_init',
      'i→Vm_init',
      'n→Vm_init',
      'i→Vm_init',
      't→Vm_init',
      '+→-',
      'g→g',
    ])
  })

  it("spells the name as the line's variables do", () => {
    const root = settled('alpha_m+g_Kr__max*Ca_2plus+q_bar')
    const names = new Set(allAtoms(root).map(({ id }) => variableAtAtom(root, id)))
    names.delete(null)
    expect([...names]).toEqual(variables(root))
    expect(variables(root)).toEqual(['alpha_m', 'g_Kr__max', 'Ca_2plus', 'q_bar'])
  })

  it('a function name, a constant, a number and its units are not variables', () => {
    // Nor the "e" of a number in scientific notation, with a variable e too.
    const root = settled('y=sin(x)+pi+2{mV}+1e-3+e')
    const named = allAtoms(root)
      .map(({ id }) => variableAtAtom(root, id))
      .filter(Boolean)
    expect(named).toEqual(['y', 'x', 'e'])
    expect(variables(root)).toEqual(['y', 'x', 'e'])
  })

  it('a number in scientific notation is not underlined for a units issue on e', () => {
    const root = settled('y=1e-3+e')
    const marks = unitsIssueMarks(root, [
      { lineId: 'line-1', message: 'e has no units', variables: ['e'] },
    ])
    const text = new Map(allAtoms(root).map(({ id, text }) => [id, text]))
    // Only the variable e, not the e of 1e-3.
    expect(marks.map((mark) => mark.atomIds.map((id) => text.get(id)))).toEqual([['e']])
    expect(marks[0].atomIds).toEqual([root[root.length - 1].id])
  })

  it("names the variables of a line with problems, as the line's variables have them", () => {
    for (const keys of ['V_m=', 'V_m=(g_K*', 'V_m=g_K**2']) {
      const root = settled(keys)
      const names = new Set(allAtoms(root).map(({ id }) => variableAtAtom(root, id)))
      names.delete(null)
      expect(parseRow(root).diagnostics.length).toBeGreaterThan(0)
      expect([...names]).toEqual(variables(root))
    }
    expect(variables(settled('V_m=(g_K*'))).toEqual(['V_m', 'g_K'])
  })

  it('finds names inside structures: fractions, exponents, derivatives', () => {
    const root = settled('a/b+c^d')
    expect(clicks(root).filter((c) => !c.endsWith('-'))).toEqual(['a→a', 'b→b', 'c→c', 'd→d'])
    expect(variables(root)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('a Greek letter alone is a variable, as the parser has it', () => {
    const root: Row = [symbol('tau'), ...row('=1')]
    expect(variableAtAtom(root, root[0].id)).toBe('tau')
    expect(variables(root)).toEqual(['tau'])
  })

  it('an unknown atom id is nothing', () => {
    expect(variableAtAtom(settled('x=1'), 'nope')).toBeNull()
  })
})

// What the field draws: the element a click lands on leads to the atom
// MathField reports (MathField's atomAt), and that atom to the variable.
describe('a click on the drawn equation', () => {
  const draw = (root: Row, typesetNames = true) => {
    const el = document.createElement('div')
    el.innerHTML = katex.renderToString(rowToLatex(root, { typesetNames }), KATEX_EDITOR_OPTIONS)
    return el
  }
  const atomAt = (target: Element) => {
    const el = target.closest<HTMLElement>('[data-atom], [data-name]')
    return el?.dataset.atom ?? el?.dataset.name ?? null
  }
  // The variable for a click on each painted glyph (a leaf with text).
  const glyphClicks = (root: Row, typesetNames = true) =>
    Array.from(draw(root, typesetNames).querySelectorAll('span'))
      .filter(
        (span) => span.children.length === 0 && span.textContent?.replace(/\u200b/g, '').trim(),
      )
      .map((span) => {
        const id = atomAt(span)
        return `${span.textContent}→${(id && variableAtAtom(root, id)) ?? '-'}`
      })

  it('a typeset name with a subscript and superscript is the whole name', () => {
    const root = settled('g_Kr__max=1')
    expect(glyphClicks(root)).toEqual([
      'g→g_Kr__max',
      'K→g_Kr__max',
      'r→g_Kr__max',
      'm→g_Kr__max',
      'a→g_Kr__max',
      'x→g_Kr__max',
      '=→-',
      '1→-',
    ])
  })

  it('a gap in a typeset name with nothing drawn is still the name', () => {
    const root = settled('V_m=1')
    const name = draw(root).querySelector<HTMLElement>('[data-name]')!
    expect(variableAtAtom(root, atomAt(name)!)).toBe('V_m')
  })

  it('drawn as typed, every glyph of a name is the name', () => {
    const root = settled('V_m+sin(x)')
    expect(glyphClicks(root, false)).toEqual([
      'V→V_m',
      '_→V_m',
      'm→V_m',
      '+→-',
      's→-',
      'i→-',
      'n→-',
      '(→-',
      'x→x',
      ')→-',
    ])
  })
})
