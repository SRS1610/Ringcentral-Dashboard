import { useState } from 'react'
import { DataProvider } from './state/DataContext'
import { RingCentralProvider } from './state/RingCentralContext'
import { Header } from './components/Header'
import { Tabs, type SectionKey } from './components/Tabs'
import { Overview } from './sections/Overview'
import { CallActivity } from './sections/CallActivity'
import { ServiceQuality } from './sections/ServiceQuality'
import { Messaging } from './sections/Messaging'
import { TeamPerformance } from './sections/TeamPerformance'
import { Settings } from './sections/Settings'

function Content({ section }: { section: SectionKey }) {
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
    case 'settings':
      return <Settings />
  }
}

function App() {
  const [section, setSection] = useState<SectionKey>('overview')

  return (
    <DataProvider>
      <RingCentralProvider>
        <div className="min-h-screen flex flex-col" style={{ background: 'var(--surface-0)' }}>
          <Header onOpenSettings={() => setSection('settings')} />
          <Tabs active={section} onChange={setSection} />
          <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex-1">
            <Content section={section} />
          </main>
          <footer className="border-t py-4 px-4 sm:px-6 text-xs text-center" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            Sample data is illustrative. Upload your own RingCentral exports, or connect live via Settings, to replace it.
          </footer>
        </div>
      </RingCentralProvider>
    </DataProvider>
  )
}

export default App
