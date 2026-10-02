import { describe, expect, it } from 'vitest'

import { latexToRow, rowToLatexSource } from '../src/editor/clipboard'
import { describeCursor } from '../src/editor/cursor'
import { contentMathML } from '../src/editor/exports'
import { isOneName, nameRuns } from '../src/editor/identifiers'
import { type Row, func, row, symbol } from '../src/editor/layout'
import { importContentMathML } from '../src/editor/mathmlImport'
import { nameAtoms, settleNames, withNameKeyword } from '../src/editor/names'
import { nameScripts } from '../src/editor/nameScripts'
import { parseRow } from '../src/editor/parse'
import { rowToLatex } from '../src/renderers/layoutLatex'
import { json, press, show, type } from './editorHelpers'

// The row's atoms as written: a Greek letter or constant atom by its value in
// brackets, typed characters as they are.
const atoms = (root: Row) =>
  root
    .map((atom) =>
      atom.kind === 'symbol' ? (atom.value.length > 1 ? `[${atom.value}]` : atom.value) : '?',
    )
    .join('')
const names = (root: Row) => nameRuns(root).map((run) => run.name)

describe('names with Greek letters', () => {
  it('a Greek letter is a word of a name, joined by _ or followed by digits', () => {
    expect(names([symbol('alpha'), ...row('_m')])).toEqual(['alpha_m'])
    expect(names([...row('m_'), symbol('alpha')])).toEqual(['m_alpha'])
    expect(names([symbol('tau'), ...row('2')])).toEqual(['tau2'])
    // Straight next to a letter it is a name of its own: αx is α·x.
    expect(names([symbol('alpha'), ...row('x')])).toEqual(['alpha', 'x'])
    expect(json({ root: [symbol('alpha'), ...row('x')], cursor: { path: [], offset: 0 } })).toEqual(
      ['Multiply', 'alpha', 'x'],
    )
  })

  it('a typed Greek word becomes the letter once the cursor leaves the name', () => {
    const typing = type('alpha_m')
    expect(atoms(typing.root)).toBe('alpha_m') // still being typed
    const done = press(typing, '+1')
    expect(atoms(done.root)).toBe('[alpha]_m+1')
    expect(show(done)).toBe('alpha_m+1‸')
    expect(json(done)).toEqual(['Add', 'alpha_m', 1])
  })

  it('the caret steps over the letter as one', () => {
    const state = type('tau_m=1')
    const stops: string[] = []
    let at = state
    for (let i = 0; i < 5; i++) {
      at = press(at, 'ArrowLeft')
      stops.push(describeCursor(at.cursor))
    }
    expect(stops).toEqual(['root @ 4', 'root @ 3', 'root @ 2', 'root @ 1', 'root @ 0'])
    expect(atoms(at.root)).toBe('[tau]_m=1')
  })

  it('only whole words, and digits after them, are Greek', () => {
    const settled = (keys: string) => atoms(press(type(keys), '+').root).slice(0, -1)
    expect(settled('alphabet')).toBe('alphabet')
    expect(settled('alpha2')).toBe('[alpha]2')
    expect(settled('beta_eta')).toBe('[beta]_[eta]')
    expect(settled('Delta_t')).toBe('[Delta]_t')
    expect(settled('V_alpha_2')).toBe('V_[alpha]_2')
    expect(settled('Alpha_x')).toBe('Alpha_x') // no such letter
  })

  it('with Greek names off, names stay as typed, and Greek letters are spelled out', () => {
    const typed = type('alpha_m+1').root
    const off = settleNames(
      { root: row('alpha_m+1'), cursor: { path: [], offset: 9 } },
      { greekNames: false },
    )
    expect(atoms(off.root)).toBe('alpha_m+1')
    expect(rowToLatex(typed, { greekNames: false })).toContain('\\mathit{alpha}')
    expect(rowToLatex(typed, { greekNames: false })).not.toContain('\\alpha')
    expect(rowToLatex(typed)).toContain('\\alpha')
    // Both spellings are the same variable.
    expect(contentMathML(typed)).toContain('<ci>alpha_m</ci>')
    expect(contentMathML(row('alpha_m'))).toContain('<ci>alpha_m</ci>')
  })

  it('a line left is settled, the name at the cursor too', () => {
    const state = type('y=alpha')
    expect(atoms(state.root)).toBe('y=alpha')
    const left = settleNames(state, { cursorAway: true })
    expect(atoms(left.root)).toBe('y=[alpha]')
    expect(left.cursor).toEqual({ path: [], offset: 3 })
  })

  it('copies as LaTeX the way it is shown, and pastes back as the same name', () => {
    const root = press(type('alpha_m*tau'), '+').root.slice(0, -1)
    expect(rowToLatexSource(root)).toBe('\\alpha_{m}\\cdot \\tau')
    expect(rowToLatexSource(root, { greekNames: false })).toBe(
      '\\mathit{alpha}_{m}\\cdot \\mathit{tau}',
    )
    expect(rowToLatexSource(root, { typesetNames: false })).toBe('\\alpha \\_m\\cdot \\tau')
    expect(names(latexToRow('\\alpha_{m}'))).toEqual(['alpha_m'])
    expect(names(latexToRow('\\alpha \\_m'))).toEqual(['alpha_m'])
  })

  it('Backspace after a Greek letter deletes it', () => {
    expect(show(press(type('alpha_m+'), 'Backspace', 'ArrowLeft', 'ArrowLeft', 'Backspace'))).toBe(
      '‸_m',
    )
  })
})

