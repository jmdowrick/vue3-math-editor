// Equations typed as the user would, including every kind of structure: for
// the round trips through an export and back (Content MathML, Word).

import { type EditorState, namedCommand } from '../src/editor/commands'
import { press, type } from './editorHelpers'

// Equations typed as the user would, including every kind of structure.
const run = (name: string) => (state: EditorState) => namedCommand(name)(state)
export const TYPED: Array<[string, () => EditorState]> = [
  ['sum and product', () => type('y=a+b*c-d')],
  ['brackets', () => type('y=(a+b)*(c-d)')],
  ['negation', () => type('y=-a*b+-c')],
  ['fraction', () => press(type('y=1/(x+1)'), ' ', '+2')],
  ['power', () => type('y=(x+1)^2')],
  ['power of a fraction', () => press(type('y=(1/x'), ' ', ')^2')],
  ['function power', () => type('y=sin(x)^2')],
  ['functions', () => type('y=exp(-t)+ln(x)+log(x,2)+min(a,b,c)+rem(a,b)')],
  ['floor and ceiling', () => type('y=floor(x)+ceil(x)')],
  ['abs', () => type('y=|x-1|')],
  ['numbers with units', () => type('V=0.25{mV}*x+1e-3{volt}')],
  ['scientific', () => type('k=1.5e-08')],
  ['greek', () => type('alpha=2*beta')],
  [
    'roots',
    () => press(run('root')(press(run('sqrt')(type('y=')), 'x', ' ', '+')), '3', 'ArrowRight', 'y'),
  ],
  [
    'derivative',
    () => press(run('dd')(type('')), 'V', 'Tab', 't', 'ArrowRight', '=-(I_ion-I_stim)/C_m'),
  ],
  ['piecewise', () => press(run('cases')(type('y=')), '5{mV}', 'ArrowRight', 't<1{ms}&t>0')],
  ['logic', () => type('b=(x<1)')],
  ['constants', () => press(run('pi')(type('y=2*')), '*r+', 'x')],
  // Names with decorations (nameScripts.ts). A superscript part before a
  // subscript (Q__eq_GLUT2) is left out: it is drawn, and so reads back, as
  // Q_GLUT2__eq.
  [
    'decorated names',
    () => type('v_m__GLUT2=kappa_hat_m__GLUT2*(Glc_conc_i-Q_GLUT2__eq*Glc_conc_o)'),
  ],
  ['accents', () => type('y=q_bar_i__Glc+x_tilde+x_check+Glc_bar')],
  [
    'charges and concentrations',
    () => type('y=Ca_2plus+Na_plus*Cl_minus+Ca_2plus_conc_i+Ca_2plus__max'),
  ],
  // Keywords out of place are ordinary parts.
  ['misplaced keywords', () => type('y=g_Na_bar+x_hat_bar+Ca_conc_2plus')],
  ['digit superscript parts', () => type('y=kappa_m__1+x_a__12+x__1__2+x_bar__1__2')],
  // A keyword as an ordinary part after a charge.
  [
    'keywords after a charge',
    () => type('y=x_plus_bar+Ca_2plus_bar+x_plus_minus+x_plus_plus+x_2plus_minus'),
  ],
]
