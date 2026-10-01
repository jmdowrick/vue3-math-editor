import { expect, test } from '@playwright/test'

import { Workbench } from './workbench'

// What an application embedding the workbench uses: setMathML (lines set from
// outside, as a new document), and the outputs, copy and history props.

let wb: Workbench

interface Host {
  lines: { mathml: string; variables: string[] }[]
  sources: string[]
  setMathML(xml: string): { equations: unknown[]; problems: string[] }
}

type Snapshot = { variables: string[][]; mathml: string[]; sources: string[] }

const snapshot = () =>
  wb.page.evaluate((): Snapshot => {
    const h = (window as unknown as { __workbench: Host }).__workbench
    return {
      variables: h.lines.map((line) => line.variables),
      mathml: h.lines.map((line) => line.mathml),
      sources: [...h.sources],
    }
  })
const setMathML = (xml: string) =>
  wb.page.evaluate(
    (text) => (window as unknown as { __workbench: Host }).__workbench.setMathML(text),
    xml,
  )
const lineVariables = async () => (await snapshot()).variables
const sources = async () => (await snapshot()).sources

const MODEL = `<math xmlns="http://www.w3.org/1998/Math/MathML">
  <apply><eq/><ci>a</ci><apply><plus/><ci>b</ci><cn>1</cn></apply></apply>
  <apply><eq/><ci>c</ci><ci>d</ci></apply>
</math>`

