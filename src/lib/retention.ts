/**
 * How long a clock-in or clock-out photograph is kept. The selfie proves
 * who was at the door at the time; once the day has been checked it is a
 * face on file and nothing more, so it is deleted. Everything else about
 * the event — time, place, distance, status — is kept permanently.
 */
export const SELFIE_RETENTION_HOURS = 24

/** How often ordinary traffic is allowed to trigger the sweep. */
export const SELFIE_SWEEP_EVERY_MINUTES = 10

export const SELFIE_RETENTION_NOTE =
  'Clock photos are deleted 24 hours after they are taken. The time, place and distance are kept.'
