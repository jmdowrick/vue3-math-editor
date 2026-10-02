// Typeset names: underscores in a name mark its subscripts and superscripts,
// and a few keywords straight after its first word decorate it.
//
// - The base is the name up to its first underscore.
// - "_part" adds a subscript, "__part" a superscript. Several of either are
//   written one after another, separated by commas: C_Ca_i is C with the
//   subscript "Ca, i"; g_Kr__max is g with the subscript Kr and the
//   superscript max.
// - A name with three or more underscores in a row, or ending with one (it is
//   still being typed), is drawn as typed.
//
// CellML names are only letters, digits and underscores, so a decorated
// symbol is spelled with keyword parts, the way alpha is drawn α:
//
// - an accent: x_bar is x̄, kappa_hat κ̂, x_tilde x̃, x_check x̌;
// - a charge: Ca_2plus is Ca²⁺, Na_plus Na⁺, Cl_minus Cl⁻;
// - a concentration: Glc_conc is [Glc].
//
// They make up the decoration zone: the single-underscore parts straight
// after the base that are keywords, in that order (accent, then charge, then
// conc), each at most once. The first part that isn't (another word, a
// superscript, or a keyword out of order) closes the zone; it and every part
// after it are ordinary scripts, keyword or not. So q_bar_i__Glc is q̄ with
// the subscript i and the superscript Glc, Ca_2plus_conc_i is [Ca²⁺] with
// the subscript i, but g_Na_bar is g with the subscript "Na, bar" and
// Ca_conc_2plus is [Ca] with the subscript 2plus. Keywords are lowercase, the
// base is never one, and a base that spells a function (sin_bar) has no zone,
// so that it reads back as the same variable.
//
// Every drawing has one spelling, so a name copied and pasted back (as LaTeX,
// or into Word and out again) is the same name.
//
// The name itself (what the equation exports, <ci>g_Kr__max</ci>) is the
// same either way; only how it is drawn changes. It is worked out on the
// name's atoms, not its text, so a Greek letter is one part of it (alpha_m is
// α, _, m) and every atom can still be tagged for the caret.

import { functionForSpelling } from './identifiers'

export type Range = readonly [start: number, end: number]

export interface NamePart {
  role: 'sub' | 'sup'
  // The underscores before the part.
  separator: Range
  text: Range
}

export type NameAccent = 'bar' | 'hat' | 'tilde' | 'check'

// A keyword part in the decoration zone.
export interface NameDecoration {
  // The underscore before the keyword.
  separator: Range
  text: Range
}

export interface NameScripts {
  base: Range
  accent?: NameDecoration & { kind: NameAccent }
  // count is 1 for plus and minus.
  charge?: NameDecoration & { count: number; sign: '+' | '-' }
  conc?: NameDecoration
  // The ordinary scripts, in the order written.
  parts: NamePart[]
}

// Each accent as every side writes and reads it.
export const NAME_ACCENTS: Readonly<
  Record<
    NameAccent,
    {
      // LaTeX over one letter.
      latex: string
      // Drawn over a longer base.
      wide: string
      // LaTeX copy over a longer base (\widecheck isn't core LaTeX).
      copyWide: string
      // The spacing mark written into Word's MathML.
      mathml: string
      // The marks (combining or spacing) read as this accent on paste.
      marks: readonly string[]
    }
  >
> = {
  bar: {
    latex: 'bar',
    wide: 'overline',
    copyWide: 'overline',
    mathml: '¯',
    marks: ['̅', '̄', '¯', '‾'],
  },
  hat: {
    latex: 'hat',
    wide: 'widehat',
    copyWide: 'widehat',
    mathml: '^',
    marks: ['̂', '^', 'ˆ'],
  },
  tilde: {
    latex: 'tilde',
    wide: 'widetilde',
    copyWide: 'widetilde',
    mathml: '~',
    marks: ['̃', '~', '˜'],
  },
  check: {
    latex: 'check',
    wide: 'widecheck',
    copyWide: 'check',
    mathml: 'ˇ',
    marks: ['̌', 'ˇ'],
  },
}

const ACCENTS = Object.keys(NAME_ACCENTS) as NameAccent[]

