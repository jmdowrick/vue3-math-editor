// The workbench toolbar: a few groups, as in a word processor's equation
// editor. A group is a button of its own (Fraction), or opens a gallery of
// buttons (Radical ▾: √x, ⁿ√x), in sections if it has several (Symbols ▾).
// Each button shows its LaTeX; its title names it and the keys that type it.

import {
  type Command,
  insertAbs,
  insertCeiling,
  insertDerivative,
  insertFloor,
  insertFraction,
  insertFunction,
  insertNthRoot,
  insertPiecewise,
  insertSquareRoot,
  insertSuperscript,
  insertSymbol,
} from './commands'
import { FUNCTION_REGISTRY } from '../registry/nodes'

export interface ToolButton {
  latex: string
  title: string
  command: Command
}

export interface ToolSection {
  label?: string
  items: ToolButton[]
}

// One button, or a gallery (`sections`) opened by the group's button.
export interface ToolGroup {
  id: string
  title: string
  latex: string
  command?: Command
  sections?: ToolSection[]
}

// A function's button: \sin, or \operatorname{sech} where LaTeX has none.
function functionButton(name: string, title: string): ToolButton {
  const { latexName, latexCommand } = FUNCTION_REGISTRY[name]
  const latex = latexCommand ? `\\${latexName}` : `\\operatorname{${latexName}}`
  return { latex, title: `${title}  ( ${latexName} )`, command: insertFunction(name) }
}

const TRIG = [
  ['sin', 'Sine'],
  ['cos', 'Cosine'],
  ['tan', 'Tangent'],
  ['sec', 'Secant'],
  ['csc', 'Cosecant'],
  ['cot', 'Cotangent'],
] as const

// Trigonometric or hyperbolic ('h'), perhaps inverse (registry names asin,
// asinh): "Inverse hyperbolic sine".
const functions = (suffix: '' | 'h', inverse: boolean) =>
  TRIG.map(([name, title]) => {
    const words = [inverse && 'inverse', suffix && 'hyperbolic', title.toLowerCase()]
    const text = words.filter(Boolean).join(' ')
    return functionButton(
      `${inverse ? 'a' : ''}${name}${suffix}`,
      text[0].toUpperCase() + text.slice(1),
    )
  })

export const TOOLBAR: readonly ToolGroup[] = [
  { id: 'fraction', title: 'Fraction  ( / )', latex: '\\frac{a}{b}', command: insertFraction },
  { id: 'script', title: 'Power  ( ^ )', latex: 'x^{n}', command: insertSuperscript },
  {
    id: 'radical',
    title: 'Roots',
    latex: '\\sqrt{x}',
    sections: [
      {
        items: [
          { latex: '\\sqrt{x}', title: 'Square root  ( \\sqrt )', command: insertSquareRoot },
          { latex: '\\sqrt[n]{x}', title: 'nth root  ( \\root )', command: insertNthRoot },
        ],
      },
    ],
  },
  {
    id: 'brackets',
    title: 'Absolute value, floor and ceiling',
    latex: '|x|',
    sections: [
      {
        items: [
          { latex: '|x|', title: 'Absolute value  ( | )', command: insertAbs },
          {
            latex: '\\lfloor x\\rfloor',
            title: 'Floor  ( floor( or \\floor )',
            command: insertFloor,
          },
          {
            latex: '\\lceil x\\rceil',
            title: 'Ceiling  ( ceil( or \\ceil )',
            command: insertCeiling,
          },
        ],
      },
    ],
  },
  {
    id: 'function',
    title: 'Functions',
    latex: '\\sin',
    sections: [
      { label: 'Trigonometric', items: functions('', false) },
      { label: 'Hyperbolic', items: functions('h', false) },
      { label: 'Inverse trigonometric', items: functions('', true) },
      { label: 'Inverse hyperbolic', items: functions('h', true) },
      {
        label: 'Exponential and logarithm',
        items: [
          functionButton('exp', 'Exponential'),
          functionButton('ln', 'Natural logarithm'),
          functionButton('log', 'Logarithm'),
        ],
      },
    ],
  },
  {
    id: 'derivative',
    title: 'Derivative  ( \\dd )',
    latex: '\\frac{\\mathrm{d}y}{\\mathrm{d}x}',
    command: insertDerivative,
  },
  {
    id: 'cases',
    title: 'Piecewise  ( \\cases )',
    // Small, to fit a toolbar button.
    latex: '\\left\\{\\begin{smallmatrix}a&p\\\\b&q\\end{smallmatrix}\\right.',
    command: insertPiecewise,
  },
  {
    id: 'symbols',
    title: 'Operators, constants, relations and logic',
    latex: '\\pi\\,\\le',
    sections: [
      {
        label: 'Operators',
        items: [
          { latex: '+', title: 'Add  ( + )', command: insertSymbol('+') },
          { latex: '-', title: 'Subtract  ( - )', command: insertSymbol('-') },
          { latex: '\\times', title: 'Multiply  ( * )', command: insertSymbol('·') },
          { latex: '=', title: 'Equals  ( = )', command: insertSymbol('=') },
        ],
      },
      {
        // CellML's <pi/>, <exponentiale/>, <infinity/>.
        label: 'Constants',
        items: [
          { latex: '\\pi', title: 'Pi  ( \\pi )', command: insertSymbol('pi') },
          {
            latex: '\\mathrm{e}',
            title: "Euler's number e  ( \\e )",
            command: insertSymbol('exponentiale'),
          },
          { latex: '\\infty', title: 'Infinity  ( \\inf )', command: insertSymbol('infinity') },
        ],
      },
      {
        label: 'Relations',
        items: [
          { latex: '<', title: 'Less than  ( < )', command: insertSymbol('<') },
          {
            latex: '\\leq',
            title: 'Less than or equal  ( <= or \\le )',
            command: insertSymbol('≤'),
          },
          { latex: '>', title: 'Greater than  ( > )', command: insertSymbol('>') },
          {
            latex: '\\geq',
            title: 'Greater than or equal  ( >= or \\ge )',
            command: insertSymbol('≥'),
          },
          { latex: '\\neq', title: 'Not equal  ( != or \\ne )', command: insertSymbol('≠') },
        ],
      },
      {
        label: 'Logic',
        items: [
          { latex: '\\land', title: 'And  ( & or \\and )', command: insertSymbol('∧') },
          { latex: '\\lor', title: 'Or  ( \\or )', command: insertSymbol('∨') },
          { latex: '\\lnot', title: 'Not  ( ! or \\not )', command: insertSymbol('¬') },
          { latex: '\\veebar', title: 'Exclusive or  ( \\xor )', command: insertSymbol('⊻') },
        ],
      },
    ],
  },
]
