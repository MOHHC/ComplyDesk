'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { parseSubdomain } from '@complydesk/shared';
import { readToken } from '@/lib/session';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // At the root domain there is no tenant, so a stored token can't be
    // used for anything — /dashboard would 403 on /auth/me and bounce
    // straight back. Send people to the workspace finder instead.
    const onTenantSubdomain = parseSubdomain(window.location.hostname) !== null;
    if (!onTenantSubdomain) {
      router.replace('/login');
      return;
    }
    router.replace(readToken() ? '/dashboard' : '/login');
  }, [router]);

  return null;
}
