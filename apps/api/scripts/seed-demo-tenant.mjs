// One-off operational script, not wired into any npm lifecycle hook.
// Populates the public "demo" tenant on complydesk.online by driving the
// real API — real signup, real evidence upload (real Gemini
// classification calls), a real policy-document upload (real chunking +
// embedding), and a real gap-analysis run (real Groq call) — rather than
// hand-inserting rows, so what a visitor sees is exactly what the app
// actually produces, not a mock of it. Run by hand:
//
//   node scripts/seed-demo-tenant.mjs
//
// Safe to point at a fresh tenant only — it does not attempt to be
// idempotent about re-seeding an existing one (see README for the
// separate follow-up script that flips isDemo + forces the one
// deliberately-FAILED classification row, which this script cannot do
// over the public API).

const API = process.env.DEMO_API_URL ?? 'https://complydesk-api.onrender.com';
const TENANT_SLUG = 'demo';
const TENANT_NAME = 'Northwind Labs (Demo)';
const EMAIL = 'demo@complydesk.online';
const PASSWORD = 'ComplyDeskDemo123!';
const OWNER_NAME = 'Demo Owner';

function file(name, mimeType, content) {
  return new File([content], name, { type: mimeType });
}

async function api(path, { method = 'GET', token, body, isForm = false } = {}) {
  const headers = { 'X-Tenant-Slug': TENANT_SLUG };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  console.log(`Seeding demo tenant against ${API} ...`);

  let token;
  try {
    const signup = await api('/auth/signup', {
      method: 'POST',
      body: { email: EMAIL, password: PASSWORD, name: OWNER_NAME, tenantName: TENANT_NAME, tenantSlug: TENANT_SLUG },
    });
    token = signup.accessToken;
    console.log('Signed up fresh demo tenant.');
  } catch (err) {
    console.log('Signup failed (tenant probably already exists), trying login instead:', err.message);
    const login = await api('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
    token = login.accessToken;
    console.log('Logged in to existing demo tenant.');
  }

  const me = await api('/auth/me', { token });
  const userId = me.userId;

  const controls = await api('/controls', { token });
  const byCode = Object.fromEntries(controls.map((c) => [c.code, c.id]));

  async function uploadEvidence(code, filename, mimeType, content, notes) {
    const form = new FormData();
    form.append('file', file(filename, mimeType, content));
    form.append('notes', notes);
    const result = await api(`/controls/${byCode[code]}/evidence`, {
      method: 'POST',
      token,
      isForm: true,
      body: form,
    });
    console.log(
      `  ${code}: uploaded, classification -> ${result.classification?.status ?? 'none'}` +
        (result.classification?.suggestedControlId
          ? ` (suggested ${controls.find((c) => c.id === result.classification.suggestedControlId)?.code})`
          : ' (no match)'),
    );
    return result;
  }

  console.log('Uploading evidence...');

  const mfa = await uploadEvidence(
    'AC-04',
    'okta-mfa-policy.txt',
    'text/plain',
    `Okta sign-on policy export, effective 2026-01-01.\n\n` +
      `All users in the "Northwind Labs" org are required to enroll a second factor (Okta Verify push or a hardware ` +
      `security key) before completing sign-in. The global session policy enforces this at the identity-provider level ` +
      `for every application connected via SSO, including production AWS accounts, GitHub, and the internal admin ` +
      `console. Users with no enrolled factor are blocked from authenticating; there is no bypass group.`,
    'Okta sign-on policy export showing MFA enforced org-wide.',
  );

  await uploadEvidence(
    'DP-01',
    'encryption-configuration.txt',
    'text/plain',
    `Infrastructure encryption configuration summary.\n\n` +
      `In transit: all external and internal service-to-service traffic is TLS 1.2+ only, enforced at the load ` +
      `balancer (legacy TLS 1.0/1.1 ciphers disabled). At rest: the production Postgres database and the S3-compatible ` +
      `object storage bucket are both encrypted using AES-256 with keys managed through the cloud provider's KMS, ` +
      `rotated automatically on a 90-day schedule.`,
    'Summary of TLS and at-rest encryption configuration across infra.',
  );

  await uploadEvidence(
    'VM-02',
    'vendor-review-2026.txt',
    'text/plain',
    `Annual vendor security review — 2026.\n\n` +
      `Reviewed: Neon (database hosting), Vercel (frontend hosting), Render (API hosting), Google Gemini API, Groq API. ` +
      `Each vendor's SOC 2 report or equivalent security documentation was collected and filed; no material findings. ` +
      `Next review due 2027-Q1.`,
    'Completed annual review of all data-processing subprocessors.',
  );

  const training = await uploadEvidence(
    'HR-01',
    'security-training-completion.txt',
    'text/plain',
    `Security awareness training completion log.\n\n` +
      `All 12 employees completed the onboarding security awareness module (phishing recognition, password hygiene, ` +
      `incident reporting) within their first week, tracked via the training platform's completion export.`,
    'Training platform completion export for all current employees.',
  );

  // Deliberately irrelevant upload, to show the AI correctly declining a
  // match rather than forcing a low-confidence guess onto some control.
  await uploadEvidence(
    'AC-01',
    'unrelated-file.txt',
    'text/plain',
    `Grandma's banana bread recipe.\n\n` +
      `Ingredients: 3 ripe bananas, 1/3 cup melted butter, 1 tsp baking soda, pinch of salt, 3/4 cup sugar, 1 egg, ` +
      `1 tsp vanilla, 1.5 cups flour. Mash bananas, mix in melted butter, then remaining ingredients. Bake at 350F ` +
      `for 55-60 minutes.`,
    'Uploaded by mistake — kept in the demo on purpose to show how the AI handles it.',
  );

  console.log('Reviewing one classification (confirming the MFA match)...');
  if (mfa.classification?.id) {
    await api(`/controls/${byCode['AC-04']}/evidence/${mfa.id}/classification`, {
      method: 'PATCH',
      token,
      body: { decision: 'confirm' },
    });
  }

  console.log('Creating tasks...');
  const inDays = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

  const t1 = await api('/tasks', {
    method: 'POST',
    token,
    body: {
      title: 'Renew MFA policy documentation',
      description: 'Re-export the Okta sign-on policy for this quarter.',
      controlId: byCode['AC-04'],
      assigneeId: userId,
      dueDate: inDays(-3),
    },
  });
  await api(`/tasks/${t1.id}/status`, { method: 'PATCH', token, body: { status: 'DONE' } });

  const t2 = await api('/tasks', {
    method: 'POST',
    token,
    body: {
      title: 'Collect Q1 vendor security review',
      description: 'Follow up with Render and Groq for updated security documentation.',
      controlId: byCode['VM-02'],
      assigneeId: userId,
      dueDate: inDays(7),
    },
  });
  await api(`/tasks/${t2.id}/status`, { method: 'PATCH', token, body: { status: 'IN_PROGRESS' } });

  await api('/tasks', {
    method: 'POST',
    token,
    body: {
      title: 'Upload backup restore test evidence',
      description: 'Run the quarterly restore drill and attach the report.',
      controlId: byCode['BC-01'],
      assigneeId: userId,
      dueDate: inDays(14),
    },
  });

  console.log('Uploading policy document (this triggers real chunking + embedding)...');
  const policyForm = new FormData();
  policyForm.append(
    'file',
    file(
      'information-security-policy.md',
      'text/markdown',
      `# Northwind Labs Information Security Policy\n\n` +
        `## Access Control\n` +
        `All employee access is provisioned on a least-privilege basis and reviewed quarterly by the security team. ` +
        `Multi-factor authentication is required for every system that touches customer data or production ` +
        `infrastructure, with no exceptions.\n\n` +
        `## Encryption\n` +
        `All data in transit uses TLS 1.2 or higher. All data at rest in our database and object storage is encrypted ` +
        `using AES-256 with provider-managed keys.\n\n` +
        `## Vendor Management\n` +
        `Any third party that processes customer data is reviewed annually and must provide a current SOC 2 report or ` +
        `equivalent attestation before onboarding.\n\n` +
        `## Security Awareness\n` +
        `All employees complete a security awareness training module during their first week, covering phishing, ` +
        `password hygiene, and incident reporting.\n\n` +
        `## Incident Response\n` +
        `The security team maintains a documented incident response plan, reviewed annually, with a defined ` +
        `escalation path and a target first-response time of under one hour for critical incidents.\n`,
    ),
  );
  await api('/policy-documents', { method: 'POST', token, isForm: true, body: policyForm });

  console.log('Waiting 15s for policy-document chunking to finish before running gap analysis...');
  await new Promise((r) => setTimeout(r, 15000));

  console.log('Running gap analysis (real Groq call, can take up to ~60-90s)...');
  const run = await api('/gap-analysis/run', { method: 'POST', token });
  console.log(`Gap analysis run complete: ${run.results?.length ?? 0} results.`);

  console.log('\nDone. Remember to run the follow-up: node scripts/mark-tenant-demo.mjs');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
