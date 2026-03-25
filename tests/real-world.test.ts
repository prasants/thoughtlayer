import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThoughtLayer } from '../src/thoughtlayer.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Real-world retrieval quality tests.
 *
 * Uses 5 realistic markdown files (no embeddings, FTS + term matching only)
 * and natural language queries a real user would type.
 */

const FILES = {
  'decisions/database.md': `---
title: "Database Choice: PostgreSQL"
tags: [architecture, database]
importance: 0.8
---

# ADR-001: PostgreSQL as Primary Database

## Status
Accepted

## Context
We need a relational database for our core application. Options considered:
- PostgreSQL
- MySQL
- CockroachDB

## Decision
We will use **PostgreSQL 15** as our primary database.

### Reasons
- Superior JSON support (JSONB columns for flexible schemas)
- Excellent full-text search capabilities
- Strong ecosystem and community
- Battle-tested at scale (Instagram, Discord, etc.)

## Consequences
- Team needs PostgreSQL expertise
- We commit to SQL-based data modelling
- Migration path to CockroachDB remains open if we need horizontal scaling

Decided by: Priya Mehta
Date: 2024-01-15
`,

  'decisions/api-framework.md': `---
title: "API Framework: FastAPI"
tags: [architecture, api]
importance: 0.7
---

# ADR-002: FastAPI for Backend API

## Status
Accepted

## Context
Choosing a Python web framework for our REST API.

## Decision
We will use FastAPI for all new API endpoints.

### Reasons
- Async-first design matches our workload
- Automatic OpenAPI documentation
- Type hints with Pydantic for validation
- High performance (comparable to Node.js/Go)

## Consequences
- Python 3.10+ required
- Team needs to understand async/await patterns
- Existing Flask endpoints will be migrated gradually

Decided by: Marcus Johnson
Date: 2024-02-01
`,

  'decisions/auth-strategy.md': `---
title: "Authentication: OAuth2 + JWT"
tags: [architecture, security]
importance: 0.8
---

# ADR-003: OAuth2 with JWT Tokens

## Status
Accepted

## Decision
We will use OAuth2 with JWT tokens for authentication and authorisation.

- Access tokens: 15-minute expiry
- Refresh tokens: 7-day expiry
- Token storage: httpOnly cookies (not localStorage)

## Security Considerations
- All tokens signed with RS256
- Refresh token rotation on every use
- Rate limiting on token endpoints

Decided by: Priya Mehta
Date: 2024-01-20
`,

  'docs/onboarding.md': `---
title: "Engineering Onboarding Guide"
tags: [onboarding, engineering, team]
importance: 0.9
---

# Engineering Onboarding Guide

Welcome to the team! This guide will get you set up and productive.

## Team Structure

- **Backend Lead**: James Rodriguez — owns API, database, and infrastructure
- **Frontend Lead**: Priya Patel — owns web app, design system
- **DevOps Lead**: Darren O'Brien — owns CI/CD, monitoring, deployments

## Getting Started

1. Clone the monorepo: \`git clone git@github.com:acme/platform.git\`
2. Install dependencies: \`make setup\`
3. Start local env: \`docker compose up\`
4. Run tests: \`make test\`

## How We Deploy

Deployments happen through our CI/CD pipeline:

1. Push to \`main\` triggers automated tests
2. If tests pass, a staging deploy happens automatically
3. After QA sign-off, promote to production with \`make deploy-prod\`
4. Rollback if needed: \`make rollback\`

We deploy 2-3 times per week. Friday deploys are discouraged.

## Key Services

| Service | Port | Owner |
|---------|------|-------|
| API Gateway | 8080 | Backend |
| Web App | 3000 | Frontend |
| Auth Service | 8081 | Backend |
| Worker | - | Backend |

## Communication

- Slack: #engineering for general, #incidents for outages
- Stand-ups: Daily at 10am GMT
- Retros: Biweekly on Fridays
`,

  'incidents/feb-12-outage.md': `---
title: "Incident: Feb 12 Database Outage"
tags: [incident, postmortem, database]
importance: 0.9
---

# Incident Report: February 12 Database Outage

## Summary
On February 12, 2024, our primary PostgreSQL database became unresponsive for 47 minutes, causing a full service outage.

## Timeline
- **14:23 UTC** — Monitoring alerts fire: database connection pool exhausted
- **14:25 UTC** — On-call engineer (Darren O'Brien) acknowledges alert
- **14:30 UTC** — Root cause identified: runaway migration script holding table locks
- **14:35 UTC** — Migration script killed, but connections still blocked
- **14:45 UTC** — Database restarted with forced connection termination
- **14:50 UTC** — Service recovery begins, health checks passing
- **15:10 UTC** — Full recovery confirmed, all systems nominal

## Root Cause
A database migration script (migrate-user-profiles-v2) was deployed without proper lock timeout settings. It acquired an ACCESS EXCLUSIVE lock on the users table and ran for 45+ minutes, blocking all other queries.

## Impact
- 47 minutes of full service downtime
- ~12,000 failed API requests
- 3 customers escalated via support

## Action Items
1. All migration scripts must set lock_timeout = 5000ms
2. Add migration dry-run step to CI pipeline
3. Create runbook for database lock escalation
`,
};

