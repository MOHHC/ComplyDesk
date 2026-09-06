'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Wordmark } from '@/components/ui';
import { clearToken } from '@/lib/session';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  // Evidence is uploaded/viewed from a control's own page (it's always
  // scoped to one control), not a standalone list — no separate nav entry.
  { href: '/controls', label: 'Controls' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/policy-documents', label: 'Policy documents' },
  { href: '/gap-analysis', label: 'Gap analysis' },
];

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();

  function handleLogout() {
    clearToken();
    router.push('/login');
  }

  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      {/* Log out sits up here on mobile so the nav row below holds only
          navigation and fits without scrolling. */}
      <div className="flex items-center justify-between px-5 py-4 md:border-b md:border-rule">
        <Wordmark />
        <button
          type="button"
          onClick={handleLogout}
          className="cursor-pointer text-[13px] text-ink-muted transition-colors duration-150 hover:text-ink md:hidden"
        >
          Log out
        </button>
      </div>

      {/* Horizontal on small screens, vertical rail from md. The active
          marker follows the axis: a bottom rule when laid out in a row,
          a left rule in the gutter when stacked. */}
      <ul className="nav-scroll flex list-none gap-1 overflow-x-auto px-3 pb-1 md:flex-1 md:flex-col md:gap-0 md:overflow-visible md:px-2 md:py-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`block cursor-pointer border-b-2 px-2 py-2 text-[14px] whitespace-nowrap transition-colors duration-150 md:border-b-0 md:border-l-2 md:px-3 ${
                  active
                    ? 'border-b-ink font-medium text-ink md:border-b-transparent md:border-l-ink md:bg-paper-raised'
                    : 'border-b-transparent text-ink-muted hover:text-ink md:border-l-transparent md:hover:border-l-rule'
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}

        {/* Settings has no page yet. Rendered as text rather than a link
            so it is not focusable or clickable, with the state named
            plainly instead of hidden in a tooltip. */}
        <li className="md:mt-0">
          <span
            aria-disabled="true"
            className="flex cursor-not-allowed items-baseline gap-2 border-b-2 border-b-transparent px-2 py-2 text-[14px] whitespace-nowrap text-ink-muted/55 md:justify-between md:border-b-0 md:border-l-2 md:border-l-transparent md:px-3"
          >
            Settings
            <span className="font-mono text-[10px] tracking-tight text-ink-muted/55">soon</span>
          </span>
        </li>
      </ul>

      <div className="hidden border-t border-rule px-2 py-3 md:block">
        <button
          type="button"
          onClick={handleLogout}
          className="w-full cursor-pointer rounded-sm px-3 py-2 text-left text-[13px] text-ink-muted transition-colors duration-150 hover:bg-paper-raised hover:text-ink"
        >
          Log out
        </button>
      </div>
    </nav>
  );
}
