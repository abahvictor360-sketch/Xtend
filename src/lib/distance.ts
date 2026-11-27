/**
 * Metres between two points on the Earth (haversine). The one copy in
 * Xtend (2026-11-27: there were four); used in the browser and on the
 * server. Display and checks only: the database measures the real distance.
 */
export function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
