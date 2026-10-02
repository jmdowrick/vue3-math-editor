// Characters of maths written as Unicode, as Word and Presentation MathML
// write it, and what each is in the editor: Greek letters (the editor's
// Greek atoms, identifiers.ts GREEK_NAMES), operators and constants.
//
// Greek letters follow TeX's names for the variants, as Word's own maths
// autocorrect does: \epsilon is ϵ (U+03F5) and \varepsilon ε (U+03B5); \phi
// is ϕ (U+03D5) and \varphi φ (U+03C6); \vartheta is ϑ. The capital letters
// that look like Latin ones (Α, Β, Ε, …) have no name of their own and are
// read as those Latin letters.

import { GREEK_NAMES } from './identifiers'

// prettier-ignore
const GREEK: ReadonlyArray<[name: string, character: string]> = [
  ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['epsilon', 'ϵ'],
  ['varepsilon', 'ε'], ['zeta', 'ζ'], ['eta', 'η'], ['theta', 'θ'], ['vartheta', 'ϑ'],
  ['iota', 'ι'], ['kappa', 'κ'], ['lambda', 'λ'], ['mu', 'μ'], ['nu', 'ν'], ['xi', 'ξ'],
  ['pi', 'π'], ['rho', 'ρ'], ['sigma', 'σ'], ['tau', 'τ'], ['upsilon', 'υ'], ['phi', 'ϕ'],
  ['varphi', 'φ'], ['chi', 'χ'], ['psi', 'ψ'], ['omega', 'ω'], ['Gamma', 'Γ'], ['Delta', 'Δ'],
  ['Theta', 'Θ'], ['Lambda', 'Λ'], ['Xi', 'Ξ'], ['Pi', 'Π'], ['Sigma', 'Σ'], ['Upsilon', 'Υ'],
  ['Phi', 'Φ'], ['Psi', 'Ψ'], ['Omega', 'Ω'],
]

const CHARACTER_OF_NAME = new Map(GREEK.filter(([name]) => GREEK_NAMES.has(name)))

const NAME_OF_CHARACTER = new Map<string, string>([
  ...GREEK.map(([name, character]): [string, string] => [character, name]),
  // Other forms of the same letters.
  ['ς', 'sigma'],
  ['ϱ', 'rho'],
  ['ϖ', 'pi'],
  ['µ', 'mu'], // the micro sign
])

// Capital Greek letters written as their Latin twins, and omicron.
const LATIN_TWINS: Record<string, string> = {
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P',
  Τ: 'T', Χ: 'X', ο: 'o',
} // prettier-ignore

// The editor's Greek atom (its name) for a Greek character, if it is one.
// π is the constant pi, as the editor's \pi is.
export const greekName = (character: string): string | undefined => NAME_OF_CHARACTER.get(character)

// The character for a Greek atom's name ("alpha" -> "α").
export const greekCharacter = (name: string): string | undefined => CHARACTER_OF_NAME.get(name)

// Characters that are operators, as the editor's symbol for each.
const OPERATORS: Record<string, string> = {
  '+': '+',
  '-': '-',
  '−': '-',
  '–': '-',
  '=': '=',
  ',': ',',
  '<': '<',
  '>': '>',
  '≤': '≤',
  '⩽': '≤',
  '≥': '≥',
  '⩾': '≥',
  '≠': '≠',
  '∧': '∧',
  '∨': '∨',
  '⊻': '⊻',
  '¬': '¬',
  '×': '×',
  '·': '·',
  '⋅': '·',
  '∙': '·',
  '*': '·',
  '∗': '·',
  // Invisible times, as Presentation MathML may write a product.
  '⁢': '·',
}

export const operatorSymbol = (character: string): string | undefined => OPERATORS[character]

// Characters that are constants, as the editor's constant symbol for each.
const CONSTANTS: Record<string, string> = {
  π: 'pi',
  '∞': 'infinity',
  ⅇ: 'exponentiale',
}

export const constantSymbol = (character: string): string | undefined => CONSTANTS[character]

// Function application (U+2061): what Presentation MathML and Word's linear
// format put between a function's name and its argument.
export const FUNCTION_APPLICATION = '⁡'
// Word's differential d (U+2146), as Word writes \dd: unambiguous, unlike d.
export const DIFFERENTIAL_D = 'ⅆ'
export const PARTIAL = '∂'

// Spaces of every width, which maths text doesn't need.
export const isSpace = (character: string) => /^[\s  -​ 　]$/u.test(character)

// A letter, digit or Greek letter from the Mathematical Alphanumeric Symbols
// block (𝑥, 𝐱, 𝛼, as Word's linear format and some MathML write them), and
// ℎ, as the plain character, with whether it was italic. Anything else is
// returned as it is. Only that block: a blanket NFKC normalisation would also
// turn ² into 2 and ⅆ into d.
export function plainCharacter(character: string): { character: string; italic: boolean | null } {
  const code = character.codePointAt(0) ?? 0
  if (character === 'ℎ') return { character: 'h', italic: true }
  if (code < 0x1d400 || code > 0x1d7ff) {
    const twin = LATIN_TWINS[character]
    return { character: twin ?? character, italic: null }
  }
  const plain = character.normalize('NFKC')
  // The italic and bold italic alphabets (Latin and Greek).
  const italic = (code >= 0x1d434 && code <= 0x1d49b) || (code >= 0x1d6e2 && code <= 0x1d755)
  return { character: plain, italic }
}

// Superscript digits (², ³, …) as the digits.
const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8',
  '⁹': '9',
} // prettier-ignore

export const superscriptDigit = (character: string): string | undefined =>
  SUPERSCRIPT_DIGITS[character]

// Primes, as derivatives are sometimes written (V′, V″).
export const isPrime = (character: string) => /^[′″‴'’]$/.test(character)
