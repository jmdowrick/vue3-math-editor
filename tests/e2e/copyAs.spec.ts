import { expect, test } from '@playwright/test'

import { Workbench } from './workbench'

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

const readClipboard = () => wb.page.evaluate(() => navigator.clipboard.readText())
const button = () => wb.page.locator('[data-role="copy-as"]')

async function copyAs(label: string) {
  await button().click()
  await wb.page.getByRole('menuitem', { name: label }).click()
}

test('is disabled for an empty equation', async () => {
  await expect(button()).toBeDisabled()
  await wb.type('x')
  await expect(button()).toBeEnabled()
})

test('copies the whole equation as MathJSON', async () => {
  await wb.type('y=1/x')
  await wb.press('ArrowRight')
  await wb.type('+1')
  await copyAs('MathJSON')

  await expect
    .poll(async () => JSON.parse(await readClipboard()))
    .toEqual(['Equal', 'y', ['Add', ['Divide', 1, 'x'], 1]])
  await expect(button()).toContainText('Copied MathJSON')
  await expect(wb.line(0)).toBeFocused()
})

test('copies the whole equation as Content MathML', async () => {
  await wb.type('x+1')
  await copyAs('Content MathML')

  await expect
    .poll(readClipboard)
    .toBe(
      [
        '<math xmlns="http://www.w3.org/1998/Math/MathML">',
        '  <apply>',
        '    <plus/>',
        '    <ci>x</ci>',
        '    <cn>1</cn>',
        '  </apply>',
        '</math>',
      ].join('\n'),
    )
})

test('copies as LaTeX, which pastes back', async () => {
  await wb.enterSample('roots-abs-derivative')
  await copyAs('LaTeX')
  await expect
    .poll(readClipboard)
    .toBe('\\sqrt{x+1}+\\sqrt[3]{y}-\\left|z\\right|=\\frac{\\mathrm{d}f}{\\mathrm{d}t}')

  const shape = await wb.shape(0)
  await wb.press('End')
  await wb.press('Enter')
  await wb.press('ControlOrMeta+v')
  await expect.poll(() => wb.shape(1)).toEqual(shape)
})

test('with a selection, copies just the selection and keeps it selected', async () => {
  await wb.type('y=a+b')
  await wb.press('Shift+ArrowLeft', 3)
  await expect(button()).toContainText('Copy selection as')

  await copyAs('MathJSON')
  await expect.poll(async () => JSON.parse(await readClipboard())).toEqual(['Add', 'a', 'b'])
  await expect(wb.line(0)).toBeFocused()
  await expect(wb.selection()).toHaveText('root 2–5')

  await copyAs('Content MathML')
  await expect.poll(readClipboard).toContain('<plus/>')
  await expect.poll(readClipboard).not.toContain('<eq/>')
})

test('the MathML panel shows the same document', async () => {
  await wb.type('x+1')
  await expect(wb.page.locator('[data-role="mathml"]')).toContainText(
    '<math xmlns="http://www.w3.org/1998/Math/MathML">',
  )
})

test.describe('CellML mode', () => {
  test.beforeEach(async () => {
    await wb.goto('/?cellml')
    await wb.focusLine(0)
  })

  test('the Content MathML panel is CellML-ready', async () => {
    await wb.type('y=2x')
    await expect(wb.page.locator('[data-role="cellml-mode"]')).toBeVisible()
    const panel = wb.page.locator('[data-role="mathml"]')
    await expect(panel).toContainText('xmlns:cellml="http://www.cellml.org/cellml/2.0#"')
    await expect(panel).toContainText('<cn cellml:units="dimensionless">2</cn>')
  })

  test('copies CellML-ready Content MathML', async () => {
    await wb.type('y=2x')
    await copyAs('Content MathML (CellML)')
    await expect.poll(readClipboard).toContain('<cn cellml:units="dimensionless">2</cn>')
    await expect.poll(readClipboard).toContain('xmlns:cellml="http://www.cellml.org/cellml/2.0#"')
  })
})

