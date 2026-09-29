import { readFileSync } from 'node:fs'

import { type Page, expect, test } from '@playwright/test'

import { Workbench } from './workbench'

// Timing checks on a large component: SN_soma (tests/resources/SN_soma.xml),
// 126 equations and 249 variables, with every variable's units given for the
// hover hints, as phlynx gives them. Opt-in (tagged @perf, run with
// test:e2e:perf), because the times depend on the machine; the limits leave
// room for a dev build on a slower one.

const resource = (name: string) =>
  readFileSync(new URL(`../resources/${name}`, import.meta.url), 'utf8')
const xml = resource('SN_soma.xml')
const units = JSON.parse(resource('SN_soma_units.json')) as Record<string, string>

interface TestWindow {
  __workbench: {
    lines: unknown[]
    setMathML(xml: string): unknown
    setUnits(units: { variableUnits?: Record<string, string> }): void
  }
}

// The long tasks (over 50 ms) while the variables' units are set and the
// page draws the result.
async function longTasksSettingUnits(page: Page, variableUnits: Record<string, string>) {
  return page.evaluate(async (variableUnits) => {
    const durations: number[] = []
    const observer = new PerformanceObserver((list) =>
      durations.push(...list.getEntries().map((entry) => Math.round(entry.duration))),
    )
    observer.observe({ type: 'longtask' })
    ;(window as unknown as TestWindow).__workbench.setUnits({ variableUnits })
    // Vue updates the page on the next tick; wait until it is drawn, and a
    // little longer for anything that follows.
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 100)))
    observer.disconnect()
    return durations
  }, variableUnits)
}

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto('/?nolibcellml&nooutputs&nohistory')
  await page.evaluate(
    (units) => (window as unknown as TestWindow).__workbench.setUnits({ variableUnits: units }),
    units,
  )
})

// From setMathML until the lines are drawn.
const loadTime = (page: Page) =>
  page.evaluate(async (xml) => {
    const start = performance.now()
    ;(window as unknown as TestWindow).__workbench.setMathML(xml)
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    return performance.now() - start
  }, xml)

test('loads with units hints about as quickly as without @perf', async ({ page }) => {
  await page.evaluate(() => (window as unknown as TestWindow).__workbench.setUnits({}))
  const without = await loadTime(page)
  await page.evaluate(
    (units) => (window as unknown as TestWindow).__workbench.setUnits({ variableUnits: units }),
    units,
  )
  const withUnits = await loadTime(page)
  await expect(wb.lines()).toHaveCount(126)
  console.log(
    `setMathML(SN_soma): ${without.toFixed(0)} ms without units, ${withUnits.toFixed(0)} ms with ${Object.keys(units).length} variables' units`,
  )
  expect(withUnits).toBeLessThan(1000)
  expect(withUnits).toBeLessThan(1.5 * without + 100)
})

test('new variable units, equal or changed, cause no long task @perf', async ({ page }) => {
  await page.evaluate((xml) => (window as unknown as TestWindow).__workbench.setMathML(xml), xml)
  await expect(wb.lines()).toHaveCount(126)

  // An equal copy, as a host rebuilding its map after each commit passes.
  const equal = await longTasksSettingUnits(page, { ...units })
  // One variable's units changed.
  const [first] = Object.keys(units)
  const changed = await longTasksSettingUnits(page, { ...units, [first]: 'second' })
  console.log(
    `long tasks: equal map ${JSON.stringify(equal)} ms, one changed ${JSON.stringify(changed)} ms`,
  )

  expect(equal).toEqual([])
  expect(changed).toEqual([])
})