describe('reserved names', () => {
  it('a constant’s MathML name typed out is the constant', () => {
    expect(json(type('pi'))).toBe('Pi')
    const done = press(type('2*pi'), '*r')
    expect(atoms(done.root)).toBe('2·[pi]·r')
    expect(json(done)).toEqual(['Multiply', 2, 'Pi', 'r'])
    expect(atoms(press(type('infinity'), '+').root)).toBe('[infinity]+')
    expect(json(type('true'))).toBe('True')
  })

  it('e, and names containing a reserved name, are variables', () => {
    expect(json(type('e'))).toBe('e')
    expect(json(type('pi_m'))).toBe('pi_m')
    expect(json(type('pix'))).toBe('pix')
    expect(atoms(press(type('pi_m'), '+').root)).toBe('pi_m+')
  })

  it('nameAtoms writes names in their settled form', () => {
    expect(atoms(nameAtoms('alpha_m'))).toBe('[alpha]_m')
    expect(atoms(nameAtoms('pi'))).toBe('[pi]')
    expect(atoms(nameAtoms('alpha_m', { greekNames: false }))).toBe('alpha_m')
    expect(parseRow(nameAtoms('tau2')).ast).toEqual({ type: 'Identifier', name: 'tau2' })
  })

  it('Content MathML import writes names settled, and warns of reserved ones', () => {
    const result = importContentMathML(
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>alpha_m</ci><ci>pi</ci></apply></math>',
    )!
    expect(atoms(result.equations[0])).toBe('[alpha]_m=[pi]')
    expect(result.problems).toEqual([
      'The variable pi has a reserved name, so it reads as the constant here',
    ])
  })
})

