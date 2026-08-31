'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signup } from '@/lib/api';

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    tenantName: '',
    tenantSlug: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { accessToken } = await signup(form);
      localStorage.setItem('accessToken', accessToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Sign up</h1>
      <label>
        Name
        <input value={form.name} onChange={update('name')} required />
      </label>
      <label>
        Email
        <input type="email" value={form.email} onChange={update('email')} required />
      </label>
      <label>
        Password
        <input
          type="password"
          value={form.password}
          onChange={update('password')}
          required
          minLength={8}
        />
      </label>
      <label>
        Workspace name
        <input value={form.tenantName} onChange={update('tenantName')} required />
      </label>
      <label>
        Workspace URL
        <input
          value={form.tenantSlug}
          onChange={update('tenantSlug')}
          required
          pattern="[a-z0-9-]+"
          title="Lowercase letters, numbers, and hyphens only"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Signing up…' : 'Sign up'}
      </button>
      <p>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </form>
  );
}
