export type UserRole = 'merchandiser' | 'marketer' | 'supervisor' | 'admin'
export type AttendanceType = 'opening' | 'closing'
export type AttendanceStatus = 'on_site' | 'off_site' | 'flagged'
export type AlertType = 'left_geofence' | 'low_accuracy' | 'permission_denied' | 'off_site_clock'

export interface Outlet {
  id: string
  name: string
  address: string | null
  /** Null while the store waits for its location (migration 030). */
  lat: number | null
  lng: number | null
  geofence_radius_m: number
  shift_start: string
  shift_end: string
  is_active: boolean
  created_at: string
}

export interface Profile {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  role: UserRole
  outlet_id: string | null
  /** Who this person reports to, independent of any store. */
  supervisor_id?: string | null
  avatar_path: string | null
  is_active: boolean
  must_change_password: boolean
  /** Excused by an admin from needing notifications on to clock in (027). */
  push_exempt?: boolean
  created_at: string
  updated_at: string
}

export interface AttendanceDetail {
  id: string
  user_id: string
  staff_name: string
  staff_phone: string | null
  attendance_date: string
  type: AttendanceType
  created_at: string
  local_time: string
  outlet_id: string | null
  outlet_name: string | null
  shift_start: string | null
  shift_end: string | null
  address: string | null
  place_name: string | null
  place_source: string | null
  /** Premises name and street, or the coordinates. Never empty. */
  location_label: string
  lat: number
  lng: number
  accuracy_m: number
  distance_m: number | null
  outlet_lat: number | null
  outlet_lng: number | null
  outlet_radius_m: number | null
  status: AttendanceStatus | null
  /** Null once the 24-hour retention sweep has deleted the photo. */
  selfie_path: string | null
  thumb_path: string | null
  device_info: Record<string, unknown>
  client_captured_at: string
  is_late: boolean
}

export interface AlertDetail {
  id: string
  user_id: string
  staff_name: string
  staff_phone: string | null
  outlet_name: string | null
  place_name: string | null
  address: string | null
  lat: number | null
  lng: number | null
  /** Where the alert happened. Null when it came from a ping, not a clock event. */
  location_label: string | null
  alert_type: AlertType
  distance_m: number | null
  is_resolved: boolean
  note: string | null
  created_at: string
  resolved_at: string | null
  resolved_by_name: string | null
  attendance_id: string | null
}

export interface DayState {
  date: string
  /** Marketers file the daily report; merchandisers do not. Set by Postgres. */
  can_file_report: boolean
  profile: Pick<Profile, 'id' | 'full_name' | 'role' | 'must_change_password' | 'is_active'> | null
  outlet: {
    id: string
    name: string
    address: string | null
    lat: number | null
    lng: number | null
    radius_m: number
    shift_start: string
    shift_end: string
  } | null
  opening: ClockSummary | null
  closing: ClockSummary | null
  report_filed: boolean
}

export interface ClockSummary {
  id: string
  at: string
  status: AttendanceStatus
  distance_m: number | null
  address: string | null
}

/** The payload the client is allowed to send. Nothing else is trusted. */
export interface ClockPayload {
  type: AttendanceType
  lat: number
  lng: number
  accuracy_m: number
  address: string | null
  place_name: string | null
  /** Null once the 24-hour retention sweep has deleted the photo. */
  selfie_path: string | null
  thumb_path: string | null
  device_info: Record<string, unknown>
  client_captured_at: string
}

/** Output of the tracking_coverage / my_coverage database functions. */
export interface Coverage {
  date: string
  shift_seconds: number
  tracked_seconds: number
  ping_count: number
  longest_gap_seconds: number
  last_ping_at: string | null
  coverage_pct: number | null
}
