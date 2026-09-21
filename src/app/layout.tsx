import { NavLink, Outlet } from 'react-router-dom';

/**
 * t2-1: How It Works is the home screen. The other four routes stay
 * registered in App.tsx (deep links + their engines keep working) but are
 * no longer linked from the top navigation.
 */
const NAV_ITEMS = [
  { to: '/how-it-works', label: 'How It Works' },
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
