export type UserRole = 'merchandiser' | 'marketer' | 'supervisor' | 'admin'
export type AttendanceType = 'opening' | 'closing'
export type AttendanceStatus = 'on_site' | 'off_site' | 'flagged'
export type AlertType = 'left_geofence' | 'low_accuracy' | 'permission_denied' | 'off_site_clock'

export interface Outlet {
  id: string
  name: string
  address: string | null
  lat: number
  lng: number
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
  avatar_path: string | null
  is_active: boolean
  must_change_password: boolean
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
  lat: number
  lng: number
  accuracy_m: number
  distance_m: number | null
  outlet_lat: number | null
  outlet_lng: number | null
  outlet_radius_m: number | null
  status: AttendanceStatus | null
  selfie_path: string
  thumb_path: string | null
  device_info: Record<string, unknown>
  client_captured_at: string
  is_late: boolean
}

export interface AlertDetail {
  id: string
  user_id: string
  staff_name: string
  outlet_name: string | null
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
    lat: number
    lng: number
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
  selfie_path: string
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
