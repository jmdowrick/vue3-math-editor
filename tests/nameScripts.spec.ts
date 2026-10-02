import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { nameAtoms } from '../src/editor/names'
import {
  LATEX_ACCENTS,
  NAME_ACCENTS,
  accentForMark,
  chargeFromText,
  chargeWord,
  isNameKeyword,
  keywordSlot,
  nameScripts,
} from '../src/editor/nameScripts'

const here = dirname(fileURLToPath(import.meta.url))

// A name's scripts as text: "g _{Kr} ^{max}", with each decoration as
// "~keyword" after the base ("q ~bar _{i} ^{Glc}"), or null when drawn as
// typed.
function scripts(name: string, options = {}): string | null {
  const values = nameAtoms(name, options).map((atom) => (atom as { value: string }).value)
  const found = nameScripts(values)
  if (!found) return null
  const text = ([start, end]: readonly [number, number]) => values.slice(start, end).join('')
  const decorations = [found.accent, found.charge, found.conc].filter((d) => d !== undefined)
  return [
    text(found.base),
    ...decorations.map((decoration) => `~${text(decoration.text)}`),
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

  it('gives the atoms of each decoration, and no parts when there are only decorations', () => {
    // x _ b a r
    expect(nameScripts(Array.from('x_bar'))).toEqual({
      base: [0, 1],
      accent: { separator: [1, 2], text: [2, 5], kind: 'bar' },
      parts: [],
    })
    // C a _ 2 p l u s _ c o n c _ i
    expect(nameScripts(Array.from('Ca_2plus_conc_i'))).toEqual({
      base: [0, 2],
      charge: { separator: [2, 3], text: [3, 8], count: 2, sign: '+' },
      conc: { separator: [8, 9], text: [9, 13] },
      parts: [{ role: 'sub', separator: [13, 14], text: [14, 15] }],
    })
    expect(nameScripts(Array.from('Cl_minus'))?.charge).toEqual({
      separator: [2, 3],
      text: [3, 8],
      count: 1,
      sign: '-',
    })
    expect(nameScripts(Array.from('x_12minus'))?.charge).toMatchObject({ count: 12, sign: '-' })
  })
})

