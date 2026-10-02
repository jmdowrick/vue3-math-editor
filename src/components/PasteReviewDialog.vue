<script setup lang="ts">
// Pasting Word's equations (or Presentation MathML): how they were read,
// before they go in. Shown when the reading made an assumption the user can
// change, or left something out (editor/presentationImport.ts).
//
// Each assumption has its options; choosing one re-reads the paste with the
// choices made, and the preview shows the result. They are listed by kind,
// each kind with several headed by a choice for all of them, and digit
// superscripts (κ_m^1: a power, or a label?) last. What was left out is
// listed, and its empty slot marked in the preview; pointing at an
// assumption or an omission marks its part of the equation. Paste (Enter)
// emits `closed` with the reading; Cancel, Escape or the close button with
// null. It is emitted once the dialog has gone, after it has given focus
// back to where it was, so the parent's insert can focus what it inserts.
import { computed, nextTick, ref, shallowRef, useId, watch } from 'vue'
import katex from 'katex'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import RadioButton from 'primevue/radiobutton'

import {
  type AssumptionKind,
  type PasteAssumption,
  type PresentationPaste,
  type PresentationReading,
  readPresentation,
} from '../editor/presentationImport'
import { KATEX_EDITOR_OPTIONS, rowToLatex } from '../renderers/layoutLatex'

const props = withDefaults(
  defineProps<{
    paste: PresentationPaste
    greekNames?: boolean
    typesetNames?: boolean
  }>(),
  { greekNames: true, typesetNames: true },
)

const emit = defineEmits<{
  closed: [reading: PresentationReading | null]
}>()

// For the radio buttons' labels.
const uid = `me-paste-${useId()}`

const visible = ref(true)
const choices = shallowRef<ReadonlyMap<string, string>>(new Map())
const reading = computed(() => readPresentation(props.paste, choices.value))

function choose(id: string, option: string) {
  choices.value = new Map(choices.value).set(id, option)
}

// One choice for every assumption of a kind, when there are several.
const ALL: Record<AssumptionKind, Record<string, string>> = {
  derivative: { derivative: 'Derivatives', fraction: 'Fractions' },
  exponential: { constant: 'Euler’s number', variable: 'Variables called e' },
  'name-superscript': { name: 'Parts of names', power: 'Powers' },
  'e-notation': { number: 'Numbers', product: 'Products' },
  'digit-superscript': { power: 'Powers', name: 'Labels (parts of names)' },
}
// The assumptions by kind, in the order first met, with digit superscripts
// last (there may be many, each most likely a power); each kind with several
// starts with its "Read all" choice.
const groups = computed(() => {
  const byKind = new Map<AssumptionKind, PasteAssumption[]>()
  for (const assumption of reading.value.assumptions) {
    byKind.set(assumption.kind, [...(byKind.get(assumption.kind) ?? []), assumption])
  }
  return [...byKind]
    .sort(([a], [b]) => Number(a === 'digit-superscript') - Number(b === 'digit-superscript'))
    .map(([kind, assumptions]) => ({
      kind,
      assumptions,
      options:
        assumptions.length > 1
          ? Object.entries(ALL[kind]).map(([id, label]) => ({ id, label }))
          : [],
    }))
})
function chooseAll(kind: AssumptionKind, option: string) {
  const next = new Map(choices.value)
  for (const assumption of reading.value.assumptions) {
    if (assumption.kind === kind) next.set(assumption.id, option)
  }
  choices.value = next
}

const several = computed(() => reading.value.equations.length > 1)
const header = computed(() => (props.paste.source === 'word' ? 'Paste from Word' : 'Paste MathML'))
const pasteLabel = computed(() =>
  several.value ? `Paste ${reading.value.equations.length} equations` : 'Paste',
)

const previews = computed(() =>
  reading.value.equations.map((root) =>
    katex.renderToString(
      rowToLatex(root, { greekNames: props.greekNames, typesetNames: props.typesetNames }),
      KATEX_EDITOR_OPTIONS,
    ),
  ),
)

const fragment = (latex: string) =>
  katex.renderToString(latex, { throwOnError: false, strict: 'ignore', displayMode: false })

// The preview's marks: what was left out, always; and the part of the
// equation the pointer (or focus) is on. Only the outermost atom of a part
// is marked, not every atom inside it too.
const previewEl = ref<HTMLElement | null>(null)
const pointed = ref<readonly string[]>([])
watch(
  [previews, pointed, previewEl],
  () =>
    void nextTick(() => {
      const root = previewEl.value
      if (!root) return
      const omitted = new Set(reading.value.omissions.flatMap((omission) => omission.atomIds))
      const marked = new Set(pointed.value)
      const atoms = Array.from(root.querySelectorAll<HTMLElement>('[data-atom]'))
      for (const atom of atoms) atom.classList.remove('me-review-omitted', 'me-review-pointed')
      for (const atom of atoms) {
        const id = atom.dataset.atom ?? ''
        const mark = (name: string) => {
          if (!atom.parentElement?.closest(`.${name}`)) atom.classList.add(name)
        }
        if (omitted.has(id)) mark('me-review-omitted')
        if (marked.has(id)) mark('me-review-pointed')
      }
    }),
  { immediate: true },
)

let result: PresentationReading | null = null
function confirm() {
  result = reading.value
  visible.value = false
}
function cancel() {
  result = null
  visible.value = false
}
</script>

