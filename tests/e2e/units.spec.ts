import { expect, test } from '@playwright/test'

import { Workbench } from './workbench'

// The units interface: the workbench reports its lines (equations-change)
// and shows the issues and variable units a host sends back. The demo app
// exposes both on window.__workbench (src/App.vue).

interface Line {
  id: string
  mathml: string
  variables: string[]
  units: string[]
  complete: boolean
}

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

const lines = () =>
  wb.page.evaluate(
    () => (window as unknown as { __workbench: { lines: Line[] } }).__workbench.lines,
  )

const setUnits = (units: { issues?: unknown[]; variableUnits?: Record<string, string> }) =>
  wb.page.evaluate(
    (u) =>
      (window as unknown as { __workbench: { setUnits(u: unknown): void } }).__workbench.setUnits(
        u,
      ),
    units,
  )

const unitsMarks = (line = 0) => wb.line(line).locator('[data-role="mark"][data-kind="units"]')

test('reports each line: id, CellML-mode MathML, variables, completeness', async () => {
  await wb.type('x=v+t*2{s}')
  await expect
    .poll(async () => (await lines())[0])
    .toMatchObject({
      id: 'line-1',
      variables: ['x', 'v', 't'],
      units: ['s'],
      complete: true,
    })
  expect((await lines())[0].mathml).toContain('<cn cellml:units="s">2</cn>')

  await wb.type('+')
  await expect.poll(async () => (await lines())[0].complete).toBe(false)
})

test('line ids stay with their lines as lines are added and removed', async () => {
  await wb.type('a=1')
  await wb.press('Enter')
  await wb.type('b=2')
  await expect.poll(async () => (await lines()).map((l) => l.id)).toEqual(['line-1', 'line-2'])

  await wb.focusLine(0)
  await wb.press('End')
  await wb.press('Enter')
  await expect
    .poll(async () => (await lines()).map((l) => l.id))
    .toEqual(['line-1', 'line-3', 'line-2'])

  // Backspace in the new, empty line removes it.
  await wb.press('Backspace')
  await expect.poll(async () => (await lines()).map((l) => l.id)).toEqual(['line-1', 'line-2'])
})

test('issues are underlined in amber on the right line, and shown in the status bar', async () => {
  await wb.type('x=v+t')
  await wb.press('Enter')
  await wb.type('y=v')
  await setUnits({
    issues: [
      { lineId: 'line-1', message: "'v' and 't' have different units", variables: ['v', 't'] },
    ],
  })

  await expect(unitsMarks(0)).toHaveCount(2)
  await expect(unitsMarks(1)).toHaveCount(0)

  // The line is outlined, and the status bar names it; a click there goes to it.
  await expect(wb.page.locator('[data-line="0"]')).toHaveClass(/has-units-issue/)
  await expect(wb.page.locator('[data-line="1"]')).not.toHaveClass(/has-units-issue/)
  // Not by colour alone: an icon beside the number says so.
  const icon = wb.page.locator('[data-line="0"] [data-role="line-problem"]')
  await expect(icon).toHaveAttribute('data-kind', 'units')
  await expect(icon).toHaveAttribute('title', "'v' and 't' have different units")
  await expect(wb.page.locator('[data-line="1"] [data-role="line-problem"]')).toHaveCount(0)
  await expect(wb.status()).toHaveAttribute('data-kind', 'units')
  await expect(wb.status()).toContainText("Line 1: 'v' and 't' have different units")
  await wb.status().click()
  await expect(wb.line(0)).toBeFocused()

  const box = await wb.boxOf(unitsMarks(0).first())
  await wb.page.mouse.move((box.left + box.right) / 2, (box.top + box.bottom) / 2)
  await expect(wb.markTip()).toHaveText("'v' and 't' have different units")
})

test('an issue follows its line when a line is inserted before it', async () => {
  await wb.type('a=1')
  await wb.press('Enter')
  await wb.type('x=v+t')
  await setUnits({ issues: [{ lineId: 'line-2', message: 'units', variables: ['v'] }] })
  await expect(unitsMarks(1)).toHaveCount(1)

  await wb.focusLine(0)
  await wb.press('End')
  await wb.press('Enter')
  await expect(unitsMarks(1)).toHaveCount(0)
  await expect(unitsMarks(2)).toHaveCount(1)
})

test('variable and number units show on hover, without underlines', async () => {
  await wb.type('x=v*2{s}')
  await setUnits({ variableUnits: { v: 'metre_per_second' } })
  await expect(wb.marks()).toHaveCount(0)

  const v = await wb.atomBox(0, 'r', 2)
  await wb.page.mouse.move((v.left + v.right) / 2, (v.top + v.bottom) / 2)
  await expect(wb.markTip()).toHaveText('v: metre_per_second')

  const two = await wb.atomBox(0, 'r', 4)
  await wb.page.mouse.move((two.left + two.right) / 2, (two.top + two.bottom) / 2)
  await expect(wb.markTip()).toHaveText('2: s')
})

