import { expect, test } from '@playwright/test'

import { GLUT2, d, f, nary, r, sSub, sSubSup, word, wordMathML } from '../wordFixtures'
import { Workbench } from './workbench'

// Pasting Word's equations: straight in when nothing was assumed or left out;
// otherwise after the review dialog. Several go in as new lines.

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

type Hooks = { __workbench: { lines: { mathml: string }[]; commits: { reason: string }[] } }
const lineMathml = (index: number) =>
  wb.page.evaluate((i) => (window as unknown as Hooks).__workbench.lines[i].mathml, index)
const commits = () =>
  wb.page.evaluate(() => (window as unknown as Hooks).__workbench.commits.map((c) => c.reason))

const dialog = () => wb.page.locator('[data-role="paste-review"]')
const preview = () => dialog().locator('[data-role="paste-preview"]')

// ⅆV/ⅆt: certain, nothing to ask.
const CERTAIN = `${f(r('ⅆV'), r('ⅆt'))}${r('=−')}${f(sSub(r('I'), r('ion')), sSub(r('C'), r('m')))}`
// dV/dt with italic d's: a derivative, or a fraction?
const ITALIC = `${f(r('dV'), r('dt'))}${r('=1')}`

test('an equation with nothing to ask goes in at the caret', async () => {
  await wb.pasteData({ 'text/html': word(CERTAIN), 'text/plain': 'linear text' })
  await expect(dialog()).toHaveCount(0)
  await wb.expectMathJson([
    'Equal',
    ['Derivative', 'V', 't'],
    ['Negate', ['Divide', 'I_ion', 'C_m']],
  ])
  expect(await lineMathml(0)).toContain('<diff/>')
  await expect(wb.line(0)).toBeFocused()
})

test('several equations go in as new lines after the active one, in one undo step', async () => {
  await wb.type('a=1')
  await wb.pasteData({ 'text/html': word(r('x=1'), r('y=2')) })

  await expect(wb.lines()).toHaveCount(3)
  await expect(wb.line(0)).toContainText('a')
  expect(await lineMathml(1)).toContain('<ci>x</ci>')
  expect(await lineMathml(2)).toContain('<ci>y</ci>')
  // The active line is committed, then each new one, as a paste.
  expect(await commits()).toEqual(['navigate', 'paste', 'paste'])
  await expect(wb.line(2)).toBeFocused()
  await expect(wb.status()).toContainText('Pasted 2 equations as new lines')

  await wb.press('ControlOrMeta+z')
  await expect(wb.lines()).toHaveCount(1)
  await expect(wb.line(0)).toContainText('a')
})

test('an empty active line takes the first of several', async () => {
  await wb.type('a=1')
  await wb.press('Enter')
  await wb.pasteData({ 'text/html': word(r('x=1'), r('y=2')) })
  await expect(wb.lines()).toHaveCount(3)
  expect(await lineMathml(1)).toContain('<ci>x</ci>')
  expect(await lineMathml(2)).toContain('<ci>y</ci>')
})

test('an assumption is reviewed first, and can be changed', async () => {
  await wb.pasteData({ 'text/html': word(ITALIC) })
  await expect(dialog()).toBeVisible()
  await expect(dialog()).toContainText('A derivative, or a fraction?')
  // Focus is in the dialog, but the line isn't committed for it.
  await expect(dialog().locator('[data-role="paste-confirm"]')).toBeFocused()
  expect(await commits()).toEqual([])

  const before = await preview().innerHTML()
  await dialog().getByText('The fraction dV over dt').click()
  await expect.poll(() => preview().innerHTML()).not.toBe(before)

  await dialog().locator('[data-role="paste-confirm"]').click()
  await expect(dialog()).toHaveCount(0)
  await wb.expectMathJson(['Equal', ['Divide', 'dV', 'dt'], 1])
  await expect(wb.line(0)).toBeFocused()
})

test('Enter pastes with what was assumed; Escape and Cancel paste nothing', async () => {
  await wb.pasteData({ 'text/html': word(ITALIC) })
  await expect(dialog()).toBeVisible()
  await wb.press('Escape')
  await expect(dialog()).toHaveCount(0)
  await expect(wb.line(0)).toBeFocused()
  await expect(wb.line(0)).not.toContainText('V')

  await wb.pasteData({ 'text/html': word(ITALIC) })
  await dialog().locator('[data-role="paste-cancel"]').click()
  await expect(dialog()).toHaveCount(0)
  await expect(wb.line(0)).not.toContainText('V')

  await wb.pasteData({ 'text/html': word(ITALIC) })
  await expect(dialog().locator('[data-role="paste-confirm"]')).toBeFocused()
  await wb.press('Enter')
  await expect(dialog()).toHaveCount(0)
  await wb.expectMathJson(['Equal', ['Derivative', 'V', 't'], 1])
})

