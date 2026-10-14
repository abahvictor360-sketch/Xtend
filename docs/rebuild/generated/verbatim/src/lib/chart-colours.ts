/*
 * Chart colours, from the brand's own orange family, checked with the
 * data-viz palette validator (lightness band, chroma, colour-blind and
 * normal-vision separation, contrast on white). Gold's contrast on white
 * is 2.99:1, so every chart also labels each part with its count.
 *
 * Kept outside the client chart file so server pages can use the values.
 */
export const ON_TIME = '#d1511a'
export const LATE = '#c98500'
export const NOT_IN = '#8a3a12'

/*
 * The orange family the Attendance and Analytics pages draw with. A part
 * is never told by colour alone: every chart also prints its figures, and
 * the calendar marks each day with a letter.
 */
export const ORANGE = {
  main: '#d1511a',
  deep: '#9b3517',
  light: '#e8833a',
  dark: '#52281a',
  pale: '#f2b48a',
  track: '#f6e4d8',
} as const

/** What each kind of day is drawn in. */
export const DAY_COLOUR = {
  on_time: ORANGE.main,
  late: ORANGE.pale,
  off_site: ORANGE.deep,
  absent: ORANGE.dark,
  rest: ORANGE.track,
} as const
