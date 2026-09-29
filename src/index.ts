// The package entry (vue3-math-editor): what an application imports. The
// styles are separate: import 'vue3-math-editor/style.css', with KaTeX's and
// PrimeIcons' (see docs/component-interface.md).

export { default as EquationWorkbench } from './components/EquationWorkbench.vue'
export { default as UnitsPanel } from './units/UnitsPanel.vue'

export { importContentMathML, type MathMLImport } from './editor/mathmlImport'
export type {
  EquationLine,
  EquationsChangeInfo,
  LineCommitInfo,
  UnitsIssue,
  VariableUnits,
} from './editor/units'

export {
  LIBCELLML_KEY,
  type ProvidedLibCellML,
  type UnitsCheckerOptions,
  type UnitsCheckerStatus,
  useUnitsChecker,
} from './units/useUnitsChecker'
export type { UnitsDefinition, UnitsPart } from './units/definitions'
export type { UnitsSource, UnitsLibraryProblem } from './units/library'
export type { LibCellML } from './units/libcellml'
