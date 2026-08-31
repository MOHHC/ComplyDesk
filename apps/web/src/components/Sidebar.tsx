'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/controls', label: 'Controls' },
  { href: '/evidence', label: 'Evidence' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/settings', label: 'Settings' },
];

export function Sidebar() {
  const router = useRouter();

  function handleLogout() {
    localStorage.removeItem('accessToken');
    router.push('/login');
  }

  return (
    <nav aria-label="Main" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, flex: 1 }}>
        {NAV_ITEMS.map((item) => (
          <li key={item.href} style={{ margin: '0.25rem 0' }}>
            <Link href={item.href}>{item.label}</Link>
          </li>
        ))}
      </ul>
      <button type="button" onClick={handleLogout}>
        Log out
      </button>
    </nav>
  );
}
