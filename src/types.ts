export type Direction = 'Inbound' | 'Outbound'

export interface CallRecord {
  callId: string
  startTime: Date
  direction: Direction
  fromName: string
  fromNumber: string
  toName: string
  toNumber: string
  extension: string
  extensionName: string
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

export type DatasetKind = 'calls' | 'qos' | 'sms'

export type DatasetSource = 'sample' | 'uploaded'

export interface DateRange {
  start: Date
  end: Date
}

export type DateRangePreset = '7d' | '30d' | '90d' | 'mtd' | 'all'
