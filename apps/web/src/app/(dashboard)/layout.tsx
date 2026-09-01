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
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 220, borderRight: '1px solid #e2e2e2', padding: '1rem' }}>
        <Sidebar />
      </aside>
      <main style={{ flex: 1, padding: '1.5rem' }}>{children}</main>
    </div>
  );
}
