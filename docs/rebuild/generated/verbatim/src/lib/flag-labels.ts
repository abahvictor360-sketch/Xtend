/** A headline a supervisor can act on from the lock screen. */
export const FLAG_HEADLINE: Record<string, string> = {
  late_clock_in: 'clocked in late',
  early_clock_out: 'clocked out early',
  impossible_journey: 'location jumped impossibly far',
  repeated_exact_location: 'same exact GPS point as another day',
  perfect_accuracy: 'location looks faked',
  photo_rejected: 'photo rejected',
  selfie_at_home: 'selfie taken at home',
  backdated_clock: 'clock-in time was changed',
  phone_clock_wrong: 'phone clock was changed',
  own_named_place: 'keeps using a place only they named',
  count_units_missing: 'stock missing from the count',
  count_identical: 'count copied from the last one',
  vpn_suspected: 'using a VPN',
  ip_location_mismatch: 'network is far from the GPS location',
  timezone_mismatch: 'phone set to another time zone',
  gps_mock_fingerprint: 'location looks faked',
  mock_location_confirmed: 'fake GPS app in use',
  device_integrity_failed: 'phone has been tampered with',
}

/** What a flag is about, in a few words: "clocked in late". */
export function flagHeadline(kind: string): string {
  return FLAG_HEADLINE[kind] ?? 'needs a look'
}
