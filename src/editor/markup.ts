// Small helpers for reading maths markup pasted from elsewhere (Word's OMML,
// Presentation MathML), which may be parsed as XML or, when it isn't
// well-formed, as HTML: element and attribute names are compared on their
// local part, case-insensitively, so either way reads the same.

// An element's name without its prefix, in lower case: "oMath", "m:omath"
// and "mml:mfrac" are "omath" and "mfrac".
export const nameOf = (el: Element): string => el.localName.replace(/^.*:/, '').toLowerCase()

export const childElements = (el: Element): Element[] => Array.from(el.children)

// The first child element with this (lower-case, unprefixed) name.
export const child = (el: Element, name: string): Element | undefined =>
  childElements(el).find((c) => nameOf(c) === name)

// An attribute by its local name, whatever its prefix (m:val, val).
export function attributeOf(el: Element, name: string): string | null {
  for (const attribute of Array.from(el.attributes)) {
    if (attribute.name.replace(/^.*:/, '').toLowerCase() === name) return attribute.value
  }
  return null
}

const XML_ENTITIES = new Set(['lt', 'gt', 'amp', 'quot', 'apos'])
const decoded = new Map<string, string>()

// HTML's named entities (&nbsp;, &minus;, &InvisibleTimes;) as the characters,
// which an XML parser doesn't know. XML's own five are left as they are.
export function decodeNamedEntities(text: string): string {
  return text.replace(/&([A-Za-z][A-Za-z0-9]*);/g, (entity, name: string) => {
    if (XML_ENTITIES.has(name)) return entity
    let character = decoded.get(name)
    if (character === undefined) {
      const doc = new DOMParser().parseFromString(`<!doctype html><p>${entity}</p>`, 'text/html')
      character = doc.body.textContent ?? ''
      // Not an entity HTML knows: drop it, rather than break the XML.
      if (character === entity) character = ''
      decoded.set(name, character)
    }
    return character === '<' ? '&lt;' : character === '&' ? '&amp;' : character
  })
}

// Parsed as XML, or null if it isn't well-formed.
export function parseXml(text: string): Document | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  return doc.getElementsByTagName('parsererror').length > 0 ? null : doc
}
