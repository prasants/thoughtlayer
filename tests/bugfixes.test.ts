import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThoughtLayerDatabase } from '../src/storage/database.js';
import { retrieve } from '../src/retrieve/pipeline.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Bug fixes', () => {
  let db: ThoughtLayerDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-bugfix-'));
    db = new ThoughtLayerDatabase(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Score normalisation (Bug #2)', () => {
    it('all scores should be between 0 and 1', () => {
      // Create entries that would trigger multiplicative boosts
      db.create({
        domain: 'engineering',
        title: 'Authentication System Design',
        content: 'The authentication system uses OAuth2 with JWT tokens for session management. Deployed last week.',
        keywords: ['authentication', 'oauth2', 'jwt', 'security'],
        importance: 0.9,
        tags: ['engineering', 'security'],
      });

      db.create({
        domain: 'engineering',
        title: 'Deployment Pipeline',
        content: 'CI/CD pipeline using GitHub Actions for automated deployment to production.',
        keywords: ['deployment', 'cicd', 'github-actions'],
        importance: 0.8,
        tags: ['engineering', 'devops'],
      });

      db.create({
        domain: 'people',
        title: 'Team Member Profile',
        content: 'Senior engineer working on authentication and deployment infrastructure.',
        keywords: ['engineer', 'authentication', 'deployment'],
        importance: 0.7,
        tags: ['people'],
      });

      const results = retrieve(db, {
        query: 'authentication deployment security',
        topK: 10,
      });

      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1.0);
      }

      // The top result should have score 1.0 (it's the max)
      if (results.length > 0) {
        expect(results[0].score).toBeCloseTo(1.0, 5);
      }
    });
  });

  describe('Prefix matching (Bug #3)', () => {
    it('"auth" should match entries about "authentication"', () => {
      db.create({
        domain: 'engineering',
        title: 'Authentication Module',
        content: 'Handles user authentication via OAuth2 and SAML. Supports multi-factor authentication.',
        keywords: ['authentication', 'oauth2', 'saml', 'mfa'],
        importance: 0.8,
      });

      db.create({
        domain: 'general',
        title: 'Unrelated Entry',
        content: 'This entry has nothing to do with the search query at all.',
        keywords: ['unrelated', 'filler'],
        importance: 0.5,
      });

      const results = retrieve(db, {
        query: 'auth',
        topK: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      const authEntry = results.find(r => r.entry.title === 'Authentication Module');
      expect(authEntry).toBeDefined();
    });

    it('"deploy" should match entries about "deployment"', () => {
      db.create({
        domain: 'engineering',
        title: 'Deployment Guide',
        content: 'Step-by-step guide for deployment of services to production environment.',
        keywords: ['deployment', 'production', 'guide'],
        importance: 0.8,
      });

      const results = retrieve(db, {
        query: 'deploy',
        topK: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      const deployEntry = results.find(r => r.entry.title === 'Deployment Guide');
      expect(deployEntry).toBeDefined();
    });
  });

  describe('CLI smoke test', () => {
    it('CLI module exports exist', async () => {
      // Verify the CLI file is not empty and has the expected structure
      const cliPath = path.join(__dirname, '..', 'src', 'cli', 'index.ts');
      const content = fs.readFileSync(cliPath, 'utf-8');
      expect(content.length).toBeGreaterThan(100);
      expect(content).toContain('#!/usr/bin/env node');
      expect(content).toContain("'init'");
      expect(content).toContain("'add'");
      expect(content).toContain("'curate'");
      expect(content).toContain("'query'");
      expect(content).toContain("'search'");
      expect(content).toContain("'list'");
      expect(content).toContain("'health'");
      expect(content).toContain("'ingest'");
      expect(content).toContain("'rebuild'");
      expect(content).toContain("'embed'");
      expect(content).toContain("'mcp'");
    });
  });
});
