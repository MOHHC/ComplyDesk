'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PolicyDocStatus, PolicyDocument } from '@complydesk/shared';
import { useAuth } from '@/lib/useAuth';
import { listPolicyDocuments, uploadPolicyDocument } from '@/lib/api';
import { Badge, Button, Notice, Spinner } from '@/components/ui';
import { RegisterEmpty, RegisterHeader, RegisterSkeletonRows } from '@/components/register';

// @Roles(OWNER, ADMIN, CONTRIBUTOR) on POST /policy-documents — same
// boundary as evidence upload, hidden client-side as a UX nicety only.
const CAN_UPLOAD = new Set(['OWNER', 'ADMIN', 'CONTRIBUTOR']);

const STATUS_LABEL: Record<PolicyDocStatus, string> = {
  PROCESSING: 'Processing',
  READY: 'Ready',
  FAILED: 'Failed',
};

const STATUS_TONE: Record<PolicyDocStatus, 'verified' | 'expiring' | 'exception'> = {
  READY: 'verified',
  PROCESSING: 'expiring',
  FAILED: 'exception',
};

// Staggers a register row's entrance. Capped at the 8th row so a long,
// unfiltered list doesn't take seconds to finish revealing.
function rowEnterStyle(index: number): React.CSSProperties {
  return { transitionDelay: `${Math.min(index, 8) * 40}ms` };
}

export default function PolicyDocumentsPage() {
  const { token, me, ready } = useAuth();
  const [documents, setDocuments] = useState<PolicyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(() => {
    if (!token) return;
    setLoading(true);
    listPolicyDocuments(token)
      .then(setDocuments)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load policy documents'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadPolicyDocument(token, file);
      setFile(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="page-enter">
      <header className="mb-6 flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink">Policy documents</h1>
        <span className="font-mono text-[11px] text-ink-muted">{loading ? '—' : `${documents.length} on file`}</span>
      </header>

      {error && <Notice>{error}</Notice>}

      {me && CAN_UPLOAD.has(me.role) && (
        <form onSubmit={handleUpload} className="mb-8 border-b border-rule pb-6">
          <p className="mb-3 text-[13px] text-ink-muted">
            PDF, plain text, or Markdown. Uploading processes the document immediately — this can take a few
            seconds for a longer file.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
              className="text-[13px] text-ink-muted file:mr-3 file:cursor-pointer file:rounded-sm file:border file:border-rule file:bg-paper-raised file:px-3 file:py-1.5 file:text-[13px] file:text-ink hover:file:border-ink-muted/50"
            />
            <Button type="submit" disabled={uploading || !file} className="w-auto">
              {uploading ? (
                <>
                  <Spinner className="mr-2" />
                  Uploading & processing…
                </>
              ) : (
                'Upload'
              )}
            </Button>
          </div>
        </form>
      )}

      <RegisterHeader columns={['File', 'Uploaded', 'Status']} />
      {loading ? (
        <RegisterSkeletonRows count={4} />
      ) : documents.length === 0 ? (
        <RegisterEmpty>No policy documents uploaded yet.</RegisterEmpty>
      ) : (
        documents.map((doc, index) => (
          <div
            key={doc.id}
            style={rowEnterStyle(index)}
            className="register-row-enter flex items-center gap-4 border-b border-rule py-3.5 pr-1 pl-1"
          >
            <span className="flex-[1.4] truncate text-[14px] font-medium text-ink">{doc.fileName}</span>
            <span className="flex-1 tabular font-mono text-[12px] text-ink-muted">
              {new Date(doc.createdAt).toLocaleDateString()}
            </span>
            <span className="flex-1">
              <Badge tone={STATUS_TONE[doc.status]}>{STATUS_LABEL[doc.status]}</Badge>
            </span>
          </div>
        ))
      )}
    </div>
  );
}