test('what isn’t supported is reviewed, then marked on its line until edited', async () => {
  await wb.pasteData({
    'text/html': word(`${r('y=')}${nary('∑', r('i=1'), r('n'), sSub(r('x'), r('i')))}`),
  })
  await expect(dialog()).toBeVisible()
  await expect(dialog().locator('[data-role="paste-omissions"]')).toContainText('A sum')
  await expect(preview().locator('.me-review-omitted')).toHaveCount(1)
  await dialog().locator('[data-role="paste-confirm"]').click()

  await expect(wb.page.locator('[data-line="0"]')).toHaveClass(/has-error/)
  await expect(wb.status()).toContainText("A sum (∑_(i=1)^(n) x_i) isn't supported")
  await wb.press('End')
  await wb.type('+1')
  await expect.poll(() => wb.problems()).not.toContainEqual(expect.stringMatching(/A sum/))
  await expect(wb.page.locator('[data-line="0"]')).not.toHaveClass(/has-error/)
})

test('a paste inside a host’s dialog: Escape closes only the review', async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto('/?dialog&autofocus')
  await page.locator('[data-role="open-dialog"]').click()
  const field = page.locator('.p-dialog .math-field').first()
  await expect(field).toBeFocused()

  await wb.pasteData({ 'text/html': word(ITALIC) })
  await expect(dialog()).toBeVisible()
  await wb.press('Escape')
  await expect(dialog()).toHaveCount(0)
  await expect(page.locator('.p-dialog', { hasText: 'Edit equations' })).toBeVisible()
  await expect(field).toBeFocused()
})

test('read-only lines take no paste', async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto('/?readonly')
  await wb.focusLine(0)
  await wb.pasteData({ 'text/html': word(ITALIC) })
  await expect(dialog()).toHaveCount(0)
  expect(await lineMathml(0)).not.toContain('<ci>V</ci>')
})

test('Word’s MathML text no longer replaces the lines', async () => {
  await wb.type('a=1')
  await wb.press('Enter')
  await wb.type('b=2')
  await wb.page.evaluate(
    (text) => navigator.clipboard.writeText(text),
    wordMathML('<mml:mi>y</mml:mi><mml:mo>=</mml:mo><mml:mn>2</mml:mn>'),
  )
  await wb.press('ControlOrMeta+v')
  await expect(wb.lines()).toHaveCount(2)
  await expect(wb.line(1)).toContainText('b')
  expect(await lineMathml(1)).toContain('<ci>y</ci>')
})

// The same equation, though not the same atoms: a function typed is its
// letters, a function pasted one function atom.
test('Copy as Word equation puts MathML on the clipboard that pastes back the same', async () => {
  await wb.type('y=sin(x)^2+1/(x+1)')
  await wb.page.locator('[data-role="copy-as"]').click()
  await wb.page.getByRole('menuitem', { name: 'Word equation' }).click()
  const text = await wb.page.evaluate(() => navigator.clipboard.readText())
  expect(text).toMatch(/^<math xmlns="http:\/\/www.w3.org\/1998\/Math\/MathML"/)

  await wb.press('Enter')
  await wb.press('ControlOrMeta+v')
  await expect(dialog()).toHaveCount(0)
  await expect.poll(() => lineMathml(1)).toBe(await lineMathml(0))
})

test('brackets written as text read as brackets', async () => {
  await wb.pasteData({ 'text/html': word(`${r('2')}${d(r('a+b'))}`) })
  await wb.expectMathJson(['Multiply', 2, ['Add', 'a', 'b']])
})

test('GLUT2 transport is reviewed for its superscripts, and goes in with its decorated names', async () => {
  await wb.pasteData({ 'text/html': word(...GLUT2) })
  await expect(dialog()).toBeVisible()
  const assumptions = dialog().locator('[data-role="paste-assumptions"]')
  // Several italic superscript words: "Read all" heads them; the digit
  // questions come last.
  await expect(assumptions.locator('.assumption-all').first()).toHaveAttribute(
    'data-kind',
    'name-superscript',
  )
  await expect(assumptions.locator('fieldset').last()).toHaveAttribute(
    'data-kind',
    'digit-superscript',
  )
  const notes = dialog().locator('[data-role="paste-notes"]')
  await expect(notes).toContainText('Accents were read as parts of names')
  await expect(notes).toContainText('Square brackets round one name were read as its concentration')
  await expect(notes).toContainText('A full stop between two factors was read as multiplication')

  await dialog().locator('[data-role="paste-confirm"]').click()
  await expect(dialog()).toHaveCount(0)
  await expect(wb.lines()).toHaveCount(2)
  const first = await lineMathml(0)
  expect(first).toContain('<ci>kappa_hat_m__GLUT2</ci>')
  expect(first).toContain('<ci>Glc_conc_i</ci>')
  expect(first).toContain('<ci>k_io__GLUT2</ci>')
  const second = await lineMathml(1)
  expect(second).toContain('<ci>q_bar_i__Glc</ci>')
  expect(second).toContain('<ci>kappa_m__1</ci>')
})

test('digits on a name can be chosen as a label, part of the name', async () => {
  await wb.pasteData({ 'text/html': word(`${sSubSup(r('κ'), r('m'), r('2'))}${r('=1')}`) })
  await expect(dialog()).toBeVisible()
  await expect(dialog()).toContainText('A power, or part of the name?')
  await dialog().getByText('Part of the name: κ_m with the superscript 2 (kappa_m__2)').click()
  await dialog().locator('[data-role="paste-confirm"]').click()
  await expect(dialog()).toHaveCount(0)
  await wb.expectMathJson(['Equal', 'kappa_m__2', 1])
})
