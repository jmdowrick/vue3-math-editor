import { describe, expect, it } from 'vitest'

import { contentMathML, exportRow, exportRows } from '../src/editor/exports'
import { type Row, derivative, row, symbol } from '../src/editor/layout'
import { readPastedData } from '../src/editor/pasteFormats'
import { readPresentation } from '../src/editor/presentationImport'
import { rowToPresentationMathML } from '../src/renderers/presentationMathml'
import { type } from './editorHelpers'
import { TYPED } from './typedEquations'

// Typed a character at a time ("Vm" isn't a key's name).
const mathml = (text: string) => rowToPresentationMathML(type(...Array.from(text)).root)
const cellml = (root: Row) => contentMathML(root, { cellml: true })

// Read back as pasting it would.
function readBack(text: string) {
  const pasted = readPastedData({ text })
  if (pasted.kind !== 'presentation') throw new Error(`Read as ${pasted.kind}`)
  return readPresentation(pasted.paste)
}

describe('Presentation MathML for Word', () => {
  it('writes names, with their parts typeset', () => {
    expect(mathml('x')).toBe('<mi>x</mi>')
    expect(mathml('Vm')).toBe('<mi mathvariant="italic">Vm</mi>')
    expect(mathml('I_ion')).toBe('<msub><mi>I</mi><mi mathvariant="italic">ion</mi></msub>')
    expect(mathml('C_Ca_i')).toBe(
      '<msub><mi>C</mi><mrow><mi mathvariant="italic">Ca</mi><mo>,</mo><mi>i</mi></mrow></msub>',
    )
    // Superscript parts upright, so they read back as part of the name.
    expect(mathml('g_Kr__max')).toBe(
      '<msubsup><mi>g</mi><mi mathvariant="italic">Kr</mi><mi mathvariant="normal">max</mi></msubsup>',
    )
    expect(mathml('alpha_m')).toBe('<msub><mi>α</mi><mi>m</mi></msub>')
  })

  it('writes decorated names as they are drawn', () => {
    const over = (base: string, mark: string) =>
      `<mover accent="true">${base}<mo>${mark}</mo></mover>`
    const italic = (text: string) => `<mi mathvariant="italic">${text}</mi>`
    const upright = (text: string) => `<mi mathvariant="normal">${text}</mi>`
    const square = (content: string) =>
      `<mfenced open="[" close="]"><mrow>${content}</mrow></mfenced>`

    // An accent over the base, with the scripts outside it.
    expect(mathml('x_bar')).toBe(over('<mi>x</mi>', '¯'))
    expect(mathml('x_tilde')).toBe(over('<mi>x</mi>', '~'))
    expect(mathml('x_check')).toBe(over('<mi>x</mi>', 'ˇ'))
    expect(mathml('Glc_bar')).toBe(over(italic('Glc'), '¯'))
    expect(mathml('q_bar_i__Glc')).toBe(
      `<msubsup>${over('<mi>q</mi>', '¯')}<mi>i</mi>${upright('Glc')}</msubsup>`,
    )
    expect(mathml('kappa_hat_m__GLUT2')).toBe(
      `<msubsup>${over('<mi>κ</mi>', '^')}<mi>m</mi>${upright('GLUT2')}</msubsup>`,
    )

    // A charge first in the superscript, a number then the sign (− for
    // minus), and the superscript parts after a comma.
    expect(mathml('Ca_2plus')).toBe(`<msup>${italic('Ca')}<mrow><mn>2</mn><mo>+</mo></mrow></msup>`)
    expect(mathml('Na_plus')).toBe(`<msup>${italic('Na')}<mo>+</mo></msup>`)
    expect(mathml('Cl_minus')).toBe(`<msup>${italic('Cl')}<mo>−</mo></msup>`)
    expect(mathml('Ca_2plus__max')).toBe(
      `<msup>${italic('Ca')}<mrow><mn>2</mn><mo>+</mo><mo>,</mo>${upright('max')}</mrow></msup>`,
    )
    expect(mathml('Ca_2minus_i')).toBe(
      `<msubsup>${italic('Ca')}<mi>i</mi><mrow><mn>2</mn><mo>−</mo></mrow></msubsup>`,
    )

    // A concentration in square brackets, a charge inside them and the
    // scripts outside.
    expect(mathml('Glc_conc_i')).toBe(`<msub>${square(italic('Glc'))}<mi>i</mi></msub>`)
    expect(mathml('Ca_2plus_conc_i')).toBe(
      `<msub>${square(`<msup>${italic('Ca')}<mrow><mn>2</mn><mo>+</mo></mrow></msup>`)}<mi>i</mi></msub>`,
    )

    // A keyword out of place is an ordinary part.
    expect(mathml('g_Na_bar')).toBe(
      `<msub><mi>g</mi><mrow>${italic('Na')}<mo>,</mo>${italic('bar')}</mrow></msub>`,
    )
    expect(mathml('x_hat_bar')).toBe(`<msub>${over('<mi>x</mi>', '^')}${italic('bar')}</msub>`)
    expect(mathml('Ca_conc_2plus')).toBe(`<msub>${square(italic('Ca'))}${italic('2plus')}</msub>`)

    // Digit superscript parts upright, as parts of the name, not a number.
    expect(mathml('kappa_m__1')).toBe(`<msubsup><mi>κ</mi><mi>m</mi>${upright('1')}</msubsup>`)
    expect(mathml('x_a__12')).toBe(`<msubsup><mi>x</mi><mi>a</mi>${upright('12')}</msubsup>`)
  })

  it('writes numbers, operators and constants', () => {
    expect(mathml('y=2*x-1')).toBe(
      '<mi>y</mi><mo>=</mo><mn>2</mn><mo>⋅</mo><mi>x</mi><mo>−</mo><mn>1</mn>',
    )
    expect(mathml('k=1.5e-08')).toBe(
      '<mi>k</mi><mo>=</mo><mrow><mn>1.5</mn><mo>×</mo><msup><mn>10</mn><mrow><mo>−</mo><mn>08</mn></mrow></msup></mrow>',
    )
    expect(mathml('x<=1')).toBe('<mi>x</mi><mo>≤</mo><mn>1</mn>')
    expect(mathml('a<b')).toBe('<mi>a</mi><mo>&lt;</mo><mi>b</mi>')
    expect(
      rowToPresentationMathML(
        row(symbol('pi'), '+', symbol('exponentiale'), '+', symbol('infinity')),
      ),
    ).toBe('<mi>π</mi><mo>+</mo><mi mathvariant="normal">e</mi><mo>+</mo><mi>∞</mi>')
  })

  it('writes structures', () => {
    expect(mathml('1/x')).toBe('<mfrac><mrow><mn>1</mn></mrow><mrow><mi>x</mi></mrow></mfrac>')
    expect(mathml('x^2')).toBe('<msup><mi>x</mi><mrow><mn>2</mn></mrow></msup>')
    expect(mathml('(a+b)')).toBe('<mfenced><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow></mfenced>')
    expect(mathml('|x|')).toBe('<mfenced open="|" close="|"><mrow><mi>x</mi></mrow></mfenced>')
    // A function, then function application before its argument, after its
    // power.
    expect(mathml('sin(x)')).toBe(
      '<mi>sin</mi><mo>&#x2061;</mo><mfenced><mrow><mi>x</mi></mrow></mfenced>',
    )
    // sin(x)^2 as sin²(x).
    expect(mathml('sin(x)^2')).toBe(
      '<msup><mi>sin</mi><mrow><mn>2</mn></mrow></msup><mo>&#x2061;</mo><mfenced><mrow><mi>x</mi></mrow></mfenced>',
    )
  })

  it('writes a derivative with Word’s differential d', () => {
    expect(rowToPresentationMathML([derivative(row('V'), row('t'))])).toBe(
      '<mfrac><mrow><mo>ⅆ</mo><mi>V</mi></mrow><mrow><mo>ⅆ</mo><mi>t</mi></mrow></mfrac>',
    )
    // Its expression bracketed, unless it is one name, number or bracket.
    expect(rowToPresentationMathML([derivative(row('x+y'), row('t'))])).toMatch(
      /^<mfrac><mrow><mo>ⅆ<\/mo><mfenced>/,
    )
  })

  it('leaves units out', () => {
    expect(mathml('V=0.25{mV}')).toBe('<mi>V</mi><mo>=</mo><mn>0.25</mn>')
  })

  it('is one <math>, with a line each for several', () => {
    expect(exportRow(type('x=1').root, 'word')).toBe(
      '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mi>x</mi><mo>=</mo><mn>1</mn></math>',
    )
    const several = exportRows([type('x=1').root, [], type('y=2').root], 'word')
    expect(several).toMatch(/^<math [^>]*><mtable columnalign="left"><mtr><mtd><mi>x<\/mi>/)
    expect(several.match(/<mtr>/g)).toHaveLength(2)
    expect(readBack(several).equations).toHaveLength(2)
  })

  it('is well-formed XML', () => {
    for (const [, make] of TYPED) {
      const text = exportRow(make().root, 'word')
      const doc = new DOMParser().parseFromString(text, 'application/xml')
      expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    }
  })

  // What every typed equation means comes back, with nothing to ask (but
  // without units, which aren't in it).
  it.each(TYPED.filter(([name]) => name !== 'numbers with units' && name !== 'piecewise'))(
    'reads back as the same equation: %s',
    (_, make) => {
      const root = make().root
      const back = readBack(exportRow(root, 'word'))
      expect(back.assumptions).toEqual([])
      expect(back.problems).toEqual([])
      expect(back.equations).toHaveLength(1)
      expect(cellml(back.equations[0])).toBe(cellml(root))
    },
  )

  // A power on a name is a question once read back: Word's MathML doesn't
  // say whether a digit superscript is a power or part of the name, so it
  // asks, defaulting to a power.
  it('asks about a digit superscript on a name, defaulting to a power', () => {
    const root = type('x^2').root
    const back = readBack(exportRow(root, 'word'))
    expect(back.assumptions).toHaveLength(1)
    expect(back.assumptions[0].kind).toBe('digit-superscript')
    expect(back.assumptions[0].chosen).toBe('power')
    expect(back.problems).toEqual([])
    expect(cellml(back.equations[0])).toBe(cellml(root))
  })

  it('reads a piecewise definition back, without its units', () => {
    const [, make] = TYPED.find(([name]) => name === 'piecewise')!
    const back = readBack(exportRow(make().root, 'word'))
    expect(back.assumptions).toEqual([])
    expect(back.problems).toEqual([])
    const withoutUnits = (text: string) => text.replace(/ cellml:units="[^"]*"/g, '')
    expect(withoutUnits(cellml(back.equations[0]))).toBe(withoutUnits(cellml(make().root)))
  })
})