test('without CellML mode, Content MathML has no CellML markup', async () => {
  await wb.type('y=2x')
  await expect(wb.page.locator('[data-role="cellml-mode"]')).toHaveCount(0)
  await expect(wb.page.locator('[data-role="mathml"]')).toContainText('<cn>2</cn>')
  await expect(wb.page.locator('[data-role="mathml"]')).not.toContainText('cellml')
})

test('the LaTeX panel shows the same LaTeX as copying', async () => {
  const panel = wb.page.locator('[data-role="latex"]')
  await expect(panel).toHaveText('')

  await wb.type('Vm_init=2Vm*sin(t)')
  await wb.press('End')
  await wb.type('+1/x')
  const expected =
    '\\mathit{Vm}_{\\mathit{init}}=2\\mathit{Vm}\\cdot \\sin \\left(t\\right)+\\frac{1}{x}'
  await expect(panel).toHaveText(expected)

  await copyAs('LaTeX')
  await expect.poll(readClipboard).toBe(expected)
})

test.describe('several lines', () => {
  const handle = (line: number) =>
    wb.page.locator(`[data-line="${line}"] [data-role="line-handle"]`)
  const selected = () => wb.page.locator('[data-line][data-selected]')

  test.beforeEach(async () => {
    await wb.type('y=2x')
    await wb.press('Enter')
    await wb.type('z=y+1')
    await wb.press('Enter')
    await wb.type('w=z')
    await wb.focusLine(0)
  })

  test('Shift+click a number selects the lines from the active one, copied as one', async () => {
    await handle(2).click({ modifiers: ['Shift'] })
    await expect(selected()).toHaveCount(3)
    await expect(button()).toContainText('Copy 3 lines as')
    await expect(wb.line(0)).toBeFocused()

    await copyAs('MathJSON')
    await expect
      .poll(async () => JSON.parse(await readClipboard()))
      .toEqual([
        ['Equal', 'y', ['Multiply', 2, 'x']],
        ['Equal', 'z', ['Add', 'y', 1]],
        ['Equal', 'w', 'z'],
      ])
    // Still selected, to copy again.
    await expect(selected()).toHaveCount(3)

    await copyAs('LaTeX')
    await expect
      .poll(readClipboard)
      .toBe(
        ['\\begin{aligned}', 'y &= 2x \\\\', 'z &= y+1 \\\\', 'w &= z', '\\end{aligned}'].join(
          '\n',
        ),
      )

    await copyAs('Content MathML')
    await expect.poll(async () => (await readClipboard()).match(/<math\b/g)).toHaveLength(1)
    await expect.poll(async () => (await readClipboard()).match(/<eq\/>/g)).toHaveLength(3)
  })

  test('Ctrl/Cmd+click adds or removes one line', async () => {
    await handle(2).click({ modifiers: ['ControlOrMeta'] })
    await expect(selected()).toHaveCount(2)
    await expect(wb.page.locator('[data-line="1"][data-selected]')).toHaveCount(0)

    await handle(0).click({ modifiers: ['ControlOrMeta'] })
    await expect(selected()).toHaveCount(1)
    await expect(button()).toContainText('Copy line 3 as')
    await copyAs('MathJSON')
    await expect.poll(async () => JSON.parse(await readClipboard())).toEqual(['Equal', 'w', 'z'])
  })

  test('Escape, typing or a click into a line clears them', async () => {
    await handle(1).click({ modifiers: ['Shift'] })
    await expect(selected()).toHaveCount(2)
    await wb.press('Escape')
    await expect(selected()).toHaveCount(0)
    await expect(button()).toHaveText(/Copy as/)

    await handle(1).click({ modifiers: ['Shift'] })
    await wb.type('1')
    await expect(selected()).toHaveCount(0)

    await handle(2).click({ modifiers: ['Shift'] })
    await wb.line(2).click()
    await expect(selected()).toHaveCount(0)
  })
})
