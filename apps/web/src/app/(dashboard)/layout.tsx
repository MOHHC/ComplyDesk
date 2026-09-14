'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { getMe } from '@/lib/api';
import { clearToken, consumeHandoffToken, readToken } from '@/lib/session';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    // Must run before the token check: arriving here straight from
    // signup on another subdomain, the token is in the URL fragment and
    // not yet in this origin's localStorage.
    consumeHandoffToken();

    const token = readToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    getMe(token)
      .then(() => setAuthorized(true))
      .catch(() => {
        clearToken();
        router.replace('/login');
      });
  }, [router]);

  if (!authorized) {
    return null;
  }

  return (
    <div className="page-enter flex min-h-dvh flex-col md:flex-row">
      {/* Full-width strip on small screens, rail from md up — the nav is
          never hidden behind a toggle. It now holds 6 items, so on
          narrow screens it scrolls horizontally with a visible
          scrollbar rather than collapsing into a menu. */}
      <aside className="w-full shrink-0 border-b border-rule md:w-[13.5rem] md:border-b-0 md:border-r">
        <div className="md:sticky md:top-0 md:h-dvh">
          <Sidebar />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-6 py-8 md:px-10 md:py-10">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
    </div>
  );
}
