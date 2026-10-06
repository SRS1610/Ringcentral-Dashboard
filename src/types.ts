export type Direction = 'Inbound' | 'Outbound'

/** RingCentral's call log holds faxes as well as phone calls; call metrics count only voice. */
export type CallKind = 'voice' | 'fax'

export interface CallRecord {
  callId: string
  kind: CallKind
  startTime: Date
  direction: Direction
  fromName: string
  fromNumber: string
  toName: string
  toNumber: string
  /** The team member (or shared line) on the account's side of the call. */
  extension: string
  extensionName: string
  /** RingCentral extension type ("User", "Department", …) when known; absent for CSV data. */
  extensionType?: string
  department: string
  durationSeconds: number
  result: string
  recorded: boolean
}

export interface QosRecord {
  date: Date
  queue: string
  offered: number
  answered: number
  abandoned: number
  serviceLevelPct: number
  avgSpeedAnswerSec: number
  avgHandleTimeSec: number
  longestWaitSec: number
}

export interface SmsRecord {
  messageId: string
  dateTime: Date
  direction: Direction
  from: string
  to: string
  extensionName: string
  department: string
  segments: number
  status: string
}

/** One user's calls on one day, as counted by RingCentral Analytics (the portal's Performance Report). */
export interface PerformanceRecord {
  /** Start of the day. */
  date: Date
  /** `YYYY-MM-DD` of that day in the time zone the report was requested in. */
  day: string
  /** Extension id of the user. */
  key: string
  extensionName: string
  extension: string
  department: string
  calls: number
  inbound: number
  outbound: number
  /** Inbound calls by first response. */
  answered: number
  notAnswered: number
  /** Outbound calls by first response. */
  connected: number
  notConnected: number
  missed: number
  voicemail: number
  abandoned: number
  businessHours: number
  afterHours: number
  holds: number
  transfers: number
  totalSec: number
  ringSec: number
  talkSec: number
  holdSec: number
}

export type DatasetKind = 'calls' | 'qos' | 'sms'

export type DatasetSource = 'site' | 'uploaded' | 'ringcentral'

export interface DateRange {
  start: Date
  end: Date
}

export type DateRangePreset = '7d' | '30d' | '90d' | 'mtd' | 'all' | 'custom'
