/**
 * Real-World Retrieval Quality Benchmark
 *
 * Tests ThoughtLayer against scenarios that actual AI agents face daily.
 * 30+ scenarios across 5 categories:
 * 1. Multi-turn conversation memory
 * 2. Fact updates and corrections
 * 3. Temporal queries
 * 4. Entity resolution
 * 5. Contradiction detection
 */

import { ThoughtLayerDatabase } from '../src/storage/database.js';
import { retrieve } from '../src/retrieve/pipeline.js';
import { addWithVersioning } from '../src/retrieve/versioning.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface Scenario {
  name: string;
  category: string;
  query: string;
  expectedTitle: string;  // Title of the entry that should rank #1
  expectedInTop3?: string[];  // Titles that should appear in top 3
}

const scenarios: Scenario[] = [
  // === Multi-turn conversation memory ===
  {
    name: 'Recall discussion topic by subject',
    category: 'conversation',
    query: 'What did we discuss about the database migration?',
    expectedTitle: 'Database Migration Plan',
  },
  {
    name: 'Recall team discussion',
    category: 'conversation',
    query: 'What was the outcome of the architecture review?',
    expectedTitle: 'Architecture Review Outcomes',
  },
  {
    name: 'Recall specific decision from meeting',
    category: 'conversation',
    query: 'What did we decide about the API versioning strategy?',
    expectedTitle: 'API Versioning Decision',
  },
  {
    name: 'Recall project status discussed earlier',
    category: 'conversation',
    query: 'What is the current status of the billing system?',
    expectedTitle: 'Billing System Status',
  },
  {
    name: 'Recall technical choice rationale',
    category: 'conversation',
    query: 'Why did we choose Rust for the matching engine?',
    expectedTitle: 'Matching Engine Language Choice',
  },
  {
    name: 'Cross-reference between discussions',
    category: 'conversation',
    query: 'What concerns were raised about performance?',
    expectedTitle: 'Performance Concerns',
  },

  // === Fact updates and corrections ===
  {
    name: 'Return corrected fact over original',
    category: 'fact_update',
    query: 'What database are we using?',
    expectedTitle: 'Database Technology (Updated)',
  },
  {
    name: 'Return latest deployment process',
    category: 'fact_update',
    query: 'How do we deploy to production?',
    expectedTitle: 'Production Deployment Process (v2)',
  },
  {
    name: 'Return updated team lead info',
    category: 'fact_update',
    query: 'Who leads the platform team?',
    expectedTitle: 'Platform Team Lead (Updated)',
  },
  {
    name: 'Return corrected pricing info',
    category: 'fact_update',
    query: 'What is the pricing for the enterprise tier?',
    expectedTitle: 'Enterprise Pricing (Revised)',
  },
  {
    name: 'Return latest compliance requirement',
    category: 'fact_update',
    query: 'What are the KYC requirements?',
    expectedTitle: 'KYC Requirements (2026 Update)',
  },
  {
    name: 'Return updated SLA terms',
    category: 'fact_update',
    query: 'What is our uptime SLA?',
    expectedTitle: 'Uptime SLA (Revised)',
  },

  // === Temporal queries ===
  {
    name: 'Yesterday query returns recent entry',
    category: 'temporal',
    query: 'What happened yesterday?',
    expectedTitle: 'Yesterday Incident',
  },
  {
    name: 'Last week query returns correct period',
    category: 'temporal',
    query: 'What did we ship last week?',
    expectedTitle: 'Last Week Release',
  },
  {
    name: 'Latest status query prefers newest',
    category: 'temporal',
    query: "What's the latest on the migration?",
    expectedTitle: 'Migration Progress (Latest)',
  },
  {
    name: 'Most recent update query',
    category: 'temporal',
    query: 'What is the most recent security audit result?',
    expectedTitle: 'Security Audit Q1 2026',
  },
  {
    name: 'This week query filters correctly',
    category: 'temporal',
    query: 'What incidents happened this week?',
    expectedTitle: 'This Week Outage',
  },
  {
    name: 'Named month query',
    category: 'temporal',
    query: 'What happened in March?',
    expectedTitle: 'March Milestone',
  },

  // === Entity resolution ===
  {
    name: 'First name matches full person entry',
    category: 'entity',
    query: 'What is Sarah working on?',
    expectedTitle: 'Priya Mehta \u2014 VP Engineering',
  },
  {
    name: 'Last name matches person entry',
    category: 'entity',
    query: 'Did Martinez review the contract?',
    expectedTitle: 'Carlos Martinez \u2014 Legal Counsel',
  },
  {
    name: 'Alias matches person entry',
    category: 'entity',
    query: 'What did SC say about the deadline?',
    expectedTitle: 'Priya Mehta \u2014 VP Engineering',
  },
  {
    name: 'Fuzzy name match with typo',
    category: 'entity',
    query: 'Ask Sarh about the infra changes',
    expectedTitle: 'Priya Mehta \u2014 VP Engineering',
  },
  {
    name: 'Role-based person lookup',
    category: 'entity',
    query: 'Who is the VP of engineering?',
    expectedTitle: 'Priya Mehta \u2014 VP Engineering',
  },
  {
    name: 'Multiple entity match disambiguation',
    category: 'entity',
    query: 'What did John say about the API?',
    expectedTitle: 'John Park \u2014 Backend Engineer',
  },

  // === Contradiction detection ===
  {
    name: 'Contradicting decisions resolved to latest',
    category: 'contradiction',
    query: 'What auth method are we using?',
    expectedTitle: 'Auth Method (Updated)',
  },
  {
    name: 'Contradicting team info resolved',
    category: 'contradiction',
    query: 'Who is the project lead for Atlas?',
    expectedTitle: 'Atlas Project Lead (New)',
  },
  {
    name: 'Process contradiction resolved',
    category: 'contradiction',
    query: 'How do we handle on-call rotations?',
    expectedTitle: 'On-Call Process (v2)',
  },
  {
    name: 'Budget figure contradiction',
    category: 'contradiction',
    query: 'What is the Q2 marketing budget?',
    expectedTitle: 'Q2 Marketing Budget (Revised)',
  },
  {
    name: 'Vendor selection contradiction',
    category: 'contradiction',
    query: 'Which cloud provider did we pick?',
    expectedTitle: 'Cloud Provider Decision (Final)',
  },
  {
    name: 'Timeline contradiction resolved',
    category: 'contradiction',
    query: 'When is the product launch?',
    expectedTitle: 'Product Launch Date (Updated)',
  },
];