test.describe('setMathML', () => {
  test.beforeEach(async ({ page }) => {
    wb = new Workbench(page)
    await wb.goto()
  })

  test('replaces every line, one per equation, and returns the problems', async () => {
    await wb.focusLine(0)
    await wb.type('x=1')
    await wb.press('Enter')
    await wb.type('y=2')

    const result = await setMathML(MODEL)
    expect(result.problems).toEqual([])
    await expect(wb.lines()).toHaveCount(2)
    await expect.poll(lineVariables).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  test('the change is a load; the user’s next change is an edit', async () => {
    await expect.poll(sources).toEqual(['load'])
    await setMathML(MODEL)
    await expect.poll(sources).toEqual(['load', 'load'])

    await wb.focusLine(1)
    await wb.press('End')
    await wb.type('+e')
    await expect.poll(lineVariables).toEqual([
      ['a', 'b'],
      ['c', 'd', 'e'],
    ])
    const after = (await sources()).slice(2)
    expect(after.length).toBeGreaterThan(0)
    expect(after.every((source) => source === 'edit')).toBe(true)
  })

  test('there is no undo back past a load', async () => {
    await wb.focusLine(0)
    await wb.type('x=1')
    await setMathML(MODEL)
    await wb.focusLine(0)
    await wb.press('ControlOrMeta+z')
    await expect.poll(lineVariables).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    await expect(wb.page.locator('[data-role="undo"]')).toBeDisabled()
  })

  test('an empty string leaves one empty line', async () => {
    await setMathML(MODEL)
    await setMathML('')
    await expect(wb.lines()).toHaveCount(1)
    await expect.poll(async () => (await snapshot()).mathml).toEqual([''])
  })

  test('the lines’ MathML, loaded again, reads back as the same text', async () => {
    const model = `<math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>V</ci></apply>
        <apply><divide/><apply><minus/><ci>I_stim</ci><ci>I_ion</ci></apply><ci>C_m</ci></apply></apply>
      <apply><eq/><ci>alpha_m</ci><apply><times/><cn cellml:units="per_ms">0.1</cn>
        <apply><exp/><apply><minus/><apply><divide/><ci>V</ci><cn cellml:units="mV">18</cn></apply></apply></apply></apply></apply>
      <apply><eq/><ci>k</ci><cn cellml:units="dimensionless" type="e-notation">1.5<sep/>-3</cn></apply>
      <apply><eq/><ci>y</ci><piecewise>
        <piece><apply><root/><degree><cn>3</cn></degree><ci>x</ci></apply><apply><lt/><ci>x</ci><cn>0</cn></apply></piece>
        <otherwise><apply><log/><logbase><cn>2</cn></logbase><ci>x</ci></apply></otherwise>
      </piecewise></apply>
      <apply><eq/><ci>z</ci><apply><plus/><apply><arcsinh/><ci>x</ci></apply><apply><rem/><ci>a</ci><ci>b</ci></apply><pi/></apply></apply>
    </math>`
    expect((await setMathML(model)).problems).toEqual([])
    await expect(wb.lines()).toHaveCount(5)
    const first = (await snapshot()).mathml
    expect(first.every((text) => text.length > 0)).toBe(true)

    expect((await setMathML(first.join('\n'))).problems).toEqual([])
    await expect.poll(async () => (await snapshot()).mathml).toEqual(first)
  })

  test('malformed XML leaves the lines as they were', async () => {
    await setMathML(MODEL)
    const result = await setMathML('<apply><eq/>')
    expect(result.equations).toEqual([])
    expect(result.problems).toHaveLength(1)
    await expect(wb.lines()).toHaveCount(2)
  })

  test('what can’t be read is reported, and shown as its line’s problem', async () => {
    const result = await setMathML(
      '<apply><eq/><ci>a</ci><apply><factorial/><ci>n</ci></apply></apply>',
    )
    expect(result.problems).toEqual(["<factorial> isn't supported; it was left as an empty slot"])
    await expect(wb.line(0)).not.toContainText('(')
    await expect(wb.status()).toContainText("Line 1: <factorial> isn't supported")
  })
})

test('outputs off: no output panels and no "Copy as"', async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto('/?nooutputs')
  await expect(page.locator('[data-role="outputs"]')).toHaveCount(0)
  await expect(page.locator('[data-role="copy-as"]')).toHaveCount(0)
  await wb.focusLine(0)
  await wb.type('x=1')
  await expect.poll(lineVariables).toEqual([['x']])
})

test.describe('copy', () => {
  const handle = (line: number) =>
    wb.page.locator(`[data-line="${line}"] [data-role="line-handle"]`)
  const selected = () => wb.page.locator('[data-line][data-selected]')

  async function typeTwoLines() {
    await wb.focusLine(0)
    await wb.type('y=2x')
    await wb.press('Enter')
    await wb.type('z=y')
    await wb.focusLine(0)
  }

  test('outputs off, copy on: "Copy as" and line selection, without the output panels', async ({
    page,
  }) => {
    wb = new Workbench(page)
    await wb.goto('/?nooutputs&copy')
    await expect(page.locator('[data-role="outputs"]')).toHaveCount(0)
    await typeTwoLines()
    await handle(1).click({ modifiers: ['Shift'] })
    await expect(selected()).toHaveCount(2)
    await expect(page.locator('[data-role="copy-as"]')).toContainText('Copy 2 lines as')
  })

  test('copy off: the output panels, without "Copy as" or line selection', async ({ page }) => {
    wb = new Workbench(page)
    await wb.goto('/?nocopy')
    await expect(page.locator('[data-role="outputs"]')).toBeVisible()
    await expect(page.locator('[data-role="copy-as"]')).toHaveCount(0)
    await typeTwoLines()
    await handle(1).click({ modifiers: ['Shift'] })
    await expect(selected()).toHaveCount(0)
  })
})

test('history off: no undo buttons, and Ctrl+Z is left to the host', async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto('/?nohistory')
  await expect(page.locator('[data-role="undo"]')).toHaveCount(0)
  await expect(page.locator('[data-role="redo"]')).toHaveCount(0)

  await page.evaluate(() => {
    const seen: boolean[] = []
    Object.assign(window, { __undoSeen: seen })
    window.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        seen.push(event.defaultPrevented)
      }
    })
  })
  await wb.focusLine(0)
  await wb.type('ab')
  await wb.press('ControlOrMeta+z')
  expect(
    await page.evaluate(() => (window as unknown as { __undoSeen: boolean[] }).__undoSeen),
  ).toEqual([false])
  await expect.poll(lineVariables).toEqual([['ab']])
})