<template>
  <!-- Teleported to the body, so the workbench's keys (Ctrl+Z, \) never see
       the dialog's; data-me-popover, so focus moving here doesn't count as
       leaving the lines. Escape is handled here, and stopped, so a dialog the
       workbench is in doesn't close as well. -->
  <Dialog
    v-model:visible="visible"
    modal
    :header="header"
    :draggable="false"
    :close-on-escape="false"
    append-to="body"
    class="me-paste-review"
    :style="{ width: 'min(42rem, calc(100vw - 2rem))' }"
    data-me-popover
    data-role="paste-review"
    @keydown.esc.stop.prevent="cancel"
    @after-hide="emit('closed', result)"
  >
    <div class="review">
      <section
        ref="previewEl"
        class="review-preview"
        aria-label="Preview"
        data-role="paste-preview"
      >
        <div v-for="(html, index) in previews" :key="index" class="preview-line">
          <span v-if="several" class="preview-number">{{ index + 1 }}</span>
          <div class="preview-math" v-html="html"></div>
        </div>
      </section>

      <section
        v-if="reading.assumptions.length"
        class="review-section"
        data-role="paste-assumptions"
      >
        <h3 class="review-heading">Check how these were read</h3>
        <template v-for="group in groups" :key="group.kind">
          <div v-if="group.options.length" class="assumption-all" :data-kind="group.kind">
            <span>Read all {{ group.assumptions.length }} as</span>
            <Button
              v-for="option in group.options"
              :key="option.id"
              :label="option.label"
              size="small"
              text
              @click="chooseAll(group.kind, option.id)"
            />
          </div>
          <fieldset
            v-for="assumption in group.assumptions"
            :key="assumption.id"
            class="assumption"
            :data-kind="assumption.kind"
            @mouseenter="pointed = assumption.atomIds"
            @mouseleave="pointed = []"
            @focusin="pointed = assumption.atomIds"
            @focusout="pointed = []"
          >
            <legend class="assumption-question">
              <span class="fragment" v-html="fragment(assumption.latex)"></span>
              <span>{{ assumption.question }}</span>
              <span v-if="several" class="assumption-line">equation {{ assumption.line + 1 }}</span>
            </legend>
            <div v-for="option in assumption.options" :key="option.id" class="assumption-option">
              <RadioButton
                :input-id="`${uid}-${assumption.id}-${option.id}`"
                :name="`${uid}-${assumption.id}`"
                :value="option.id"
                :model-value="assumption.chosen"
                :data-option="option.id"
                @update:model-value="choose(assumption.id, option.id)"
              />
              <label :for="`${uid}-${assumption.id}-${option.id}`">{{ option.label }}</label>
            </div>
          </fieldset>
        </template>
      </section>

      <section
        v-if="reading.omissions.length"
        class="review-section review-omissions"
        data-role="paste-omissions"
      >
        <h3 class="review-heading">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          Not supported ({{ reading.omissions.length }})
        </h3>
        <ul class="review-list">
          <li
            v-for="(omission, index) in reading.omissions"
            :key="index"
            @mouseenter="pointed = omission.atomIds"
            @mouseleave="pointed = []"
          >
            <template v-if="several && omission.line >= 0"
              >Equation {{ omission.line + 1 }}: </template
            >{{ omission.message }}
          </li>
        </ul>
      </section>

      <section v-if="reading.notes.length" class="review-section" data-role="paste-notes">
        <ul class="review-list review-notes">
          <li v-for="note in reading.notes" :key="note">{{ note }}</li>
        </ul>
      </section>
    </div>

    <template #footer>
      <Button label="Cancel" text severity="secondary" data-role="paste-cancel" @click="cancel" />
      <Button :label="pasteLabel" autofocus data-role="paste-confirm" @click="confirm" />
    </template>
  </Dialog>
</template>

<style scoped>
/* The workbench's colours (EquationWorkbench.vue), as the dialog is outside
   it. */
.review {
  --me-accent: var(--math-editor-accent, #2563eb);
  --me-subtle: var(--p-content-hover-background, #f1f5f9);
  --me-border: var(--p-content-border-color, #e2e8f0);
  --me-text: var(--p-text-color, #0f172a);
  --me-muted: var(--p-text-muted-color, #64748b);
  --me-warn: var(--math-editor-warn, #d97706);
  display: grid;
  gap: 1rem;
  color: var(--me-text);
}

.review-preview {
  display: grid;
  gap: 0.25rem;
  max-height: 14rem;
  overflow: auto;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--me-border);
  border-radius: 6px;
  background: var(--me-subtle);
}

.preview-line {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.preview-number {
  color: var(--me-muted);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

.preview-math {
  min-width: 0;
  overflow-x: auto;
}

.preview-math :deep(.katex-display) {
  margin: 0.25rem 0;
  text-align: left;
}

.preview-math :deep(.me-review-omitted) {
  border-radius: 3px;
  background: color-mix(in srgb, var(--me-warn) 18%, transparent);
  outline: 1px dashed var(--me-warn);
}

.preview-math :deep(.me-review-pointed) {
  border-radius: 3px;
  background: color-mix(in srgb, var(--me-accent) 18%, transparent);
  outline: 1px solid color-mix(in srgb, var(--me-accent) 60%, transparent);
}

.review-section {
  display: grid;
  gap: 0.5rem;
}

.review-heading {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
}

.assumption {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--me-border);
  border-radius: 6px;
}

.assumption-question {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0 0.25rem;
  font-weight: 500;
}

.assumption-line {
  color: var(--me-muted);
  font-size: 0.8rem;
  font-weight: 400;
}

.assumption-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.assumption-option label {
  cursor: pointer;
}

.assumption-all {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  color: var(--me-muted);
  font-size: 0.875rem;
}

.review-omissions .review-heading {
  color: color-mix(in srgb, var(--me-warn) 75%, var(--me-text));
}

.review-list {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.875rem;
}

.review-notes {
  color: var(--me-muted);
}
</style>
