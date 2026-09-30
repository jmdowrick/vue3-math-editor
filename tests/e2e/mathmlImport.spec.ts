import { expect, test } from '@playwright/test'

import { Workbench } from './workbench'

// Pasting Content MathML: one equation goes in at the caret; several replace
// every line.

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

const paste = async (text: string) => {
  await wb.page.evaluate((value) => navigator.clipboard.writeText(value), text)
  await wb.press('ControlOrMeta+v')
}

// What the status bar says (the import's notice, or a line's problem).
const notice = () => wb.status()
// The lines' CellML-mode MathML, as the workbench reports it.
const lineMathml = (index: number) =>
  wb.page.evaluate(
    (i) =>
      (window as unknown as { __workbench: { lines: { mathml: string }[] } }).__workbench.lines[i]
        .mathml,
    index,
  )

const MODEL = `<math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
  <apply><eq/>
    <apply><diff/><bvar><ci>t</ci></bvar><ci>V</ci></apply>
    <apply><divide/><apply><minus/><ci>I_stim</ci><ci>I_ion</ci></apply><ci>C_m</ci></apply>
  </apply>
  <apply><eq/>
    <ci>I_ion</ci>
    <apply><times/><ci>g_K</ci><apply><minus/><ci>V</ci><ci>E_K</ci></apply></apply>
  </apply>
  <apply><eq/><ci>E_K</ci><cn cellml:units="mV">-77</cn></apply>
</math>`

test('one equation goes in at the caret, with its numbers’ units', async () => {
  await wb.type('y=')
  await paste('<apply><plus/><ci>x</ci><cn cellml:units="mV">2.5</cn></apply>')
  await wb.expectMathJson(['Equal', 'y', ['Add', 'x', 2.5]])
  await expect(wb.line(0).locator('.me-units-flag')).toHaveCount(1)
  await expect(notice()).toHaveCount(0)
  expect(await lineMathml(0)).toContain('<cn cellml:units="mV">2.5</cn>')
})

test('several equations replace every line, in one undo step', async () => {
  await wb.type('a=1')
  await wb.press('Enter')
  await wb.type('b=2')
  await paste(MODEL)

  await expect(wb.lines()).toHaveCount(3)
  // Each new line is committed, as a paste.
  expect(
    await wb.page.evaluate(() =>
      (
        window as unknown as { __workbench: { commits: { reason: string }[] } }
      ).__workbench.commits.map((commit) => commit.reason),
    ),
  ).toEqual(['enter', 'paste', 'paste', 'paste'])
  await expect(notice()).toContainText('Imported 3 equations')
  // I_ion, typeset: I with the subscript ion.
  expect(await lineMathml(1)).toContain('<ci>I_ion</ci>')
  await expect(wb.line(1).locator('.msupsub')).not.toHaveCount(0)
  expect(await lineMathml(2)).toContain('<cn cellml:units="mV">77</cn>')
  // Their variables are listed for their units.
  await expect(wb.page.locator('[data-role="variables"] tr[data-variable="g_K"]')).toHaveCount(1)

  await wb.press('ControlOrMeta+z')
  await expect(wb.lines()).toHaveCount(2)
  await expect(wb.line(0)).toContainText('a')
})

test('what can’t be read is left out, and a problem of its line until it is edited', async () => {
  await paste(
    '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>y</ci><apply><factorial/><ci>n</ci></apply></apply></math>',
  )
  await expect(wb.line(0)).not.toContainText('(')
  await expect(notice()).toContainText("Line 1: <factorial> isn't supported")
  await expect(wb.page.locator('[data-line="0"]')).toHaveClass(/has-error/)
  expect(
    await wb.page.evaluate(
      () =>
        (window as never as { __workbench: { lines: { complete: boolean }[] } }).__workbench
          .lines[0].complete,
    ),
  ).toBe(false)

  await wb.type('2')
  await expect(notice()).toHaveCount(0)
  await expect(wb.page.locator('[data-line="0"]')).not.toHaveClass(/has-error/)
})

test('MathML that isn’t well-formed imports nothing', async () => {
  await wb.type('x')
  await paste('<math><apply><eq/>')
  await expect(notice()).toContainText("isn't well-formed")
  await wb.expectMathJson('x')
})
