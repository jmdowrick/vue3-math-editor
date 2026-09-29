import { type Page, expect, test } from '@playwright/test'

import { Workbench } from './workbench'

// Committing lines (line-commit, validate), and how problems are shown: the
// line's marks and outline, and the status bar. Also readonly, autofocus and
// the toolbar's layout.

let wb: Workbench

interface Host {
  lines: { mathml: string; complete: boolean }[]
  commits: { id: string; mathml: string; complete: boolean; reason: string }[]
  setMathML(xml: string): unknown
}
// What the demo has seen: the lines, and every line-commit.
const hostState = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as { __workbench: Host }).__workbench
    return { lines: [...h.lines], commits: [...h.commits] }
  })
const reasons = async () => (await hostState(wb.page)).commits.map((commit) => commit.reason)
const setMathML = (xml: string) =>
  wb.page.evaluate(
    (text) => (window as unknown as { __workbench: Host }).__workbench.setMathML(text),
    xml,
  )

test.describe('line-commit', () => {
  test.beforeEach(async ({ page }) => {
    wb = new Workbench(page)
    await wb.goto()
    await wb.focusLine(0)
  })

  test('Enter, "+ Line", ↑/↓ and a click on another line commit the line left', async () => {
    await wb.type('a=1')
    await wb.press('Enter')
    await wb.type('b=2')
    await wb.page.locator('[data-role="add-line"]').click()
    await wb.type('c=3')
    await wb.press('ArrowUp')
    await expect.poll(reasons).toEqual(['enter', 'new-line', 'navigate'])

    await wb.press('End')
    await wb.type('+1')
    await wb.line(0).click()
    await expect.poll(reasons).toEqual(['enter', 'new-line', 'navigate', 'navigate'])
    const last = (await hostState(wb.page)).commits.at(-1)!
    expect(last.mathml).toContain('<ci>b</ci>')
    expect(last.complete).toBe(true)
  })

  test('focus leaving the lines commits; nothing is committed twice', async () => {
    await wb.type('a=')
    await wb.page.locator('.hero h1').click()
    await expect.poll(reasons).toEqual(['blur'])
    expect((await hostState(wb.page)).commits[0].complete).toBe(false)

    // Unchanged since: leaving again, or moving about, commits nothing.
    await wb.focusLine(0)
    await wb.page.locator('.hero h1').click()
    await wb.focusLine(0)
    await wb.press('ArrowDown')
    expect(await reasons()).toEqual(['blur'])
  })

  test('a toolbar gallery keeps the line focused, and commits nothing', async () => {
    await wb.type('2')
    await wb.tool('symbols', 'Pi')
    await expect(wb.line(0)).toBeFocused()
    await wb.expectMathJson(['Multiply', 2, 'Pi'])
    expect(await reasons()).toEqual([])
  })

  test('lines set by setMathML are committed already', async () => {
    await setMathML(
      '<apply><eq/><ci>a</ci><cn>1</cn></apply><apply><eq/><ci>b</ci><cn>2</cn></apply>',
    )
    await wb.focusLine(0)
    await wb.press('ArrowDown')
    expect(await reasons()).toEqual([])
  })
})

test.describe('problems while typing (validate="input")', () => {
  test.beforeEach(async ({ page }) => {
    wb = new Workbench(page)
    await wb.goto()
    await wb.focusLine(0)
  })

  test('what is only missing is marked once the line is left', async () => {
    await wb.type('x+')
    await expect(wb.marks(0)).toHaveCount(0)
    await expect(wb.status()).toBeEmpty()

    await wb.press('Enter')
    await expect(wb.marks(0)).toHaveCount(1)
    await expect(wb.page.locator('[data-line="0"]')).toHaveClass(/has-error/)
    await expect(wb.status()).toContainText('Line 1: Missing operand after +')
  })

  test('the lines don’t move when a problem appears or goes', async () => {
    await wb.type('a=1')
    await wb.press('Enter')
    await wb.type('b=2')
    const boxes = () =>
      Promise.all([0, 1].map((i) => wb.page.locator(`[data-line="${i}"]`).boundingBox()))
    const before = await boxes()

    await wb.type(',')
    await expect(wb.status()).toContainText('Unexpected ","')
    const during = await boxes()
    await wb.press('Backspace')
    await expect(wb.status()).toBeEmpty()
    const after = await boxes()

    for (const [index, box] of before.entries()) {
      for (const other of [during[index], after[index]]) {
        expect(other!.y).toBeCloseTo(box!.y, 1)
        expect(other!.height).toBeCloseTo(box!.height, 1)
      }
    }
  })
})