function seedBenchmarkData(db: ThoughtLayerDatabase): void {
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const lastWeek = new Date(now); lastWeek.setDate(now.getDate() - 5);
  const twoWeeksAgo = new Date(now); twoWeeksAgo.setDate(now.getDate() - 14);
  const lastMonth = new Date(now); lastMonth.setMonth(now.getMonth() - 1);
  const marchDate = new Date(2026, 2, 10); // March 10, 2026

  // --- Conversation memory entries ---
  db.create({ domain: 'architecture', topic: 'database', title: 'Database Migration Plan', content: 'Discussed migrating from MySQL to PostgreSQL. Key concerns: data integrity during migration, zero-downtime approach, rollback strategy. Timeline: 3 months.', tags: ['migration', 'database'], keywords: ['mysql', 'postgresql', 'migration', 'database'], importance: 0.9 });
  db.create({ domain: 'architecture', title: 'Architecture Review Outcomes', content: 'Architecture review concluded: microservices approved for billing and auth services. Monolith stays for core matching engine. Event sourcing for audit trail.', tags: ['architecture', 'review'], keywords: ['microservices', 'monolith', 'architecture'], importance: 0.85 });
  db.create({ domain: 'decisions', topic: 'api', title: 'API Versioning Decision', content: 'Decided on URL-based versioning (v1, v2) over header-based. Simpler for clients, clearer deprecation path. Breaking changes only on major versions.', tags: ['api', 'versioning', 'decisions'], keywords: ['api', 'versioning', 'url'], importance: 0.8 });
  db.create({ domain: 'operations', title: 'Billing System Status', content: 'Billing system migration 70% complete. Stripe integration done. Invoice generation pending. Tax calculation needs review. Target: end of Q2.', tags: ['billing', 'status'], keywords: ['billing', 'stripe', 'invoice', 'status'], importance: 0.7 });
  db.create({ domain: 'decisions', title: 'Matching Engine Language Choice', content: 'Chose Rust for the matching engine because of zero-cost abstractions, memory safety without GC, and sub-microsecond latency requirements. Evaluated Go, C++, and Rust.', tags: ['decisions', 'rust', 'matching'], keywords: ['rust', 'matching', 'engine', 'language', 'performance'], importance: 0.9 });
  db.create({ domain: 'operations', title: 'Performance Concerns', content: 'Raised concerns about API latency under load. P99 at 450ms, target is 200ms. Root cause: N+1 queries in order book endpoint. Fix: batch loading with DataLoader pattern.', tags: ['performance', 'concerns'], keywords: ['latency', 'performance', 'p99', 'api'], importance: 0.8 });

  // --- Fact update entries (older then newer) ---
  const oldEntry1 = db.create({ domain: 'architecture', topic: 'database', title: 'Database Technology', content: 'Using MySQL 8.0 as primary database with Redis for caching.', facts: ['MySQL 8.0 is primary database', 'Redis for caching'], tags: ['database'], keywords: ['mysql', 'redis', 'database'], importance: 0.8 });
  // Simulate older date
  db.update(oldEntry1.id, { content: oldEntry1.content }); // trigger updated_at
  db.create({ domain: 'architecture', topic: 'database', title: 'Database Technology (Updated)', content: 'Migrated to PostgreSQL 16 with pgvector. MySQL deprecated. Redis still used for caching and session storage.', facts: ['PostgreSQL 16 is primary database', 'Redis for caching and sessions'], tags: ['database', 'has_prior_version'], keywords: ['postgresql', 'pgvector', 'redis', 'database'], importance: 0.9, relations: [{ target_id: oldEntry1.id, type: 'supersedes', strength: 0.8 }] });

  const oldDeploy = db.create({ domain: 'operations', title: 'Production Deployment Process', content: 'Manual deployment every Tuesday. SSH into production, pull latest, restart services.', facts: ['Manual deployment', 'Weekly on Tuesday'], tags: ['deployment', 'process'], keywords: ['deploy', 'production', 'manual'], importance: 0.7 });
  db.create({ domain: 'operations', title: 'Production Deployment Process (v2)', content: 'Fully automated CI/CD via GitHub Actions. Staging auto-deploys on merge to main. Production requires 2 approvals and passes all integration tests.', facts: ['Automated CI/CD', 'GitHub Actions', '2 approvals required'], tags: ['deployment', 'process', 'has_prior_version'], keywords: ['deploy', 'production', 'cicd', 'github-actions'], importance: 0.9, relations: [{ target_id: oldDeploy.id, type: 'supersedes', strength: 0.8 }] });

  const oldLead = db.create({ domain: 'team', title: 'Platform Team Lead', content: 'James Wilson leads the platform team. Focus on infrastructure and DevOps.', facts: ['James Wilson is platform team lead'], tags: ['people', 'leadership'], keywords: ['james', 'wilson', 'platform', 'lead'], importance: 0.7 });
  db.create({ domain: 'team', title: 'Platform Team Lead (Updated)', content: 'Anke Vogel now leads the platform team after James transitioned to advisory role. Focus expanded to include SRE.', facts: ['Anke Vogel is platform team lead'], tags: ['people', 'leadership', 'has_prior_version'], keywords: ['priya', 'sharma', 'platform', 'lead'], importance: 0.8, relations: [{ target_id: oldLead.id, type: 'supersedes', strength: 0.9 }] });

  const oldPricing = db.create({ domain: 'product', title: 'Enterprise Pricing', content: 'Enterprise tier: $5,000/month. Includes unlimited API calls, dedicated support, custom integrations.', facts: ['Enterprise tier is $5000/month'], tags: ['pricing'], keywords: ['enterprise', 'pricing', 'tier'], importance: 0.7 });
  db.create({ domain: 'product', title: 'Enterprise Pricing (Revised)', content: 'Enterprise tier revised to $8,000/month with volume discounts. Includes SLA guarantee, SOC2 compliance dashboard, and priority support.', facts: ['Enterprise tier is $8000/month', 'Volume discounts available'], tags: ['pricing', 'has_prior_version'], keywords: ['enterprise', 'pricing', 'tier', 'sla'], importance: 0.85, relations: [{ target_id: oldPricing.id, type: 'supersedes', strength: 0.8 }] });

  const oldKYC = db.create({ domain: 'compliance', title: 'KYC Requirements', content: 'Basic KYC: government ID and proof of address. Enhanced due diligence for transactions over $10,000.', facts: ['Government ID required', 'Proof of address required', 'EDD for >$10k'], tags: ['kyc', 'compliance'], keywords: ['kyc', 'compliance', 'identity'], importance: 0.8 });
  db.create({ domain: 'compliance', title: 'KYC Requirements (2026 Update)', content: 'Updated KYC: biometric verification added. Liveness check for all new accounts. EDD threshold lowered to $5,000. Source of funds declaration for >$25k.', facts: ['Biometric verification required', 'Liveness check mandatory', 'EDD threshold $5000'], tags: ['kyc', 'compliance', 'has_prior_version'], keywords: ['kyc', 'compliance', 'biometric', 'liveness'], importance: 0.9, relations: [{ target_id: oldKYC.id, type: 'supersedes', strength: 0.8 }] });

  const oldSLA = db.create({ domain: 'operations', title: 'Uptime SLA', content: 'We guarantee 99.5% uptime measured monthly. Credits for downtime exceeding 4 hours.', facts: ['99.5% uptime guarantee'], tags: ['sla', 'operations'], keywords: ['uptime', 'sla', 'availability'], importance: 0.7 });
  db.create({ domain: 'operations', title: 'Uptime SLA (Revised)', content: 'Uptime SLA upgraded to 99.95% with real-time status page. Automatic credits for any downtime exceeding 15 minutes. Quarterly review.', facts: ['99.95% uptime guarantee', 'Automatic credits after 15min downtime'], tags: ['sla', 'operations', 'has_prior_version'], keywords: ['uptime', 'sla', 'availability', 'status-page'], importance: 0.85, relations: [{ target_id: oldSLA.id, type: 'supersedes', strength: 0.8 }] });

  // --- Temporal entries ---
  // Use raw SQL to set freshness_at for temporal testing
  const yesterdayEntry = db.create({ domain: 'incidents', title: 'Yesterday Incident', content: 'Payment processing went down for 45 minutes due to Stripe webhook misconfiguration. Resolved by rolling back webhook handler.', tags: ['incident', 'payments'], keywords: ['payment', 'stripe', 'outage', 'incident'], importance: 0.9 });
  (db as any).db.prepare('UPDATE entries SET freshness_at = ? WHERE id = ?').run(yesterday.toISOString(), yesterdayEntry.id);

  const lastWeekEntry = db.create({ domain: 'releases', title: 'Last Week Release', content: 'Shipped v2.3.0 with new order types (stop-limit, trailing stop). Performance improvements to matching engine. 40% latency reduction.', tags: ['release', 'shipping'], keywords: ['release', 'v2.3.0', 'order-types', 'ship'], importance: 0.8 });
  (db as any).db.prepare('UPDATE entries SET freshness_at = ? WHERE id = ?').run(lastWeek.toISOString(), lastWeekEntry.id);

  db.create({ domain: 'operations', title: 'Migration Progress (Latest)', content: 'Database migration 95% complete. Final data validation running. Go-live scheduled for next Monday. All integration tests passing.', tags: ['migration', 'status'], keywords: ['migration', 'progress', 'database', 'status'], importance: 0.85 });

  db.create({ domain: 'security', title: 'Security Audit Q1 2026', content: 'Q1 2026 security audit by Trail of Bits completed. 2 medium findings (CORS misconfiguration, rate limiting bypass). Both fixed. No critical issues.', tags: ['security', 'audit'], keywords: ['security', 'audit', 'trail-of-bits', 'q1'], importance: 0.9 });

  const thisWeekEntry = db.create({ domain: 'incidents', title: 'This Week Outage', content: 'Redis cluster failover caused 10-minute blip in websocket connections. Auto-recovery worked. No data loss.', tags: ['incident', 'redis'], keywords: ['redis', 'outage', 'websocket', 'incident'], importance: 0.8 });
  const twoDaysAgo = new Date(now); twoDaysAgo.setDate(now.getDate() - 2);
  (db as any).db.prepare('UPDATE entries SET freshness_at = ? WHERE id = ?').run(twoDaysAgo.toISOString(), thisWeekEntry.id);

  const marchEntry = db.create({ domain: 'milestones', title: 'March Milestone', content: 'Hit 100,000 registered users in March 2026. Trading volume exceeded $1B for the first time.', tags: ['milestone', 'growth'], keywords: ['milestone', 'users', 'volume', 'march'], importance: 0.9 });
  (db as any).db.prepare('UPDATE entries SET freshness_at = ? WHERE id = ?').run(marchDate.toISOString(), marchEntry.id);

  // Old entries that should NOT rank first for temporal queries
  const oldMigration = db.create({ domain: 'operations', title: 'Migration Progress (Old)', content: 'Database migration 30% complete. Schema changes applied. Data migration starting next week.', tags: ['migration', 'status'], keywords: ['migration', 'progress', 'database'], importance: 0.7 });
  (db as any).db.prepare('UPDATE entries SET freshness_at = ? WHERE id = ?').run(lastMonth.toISOString(), oldMigration.id);

  // --- Entity entries ---
  db.create({ domain: 'team', title: 'Priya Mehta \u2014 VP Engineering', content: 'Priya Mehta is VP Engineering. Joined in 2024. Responsible for platform, infrastructure, and engineering hiring. Previously at Coinbase.', tags: ['people', 'leadership', 'alias:PM'], keywords: ['sarah', 'chen', 'vp', 'engineering'], importance: 0.8 });
  db.create({ domain: 'team', title: 'Carlos Martinez \u2014 Legal Counsel', content: 'Carlos Martinez handles all legal matters. Contract review, regulatory compliance, licensing. Previously at Linklaters.', tags: ['people', 'legal', 'alias:CM'], keywords: ['carlos', 'martinez', 'legal', 'counsel'], importance: 0.7 });
  db.create({ domain: 'team', title: 'John Park \u2014 Backend Engineer', content: 'John Park is a senior backend engineer. Owns the API layer and order management system. Expert in TypeScript and Rust.', tags: ['people', 'engineering', 'alias:JP'], keywords: ['john', 'park', 'backend', 'engineer', 'api'], importance: 0.6 });

  // --- Contradiction entries ---
  const oldAuth = db.create({ domain: 'decisions', topic: 'auth', title: 'Auth Method', content: 'Using JWT tokens with 15-minute expiry and 7-day refresh tokens.', facts: ['JWT tokens for authentication'], tags: ['auth', 'security'], keywords: ['jwt', 'auth', 'token'], importance: 0.7 });
  db.create({ domain: 'decisions', topic: 'auth', title: 'Auth Method (Updated)', content: 'Switched to session-based auth with httpOnly cookies. JWT deprecated due to token theft concerns. Sessions stored in Redis.', facts: ['Session-based auth', 'httpOnly cookies', 'Redis session store'], tags: ['auth', 'security', 'has_prior_version'], keywords: ['session', 'auth', 'cookie', 'redis'], importance: 0.85, relations: [{ target_id: oldAuth.id, type: 'supersedes', strength: 0.9 }] });

  const oldAtlasLead = db.create({ domain: 'team', topic: 'atlas', title: 'Atlas Project Lead', content: 'David Kim leads Project Atlas (next-gen trading platform).', facts: ['David Kim leads Atlas'], tags: ['people', 'project'], keywords: ['david', 'kim', 'atlas', 'lead'], importance: 0.7 });
  db.create({ domain: 'team', topic: 'atlas', title: 'Atlas Project Lead (New)', content: 'Lisa Wang took over Project Atlas from David Kim. David moved to advisory. Lisa bringing mobile-first approach.', facts: ['Lisa Wang leads Atlas'], tags: ['people', 'project', 'has_prior_version'], keywords: ['lisa', 'wang', 'atlas', 'lead'], importance: 0.8, relations: [{ target_id: oldAtlasLead.id, type: 'supersedes', strength: 0.9 }] });

  const oldOncall = db.create({ domain: 'operations', title: 'On-Call Process', content: 'On-call rotation: 1 week per engineer, manual escalation via Slack. No compensation for after-hours pages.', facts: ['Weekly rotation', 'Manual escalation', 'No on-call pay'], tags: ['oncall', 'process'], keywords: ['oncall', 'rotation', 'escalation'], importance: 0.6 });
  db.create({ domain: 'operations', title: 'On-Call Process (v2)', content: 'On-call overhauled: 3-day rotations, PagerDuty auto-escalation, $500/week on-call bonus, runbooks for top 20 alerts.', facts: ['3-day rotation', 'PagerDuty escalation', '$500/week bonus'], tags: ['oncall', 'process', 'has_prior_version'], keywords: ['oncall', 'rotation', 'pagerduty', 'bonus'], importance: 0.8, relations: [{ target_id: oldOncall.id, type: 'supersedes', strength: 0.8 }] });

  const oldBudget = db.create({ domain: 'finance', title: 'Q2 Marketing Budget', content: 'Q2 marketing budget set at $150,000. Focus on content marketing and conference sponsorships.', facts: ['Q2 budget: $150,000'], tags: ['budget', 'marketing'], keywords: ['marketing', 'budget', 'q2'], importance: 0.7 });
  db.create({ domain: 'finance', title: 'Q2 Marketing Budget (Revised)', content: 'Q2 marketing budget increased to $250,000 after Series A. Adding paid acquisition channels and influencer partnerships.', facts: ['Q2 budget: $250,000', 'Paid acquisition added'], tags: ['budget', 'marketing', 'has_prior_version'], keywords: ['marketing', 'budget', 'q2', 'paid'], importance: 0.85, relations: [{ target_id: oldBudget.id, type: 'supersedes', strength: 0.8 }] });

  const oldCloud = db.create({ domain: 'decisions', title: 'Cloud Provider Decision', content: 'Going with AWS for primary infrastructure. GCP considered but AWS has better enterprise support.', facts: ['AWS is primary cloud'], tags: ['cloud', 'infrastructure'], keywords: ['aws', 'cloud', 'infrastructure'], importance: 0.8 });
  db.create({ domain: 'decisions', title: 'Cloud Provider Decision (Final)', content: 'Multi-cloud strategy approved. AWS primary for compute, GCP for ML/data, Cloudflare for edge. Cost savings of 30% projected.', facts: ['Multi-cloud: AWS + GCP + Cloudflare'], tags: ['cloud', 'infrastructure', 'has_prior_version'], keywords: ['aws', 'gcp', 'cloudflare', 'multi-cloud'], importance: 0.9, relations: [{ target_id: oldCloud.id, type: 'supersedes', strength: 0.8 }] });

  const oldLaunch = db.create({ domain: 'milestones', title: 'Product Launch Date', content: 'Product launch planned for June 2026. Internal beta in April.', facts: ['Launch: June 2026'], tags: ['launch', 'timeline'], keywords: ['launch', 'date', 'june', 'product'], importance: 0.8 });
  db.create({ domain: 'milestones', title: 'Product Launch Date (Updated)', content: 'Launch moved to August 2026. Additional time for security audit and regulatory approval. Beta extended to June.', facts: ['Launch: August 2026', 'Beta extended to June'], tags: ['launch', 'timeline', 'has_prior_version'], keywords: ['launch', 'date', 'august', 'product'], importance: 0.85, relations: [{ target_id: oldLaunch.id, type: 'supersedes', strength: 0.9 }] });
}

