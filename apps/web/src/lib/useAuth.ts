'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MeResponse } from '@complydesk/shared';
import { getMe } from './api';
import { clearToken, readToken } from './session';

/**
 * Every page under (dashboard) needs both the bearer token (to call the
 * API) and the resolved role (to conditionally show upload/assign
 * controls) — the layout's own auth check doesn't expose either to
 * children, so each page resolves it again itself. One extra /auth/me
 * round trip per navigation is an acceptable simplicity trade-off at
 * this scope.
 */
export function useAuth() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = readToken();
    if (!stored) {
      router.replace('/login');
      return;
    }
    setToken(stored);
    getMe(stored)
      .then(setMe)
      .catch((err) => {
        clearToken();
        setError(err instanceof Error ? err.message : 'Failed to load session');
        router.replace('/login');
      });
  }, [router]);

  return { token, me, error, ready: Boolean(token && me) };
}
