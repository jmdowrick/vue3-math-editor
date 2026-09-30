import { expect, test } from '@playwright/test'

import { Workbench } from './workbench'

// Lines are reordered with Alt+↑/↓, or by dragging one by its number: its id
// goes with it, it becomes the active line, and it's one undo step.

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
  await wb.type('a=1')
  await wb.press('Enter')
  await wb.type('b=2')
  await wb.press('Enter')
  await wb.type('c=3')
})

interface Host {
  lines: { id: string; variables: string[] }[]
  setMathML(xml: string): unknown
}

// Each line's id and variable, in order, as the host sees them; the rows
// carry the same ids.
const order = async () => {
  const lines = await wb.page.evaluate(() =>
    (window as unknown as { __workbench: Host }).__workbench.lines.map(
      (line) => `${line.id}:${line.variables[0]}`,
    ),
  )
  const rows = await wb.page
    .locator('[data-line]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-line-id')))
  expect(rows).toEqual(lines.map((line) => line.split(':')[0]))
  return lines
}

test('Alt+↑/↓ moves the line, with its id, and undo puts it back', async () => {
  await wb.press('Alt+ArrowUp')
  expect(await order()).toEqual(['line-1:a', 'line-3:c', 'line-2:b'])
  await expect(wb.line(1)).toBeFocused()
  await wb.expectMathJson(['Equal', 'c', 3])

  await wb.press('Alt+ArrowUp')
  await wb.press('Alt+ArrowUp') // at the top: nothing
  expect(await order()).toEqual(['line-3:c', 'line-1:a', 'line-2:b'])

  await wb.press('Alt+ArrowDown')
  expect(await order()).toEqual(['line-1:a', 'line-3:c', 'line-2:b'])

  await wb.press('Control+z')
  expect(await order()).toEqual(['line-3:c', 'line-1:a', 'line-2:b'])
  await wb.press('Control+z')
  await wb.press('Control+z')
  expect(await order()).toEqual(['line-1:a', 'line-2:b', 'line-3:c'])
})

test('a line dragged by its number moves where it is dropped', async ({ page }) => {
  const handle = (line: number) => page.locator(`[data-line="${line}"] [data-role="line-handle"]`)
  await expect(handle(0)).toHaveAttribute('draggable', 'true')

  // The last line onto the top half of the first: it goes before it.
  await handle(2).dragTo(page.locator('[data-line="0"]'), { targetPosition: { x: 40, y: 4 } })
  expect(await order()).toEqual(['line-3:c', 'line-1:a', 'line-2:b'])
  await expect(wb.line(0)).toBeFocused()

  // The first onto the bottom half of the last: after it.
  const last = page.locator('[data-line="2"]')
  const height = (await last.boundingBox())!.height
  await handle(0).dragTo(last, { targetPosition: { x: 40, y: height - 4 } })
  expect(await order()).toEqual(['line-1:a', 'line-2:b', 'line-3:c'])
  await expect(page.locator('.drop-before, .drop-after')).toHaveCount(0)
})

test('read-only: lines can’t be reordered', async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto('/?readonly')
  await page.evaluate(() =>
    (window as unknown as { __workbench: Host }).__workbench.setMathML(
      '<math><apply><eq/><ci>a</ci><cn>1</cn></apply><apply><eq/><ci>b</ci><cn>2</cn></apply></math>',
    ),
  )
  await expect(page.locator('[data-line]')).toHaveCount(2)
  await expect(page.locator('[data-role="line-handle"]').first()).not.toHaveAttribute('draggable')
  const before = await order()
  await wb.focusLine(1)
  await wb.press('Alt+ArrowUp')
  expect(await order()).toEqual(before)
})