// LaTeX accent commands (without the backslash) -> the accent: \bar and
// \overline are both bar. It has no prototype, so `name in LATEX_ACCENTS` is
// only true for these.
export const LATEX_ACCENTS: Readonly<Record<string, NameAccent>> = Object.freeze(
  Object.assign(
    Object.create(null) as Record<string, NameAccent>,
    Object.fromEntries(
      ACCENTS.flatMap((kind) => [
        [NAME_ACCENTS[kind].latex, kind],
        [NAME_ACCENTS[kind].wide, kind],
      ]),
    ),
  ),
)

// The accent a mark over a letter stands for, if any: U+0304 (combining
// macron) is bar, ^ is hat.
export function accentForMark(mark: string): NameAccent | null {
  return ACCENTS.find((kind) => NAME_ACCENTS[kind].marks.includes(mark)) ?? null
}

// A charge keyword: plus, minus, or a count of 2 or more before either
// (2plus, 12minus). 1plus and 02plus are not charges.
const CHARGE_WORD = /^([2-9]|[1-9][0-9]+)?(plus|minus)$/

// The decoration slot a word fills, if it is a keyword: 0 for an accent, 1
// for a charge, 2 for conc.
export function keywordSlot(word: string): 0 | 1 | 2 | null {
  if ((ACCENTS as string[]).includes(word)) return 0
  if (CHARGE_WORD.test(word)) return 1
  if (word === 'conc') return 2
  return null
}

export const isNameKeyword = (word: string): boolean => keywordSlot(word) !== null

// The keyword for a charge: 1, '+' is plus; 2, '+' is 2plus.
export function chargeWord(count: number, sign: '+' | '-'): string {
  return `${count === 1 ? '' : count}${sign === '+' ? 'plus' : 'minus'}`
}

// A charge as written in a superscript: a count then one sign (2+, 2−, 1+),
// or signs alone (+, −, ++). Null for anything else, a sign before the count
// (+2, -1, which are powers) or a count of 0 (0+, 02+).
export function chargeFromText(text: string): { count: number; sign: '+' | '-' } | null {
  const match = /^(?:([1-9][0-9]*)([+\-−])|([+\-−])\3*)$/.exec(text.trim())
  if (!match) return null
  const [whole, digits, countedSign, sign] = match
  return {
    count: digits ? Number(digits) : whole.length,
    sign: (countedSign ?? sign) === '+' ? '+' : '-',
  }
}

// A name's base, decorations and scripts, as atom index ranges of `values`
// (the name's atom values), or null if the name has no scripts or
// decorations, or is drawn as typed.
export function nameScripts(values: readonly string[]): NameScripts | null {
  const first = values.indexOf('_')
  if (first <= 0) return null

  // The parts after the base: each a run of underscores, then a word.
  const segments: Array<{ count: number; separator: Range; text: Range }> = []
  let i = first

  while (i < values.length) {
    const separator = i
    while (i < values.length && values[i] === '_') i++
    const count = i - separator
    if (count > 2) return null

    const text = i
    while (i < values.length && values[i] !== '_') i++
    if (i === text) return null // ends with an underscore

    segments.push({ count, separator: [separator, text], text: [text, i] })
  }

  const scripts: NameScripts = { base: [0, first], parts: [] }
  const word = ([start, end]: Range) => values.slice(start, end).join('')

  // The decoration zone: keywords in increasing slot order, from the first
  // part on. A function's spelling as the base has none.
  let slot = functionForSpelling(word(scripts.base)) ? 3 : 0
  for (const { count, separator, text } of segments) {
    const keyword = word(text)
    const found = count === 1 ? keywordSlot(keyword) : null
    if (found === null || found < slot) {
      slot = 3
      scripts.parts.push({ role: count === 1 ? 'sub' : 'sup', separator, text })
      continue
    }

    slot = found + 1
    if (found === 0) scripts.accent = { separator, text, kind: keyword as NameAccent }
    else if (found === 2) scripts.conc = { separator, text }
    else {
      const [, digits, sign] = CHARGE_WORD.exec(keyword)!
      scripts.charge = {
        separator,
        text,
        count: digits ? Number(digits) : 1,
        sign: sign === 'plus' ? '+' : '-',
      }
    }
  }

  return scripts
}
