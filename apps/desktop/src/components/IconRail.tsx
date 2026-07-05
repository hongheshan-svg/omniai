import type { WorkspaceNavItem, WorkspaceView } from "../navModel";

const icons: Record<WorkspaceView, JSX.Element> = {
  studio: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    </svg>
  ),
  assets: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  tasks: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  )
};

export interface IconRailProps {
  items: WorkspaceNavItem[];
  active: WorkspaceView;
  activeTaskCount: number;
  onSelect(view: WorkspaceView): void;
}

export function IconRail({ items, active, activeTaskCount, onSelect }: IconRailProps) {
  return (
    <aside className="rail">
      <span className="logo" aria-hidden="true" />
      <nav aria-label="Workspace views" className="rail-nav">
        {items.map((item) => (
          <button
            key={item.view}
            type="button"
            aria-pressed={active === item.view}
            onClick={() => onSelect(item.view)}
          >
            {icons[item.view]}
            <span className="rail-label">{item.label}</span>
            {item.view === "tasks" && activeTaskCount > 0 ? (
              <span className="badge" aria-hidden="true">
                {activeTaskCount}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
    </aside>
  );
}
