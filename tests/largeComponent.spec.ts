import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { contentStable } from '../src/components/contentStable'
import { constantForSymbol } from '../src/editor/constants'
import { nameOccurrenceMap, nameOccurrences, nameRuns } from '../src/editor/identifiers'
import { type Row, childRows, row } from '../src/editor/layout'
import { importContentMathML } from '../src/editor/mathmlImport'
import { unitsHintMarks, unitsIssueMarks } from '../src/editor/units'

// SN_soma (tests/resources/SN_soma.xml): 126 equations and 249 variables,
// the component that made phlynx slow. The costs here are compared with each
// other, not with a time, so they hold on any machine.
const here = dirname(fileURLToPath(import.meta.url))
const resource = (name: string) => readFileSync(join(here, 'resources', name), 'utf8')
const lines = importContentMathML(resource('SN_soma.xml'))!.equations
const units = JSON.parse(resource('SN_soma_units.json')) as Record<string, string>
const names = Object.keys(units)

// The fastest of a few runs, in milliseconds: the least disturbed by
// anything else going on.
function time(run: () => unknown): number {
  let best = Infinity
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    run()
    best = Math.min(best, performance.now() - start)
  }
  return best
}

// Fresh copies of the lines, so no cache already holds them.
const copies = () => lines.map((root) => structuredClone(root))

// nameOccurrences as it was, one walk of the tree per name.
function occurrencesOf(root: Row, name: string): string[][] {
  const found: string[][] = []
  const visit = (atoms: Row) => {
    const runs = new Map(nameRuns(atoms).map((run) => [run.start, run]))
    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i]
      const run = runs.get(i)
      if (run) {
        if (run.name === name && !run.functionName) {
          found.push(atoms.slice(run.start, run.end).map((a) => a.id))
        }
        i = run.end - 1
        continue
      }
      if (atom.kind === 'symbol' && atom.value === name && !constantForSymbol(name)) {
        found.push([atom.id])
      }
      if (atom.kind === 'units') continue
      for (const [, child] of childRows(atom)) visit(child)
    }
  }
  visit(root)
  return found
}

describe('a large component', () => {
  it('is the one measured', () => {
    expect(lines).toHaveLength(126)
    expect(names).toHaveLength(249)
  })

  it('finds each name where one walk per name did', () => {
    for (const root of lines) {
      for (const name of names) {
        expect(nameOccurrences(root, name)).toEqual(occurrencesOf(root, name))
      }
    }
  })

  it('walks each line once, however many names are looked up', () => {
    const root = row('x=V_m+2V_m')
    expect(nameOccurrenceMap(root)).toBe(nameOccurrenceMap(root))
    expect(nameOccurrences(root, 'V_m')).toHaveLength(2)
    expect(nameOccurrences(root, 'y')).toEqual([])
  })

  it('gives its units hints in about the time it takes without units', () => {
    // Warm up, then compare on uncached lines each time.
    time(() => copies().map((root) => unitsHintMarks(root, units)))
    const without = time(() => copies().map((root) => unitsHintMarks(root, null)))
    const withUnits = time(() => copies().map((root) => unitsHintMarks(root, units)))
    expect(withUnits).toBeLessThan(3 * without + 5)
  })

  it('marks an issue naming every variable as quickly', () => {
    const issues = [{ lineId: 'l', message: 'units', variables: names }]
    const without = time(() => copies().map((root) => unitsIssueMarks(root, [])))
    const withIssue = time(() => copies().map((root) => unitsIssueMarks(root, issues)))
    expect(withIssue).toBeLessThan(3 * without + 5)
  })

  it('marks every occurrence of a known variable', () => {
    const marks = lines.flatMap((root) => unitsHintMarks(root, units))
    const total = lines.reduce(
      (sum, root) => sum + names.reduce((n, name) => n + nameOccurrences(root, name).length, 0),
      0,
    )
    expect(marks.filter((mark) => !/^[\d.]/.test(mark.message))).toHaveLength(total)
  })
})

describe('variable units hints', () => {
  it('only come from the map’s own entries', () => {
    const root = row('constructor+x')
    expect(unitsHintMarks(root, { x: 'm' }).map((mark) => mark.message)).toEqual(['x: m'])
  })
})

describe('contentStable', () => {
  it('keeps the previous value while the content is the same', () => {
    const source = ref<Record<string, string>>({ a: 'm' })
    const stable = contentStable(() => source.value)
    const first = stable.value

    source.value = { a: 'm' }
    expect(stable.value).toBe(first)

    source.value = { a: 's' }
    expect(stable.value).toEqual({ a: 's' })
    expect(stable.value).not.toBe(first)
  })
})
