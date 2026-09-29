import { expect, test } from '@playwright/test'

import { Workbench } from './workbench'

// A name's subscripts and superscripts (g_Kr__max: Kr below, max above) are
// typeset once it is no longer being edited; the demo's checkbox is the
// workbench's typesetNames prop.

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

const text = (line = 0) => wb.line(line).locator('.katex-html').innerText()
const scripts = (line = 0) => wb.line(line).locator('.msupsub')

test('a name is drawn as typed while typed, then typeset', async () => {
  await wb.type('g_Kr__max')
  expect(await text()).toContain('g_Kr__max')
  await expect(scripts()).toHaveCount(0)

  await wb.type('+1')
  await expect.poll(text).not.toContain('_')
  await expect(scripts()).toHaveCount(1)
  await wb.expectMathJson(['Add', 'g_Kr__max', 1])
})

test('moving back into a typeset name draws it as typed, with the caret in it', async () => {
  await wb.type('C_Ca_i=1')
  await expect.poll(text).not.toContain('_')

  await wb.press('ArrowLeft', 2)
  await expect(wb.cursor()).toHaveText('root @ 6')
  await expect.poll(text).toContain('C_Ca_i')
  await wb.press('ArrowLeft', 3)
  await expect(wb.cursor()).toHaveText('root @ 3')
  const caret = await wb.caretBox(0)
  const field = await wb.fieldBox(0)
  expect(caret!.left).toBeGreaterThan(field.left)
  expect(caret!.right).toBeLessThan(field.right)
})

test('clicking a typeset name puts the cursor in it', async () => {
  await wb.type('V_m=1')
  await wb.press('Enter')
  await expect.poll(() => text(0)).not.toContain('_')

  const glyph = await wb.boxOf(wb.line(0).locator('.katex-html .mord').first())
  await wb.page.mouse.click(glyph.left + 2, (glyph.top + glyph.bottom) / 2)
  await expect(wb.cursor()).toHaveText(/^root @ [0-3]$/)
  await expect.poll(() => text(0)).toContain('V_m')
})

test('with typesetting off, names are drawn as typed', async () => {
  await wb.type('g_Kr__max=1')
  await wb.press('Enter')
  await expect(scripts(0)).toHaveCount(1)

  const toggle = wb.page.locator('[data-role="typeset-names"]')
  await toggle.uncheck()
  await expect.poll(() => text(0)).toContain('g_Kr__max')
  await expect(scripts(0)).toHaveCount(0)
  await toggle.check()
  await expect(scripts(0)).toHaveCount(1)
})
