import { useIDE } from './n2c-ui-ide-hooks'
import type { ActivityView } from './n2c-ui-ide-types'

interface ActivityItem {
  id: ActivityView
  label: string
}

const activities: ActivityItem[] = [
  { id: 'explorer', label: 'Explorer (Ctrl+B)' },
  { id: 'graph', label: 'Graph Editor' },
  { id: 'diagrams', label: 'Diagrams' },
  { id: 'settings', label: 'Settings' },
]

function ActivityIcon({ id }: { id: ActivityView }) {
  const props = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (id) {
    case 'explorer':
      return <svg {...props}><path d="M3 7V5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /><path d="M8 12h8M8 16h5" strokeWidth={1.2} /></svg>
    case 'graph':
      return <svg {...props}><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8.5 6h7M7.5 8.2l3.2 7.6M16.5 8.2l-3.2 7.6" strokeWidth={1.2} /></svg>
    case 'diagrams':
      return <svg {...props}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
    case 'settings':
      return <svg {...props}><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.93 4.93l2.12 2.12m9.9 9.9l2.12 2.12M4.93 19.07l2.12-2.12m9.9-9.9l2.12-2.12" /></svg>
  }
}

export default function ActivityBar() {
  const { activeView, setActiveView, sidebarCollapsed, toggleSidebar } = useIDE()

  const handleClick = (view: ActivityView) => {
    if (activeView === view && !sidebarCollapsed) {
      toggleSidebar()
    } else {
      setActiveView(view)
      if (sidebarCollapsed) toggleSidebar()
    }
  }

  return (
    <nav className="ide-activity-bar" aria-label="Activity Bar">
      <div className="ide-activity-top">
        {activities.map(activity => (
          <button
            key={activity.id}
            className={`ide-activity-button ${activeView === activity.id && !sidebarCollapsed ? 'ide-activity-button-active' : ''}`}
            onClick={() => handleClick(activity.id)}
            title={activity.label}
            aria-label={activity.label}
            type="button"
          >
            <ActivityIcon id={activity.id} />
          </button>
        ))}
      </div>
    </nav>
  )
}
