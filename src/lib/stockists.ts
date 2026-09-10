export interface Stockist {
  name: string
  region: string
}

/**
 * The customer list names a region, never a street. "Ebeano Supermarket
 * Lekki" is findable; "Ebeano Supermarket" on its own is one of nine. So
 * each region becomes a place hint that is searched alongside the name.
 */
const REGION_HINT: Record<string, string> = {
  MAINLAND: 'Lagos Mainland, Lagos, Nigeria',
  ISLAND: 'Lekki, Lagos, Nigeria',
  TRADEFAIR: 'Trade Fair Complex, Ojo, Lagos, Nigeria',
  PH: 'Port Harcourt, Rivers, Nigeria',
  ABUJA: 'Abuja, FCT, Nigeria',
  BENIN: 'Benin City, Edo, Nigeria',
  IBADAN: 'Ibadan, Oyo, Nigeria',
  OWERRI: 'Owerri, Imo, Nigeria',
  'AKWA IBOM': 'Uyo, Akwa Ibom, Nigeria',
  ABEOKUTA: 'Abeokuta, Ogun, Nigeria',
  ASABA: 'Asaba, Delta, Nigeria',
  AKURE: 'Akure, Ondo, Nigeria',
  AWKA: 'Awka, Anambra, Nigeria',
  ENUGU: 'Enugu, Nigeria',
  YENOGOA: 'Yenagoa, Bayelsa, Nigeria',
  OSUN: 'Osogbo, Osun, Nigeria',
  EKITI: 'Ado-Ekiti, Ekiti, Nigeria',
  ILORIN: 'Ilorin, Kwara, Nigeria',
  ABIA: 'Umuahia, Abia, Nigeria',
  ABA: 'Aba, Abia, Nigeria',
  ONITSHA: 'Onitsha, Anambra, Nigeria',
  CALABAR: 'Calabar, Cross River, Nigeria',
  ABAKALIKI: 'Abakaliki, Ebonyi, Nigeria',
  KANO: 'Kano, Nigeria',
  BORNO: 'Maiduguri, Borno, Nigeria',
  KADUNA: 'Kaduna, Nigeria',
  DELTA: 'Delta State, Nigeria',
}

export function regionHint(region: string): string {
  return REGION_HINT[region.trim().toUpperCase()] ?? 'Nigeria'
}

/**
 * The name plus only the part of the hint it does not already say.
 * "247 Supermarket, Uyo" wants "Akwa Ibom, Nigeria" after it, not
 * "Uyo, Akwa Ibom, Nigeria" — repeating the town confuses the search as
 * often as it helps.
 */
export function stockistQuery(row: Stockist): string {
  const name = row.name.trim()
  const lower = name.toLowerCase()
  const rest = regionHint(row.region)
    .split(', ')
    .filter((part) => !lower.includes(part.toLowerCase()))
  return rest.length ? `${name}, ${rest.join(', ')}` : name
}

/**
 * Trade Fair traders and named individuals are people, not premises. A
 * geofence round "ABUCHI" or "Doris" would be a fence round a market
 * stall that moves, so they are left out of the import by default rather
 * than pinned somewhere wrong.
 */
export function isVisitableStore(row: Stockist): boolean {
  const region = row.region.trim().toUpperCase()
  if (region === 'TRADEFAIR' || region === 'INDIVIDUAL') return false
  // A one- or two-word entry with no trading words in it is a person.
  return /supermarket|mall|store|stores|pharmac|cosmetic|mart|market|shop|plaza|superstore|venture|beauty|centre|center|hub|limited|ltd|enterprise|plc|plaz|plus|depot|chemist|outlet|complex/i.test(
    row.name,
  )
}
