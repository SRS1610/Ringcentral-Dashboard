/** Bar colours for call results; anything not listed gets the neutral series colour. */
export const OUTCOME_COLORS: Record<string, string> = {
  'Call connected': 'var(--status-good)',
  Accepted: 'var(--status-good)',
  Missed: 'var(--status-critical)',
  Voicemail: 'var(--series-1)',
  Rejected: 'var(--status-serious)',
  Busy: 'var(--status-warning)',
}

export const outcomeColor = (result: string): string => OUTCOME_COLORS[result] ?? 'var(--series-7)'