describe('name keywords', () => {
  // The name with the keyword added, written as atoms(), or null.
  const added = (name: string, keyword: string, options = {}) => {
    const result = withNameKeyword(nameAtoms(name, options), keyword)
    return result && atoms(result)
  }

  it('puts the keyword straight after the base', () => {
    expect(added('q', 'bar')).toBe('q_bar')
    expect(added('q_i', 'bar')).toBe('q_bar_i')
    expect(added('q_i__Glc', 'bar')).toBe('q_bar_i__Glc')
    expect(added('x__max', 'bar')).toBe('x_bar__max')
    expect(added('Ca_i', '2plus')).toBe('Ca_2plus_i')
    expect(added('Glc', 'conc')).toBe('Glc_conc')
    expect(added('Glc_i', 'conc')).toBe('Glc_conc_i')
    expect(added('Na', 'plus')).toBe('Na_plus')
    // An ordinary part that happens to be a keyword stays where it is.
    expect(added('g_Na_bar', 'bar')).toBe('g_bar_Na_bar')
  })

  it('after any decoration of an earlier slot', () => {
    expect(added('q_bar', '2plus')).toBe('q_bar_2plus')
    expect(added('q_bar_i', '2plus')).toBe('q_bar_2plus_i')
    expect(added('Ca_2plus', 'conc')).toBe('Ca_2plus_conc')
    expect(added('Ca_2plus_i', 'conc')).toBe('Ca_2plus_conc_i')
    expect(added('q_bar_i', 'conc')).toBe('q_bar_conc_i')
    expect(added('x_hat_bar', '2plus')).toBe('x_hat_2plus_bar')
  })

  it('on a Greek name, as one atom or spelled out', () => {
    expect(added('kappa_m__GLUT2', 'hat')).toBe('[kappa]_hat_m__GLUT2')
    expect(added('kappa_m', 'hat', { greekNames: false })).toBe('kappa_hat_m')
    expect(added('alpha', 'tilde')).toBe('[alpha]_tilde')
  })

  it('is null when the slot, or a later one, is taken', () => {
    expect(added('x_bar', 'hat')).toBeNull()
    expect(added('x_bar', 'bar')).toBeNull()
    expect(added('Glc_conc', '2plus')).toBeNull()
    expect(added('Glc_conc_i', 'bar')).toBeNull()
    expect(added('Ca_2plus', 'minus')).toBeNull()
    expect(added('Ca_2plus', 'bar')).toBeNull()
    expect(added('Ca_conc_2plus', 'conc')).toBeNull()
  })

  it('is null for a name drawn as typed', () => {
    expect(added('x_bar_', 'conc')).toBeNull()
    expect(added('x_', 'bar')).toBeNull()
    expect(added('a___b', 'bar')).toBeNull()
  })

  it('is null for a word that isn’t a keyword', () => {
    expect(added('x', 'Bar')).toBeNull()
    expect(added('x', 'dot')).toBeNull()
    expect(added('x', '1plus')).toBeNull()
    expect(added('x', '')).toBeNull()
  })

  it('is null for anything but one variable name', () => {
    expect(withNameKeyword([], 'bar')).toBeNull()
    expect(withNameKeyword(row('x+y'), 'bar')).toBeNull()
    expect(withNameKeyword(row('2'), 'bar')).toBeNull()
    expect(withNameKeyword(row('sin'), 'bar')).toBeNull()
    expect(withNameKeyword([func('sin')], 'bar')).toBeNull()
    expect(withNameKeyword([symbol('pi')], 'hat')).toBeNull()
    // A base that spells a function has no decorations.
    expect(added('sin_x', 'bar')).toBeNull()
    // A constant's name typed out is still letters.
    expect(added('pi_m', 'hat')).toBe('pi_hat_m')
  })

  it('keeps the name’s own atoms, and adds new ones for the keyword', () => {
    const name = nameAtoms('Ca_2plus_i')
    const result = withNameKeyword(name, 'conc')!
    expect(result.slice(0, 8)).toEqual(name.slice(0, 8))
    expect(result.slice(-2)).toEqual(name.slice(-2))
    expect(result.slice(0, 8)[0]).toBe(name[0])
    const inserted = result.slice(8, -2)
    expect(atoms(inserted)).toBe('_conc')
    const ids = new Set(name.map((atom) => atom.id))
    expect(inserted.every((atom) => !ids.has(atom.id))).toBe(true)
    expect(new Set(result.map((atom) => atom.id)).size).toBe(result.length)
  })

  it('gives a name read with the keyword as its decoration', () => {
    const result = withNameKeyword(nameAtoms('Ca_i'), '2plus')!
    expect(isOneName(result)).toBe(true)
    expect(names(result)).toEqual(['Ca_2plus_i'])
    const values = result.map((atom) => (atom as { value: string }).value)
    expect(nameScripts(values)?.charge).toMatchObject({ count: 2, sign: '+' })
    expect(contentMathML(result)).toContain('<ci>Ca_2plus_i</ci>')
  })
})

describe('isOneName', () => {
  it('is a row that is exactly one variable name', () => {
    expect(isOneName(row('x'))).toBe(true)
    expect(isOneName(row('q_bar_i__Glc'))).toBe(true)
    expect(isOneName(nameAtoms('kappa_m'))).toBe(true)
    expect(isOneName([])).toBe(false)
    expect(isOneName(row('x+y'))).toBe(false)
    expect(isOneName(row('2x'))).toBe(false)
    expect(isOneName(row('x '))).toBe(false)
    expect(isOneName(row('sin'))).toBe(false)
    expect(isOneName([symbol('alpha'), ...row('x')])).toBe(false)
  })
})
