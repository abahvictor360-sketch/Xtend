/** Plain-language names for the integrity checks, shared by the page and the assistant. */
export const FLAG_KINDS: Record<string, { label: string; meaning: string }> = {
  repeated_exact_location: {
    label: 'Same GPS point again',
    meaning:
      'Clocked in at exactly the same point, to the centimetre, as on another day. Real GPS always moves a little; fake-location apps do not.',
  },
  perfect_accuracy: {
    label: 'Too-perfect GPS',
    meaning: 'The phone claimed accuracy under 2 m, which phones do not achieve indoors.',
  },
  impossible_journey: {
    label: 'Impossible journey',
    meaning: 'Moved faster than any car between two readings: one of them was probably faked.',
  },
  count_units_missing: {
    label: 'Units missing',
    meaning:
      'Fewer units left than the last count minus what was sold. Stock went somewhere: theft, unreported sales, or a wrong count.',
  },
  count_identical: {
    label: 'Copied count',
    meaning: 'Every number is exactly the same as the previous count.',
  },
  count_round_numbers: {
    label: 'Round numbers',
    meaning: 'Every number is a multiple of 10, which real counts rarely are.',
  },
  photo_rejected: {
    label: 'Photo rejected',
    meaning:
      'A photo was refused by the server check: a picture of a screen or a printed photo, no face, or too poor to use.',
  },
  photo_unchecked: {
    label: 'Photo not checked',
    meaning: 'The photo check was unavailable, so the photo was allowed without being looked at.',
  },
  own_named_place: {
    label: 'Self-named place',
    meaning:
      'Keeps clocking in, checking in or being found off-site at a place they named themselves that nobody else has visited. It could be their house given a shop name: look at the photo on the Places page.',
  },
  selfie_at_home: {
    label: 'Selfie at home',
    meaning:
      'The clock-in selfie looks like it was taken inside a home (bed, sofa, curtains). With a store GPS reading, that suggests a faked location.',
  },
}
