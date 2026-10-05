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
  backdated_clock: {
    label: 'Faked clock-in time',
    meaning:
      'A clock event saved "offline" claims a time before the phone was last in touch with Xtend. The time on the phone was changed to make it look earlier.',
  },
  phone_clock_wrong: {
    label: 'Phone clock changed',
    meaning:
      "The phone's clock was more than 5 minutes out at a clock event. Phones set their own time from the network, so someone changed it.",
  },
  late_sync_with_network: {
    label: 'Sent late with network',
    meaning:
      'A clock event was taken offline and sent much later, although the phone had network well before it was sent.',
  },
  vpn_suspected: {
    label: 'VPN or proxy',
    meaning:
      'The clock-in arrived through a VPN, proxy or datacentre IP address. Hiding the real network is what someone does to fake where they are.',
  },
  ip_location_mismatch: {
    label: 'GPS vs internet far apart',
    meaning:
      'The GPS pin and the internet address the clock-in came from are hundreds of kilometres apart. The GPS, the network, or both were manipulated.',
  },
  timezone_mismatch: {
    label: 'Phone zone not Nigeria',
    meaning:
      "The phone's time zone was not Nigeria's. Combined with a Nigerian GPS pin, that points to a changed location or a device somewhere else.",
  },
  gps_mock_fingerprint: {
    label: 'Fake-GPS fingerprint',
    meaning:
      'The GPS fix carried no altitude, speed or heading, the way a fake-location app feeds a bare coordinate. On its own it is weak; read it with the other flags.',
  },
  mock_location_confirmed: {
    label: 'Fake GPS confirmed',
    meaning:
      'The Xtend app (Android) reported that the location came from a mock provider: a fake-GPS app was switched on. This is proof, not a guess.',
  },
  device_integrity_failed: {
    label: 'Rooted / jailbroken phone',
    meaning:
      'The clock-in came from a rooted (Android) or jailbroken (iOS) phone, where location and app checks can be bypassed. Treat its location as untrusted.',
  },
}