describe('decorated names', () => {
  it('reads accents, charges and concentrations straight after the base', () => {
    expect(scripts('q_bar_i__Glc')).toBe('q ~bar _{i} ^{Glc}')
    expect(scripts('kappa_hat_m__GLUT2')).toBe('kappa ~hat _{m} ^{GLUT2}')
    expect(scripts('x_tilde')).toBe('x ~tilde')
    expect(scripts('x_check')).toBe('x ~check')
    expect(scripts('Glc_bar')).toBe('Glc ~bar')
    expect(scripts('Glc_conc_i')).toBe('Glc ~conc _{i}')
    expect(scripts('Ca_2plus')).toBe('Ca ~2plus')
    expect(scripts('Na_plus')).toBe('Na ~plus')
    expect(scripts('Cl_minus')).toBe('Cl ~minus')
    expect(scripts('Ca_2plus_conc_i')).toBe('Ca ~2plus ~conc _{i}')
    expect(scripts('Ca_2plus__max')).toBe('Ca ~2plus ^{max}')
    expect(scripts('Ca_10plus')).toBe('Ca ~10plus')
    expect(scripts('q_bar_2plus_conc_i')).toBe('q ~bar ~2plus ~conc _{i}')
    expect(scripts('x_bar__max')).toBe('x ~bar ^{max}')
    // Charges go on any base.
    expect(scripts('k_plus')).toBe('k ~plus')
    expect(scripts('alpha_minus')).toBe('alpha ~minus')
  })

  it('a digit superscript is an ordinary part', () => {
    expect(scripts('kappa_m__1')).toBe('kappa _{m} ^{1}')
    expect(scripts('x_a__12')).toBe('x _{a} ^{12}')
  })

  it('the first part that isn’t a keyword in order closes the zone', () => {
    expect(scripts('g_Na_bar')).toBe('g _{Na} _{bar}')
    expect(scripts('x_i_bar')).toBe('x _{i} _{bar}')
    expect(scripts('x_hat_bar')).toBe('x ~hat _{bar}')
    expect(scripts('x_bar_bar')).toBe('x ~bar _{bar}')
    expect(scripts('Ca_conc_2plus')).toBe('Ca ~conc _{2plus}')
    expect(scripts('x_plus_minus')).toBe('x ~plus _{minus}')
    expect(scripts('x_conc_bar')).toBe('x ~conc _{bar}')
    expect(scripts('x_conc_conc')).toBe('x ~conc _{conc}')
    // A superscript is never a decoration, and closes the zone too.
    expect(scripts('x__bar')).toBe('x ^{bar}')
    expect(scripts('x__bar_hat')).toBe('x ^{bar} _{hat}')
    expect(scripts('x__max_bar')).toBe('x ^{max} _{bar}')
  })

  it('only whole lowercase keywords, and no 1 or leading 0 before a charge', () => {
    expect(scripts('Ca_1plus')).toBe('Ca _{1plus}')
    expect(scripts('Ca_02plus')).toBe('Ca _{02plus}')
    expect(scripts('Ca_0plus')).toBe('Ca _{0plus}')
    expect(scripts('x_Bar')).toBe('x _{Bar}')
    expect(scripts('x_HAT')).toBe('x _{HAT}')
    expect(scripts('x_Plus')).toBe('x _{Plus}')
    expect(scripts('x_barn')).toBe('x _{barn}')
    expect(scripts('x_bar2')).toBe('x _{bar2}')
    expect(scripts('x_concs')).toBe('x _{concs}')
    expect(scripts('x_2plusx')).toBe('x _{2plusx}')
  })

  it('the base is never a keyword', () => {
    expect(scripts('bar')).toBeNull()
    expect(scripts('conc_Ca')).toBe('conc _{Ca}')
    expect(scripts('plus_x')).toBe('plus _{x}')
    expect(scripts('bar_hat')).toBe('bar ~hat')
  })

  it('a base that spells a function has no decorations', () => {
    expect(scripts('sin_bar')).toBe('sin _{bar}')
    expect(scripts('exp_hat')).toBe('exp _{hat}')
    expect(scripts('max_bar')).toBe('max _{bar}')
    expect(scripts('ln_conc')).toBe('ln _{conc}')
    expect(scripts('arcsin_plus')).toBe('arcsin _{plus}')
    // A longer word containing one is just a name.
    expect(scripts('sinx_bar')).toBe('sinx ~bar')
  })

  it('a Greek base is one atom, with Greek names on or off', () => {
    expect(nameScripts(['kappa', '_', 'h', 'a', 't'])).toEqual({
      base: [0, 1],
      accent: { separator: [1, 2], text: [2, 5], kind: 'hat' },
      parts: [],
    })
    expect(scripts('kappa_hat')).toBe('kappa ~hat')
    expect(scripts('alpha_hat', { greekNames: false })).toBe('alpha ~hat')
    expect(nameScripts(Array.from('alpha_hat'))?.base).toEqual([0, 5])
    // A constant's name is kept as letters (pi_hat), and decorated the same.
    expect(scripts('pi_hat')).toBe('pi ~hat')
  })

  it('is drawn as typed with three underscores or a trailing one', () => {
    expect(scripts('a___bar')).toBeNull()
    expect(scripts('x_bar_')).toBeNull()
    expect(scripts('x_bar__')).toBeNull()
    expect(scripts('Ca_2plus___i')).toBeNull()
  })

  it('decorates no name in a real model', () => {
    const xml = readFileSync(join(here, 'resources', 'SN_soma.xml'), 'utf8')
    const names = [...new Set(Array.from(xml.matchAll(/<ci>\s*([^<\s]+)\s*<\/ci>/g), (m) => m[1]))]
    expect(names.length).toBeGreaterThan(100)
    const decorated = names.filter((name) => {
      const values = nameAtoms(name).map((atom) => (atom as { value: string }).value)
      const found = nameScripts(values)
      return !!(found?.accent || found?.charge || found?.conc)
    })
    expect(decorated).toEqual([])
  })
})

