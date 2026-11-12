/**
 * What the phone app must be allowed to do before someone can clock in or
 * out: location "all the time" (iPhone: "Always") and, on Android, no battery
 * saving for Xtend. Pure on purpose, so scripts/check-background-required.ts
 * can test it.
 *
 * Only a setting the app clearly reports as OFF is demanded. A browser, an
 * app build without the tracker, or one that does not report a setting says
 * nothing (null or undefined), and is never locked out: the gate must not
 * stop someone whose phone it cannot read.
 */
export interface BackgroundState {
  platform?: 'android' | 'ios' | string
  /** Location "Allow all the time" (iPhone: "Always"). */
  always?: boolean
  /** Android: battery saving will not stop Xtend. Always true on iPhone. */
  batteryUnrestricted?: boolean
}

export interface BackgroundNeeds {
  /** Location must be set to all the time. */
  always: boolean
  /** Battery saving must be turned off for Xtend (Android). */
  battery: boolean
  /** Either: the clock is held back until both are done. */
  blocked: boolean
}

/**
 * `batteryConfirmed`: the person says they turned battery saving off for
 * today, for phones (TECNO, Infinix, itel) that will not report the setting
 * even when it is off. Only the battery step can be confirmed this way;
 * location can always be read, so it is never waived.
 */
export function backgroundNeeds(
  state: BackgroundState | null | undefined,
  options: { batteryConfirmed?: boolean } = {},
): BackgroundNeeds {
  if (!state) return { always: false, battery: false, blocked: false }
  const always = state.always === false
  const battery = state.platform === 'android' && state.batteryUnrestricted === false && !options.batteryConfirmed
  return { always, battery, blocked: always || battery }
}
