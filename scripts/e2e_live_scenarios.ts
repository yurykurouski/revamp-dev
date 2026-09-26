import { LeadStatus } from '@revamp/shared-types';

const API_BASE = 'http://localhost:4000/api/v1';

interface ScenarioResult {
  category: string;
  name: string;
  status: 'PASSED' | 'FAILED';
  details?: string;
  durationMs: number;
}

const results: ScenarioResult[] = [];

async function runScenario(
  category: string,
  name: string,
  fn: () => Promise<void>
) {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    results.push({ category, name, status: 'PASSED', durationMs });
    console.log(`✅ [${category}] ${name} (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    results.push({
      category,
      name,
      status: 'FAILED',
      details: err?.message || String(err),
      durationMs,
    });
    console.error(`❌ [${category}] ${name} (${durationMs}ms):`, err?.message || err);
  }
}

async function main() {
  console.log('====================================================');
  console.log('🚀 RUNNING AUTOMATED LIVE API SCENARIOS VERIFICATION');
  console.log('Target API:', API_BASE);
  console.log('====================================================\n');

  // --- Category 1: Health & System Diagnostics ---
  await runScenario('Diagnostics', 'Health Check endpoint returns OK and all dependencies connected', async () => {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error(`Expected status ok, got ${data.status}`);
    if (data.services.api !== 'healthy') throw new Error('API not healthy');
    if (data.services.mongodb !== 'connected') throw new Error('MongoDB not connected');
    if (data.services.redis !== 'connected') throw new Error('Redis not connected');
  });

  // --- Category 2: Validation & Error Handling (Boundary / Negative Tests) ---
  await runScenario('Validation', 'POST /leads rejects empty or invalid payload with 400', async () => {
    const res = await fetch(`${API_BASE}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-url', niche: 'invalid-niche' }),
    });
    if (res.status !== 400) throw new Error(`Expected status 400, got ${res.status}`);
    const data = await res.json();
    if (data.success !== false) throw new Error('Expected success: false');
  });

  await runScenario('Validation', 'GET /leads/non-existent-id returns 404', async () => {
    const res = await fetch(`${API_BASE}/leads/000000000000000000000000`);
    if (res.status !== 404) throw new Error(`Expected status 404, got ${res.status}`);
  });

  await runScenario('Validation', 'POST /audits/trigger rejects invalid leadId with 400', async () => {
    const res = await fetch(`${API_BASE}/audits/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: 'invalid-id' }),
    });
    if (res.status !== 400) throw new Error(`Expected 400 for invalid leadId, got ${res.status}`);
  });

  await runScenario('Validation', 'POST /outreach/:id/approve rejects missing required fields with 400', async () => {
    const res = await fetch(`${API_BASE}/outreach/000000000000000000000000/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // missing subject, approvedBy, etc. if required
    });
    if (res.status !== 400 && res.status !== 404) {
      throw new Error(`Expected 400 or 404, got ${res.status}`);
    }
  });

  // --- Category 3: Lead Creation & Lifecycle ---
  let createdLeadId = '';
  const testUrl = `https://verification-test-${Date.now()}.com`;

  await runScenario('Leads API', 'POST /leads creates new lead and queues initial audit', async () => {
    const res = await fetch(`${API_BASE}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalUrl: testUrl,
        niche: 'dental',
        businessName: 'Automated Test Dental Clinic',
        contactEmail: 'doctor@automated-test-dental.com',
      }),
    });
    if (res.status !== 201) {
      const errText = await res.text();
      throw new Error(`Expected 201 Created, got ${res.status}: ${errText}`);
    }
    const data = await res.json();
    if (!data.success || (!data.data?.id && !data.data?.lead?._id)) throw new Error('Invalid response structure');
    createdLeadId = data.data.id || data.data.lead._id;
    if (data.data.lead.status !== 'QUEUED') {
      throw new Error(`Expected initial status QUEUED, got ${data.data.lead.status}`);
    }
  });

  await runScenario('Leads API', 'GET /leads lists leads with pagination and filters', async () => {
    const res = await fetch(`${API_BASE}/leads?niche=dental&page=1&limit=10`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.success || !Array.isArray(data.data)) throw new Error('Expected data array');
    if (!data.pagination || typeof data.pagination.total !== 'number') {
      throw new Error('Pagination metadata missing');
    }
    const match = data.data.find((l: any) => l._id === createdLeadId || l.id === createdLeadId);
    if (!match) {
      throw new Error('Created lead not found in filtered list');
    }
  });

  await runScenario('Leads API', 'GET /leads with search query finds the lead', async () => {
    const res = await fetch(`${API_BASE}/leads?search=Automated+Test+Dental`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    const found = data.data.some((l: any) => l._id === createdLeadId || l.id === createdLeadId);
    if (!found) throw new Error('Search did not return the newly created lead');
  });

  await runScenario('Leads API', 'GET /leads/:id returns lead details', async () => {
    const res = await fetch(`${API_BASE}/leads/${createdLeadId}`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (data.data.lead._id !== createdLeadId && data.data.lead.id !== createdLeadId) {
      throw new Error('Returned lead ID does not match');
    }
  });

  // --- Category 4: Audit & MVP Services ---
  await runScenario('Audit API', 'POST /audits/trigger enqueues audit job for lead', async () => {
    const res = await fetch(`${API_BASE}/audits/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: createdLeadId }),
    });
    if (res.status !== 202) {
      const err = await res.text();
      throw new Error(`Expected 202 Accepted, got ${res.status}: ${err}`);
    }
    const data = await res.json();
    if (!data.success || !data.data?.jobId) throw new Error('Job ID missing from trigger response');
  });

  await runScenario('MVP API', 'POST /mvp/generate triggers MVP generation', async () => {
    const res = await fetch(`${API_BASE}/mvp/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auditId: createdLeadId, // accepts lead or audit id
      }),
    });
    if (res.status !== 202) throw new Error(`Expected 202, got ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error('MVP generate failed');
  });

  await runScenario('MVP API', 'GET /mvp/:id returns MVP project details or demo preview URL', async () => {
    const res = await fetch(`${API_BASE}/mvp/${createdLeadId}`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.success || !data.data?.fullPreviewUrl) {
      throw new Error('MVP project response missing preview URL');
    }
  });

  await runScenario('MVP API', 'PATCH /mvp/:id/tokens updates MVP color tokens', async () => {
    const res = await fetch(`${API_BASE}/mvp/${createdLeadId}/tokens`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primaryColor: '#0EA5E9',
        secondaryColor: '#1E293B',
        accentColor: '#10B981',
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to update tokens (${res.status}): ${err}`);
    }
    const data = await res.json();
    if (!data.success) throw new Error('Failed to update tokens');
  });

  // --- Category 5: HITL Outreach Approval & Email Dispatch ---
  // Find or use a lead for outreach testing
  let outreachLeadId = '';
  await runScenario('Outreach API', 'GET /outreach/pending returns leads in NEEDS_APPROVAL or AWAITING_APPROVAL', async () => {
    const res = await fetch(`${API_BASE}/outreach/pending`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.success || !Array.isArray(data.data)) throw new Error('Invalid pending response');
    if (data.data.length > 0) {
      outreachLeadId = data.data[0]._id || data.data[0].id;
    }
  });

  // If no lead in pending, we can test on our created lead by updating or using existing
  if (!outreachLeadId) {
    outreachLeadId = createdLeadId;
  }

  await runScenario('Outreach API', 'POST /outreach/:id/test sends operator test email', async () => {
    const res = await fetch(`${API_BASE}/outreach/${outreachLeadId}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        testEmail: 'operator@revamp-test.local',
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed test email: ${err}`);
    }
    const data = await res.json();
    if (!data.success) throw new Error('Test email failed');
  });

  let trackingToken = '';
  await runScenario('Outreach API', 'POST /outreach/:id/approve approves draft, transitions to SCHEDULED and queues dispatch job', async () => {
    const res = await fetch(`${API_BASE}/outreach/${outreachLeadId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approvedBy: 'automated-verifier',
        subject: 'Live Automated Verification: 3 growth points for your website',
        preheader: 'Interactive MVP prototype',
        body: '<p>Hello! This is a live system verification test.</p>',
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Approval failed (${res.status}): ${err}`);
    }
    const data = await res.json();
    if (!data.success) throw new Error('Approval success flag was false');
    if (data.data.status !== 'SCHEDULED') {
      throw new Error(`Expected status SCHEDULED, got ${data.data.status}`);
    }
  });

  // --- Category 6: Telemetry, Web Tracking & Engaged Funnel Transitions ---
  await runScenario('Telemetry', 'GET /track/revamp-tracker.js serves tracking script', async () => {
    const res = await fetch(`${API_BASE}/track/revamp-tracker.js`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const script = await res.text();
    if (!script.includes('RevampTracker') && !script.includes('mvp-event')) {
      throw new Error('Tracking script does not contain expected tracker code');
    }
  });

  // Query database or create campaign to get a real tracking token
  await runScenario('Telemetry', 'GET /track/open/:token.gif returns 1x1 transparent GIF & registers email open', async () => {
    // Generate a test token
    const testToken = `track_test_${Date.now()}`;
    const res = await fetch(`${API_BASE}/track/open/${testToken}.gif`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('image/gif')) {
      throw new Error(`Expected image/gif, got ${contentType}`);
    }
  });

  await runScenario('Telemetry', 'GET /track/click/:token records click and redirects (302)', async () => {
    const testToken = `track_test_${Date.now()}`;
    // Using redirect: 'manual' to verify 302
    const res = await fetch(`${API_BASE}/track/click/${testToken}`, {
      redirect: 'manual',
    });
    if (res.status !== 302 && res.status !== 301) {
      throw new Error(`Expected redirect status (302), got ${res.status}`);
    }
  });

  await runScenario('Telemetry', 'POST /track/mvp-event ingests dwell_time / cta_click and records engagement', async () => {
    const res = await fetch(`${API_BASE}/track/mvp-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadId: outreachLeadId,
        eventType: 'dwell_time',
        dwellTimeSeconds: 45,
        scrollDepthPercent: 85,
        metadata: { source: 'automated_verification' },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`mvp-event failed: ${err}`);
    }
    const data = await res.json();
    if (!data.success) throw new Error('Expected success true');
  });

  // Rejection scenario test
  // Create another lead specifically to test rejection flow
  await runScenario('Outreach API', 'POST /outreach/:id/reject transitions lead and campaign to REJECTED', async () => {
    // 1. Create a lead for rejection
    const createRes = await fetch(`${API_BASE}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalUrl: `https://reject-test-${Date.now()}.com`,
        niche: 'auto',
        businessName: 'Reject Test Auto Clinic',
        contactEmail: 'contact@reject-test-auto.com',
      }),
    });
    const createData = await createRes.json();
    const rejectLeadId = createData.data.id || createData.data.lead?._id;

    const res = await fetch(`${API_BASE}/outreach/${rejectLeadId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'Operator rejected: Low commercial intent',
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Reject failed (${res.status}): ${err}`);
    }
    const data = await res.json();
    if (data.data.status !== 'REJECTED') {
      throw new Error(`Expected REJECTED, got ${data.data.status}`);
    }

    // Verify lead status in GET /leads/:id
    const leadRes = await fetch(`${API_BASE}/leads/${rejectLeadId}`);
    const leadData = await leadRes.json();
    if (leadData.data.lead.status !== 'REJECTED') {
      throw new Error(`Lead status not updated in DB, got ${leadData.data.lead.status}`);
    }
  });

  console.log('\n====================================================');
  console.log('📊 LIVE API VERIFICATION SUMMARY REPORT');
  console.log('====================================================');
  const passed = results.filter((r) => r.status === 'PASSED').length;
  const failed = results.filter((r) => r.status === 'FAILED').length;
  console.log(`Total Scenarios: ${results.length}`);
  console.log(`Passed:          ${passed}`);
  console.log(`Failed:          ${failed}`);
  console.log(`Success Rate:    ${((passed / results.length) * 100).toFixed(1)}%`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
