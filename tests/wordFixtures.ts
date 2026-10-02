// Word-like clipboard data for the paste tests, modelled on what Word for
// Windows puts on the clipboard: a whole HTML document whose equations are
// OMML in conditional comments, runs wrapped in <i> and <span> with unquoted
// attributes, and a picture of each equation as a fallback; and, with "Copy
// MathML to the clipboard as plain text" on, mml:-prefixed Presentation
// MathML as text. The files in tests/resources/word/ are whole examples.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const wordResource = (name: string) =>
  readFileSync(join(here, 'resources', 'word', name), 'utf8')

// OMML builders. A run is italic unless given a style (p: upright).
export const r = (text: string, sty?: 'p' | 'b' | 'i') =>
  `<i><span style='font-family:"Cambria Math",serif'><m:r>${sty ? `<m:rPr><m:sty m:val=${sty}/></m:rPr>` : ''}${text}</m:r></span></i>`
// Normal (non-maths) text.
export const nor = (text: string) =>
  `<m:r><m:rPr><m:nor/></m:rPr><span style='font-family:"Cambria Math"'>${text}</span></m:r>`
const ctrl = `<span style='font-family:"Cambria Math",serif;font-style:italic'><m:ctrlPr></m:ctrlPr></span>`
export const f = (num: string, den: string) =>
  `<m:f><m:fPr>${ctrl}</m:fPr><m:num>${num}</m:num><m:den>${den}</m:den></m:f>`
export const sSub = (e: string, sub: string) =>
  `<m:sSub><m:sSubPr>${ctrl}</m:sSubPr><m:e>${e}</m:e><m:sub>${sub}</m:sub></m:sSub>`
export const sSup = (e: string, sup: string) =>
  `<m:sSup><m:sSupPr>${ctrl}</m:sSupPr><m:e>${e}</m:e><m:sup>${sup}</m:sup></m:sSup>`
export const sSubSup = (e: string, sub: string, sup: string) =>
  `<m:sSubSup><m:sSubSupPr>${ctrl}</m:sSubSupPr><m:e>${e}</m:e><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup></m:sSubSup>`
export const d = (e: string, beg?: string, end?: string) =>
  `<m:d><m:dPr>${beg !== undefined ? `<m:begChr m:val="${beg}"/>` : ''}${end !== undefined ? `<m:endChr m:val="${end}"/>` : ''}${ctrl}</m:dPr><m:e>${e}</m:e></m:d>`
export const func = (name: string, e: string) =>
  `<m:func><m:funcPr>${ctrl}</m:funcPr><m:fName>${name}</m:fName><m:e>${e}</m:e></m:func>`
export const rad = (e: string, deg?: string) =>
  `<m:rad><m:radPr>${deg === undefined ? '<m:degHide m:val=1/>' : ''}${ctrl}</m:radPr><m:deg>${deg ?? ''}</m:deg><m:e>${e}</m:e></m:rad>`
export const nary = (chr: string, sub: string, sup: string, e: string) =>
  `<m:nary><m:naryPr><m:chr m:val="${chr}"/>${ctrl}</m:naryPr><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup><m:e>${e}</m:e></m:nary>`
// An accent: a dot unless given another mark, or Word's default (a hat,
// with no m:chr) for null.
export const acc = (e: string, chr: string | null = '̇') =>
  `<m:acc><m:accPr>${chr === null ? '' : `<m:chr m:val="${chr}"/>`}${ctrl}</m:accPr><m:e>${e}</m:e></m:acc>`
// A bar: under its base unless pos is top (Word's default is bot).
export const bar = (e: string, pos?: 'top' | 'bot') =>
  `<m:bar><m:barPr>${pos ? `<m:pos m:val="${pos}"/>` : ''}${ctrl}</m:barPr><m:e>${e}</m:e></m:bar>`
export const eqArr = (...rows: string[]) =>
  `<m:eqArr><m:eqArrPr>${ctrl}</m:eqArrPr>${rows.map((row) => `<m:e>${row}</m:e>`).join('')}</m:eqArr>`

// One display equation: a paragraph with the OMML in a conditional comment,
// and its picture.
export const paragraph = (omath: string, n = 1) =>
  `<p class=MsoNormal><!--[if gte msEquation 12]><m:oMathPara><m:oMath>${omath}</m:oMath></m:oMathPara><![endif]--><![if !msEquation]><span style='font-size:11.0pt;line-height:107%;position:relative;top:15.0pt;mso-text-raise:-15.0pt'><img width=161 height=41 src="file:///C:/Users/me/AppData/Local/Temp/msohtmlclip1/01/clip_image00${n}.png" v:shapes="_x0000_i102${n}"></span><![endif]><o:p></o:p></p>`

// Word's clipboard HTML around the paragraphs.
export const wordHtml = (...paragraphs: string[]) => `<html xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
xmlns="http://www.w3.org/TR/REC-html40">

<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<meta name=ProgId content=Word.Document>
<meta name=Generator content="Microsoft Word 15">
<style>
<!--
 /* Font Definitions */
 @font-face
	{font-family:"Cambria Math";
	panose-1:2 4 5 3 5 4 6 3 2 4;}
p.MsoNormal
	{margin-top:0cm;
	font-family:"Calibri",sans-serif;}
-->
</style>
</head>

<body lang=EN-NZ style='tab-interval:36.0pt;word-wrap:break-word'>
<!--StartFragment-->
${paragraphs.join('\n\n')}
<!--EndFragment-->
</body>

</html>`

// GLUT2 transport, as typed into Word (every run italic):
//   v_m^GLUT2 = κ̂_m^GLUT2 . ([Glc]_i − Q^eq_GLUT2 . [Glc]_o)
//                / (1 + [Glc]_i/k_i^GLUT2 + [Glc]_o/k_o^GLUT2 + [Glc]_i.[Glc]_o/k_io^GLUT2)
// and a saturation term with numbered constants:
//   q̄_i^Glc / (1 + q̄_i/κ_m^1 + q̄_o/κ_m^2)
const glc = (sub: string) => sSub(d(r('Glc'), '[', ']'), r(sub))
const kGlut2 = (sub: string) => sSubSup(r('k'), r(sub), r('GLUT2'))
export const GLUT2 = [
  `${sSubSup(r('v'), r('m'), r('GLUT2'))}${r('=')}${sSubSup(acc(r('κ'), null), r('m'), r('GLUT2'))}${r('.')}${f(
    `${glc('i')}${r('−')}${sSubSup(r('Q'), r('GLUT2'), r('eq'))}${r('.')}${glc('o')}`,
    `${r('1+')}${f(glc('i'), kGlut2('i'))}${r('+')}${f(glc('o'), kGlut2('o'))}${r('+')}${f(`${glc('i')}${r('.')}${glc('o')}`, kGlut2('io'))}`,
  )}`,
  f(
    sSubSup(acc(r('q'), '\u0305'), r('i'), r('Glc')),
    `${r('1+')}${f(sSub(acc(r('q'), '\u0305'), r('i')), sSubSup(r('κ'), r('m'), r('1')))}${r('+')}${f(sSub(acc(r('q'), '\u0305'), r('o')), sSubSup(r('κ'), r('m'), r('2')))}`,
  ),
]

// Equations, one paragraph each.
export const word = (...omaths: string[]) =>
  wordHtml(...omaths.map((omath, i) => paragraph(omath, i + 1)))

// Presentation MathML as Word writes it as text.
export const wordMathML = (body: string) =>
  `<mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><mml:mrow>${body}</mml:mrow></mml:math>`
