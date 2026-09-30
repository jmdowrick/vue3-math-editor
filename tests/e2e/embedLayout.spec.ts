import { expect, test } from '@playwright/test'

import { Workbench } from './workbench'

// The workbench fits the room its host gives it: its layout follows its own
// width, not the window's; the toolbar's tools that don't fit go in "More ▾";
// the status bar is there only when it has something to say; and its colours
// follow the host's.

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

// The demo's box around the workbench, made narrow (a host's side panel).
const narrow = (width: number) =>
  wb.page.evaluate((px) => {
    document.querySelector<HTMLElement>('[data-role="scroll-box"]')!.style.maxWidth = `${px}px`
  }, width)

test('no status bar until there is something to say', async () => {
  await wb.type('a=1')
  await expect(wb.status()).toHaveCount(0)
  await wb.type(',')
  await expect(wb.status()).toContainText('Unexpected ","')
  await expect(wb.page.locator('[data-line="0"] [data-role="line-problem"]')).toHaveAttribute(
    'data-kind',
    'error',
  )
  await wb.press('Backspace')
  await expect(wb.status()).toHaveCount(0)
  await expect(wb.page.locator('[data-role="line-problem"]')).toHaveCount(0)
})

test('narrow, on a wide window: one column, and the tools that don’t fit in More', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  const side = page.locator('[data-role="side"]')
  const editor = page.locator('.editor-panel')
  // Wide: the side content is beside the editor.
  await expect.poll(async () => (await side.boundingBox())!.x).toBeGreaterThan(700)
  await expect(page.locator('[data-role="toolbar-more"]')).toHaveClass(/overflowed/)

  await narrow(480)
  await expect
    .poll(async () => (await side.boundingBox())!.y)
    .toBeGreaterThan((await editor.boundingBox())!.y + 50)

  // Some tools are in More, and the toolbar is still one row.
  const more = page.locator('[data-role="toolbar-more"]')
  await expect(more).not.toHaveClass(/overflowed/)
  await expect(page.locator('[data-role="toolbar-symbols"]')).toHaveClass(/overflowed/)
  const tops = await page
    .locator('.toolbar .tool-button:not(.overflowed), .toolbar .p-button')
    .evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().top)))
  expect(new Set(tops).size).toBe(1)

  // What's in More works as it would from its own button.
  await more.click()
  await page.locator('[data-role="gallery"]').locator('button[title^="Pi  ("]').click()
  await wb.expectMathJson('Pi')

  // Wide again: everything back in the toolbar.
  await narrow(1240)
  await expect(more).toHaveClass(/overflowed/)
  await expect(page.locator('[data-role="toolbar-symbols"]')).not.toHaveClass(/overflowed/)
})

test('the host’s accent colours the caret and the active line', async ({ page }) => {
  await page.evaluate(() =>
    document
      .querySelector<HTMLElement>('[data-role="scroll-box"]')!
      .style.setProperty('--math-editor-accent', 'rgb(200, 0, 120)'),
  )
  await wb.type('x')
  await expect(wb.caret(0)).toHaveCSS('background-color', 'rgb(200, 0, 120)')
  await expect(page.locator('[data-line="0"]')).toHaveCSS('border-color', 'rgb(200, 0, 120)')
})
