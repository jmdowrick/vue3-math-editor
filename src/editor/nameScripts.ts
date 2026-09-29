// Typeset names: underscores in a name mark its subscripts and superscripts.
//
// - The base is the name up to its first underscore.
// - "_part" adds a subscript, "__part" a superscript. Several of either are
//   written one after another, separated by commas: C_Ca_i is C with the
//   subscript "Ca, i"; g_Kr__max is g with the subscript Kr and the
//   superscript max.
// - A name with three or more underscores in a row, or ending with one (it is
//   still being typed), is drawn as typed.
//
// The name itself (what the equation exports, <ci>g_Kr__max</ci>) is the
// same either way; only how it is drawn changes. It is worked out on the
// name's atoms, not its text, so a Greek letter is one part of it (alpha_m is
// α, _, m) and every atom can still be tagged for the caret.

export type Range = readonly [start: number, end: number]

export interface NamePart {
  role: 'sub' | 'sup'
  // The underscores before the part.
  separator: Range
  text: Range
}

export interface NameScripts {
  base: Range
  // In the order written.
  parts: NamePart[]
}

// A name's base and scripts, as atom index ranges of `values` (the name's
// atom values), or null if the name has no scripts or is drawn as typed.
export function nameScripts(values: readonly string[]): NameScripts | null {
  const first = values.indexOf('_')
  if (first <= 0) return null

  const parts: NamePart[] = []
  let i = first

  while (i < values.length) {
    const separator = i
    while (i < values.length && values[i] === '_') i++
    const count = i - separator
    if (count > 2) return null

    const text = i
    while (i < values.length && values[i] !== '_') i++
    if (i === text) return null // ends with an underscore

    parts.push({ role: count === 1 ? 'sub' : 'sup', separator: [separator, text], text: [text, i] })
  }

  return { base: [0, first], parts }
}
