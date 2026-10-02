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

// Decorated names (editor/nameScripts.ts): keywords straight after the base
// are drawn as an accent, a charge or square brackets, and paint nothing
// themselves.

const accents = (line = 0) => wb.line(line).locator('.katex-html .accent')

test('a decorated name is drawn as typed while typed, then decorated', async () => {
  await wb.type('q_bar_i__Glc')
  expect(await text()).toContain('q_bar_i__Glc')
  await expect(accents()).toHaveCount(0)

  await wb.type('+1')
  await expect.poll(text).not.toContain('_')
  expect(await text()).not.toContain('bar')
  await expect(accents()).toHaveCount(1)
  await expect(scripts()).toHaveCount(1)
  await wb.expectMathJson(['Add', 'q_bar_i__Glc', 1])
})

test('a concentration is drawn in square brackets, with its charge', async () => {
  await wb.type('Ca_2plus_conc_i=1')
  await wb.expectMathJson(['Equal', 'Ca_2plus_conc_i', 1])
  await wb.press('Enter')
  await expect.poll(() => text(0)).not.toContain('_')

  const drawn = await text(0)
  for (const glyph of ['[', ']', '+']) expect(drawn).toContain(glyph)
  for (const word of ['conc', 'plus']) expect(drawn).not.toContain(word)
})

test('the caret walks every atom of a decorated name', async () => {
  await wb.type('q_bar_i__Glc=1')
  await expect(wb.cursor()).toHaveText('root @ 14')
  const field = await wb.fieldBox(0)

  // At 13 (after the =) the name is decorated, so the caret is checked on
  // its own: between the = and the 1, which are drawn after the name.
  await wb.press('ArrowLeft')
  await expect(wb.cursor()).toHaveText('root @ 13')
  await expect(accents()).toHaveCount(1)
  const equals = await wb.glyphBox(0, 'r', 12)
  const one = await wb.glyphBox(0, 'r', 13)
  const at13 = (await wb.caretBox(0))!
  expect(at13.left).toBeGreaterThan(equals.right - 1)
  expect(at13.left).toBeLessThan(one.left + 1)

  // From 12 down the name is drawn as typed, one gap per atom.
  await wb.press('ArrowLeft')
  await expect(wb.cursor()).toHaveText('root @ 12')
  await expect.poll(text).toContain('q_bar_i__Glc')
  let previous = (await wb.caretBox(0))!
  for (let offset = 11; offset >= 0; offset--) {
    await wb.press('ArrowLeft')
    await expect(wb.cursor()).toHaveText(`root @ ${offset}`)
    const caret = (await wb.caretBox(0))!
    expect(caret.left, `${offset}`).toBeLessThan(previous.left)
    expect(caret.left).toBeGreaterThan(field.left)
    previous = caret
  }
  for (let offset = 1; offset <= 12; offset++) {
    await wb.press('ArrowRight')
    await expect(wb.cursor()).toHaveText(`root @ ${offset}`)
    const caret = (await wb.caretBox(0))!
    expect(caret.left, `${offset}`).toBeGreaterThan(previous.left)
    expect(caret.right).toBeLessThan(field.right)
    previous = caret
  }
})

test('clicking right of a name whose last atoms paint nothing reaches its end', async () => {
  await wb.type('x_tilde')
  await wb.press('Enter')
  await expect(accents(0)).toHaveCount(1)

  // x̃ is the x atom; "_tilde" has no box. The whole name's wrapper does.
  const name = await wb.boxOf(wb.line(0).locator('[data-name]'))
  await wb.page.mouse.click(name.right + 3, (name.top + name.bottom) / 2)
  await expect(wb.cursor()).toHaveText('root @ 7')
  await expect.poll(() => text(0)).toContain('x_tilde')
})

test('with typesetting off, a decorated name is drawn as typed', async () => {
  await wb.type('q_bar_i__Glc=1')
  await wb.press('Enter')
  await expect(accents(0)).toHaveCount(1)

  const toggle = wb.page.locator('[data-role="typeset-names"]')
  await toggle.uncheck()
  await expect.poll(() => text(0)).toContain('q_bar_i__Glc')
  await expect(accents(0)).toHaveCount(0)
  await toggle.check()
  await expect(accents(0)).toHaveCount(1)
})
