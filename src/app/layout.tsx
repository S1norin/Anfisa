import { NavLink, Outlet } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/operations', label: 'Operations' },
  { to: '/camera-lab', label: 'Camera Lab' },
  { to: '/schema', label: 'Schema' },
  { to: '/metrics', label: 'Metrics' },
] as const;

export function AppLayout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title" data-testid="app-title">
          Anfisa · Conveyor Barcode Station
        </span>
        <nav aria-label="Primary">
          <ul className="app-nav">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    isActive ? 'nav-link active' : 'nav-link'
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
