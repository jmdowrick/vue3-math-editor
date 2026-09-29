// A prop's value, replaced only when its content changes. A host that rebuilds
// an equal object (its variables' units after every commit, say) would
// otherwise make everything computed from it run again. Computed values that
// don't change don't wake what depends on them, so this one hands back the
// previous object while the new one is the same as JSON.

import { type ComputedRef, computed } from 'vue'

export function contentStable<T>(source: () => T): ComputedRef<T> {
  let last: { key: string; value: T } | null = null

  return computed(() => {
    const value = source()
    const key = JSON.stringify(value) ?? ''
    if (last && last.key === key) return last.value
    last = { key, value }
    return value
  })
}
