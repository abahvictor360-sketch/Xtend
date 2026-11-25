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
  /** Android: who made the phone ("tecno", "infinix", …), from app builds of 2026-11-25. */
  maker?: string
}

/**
 * Makers whose phones stop apps their own way (Transsion: TECNO, Infinix,
 * itel), whatever Android's battery setting says: Xtend must be allowed to
 * Auto-start and be locked in the recent apps. Android cannot tell whether
 * that is done, so the person confirms it once on the phone.
 */
export const STRICT_MAKERS = ['tecno', 'infinix', 'itel']

export function strictMaker(state: BackgroundState | null | undefined): string | null {
  const maker = (state?.maker ?? '').toLowerCase()
  if (state?.platform !== 'android' || !maker) return null
  const hit = STRICT_MAKERS.find((m) => maker.includes(m))
  return hit ? { tecno: 'TECNO', infinix: 'Infinix', itel: 'itel' }[hit] ?? hit : null
}

export interface BackgroundNeeds {
  /** Location must be set to all the time. */
  always: boolean
  /** Battery saving must be turned off for Xtend (Android). */
  battery: boolean
  /** TECNO, Infinix, itel: Auto-start on and Xtend locked in recent apps, not yet confirmed. */
  maker: boolean
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
  options: { batteryConfirmed?: boolean; makerConfirmed?: boolean } = {},
): BackgroundNeeds {
  if (!state) return { always: false, battery: false, maker: false, blocked: false }
  const always = state.always === false
  const battery = state.platform === 'android' && state.batteryUnrestricted === false && !options.batteryConfirmed
  const maker = strictMaker(state) !== null && !options.makerConfirmed
  return { always, battery, maker, blocked: always || battery || maker }
}