test.describe('validate="commit"', () => {
  test.beforeEach(async ({ page }) => {
    wb = new Workbench(page)
    await wb.goto('/?validate=commit')
    await wb.focusLine(0)
  })

  test('a line’s problems show once it is committed', async () => {
    await wb.type('1,2=')
    await expect(wb.marks(0)).toHaveCount(0)
    await expect(wb.status()).toBeEmpty()

    await wb.press('Enter')
    await expect(wb.marks(0)).toHaveCount(2)
    await expect(wb.status()).toContainText('Line 1: Unexpected ","')
    await expect.poll(() => wb.problems()).toEqual(['Unexpected ","', 'Missing right-hand side'])

    // Edited again: hidden until the next commit.
    await wb.focusLine(0)
    await wb.press('End')
    await wb.type('3')
    await expect(wb.marks(0)).toHaveCount(0)
    await wb.press('ArrowDown')
    await expect.poll(() => wb.problems()).toEqual(['Unexpected ","'])
  })
})

test('CellML mode: a line that isn’t an equation is a problem', async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto('/?cellml')
  await wb.focusLine(0)
  await wb.type('x+1')
  await wb.press('Enter')
  await expect(wb.status()).toContainText('Line 1: A CellML line must be an equation')
  expect((await hostState(page)).lines[0].complete).toBe(false)
})

test('readonly: nothing can be edited', async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto('/?readonly')
  await setMathML('<apply><eq/><ci>a</ci><cn>1</cn></apply>')
  await wb.focusLine(0)
  await wb.type('+2')
  await wb.press('Enter')
  await wb.press('ControlOrMeta+z')
  await expect(wb.lines()).toHaveCount(1)
  await wb.expectMathJson(['Equal', 'a', 1])
  await expect(page.locator('[data-role="toolbar-fraction"]')).toBeDisabled()
  await expect(page.locator('[data-role="add-line"]')).toBeDisabled()
})

test('the toolbar is one row at 800px', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 })
  wb = new Workbench(page)
  await wb.goto()
  const tops = await page
    .locator('.toolbar .tool-button, .toolbar .p-button')
    .evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().top)))
  expect(new Set(tops).size).toBe(1)

  // Every button's label fits inside it.
  const overflows = await page.locator('.toolbar .tool-button').evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const outer = button.getBoundingClientRect()
        const inner = button.querySelector('.katex')!.getBoundingClientRect()
        return inner.top < outer.top || inner.bottom > outer.bottom
      })
      .map((button) => button.getAttribute('title')),
  )
  expect(overflows).toEqual([])
})

test('the toolbar stays in view as the lines scroll', async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto('/?scroll')
  const equations = Array.from(
    { length: 30 },
    (_, i) => `<apply><eq/><ci>x${i}</ci><cn>${i}</cn></apply>`,
  )
  await setMathML(equations.join(''))
  const box = page.locator('[data-role="scroll-box"]')
  await box.evaluate((el) => (el.scrollTop = el.scrollHeight))

  const scroller = (await box.boundingBox())!
  const toolbarEl = page.locator('.toolbar')
  const toolbar = (await toolbarEl.boundingBox())!
  expect(toolbar.y).toBeCloseTo(scroller.y, 0)
  await expect(page.locator('[data-role="toolbar-fraction"]')).toBeInViewport()

  // Stuck, it covers the panel between its side borders and draws its top
  // edge: no line shows beside or above it.
  await expect(toolbarEl).toHaveClass(/\bstuck\b/)
  const panel = (await page.locator('.editor-panel').boundingBox())!
  expect(toolbar.x).toBeCloseTo(panel.x + 1, 0)
  expect(toolbar.width).toBeCloseTo(panel.width - 2, 0)
  const topColor = await toolbarEl.evaluate((el) => getComputedStyle(el).borderTopColor)
  expect(topColor).not.toBe('rgba(0, 0, 0, 0)')

  // Back at the top, the panel's own edge shows again.
  await box.evaluate((el) => (el.scrollTop = 0))
  await expect(toolbarEl).not.toHaveClass(/\bstuck\b/)
})

test('autofocus: in a dialog, the active line has the focus', async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto('/?dialog&autofocus')
  await page.locator('[data-role="open-dialog"]').click()
  const field = page.locator('.p-dialog .math-field').first()
  await expect(field).toHaveAttribute('autofocus')
  await expect(field).toBeFocused()
})
