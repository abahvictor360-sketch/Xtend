/**
 * Words for location turned off during a shift (migration 0115). Pure, so
 * scripts/check-location-off.ts can test them.
 */

/** To the supervisor and admins. */
export function locationOffAlert(o: {
  name: string
  since: string
  minutes: number
  lastPlace: string | null
  lastAt: string | null
}): { title: string; body: string } {
  const last = o.lastAt ? ` Last seen${o.lastPlace ? ` at ${o.lastPlace}` : ''} at ${o.lastAt}.` : ''
  return {
    title: `${o.name}'s location is off`.slice(0, 80),
    body: `${o.name} turned off location at ${o.since} and it has been off for ${o.minutes} min while clocked in.${last} Call them to turn it back on.`.slice(0, 400),
  }
}

/** On the person's phone (also in the Android and iPhone trackers, word for word). */
export const TURN_LOCATION_ON = {
  title: 'Turn your location back on',
  body: 'Xtend needs your location on while you are at work. Tap to turn it on.',
} as const
