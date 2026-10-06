import { useState } from 'react'
import { DataProvider, useData } from './state/DataContext'
import { RingCentralProvider } from './state/RingCentralContext'
import { Header } from './components/Header'
import { Tabs, type SectionKey } from './components/Tabs'
import { UploadPanel } from './components/UploadPanel'
import { EmptyState } from './components/EmptyState'
import { Overview } from './sections/Overview'
import { CallActivity } from './sections/CallActivity'
import { ServiceQuality } from './sections/ServiceQuality'
import { Messaging } from './sections/Messaging'
import { TeamPerformance } from './sections/TeamPerformance'
import { Settings } from './sections/Settings'

type DashboardSection = Exclude<SectionKey, 'settings'>
type DatasetKey = 'calls' | 'qos' | 'sms' | 'perf'

/** Which datasets each tab reads, and what to say when none of them has any rows. */
const NEEDS: Record<DashboardSection, { datasets: DatasetKey[]; title: string; body: string }> = {
  overview: {
    datasets: ['calls', 'qos', 'sms'],
    title: 'No data yet',
    body: 'Unlock live data in Settings to import calls, SMS and service quality from RingCentral, or upload RingCentral export files.',
  },
  calls: {
    datasets: ['calls'],
    title: 'No call data yet',
    body: 'Unlock live data in Settings to import the call log from RingCentral, or upload a RingCentral Call Log Report export.',
  },
  quality: {
    datasets: ['qos', 'perf'],
    title: 'No service quality data yet',
    body: 'This tab shows the RingCentral Analytics performance report: how each person’s calls were answered, and talk, ring and hold times. Accounts with call queues also get service level and abandon rate. Both need live data and the Analytics permission on the RingCentral app.',
  },
  messaging: {
    datasets: ['sms'],
    title: 'No SMS data yet',
    body: 'Unlock live data in Settings to import SMS from RingCentral, or upload a RingCentral message log export.',
  },
  team: {
    datasets: ['calls'],
    title: 'No call data yet',
    body: 'Team rankings are built from the call log. Unlock live data in Settings to import it, or upload a Call Log Report export.',
  },
}

function Content({ section, onOpenSettings, onOpenUpload }: { section: SectionKey; onOpenSettings: () => void; onOpenUpload: () => void }) {
  const data = useData()
  if (section === 'settings') return <Settings />

  const need = NEEDS[section]
  const loading = need.datasets.some((k) => data[k].loading)
  if (!loading && need.datasets.every((k) => data[k].records.length === 0)) {
    return (
      <EmptyState
        title={need.title}
        body={need.body}
        onOpenSettings={onOpenSettings}
        onOpenUpload={onOpenUpload}
      />
    )
  }

  switch (section) {
    case 'overview':
      return <Overview />
    case 'calls':
      return <CallActivity />
    case 'quality':
      return <ServiceQuality />
    case 'messaging':
      return <Messaging />
    case 'team':
      return <TeamPerformance />
  }
}

function App() {
  const [section, setSection] = useState<SectionKey>('overview')
  const [uploadOpen, setUploadOpen] = useState(false)
  const openSettings = () => setSection('settings')
  const openUpload = () => setUploadOpen(true)

  return (
    <DataProvider>
      <RingCentralProvider>
        <div className="min-h-screen flex flex-col" style={{ background: 'var(--surface-0)' }}>
          <Header onOpenSettings={openSettings} onOpenUpload={openUpload} />
          <Tabs active={section} onChange={setSection} />
          <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex-1">
            <Content section={section} onOpenSettings={openSettings} onOpenUpload={openUpload} />
          </main>
          <footer className="border-t py-4 px-4 sm:px-6 text-xs text-center" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            Data comes from RingCentral: live through the dashboard server, the scheduled sync, or export files you upload.
          </footer>
          {uploadOpen && <UploadPanel onClose={() => setUploadOpen(false)} />}
        </div>
      </RingCentralProvider>
    </DataProvider>
  )
}

export default App