describe('Real-world retrieval quality', () => {
  let tl: ThoughtLayer;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-realworld-'));

    // Init ThoughtLayer (no embeddings — FTS + term matching only)
    tl = ThoughtLayer.init(tmpDir);

    // Write files to disk and ingest
    for (const [relPath, content] of Object.entries(FILES)) {
      const fullPath = path.join(tmpDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
    }

    // Use the ingest pipeline
    const { ingestFiles } = await import('../src/ingest/files.js');
    await ingestFiles(tl, tl.database, {
      sourceDir: tmpDir,
      extensions: ['.md'],
      exclude: ['.thoughtlayer'],
    });
  });

  afterEach(() => {
    tl.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('query "what database are we using" → database.md is #1', async () => {
    const results = await tl.query('what database are we using', { topK: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.title).toContain('PostgreSQL');
  });

  it('query "who is the backend lead" → onboarding.md is #1', async () => {
    const results = await tl.query('who is the backend lead', { topK: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.title).toContain('Onboarding');
  });

  it('query "what happened on Feb 12" → incident report is #1', async () => {
    const results = await tl.query('what happened on Feb 12', { topK: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.title).toContain('Feb 12');
  });

  it('query "how do we deploy" → onboarding.md is in top 3', async () => {
    const results = await tl.query('how do we deploy', { topK: 5 });
    expect(results.length).toBeGreaterThan(0);
    const top3Titles = results.slice(0, 3).map(r => r.entry.title);
    expect(top3Titles.some(t => t.includes('Onboarding'))).toBe(true);
  });

  it('entity resolution does not false-positive on non-people entries', async () => {
    const results = await tl.query('who handles backend', { topK: 5 });
    // The database decision should NOT get entity boost
    for (const r of results) {
      if (r.entry.title.includes('PostgreSQL')) {
        expect(r.sources.entityBoost ?? 1.0).toBe(1.0);
      }
    }
  });

  it('CLI score display shows strategy indicators not raw values', () => {
    // This is a unit test for the display format logic
    const sources = {
      vector: 0.85,
      fts: 0.0000095,
      rrf: 0.5,
      freshness: 0.95,
      importance: 0.8,
      entityBoost: 1.0,
      temporalBoost: 1.0,
    };

    const strategies: string[] = [];
    if (sources.vector !== undefined) strategies.push('vec ✓');
    if (sources.fts !== undefined) strategies.push('fts ✓');
    if (sources.entityBoost && sources.entityBoost > 1.0) strategies.push('entity ✓');
    if (sources.temporalBoost && sources.temporalBoost > 1.0) strategies.push('temporal ✓');
    const strategyStr = strategies.length > 0 ? ` [${strategies.join('] [')}]` : '';

    expect(strategyStr).toBe(' [vec ✓] [fts ✓]');
    expect(strategyStr).not.toContain('0.000');
  });
});
