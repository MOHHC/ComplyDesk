import Link from 'next/link';

/**
 * Shared primitives for the auth surfaces and the register rows.
 *
 * Structure here is carried by hairline rules, never by shadows or
 * cards — the reference is an auditor's working paper, where a row's
 * meaning comes from its column and its mark, not from a floating
 * container.
 */

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-mono text-[13px] font-medium tracking-tight text-ink ${className}`}>
      Comply<span className="text-ink-muted">Desk</span>
    </span>
  );
}

/** Single-column form on paper. Used by all three auth screens so signing
 * in feels continuous with the register you're signing into. */
export function AuthShell({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col justify-center px-6 py-16">
      <div className="mb-8 flex items-baseline justify-between border-b border-rule pb-3">
        <Wordmark />
        <span className="font-mono text-[11px] text-ink-muted">Audit readiness</span>
      </div>

      <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.015em] text-ink">
        {title}
      </h1>
      {intro && <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{intro}</p>}

      <div className="mt-7">{children}</div>

      {footer && (
        <div className="mt-8 border-t border-rule pt-4 text-[13px] text-ink-muted">{footer}</div>
      )}
    </main>
  );
}

export function Field({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = props.id ?? props.name ?? label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        {...props}
        className={`w-full rounded-sm border border-rule bg-paper-raised px-3 py-2.5 text-[14px] text-ink transition-colors duration-150 placeholder:text-ink-muted/60 hover:border-ink-muted/50 focus:border-ink focus:outline-none ${props.className ?? ''}`}
      />
      {hint && <p className="mt-1.5 font-mono text-[11px] text-ink-muted">{hint}</p>}
    </div>
  );
}

/** Primary actions are ink, not a brand hue — see globals.css. */
export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' }) {
  const base =
    'inline-flex w-full cursor-pointer items-center justify-center rounded-sm px-4 py-2.5 text-[14px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55';
  const styles =
    variant === 'primary'
      ? 'bg-ink text-paper hover:bg-ink/88'
      : 'border border-rule bg-transparent text-ink hover:border-ink-muted/60 hover:bg-paper-raised';
  return (
    <button {...props} className={`${base} ${styles} ${props.className ?? ''}`}>
      {children}
    </button>
  );
}

/** A continuously-spinning "still working" indicator for actions known to
 * take real time (gap analysis, evidence upload+classification, policy
 * processing) — a static disabled button with no motion reads as frozen,
 * not busy. `linear` timing, not ease: constant motion (this, unlike a
 * one-shot entrance) should never appear to accelerate or decelerate.
 * The fully circular shape (`rounded-full`) is a deliberate, narrow
 * exception to the app's crisp `--radius-sm`/`--radius-lg` scale — a
 * spinner has to be a true circle to read as one. Paper-colored, not
 * ink-colored: every call site places it on a `variant="primary"`
 * Button, whose fill is ink — an ink spinner would be invisible on it. */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-[13px] w-[13px] shrink-0 animate-spin rounded-full border-2 border-paper/30 border-t-paper ${className}`}
    />
  );
}

/** Errors state what happened, in the interface's voice. Marked with the
 * exception ink — the same color a missing control carries — so the
 * meaning of that color stays consistent everywhere. */
export function Notice({
  tone = 'exception',
  children,
  role = 'alert',
}: {
  tone?: 'exception' | 'neutral';
  children: React.ReactNode;
  role?: 'alert' | 'status';
}) {
  const accent = tone === 'exception' ? 'border-l-exception' : 'border-l-ink-muted';
  const text = tone === 'exception' ? 'text-exception' : 'text-ink-muted';
  return (
    <p role={role} className={`border-l-2 ${accent} py-1 pl-3 text-[13px] leading-relaxed ${text}`}>
      {children}
    </p>
  );
}

/** A compact status mark for a table/register cell — the mono, boxed
 * counterpart to Notice's prose-toned alerts. Tone follows the same
 * verified/expiring/exception triad as everywhere else; 'neutral' is
 * for states that carry no compliance meaning (e.g. a task's TODO
 * status), never used for anything status.css governs. */
export function Badge({
  tone,
  children,
}: {
  tone: 'verified' | 'expiring' | 'exception' | 'neutral';
  children: React.ReactNode;
}) {
  const styles: Record<typeof tone, string> = {
    verified: 'border-verified/35 bg-verified/10 text-verified',
    expiring: 'border-expiring/35 bg-expiring/10 text-expiring',
    exception: 'border-exception/35 bg-exception/10 text-exception',
    neutral: 'border-rule bg-paper-raised text-ink-muted',
  };
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[11px] font-medium whitespace-nowrap ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="cursor-pointer font-medium text-ink underline decoration-rule underline-offset-[3px] transition-colors duration-150 hover:decoration-ink"
    >
      {children}
    </Link>
  );
}