function runBenchmark(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoughtlayer-bench-'));
  const db = new ThoughtLayerDatabase(tmpDir);

  console.log('\n\u2550\u2550\u2550 ThoughtLayer Real-World Retrieval Benchmark \u2550\u2550\u2550\n');
  console.log('Seeding benchmark data...');
  seedBenchmarkData(db);

  const health = db.health();
  console.log(`Seeded ${health.active} entries across ${Object.keys(health.domains).length} domains\n`);

  let passed = 0;
  let failed = 0;
  const failures: Array<{ scenario: Scenario; gotTitle: string; gotRank: number }> = [];

  const categories = new Map<string, { passed: number; total: number }>();

  for (const scenario of scenarios) {
    const results = retrieve(db, { query: scenario.query, topK: 5 });

    const cat = categories.get(scenario.category) ?? { passed: 0, total: 0 };
    cat.total++;

    if (results.length === 0) {
      failed++;
      failures.push({ scenario, gotTitle: '(no results)', gotRank: -1 });
      console.log(`  \u2718 ${scenario.name}`);
      console.log(`    Query: "${scenario.query}"`);
      console.log(`    Expected: "${scenario.expectedTitle}"`);
      console.log(`    Got: NO RESULTS\n`);
      categories.set(scenario.category, cat);
      continue;
    }

    // Check if expected title is in top 3
    const top3Titles = results.slice(0, 3).map(r => r.entry.title);
    const rank = results.findIndex(r => r.entry.title === scenario.expectedTitle);

    if (rank === 0) {
      passed++;
      cat.passed++;
      console.log(`  \u2714 ${scenario.name}`);
    } else if (rank > 0 && rank < 3) {
      passed++;
      cat.passed++;
      console.log(`  \u2714 ${scenario.name} (rank #${rank + 1})`);
    } else {
      failed++;
      failures.push({ scenario, gotTitle: results[0].entry.title, gotRank: rank });
      console.log(`  \u2718 ${scenario.name}`);
      console.log(`    Query: "${scenario.query}"`);
      console.log(`    Expected: "${scenario.expectedTitle}"`);
      console.log(`    Got #1: "${results[0].entry.title}" (score: ${results[0].score.toFixed(4)})`);
      if (rank >= 0) console.log(`    Expected was at rank #${rank + 1}`);
      else console.log(`    Expected entry NOT FOUND in results`);
      console.log();
    }
    categories.set(scenario.category, cat);
  }

  // Summary
  console.log('\n\u2500\u2500\u2500 Results \u2500\u2500\u2500\n');
  console.log(`Total: ${passed}/${scenarios.length} passed (${(passed / scenarios.length * 100).toFixed(1)}%)\n`);

  console.log('By category:');
  for (const [cat, stats] of categories) {
    const pct = (stats.passed / stats.total * 100).toFixed(0);
    const icon = stats.passed === stats.total ? '\u2714' : '\u2718';
    console.log(`  ${icon} ${cat}: ${stats.passed}/${stats.total} (${pct}%)`);
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} failures need investigation.`);
  }

  console.log();

  // Cleanup
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // Exit with error if <80% pass rate
  if (passed / scenarios.length < 0.8) {
    process.exit(1);
  }
}

runBenchmark();
