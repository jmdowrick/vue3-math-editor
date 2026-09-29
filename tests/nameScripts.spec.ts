import { describe, expect, it } from 'vitest'

import { nameAtoms } from '../src/editor/names'
import { nameScripts } from '../src/editor/nameScripts'

// A name's scripts as text: "g _{Kr} ^{max}", or null when drawn as typed.
function scripts(name: string, options = {}): string | null {
  const values = nameAtoms(name, options).map((atom) => (atom as { value: string }).value)
  const found = nameScripts(values)
  if (!found) return null
  const text = ([start, end]: readonly [number, number]) => values.slice(start, end).join('')
  return [
    text(found.base),
    ...found.parts.map((part) => `${part.role === 'sub' ? '_' : '^'}{${text(part.text)}}`),
  ].join(' ')
}

describe('nameScripts', () => {
  it('reads one underscore as a subscript and two as a superscript', () => {
    expect(scripts('V_m')).toBe('V _{m}')
    expect(scripts('C_Ca_i')).toBe('C _{Ca} _{i}')
    expect(scripts('g_Kr__max')).toBe('g _{Kr} ^{max}')
    expect(scripts('k__max')).toBe('k ^{max}')
    expect(scripts('x__a_b')).toBe('x ^{a} _{b}')
    expect(scripts('Vm_init')).toBe('Vm _{init}')
    expect(scripts('x_12')).toBe('x _{12}')
  })

  it('takes a Greek letter as one part', () => {
    expect(scripts('alpha_m')).toBe('alpha _{m}')
    expect(scripts('beta_n__inf')).toBe('beta _{n} ^{inf}')
    expect(scripts('V_alpha')).toBe('V _{alpha}')
    expect(scripts('x__tau2')).toBe('x ^{tau2}')
    expect(scripts('alpha_m', { greekNames: false })).toBe('alpha _{m}')
  })

  it('leaves a name without scripts, or one drawn as typed', () => {
    expect(scripts('Vm')).toBeNull()
    expect(scripts('a___b')).toBeNull()
    expect(scripts('Ca___i')).toBeNull()
    expect(scripts('V_')).toBeNull()
    expect(scripts('V__')).toBeNull()
    expect(nameScripts(['_', 'x'])).toBeNull()
  })

  it('gives the atoms of each part', () => {
    // g _ K r _ _ m a x
    expect(nameScripts(Array.from('g_Kr__max'))).toEqual({
      base: [0, 1],
      parts: [
        { role: 'sub', separator: [1, 2], text: [2, 4] },
        { role: 'sup', separator: [4, 6], text: [6, 9] },
      ],
    })
  })
})