test('the hover tip sits under its glyph inside a transformed host', async () => {
  // As a PrimeVue Dialog is: transformed, so it (not the viewport) places
  // position: fixed descendants, and away from the viewport's corner.
  await wb.page.evaluate(() => {
    Object.assign(document.querySelector<HTMLElement>('#app')!.style, {
      transform: 'scale(1)',
      willChange: 'transform',
      margin: '120px 0 0 200px',
    })
  })
  await wb.type('x=v*2{s}')
  await setUnits({ variableUnits: { v: 'metre_per_second' } })

  const hoverV = async () => {
    const v = await wb.atomBox(0, 'r', 2)
    await wb.page.mouse.move((v.left + v.right) / 2, (v.top + v.bottom) / 2)
    await expect(wb.markTip()).toHaveText('v: metre_per_second')
    // Just under the glyph: its mark's box is padded by 1, the tip 6 below.
    const tip = (await wb.markTip().boundingBox())!
    expect(Math.abs(tip.x - (v.left - 1))).toBeLessThanOrEqual(3)
    expect(Math.abs(tip.y - (v.bottom + 7))).toBeLessThanOrEqual(3)
  }
  await hoverV()

  // The layout inside the field changes, with no resize or redraw: the
  // boxes are measured again when the pointer comes back.
  await wb.page.mouse.move(0, 0)
  await wb.page.evaluate(() =>
    document.querySelector<HTMLElement>('#app')!.style.setProperty('--me-line-font-size', '1.8rem'),
  )
  await hoverV()
})

test('a number’s units show while typed, then hide, showing on hover', async () => {
  await wb.type('k=0.25{')
  // An empty units slot of its own kind, labelled "units".
  await expect(wb.line(0).locator('.me-units-ph')).toHaveText('units')
  await expect(wb.marks()).toHaveCount(0) // still being typed: not a problem
  await wb.type('per_s')
  await expect(wb.cursor()).toHaveText('6.units @ 5')
  await expect(wb.line(0).locator('.me-units')).toHaveText('per_s')

  await expect(wb.line(0).locator('.me-units')).toHaveCSS('color', 'rgb(96, 165, 250)')
  await expect(wb.line(0).locator('.me-units-flag')).toHaveCount(0)
  await wb.type('}')
  await expect(wb.cursor()).toHaveText('root @ 7')
  await expect(wb.line(0).locator('.me-units')).toHaveCount(0)
  // Hidden: a small triangle says the number has units.
  await expect(wb.line(0).locator('.me-units-flag')).toHaveCount(1)
  await wb.expectMathJson(['Equal', 'k', 0.25])
  expect((await lines())[0].mathml).toContain('<cn cellml:units="per_s">0.25</cn>')

  const number = await wb.atomBox(0, 'r', 5)
  await wb.page.mouse.move((number.left + number.right) / 2, (number.top + number.bottom) / 2)
  await expect(wb.markTip()).toHaveText('0.25: per_s')
})

test('{ opens hidden units again to change them', async () => {
  await wb.type('V=5{volt}+x')
  await wb.press('ArrowLeft', 2)
  await expect(wb.cursor()).toHaveText('root @ 4')
  await wb.type('{')
  await expect(wb.line(0).locator('.me-units')).toHaveText('volt')
  await expect(wb.selection(0)).toBeVisible()
  await wb.type('ampere ')
  await expect(wb.line(0).locator('.me-units')).toHaveCount(0)
  expect((await lines())[0].mathml).toContain('<cn cellml:units="ampere">5</cn>')

  // Deleting the number's last digit takes its units with it.
  await wb.press('Backspace')
  await expect(wb.line(0).locator('.me-units-flag')).toHaveCount(0)
  await wb.type('6')
  expect((await lines())[0].mathml).toContain('<cn cellml:units="dimensionless">6</cn>')
})

test('a units problem underlines the number, its units staying hidden', async () => {
  await wb.type('x=2{furlong}')
  await setUnits({
    issues: [
      { lineId: 'line-1', message: 'No units called furlong are defined', units: ['furlong'] },
    ],
  })
  await expect(unitsMarks()).toHaveCount(1)
  await expect(wb.line(0).locator('.me-units')).toHaveCount(0)
  await expect(wb.line(0).locator('.me-units-flag')).toHaveCount(1)
  await setUnits({ issues: [{ lineId: 'line-1', message: '2 is dimensionless', numbers: [2] }] })
  await expect(wb.line(0).locator('.me-units')).toHaveCount(0)
  await expect(unitsMarks()).toHaveCount(1)
})