describe('name keywords', () => {
  it('gives each keyword its slot', () => {
    for (const accent of ['bar', 'hat', 'tilde', 'check']) expect(keywordSlot(accent)).toBe(0)
    for (const charge of ['plus', 'minus', '2plus', '9minus', '10plus', '123minus']) {
      expect(keywordSlot(charge)).toBe(1)
    }
    expect(keywordSlot('conc')).toBe(2)
    for (const word of ['', 'Bar', 'overline', '1plus', '0minus', '02plus', 'plus2', 'dot']) {
      expect(keywordSlot(word)).toBeNull()
      expect(isNameKeyword(word)).toBe(false)
    }
    expect(isNameKeyword('tilde')).toBe(true)
    expect(isNameKeyword('3minus')).toBe(true)
  })

  it('holds every accent’s spellings in one table', () => {
    expect(Object.keys(NAME_ACCENTS)).toEqual(['bar', 'hat', 'tilde', 'check'])
    expect(NAME_ACCENTS.bar).toMatchObject({ latex: 'bar', wide: 'overline', mathml: '¯' })
    expect(NAME_ACCENTS.check).toMatchObject({ wide: 'widecheck', copyWide: 'check', mathml: 'ˇ' })
    for (const [kind, accent] of Object.entries(NAME_ACCENTS)) {
      expect(keywordSlot(kind)).toBe(0)
      expect(accent.latex).toBe(kind)
      expect(accentForMark(accent.mathml)).toBe(kind)
    }
  })

  it('reads LaTeX accent commands, narrow and wide', () => {
    expect({ ...LATEX_ACCENTS }).toEqual({
      bar: 'bar',
      overline: 'bar',
      hat: 'hat',
      widehat: 'hat',
      tilde: 'tilde',
      widetilde: 'tilde',
      check: 'check',
      widecheck: 'check',
    })
    expect('toString' in LATEX_ACCENTS).toBe(false)
    expect('dot' in LATEX_ACCENTS).toBe(false)
  })

  it('reads combining and spacing marks as accents', () => {
    for (const mark of ['̅', '̄', '¯', '‾']) expect(accentForMark(mark)).toBe('bar')
    for (const mark of ['̂', '^', 'ˆ']) expect(accentForMark(mark)).toBe('hat')
    for (const mark of ['̃', '~', '˜']) expect(accentForMark(mark)).toBe('tilde')
    for (const mark of ['̌', 'ˇ']) expect(accentForMark(mark)).toBe('check')
    // Dot and prime are not keywords.
    for (const mark of ['̇', '̈', '′', "'", 'x', '']) expect(accentForMark(mark)).toBeNull()
  })

  it('writes charges as keywords', () => {
    expect(chargeWord(1, '+')).toBe('plus')
    expect(chargeWord(1, '-')).toBe('minus')
    expect(chargeWord(2, '+')).toBe('2plus')
    expect(chargeWord(3, '-')).toBe('3minus')
    expect(chargeWord(12, '+')).toBe('12plus')
  })

  it('reads charges as written in a superscript', () => {
    expect(chargeFromText('2+')).toEqual({ count: 2, sign: '+' })
    expect(chargeFromText('+')).toEqual({ count: 1, sign: '+' })
    expect(chargeFromText('-')).toEqual({ count: 1, sign: '-' })
    expect(chargeFromText('−')).toEqual({ count: 1, sign: '-' })
    expect(chargeFromText('2−')).toEqual({ count: 2, sign: '-' })
    expect(chargeFromText('1+')).toEqual({ count: 1, sign: '+' })
    expect(chargeFromText('12-')).toEqual({ count: 12, sign: '-' })
    expect(chargeFromText('++')).toEqual({ count: 2, sign: '+' })
    expect(chargeFromText('−−')).toEqual({ count: 2, sign: '-' })
    expect(chargeFromText('---')).toEqual({ count: 3, sign: '-' })
    for (const text of ['+2', '-1', '0+', '02+', '', '2', 'x', '+-', '2+3', '2++', '+2+']) {
      expect(chargeFromText(text)).toBeNull()
    }
  })

  it('a charge read from text is written as a charge keyword', () => {
    for (const text of ['+', '2+', '1+', '−', '3-', '++', '10+']) {
      const charge = chargeFromText(text)!
      const word = chargeWord(charge.count, charge.sign)
      expect(keywordSlot(word)).toBe(1)
      expect(nameScripts(Array.from(`Ca_${word}`))?.charge).toMatchObject(charge)
    }
  })
})
