// What a paste is, from what's on the clipboard: which format it is read
// from, first match wins:
// 1. the editor's own format (CLIPBOARD_MIME), exactly as copied;
// 2. Word's equations, from its HTML (OMML; ommlReader.ts). Only HTML with
//    Word's equations in it, so HTML from elsewhere doesn't take this path;
// 3. Presentation MathML text: Word's, with "Copy MathML to the clipboard as
//    plain text" on, or another app's;
// 4. Content MathML text (a CellML model's maths);
// 5. Word's linear format (ⅆV/ⅆt, 𝑥, ▒): it can't be read, so the user is
//    told how to copy MathML instead;
// 6. otherwise LaTeX, or plain typed maths (clipboard.ts).
//
// Pure, so it can be tested without a browser's clipboard; MathField passes
// it the clipboard's data and acts on the result.

import { deserializeAtoms, latexToRow } from './clipboard'
import type { Row } from './layout'
import { type MathMLImport, importContentMathML, looksLikeContentMathML } from './mathmlImport'
import { hasWordMath, wordEquationsFromHtml } from './ommlReader'
import type { PresentationPaste } from './presentationImport'
import {
  looksLikePresentationMathML,
  presentationMathMLEquations,
} from './presentationMathmlReader'

export type PastedContent =
  // Atoms to insert at the caret: the editor's own, or LaTeX or text read.
  | { kind: 'atoms'; atoms: Row }
  | { kind: 'content-mathml'; result: MathMLImport }
  | { kind: 'presentation'; paste: PresentationPaste }
  // Nothing can be read; the message says why.
  | { kind: 'unreadable'; message: string }

export interface ClipboardText {
  // The editor's own format, text/html and text/plain.
  own?: string
  html?: string
  text?: string
}

// Characters only Word's linear format (UnicodeMath) writes: its differential
// and exponential d and e, function application, invisible times, the
// mathematical alphanumerics (𝑥), and its operators for building structures.
const LINEAR_FORMAT = /[ⅆ-ⅉ⁡⁢▒〖〗┤■█]|[\u{1D400}-\u{1D7FF}]/u

export const LINEAR_FORMAT_MESSAGE =
  'This looks like a Word equation as text, which can’t be read. In Word, open Equation Options and turn on “Copy MathML to the clipboard as plain text”, then copy the equation again.'

export function readPastedData({ own, html, text = '' }: ClipboardText): PastedContent {
  const atoms = deserializeAtoms(own)
  if (atoms) return { kind: 'atoms', atoms }

  if (html && hasWordMath(html)) {
    const word = wordEquationsFromHtml(html)
    if (word && (word.equations.length > 0 || !looksLikePresentationMathML(text))) {
      return {
        kind: 'presentation',
        paste: {
          source: 'word',
          equations: word.equations,
          textLeftOut: word.textLeftOut,
          problems: word.problems,
        },
      }
    }
  }

  if (looksLikePresentationMathML(text)) {
    const equations = presentationMathMLEquations(text)
    if (!equations) {
      return {
        kind: 'unreadable',
        message: "The pasted MathML isn't well-formed XML, so nothing was pasted",
      }
    }
    return {
      kind: 'presentation',
      paste: { source: 'mathml', equations, textLeftOut: false, problems: [] },
    }
  }

  if (looksLikeContentMathML(text)) {
    const result = importContentMathML(text)
    return result
      ? { kind: 'content-mathml', result }
      : {
          kind: 'unreadable',
          message: "The pasted MathML isn't well-formed XML, so nothing was imported",
        }
  }

  if (LINEAR_FORMAT.test(text)) return { kind: 'unreadable', message: LINEAR_FORMAT_MESSAGE }

  return { kind: 'atoms', atoms: latexToRow(text) }
}
