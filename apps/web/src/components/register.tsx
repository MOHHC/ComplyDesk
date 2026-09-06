/**
 * Shared shell for the register-style list views (Controls, Tasks,
 * Policy Documents, Gap Analysis report). A "register" here is the
 * dashboard's own pattern generalized: a ruled header row of column
 * labels, then hairline-separated rows — never a card grid, never a
 * shadow. Row bodies stay page-specific (each list's columns differ too
 * much to force through one generic <Table>); only the header, empty,
 * and loading chrome are shared.
 */

export function RegisterHeader({ columns }: { columns: string[] }) {
  return (
    <div className="flex gap-4 border-b border-rule pb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
      {columns.map((col) => (
        <span key={col} className="flex-1 first:flex-[1.4]">
          {col}
        </span>
      ))}
    </div>
  );
}

export function RegisterEmpty({ children }: { children: React.ReactNode }) {
  return <p className="border-b border-rule py-6 text-[13px] text-ink-muted">{children}</p>;
}

export function RegisterSkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-l-2 border-rule border-l-transparent py-3.5 pr-1 pl-4"
        >
          <span className="h-4 flex-[1.4] rounded-sm bg-rule/50" />
          <span className="h-4 flex-1 rounded-sm bg-rule/35" />
          <span className="h-4 flex-1 rounded-sm bg-rule/35" />
        </div>
      ))}
    </div>
  );
}
