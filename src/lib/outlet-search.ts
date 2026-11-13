/**
 * Finding shops in a long list (Store allocation): every word typed must
 * appear in the shop's name or address, in any order, ignoring case and
 * accents. Pure, so scripts/check-allocate.ts can test it.
 */
export interface SearchableOutlet {
  id: string
  name: string
  address: string | null
}

function fold(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function searchOutlets<T extends SearchableOutlet>(outlets: T[], query: string): T[] {
  const words = fold(query).split(/[\s,]+/).filter(Boolean)
  if (words.length === 0) return outlets
  return outlets.filter((o) => {
    const text = fold(`${o.name} ${o.address ?? ''}`)
    return words.every((w) => text.includes(w))
  })
}
