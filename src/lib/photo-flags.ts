/**
 * Flagging a photo that is not right (migration 0092). Pure: shared by the
 * route, the day page and scripts/check-photo-flags.ts.
 */
export const PHOTO_FLAG_REASONS = ['not_them', 'not_at_store', 'photo_of_photo', 'unclear', 'other'] as const
export type PhotoFlagReason = (typeof PHOTO_FLAG_REASONS)[number]

export const PHOTO_FLAG_LABEL: Record<PhotoFlagReason, string> = {
  not_them: 'Not the right person',
  not_at_store: 'Not taken at the store',
  photo_of_photo: 'A photo of a photo or a screen',
  unclear: 'Face not clear',
  other: 'Something else',
}

export function isPhotoFlagReason(value: unknown): value is PhotoFlagReason {
  return typeof value === 'string' && (PHOTO_FLAG_REASONS as readonly string[]).includes(value)
}
