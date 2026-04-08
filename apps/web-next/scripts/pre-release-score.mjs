#!/usr/bin/env node
/**
 * Reads Playwright JSON output and prints GA + appendix scoring guidance.
 *
 * Usage (from apps/web-next):
 *   npx playwright test --grep @pre-release --grep-invert @appendix-preview --project=chromium
 *   node scripts/pre-release-score.mjs test-results/results.json
 *
 *   npx playwright test --grep @appendix-preview --project=chromium
 *   node scripts/pre-release-score.mjs test-results/results.json --appendix
 */

import fs from 'node:fs';
import path from 'node:path';

const RUBRIC_GA = {
  overview: {
    max: 17,
    patterns: [/prod-smoke.*landing responds/i, /prod-smoke.*docs responds/i],
  },
  auth: {
    max: 17,
    patterns: [/auth-flows/i, /prod-smoke.*login page responds/i],
  },
  teams: { max: 20, patterns: [/teams\.spec/i] },
  capacity: { max: 14, patterns: [/capacity-planner/i] },
  community: { max: 14, patterns: [/community-hub/i] },
  developer: { max: 12, patterns: [/developer-api-manager/i] },
  security: { max: 3, patterns: [/security-headers/i] },
  performance: { max: 3, patterns: [/overview-sla/i] },
};

const RUBRIC_APPENDIX = {
  wallet: { max: 45, patterns: [/wallet plugin shell loads/i] },
  gateway: { max: 45, patterns: [/service gateway plugin shell loads/i] },
  /** Remaining 10 pts: CSP / HTTPS / known limitations — fill manually in docs/pre-release-assessment.md */
};

function walkSuites(suite, ancestors, fileHint, callback) {
  const title = suite.title || '';
  const nextAncestors = title ? [...ancestors, title] : ancestors;
  const file = suite.file || suite.specs?.[0]?.file || fileHint;

  for (const spec of suite.specs || []) {
    const specFile = spec.file || file;
    for (const t of spec.tests || []) {
      const leaf = spec.title || '';
      const fullTitle = [...nextAncestors, leaf].filter(Boolean).join(' › ');
      const result = t.results?.[t.results.length - 1];
      const status = result?.status || 'skipped';
      const project = t.projectName || String(result?.workerIndex ?? '');
      callback({
        file: specFile || '',
        fullTitle,
        leaf,
        status,
        project: String(project),
      });
    }
  }

  for (const child of suite.suites || []) {
    walkSuites(child, nextAncestors, file || fileHint, callback);
  }
}

function collectTests(report) {
  const rows = [];
  for (const suite of report.suites || []) {
    walkSuites(suite, [], suite.file, (row) => rows.push(row));
  }
  return rows;
}

function mergeByTest(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.file}::${row.leaf}`;
    const prev = map.get(key);
    const rank = { failed: 4, timedOut: 4, interrupted: 4, flaky: 3, skipped: 1, passed: 0 };
    if (!prev || rank[row.status] > rank[prev.status]) {
      map.set(key, { ...row });
    }
  }
  return [...map.values()];
}

function classifyModule(file, title, rubric) {
  const hay = `${file} ${title}`;
  const hits = [];
  for (const [id, { patterns }] of Object.entries(rubric)) {
    if (patterns.some((re) => re.test(hay))) hits.push(id);
  }
  return hits;
}

function scoreModule(moduleId, tests, rubric) {
  const { max } = rubric[moduleId];
  const relevant = tests.filter((t) => classifyModule(t.file, t.fullTitle, rubric).includes(moduleId));
  if (relevant.length === 0) return { earned: null, max, note: 'no mapped tests' };
  const passed = relevant.filter((t) => t.status === 'passed').length;
  const failed = relevant.filter((t) => t.status === 'failed' || t.status === 'timedOut').length;
  const skipped = relevant.filter((t) => t.status === 'skipped').length;
  /** Skips count as non-pass (evidence gap); failed weight same as skip for scoring. */
  const earned = (passed / relevant.length) * max;
  return {
    earned: Math.round(earned * 10) / 10,
    max,
    passed,
    failed,
    skipped,
    total: relevant.length,
  };
}

function main() {
  const args = process.argv.slice(2);
  const appendix = args.includes('--appendix');
  const jsonPath = args.find((a) => !a.startsWith('--')) || 'test-results/results.json';
  const abs = path.resolve(process.cwd(), jsonPath);
  if (!fs.existsSync(abs)) {
    console.error(`Missing ${abs} — run Playwright with json reporter first.`);
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const raw = collectTests(report);
  const tests = mergeByTest(raw);

  const rubric = appendix ? RUBRIC_APPENDIX : RUBRIC_GA;
  const ids = Object.keys(rubric);

  console.log(`\n# Pre-release score (${appendix ? 'Appendix preview' : 'GA'})`);
  console.log(`Source: ${jsonPath}`);
  console.log(`Unique tests (worst status per file+title): ${tests.length}\n`);

  let totalEarned = 0;
  let totalMax = 0;
  for (const id of ids) {
    const s = scoreModule(id, tests, rubric);
    if (s.earned === null) {
      console.log(`- **${id}**: n/a (${s.note}) / ${s.max}`);
      continue;
    }
    totalEarned += s.earned;
    totalMax += s.max;
    console.log(
      `- **${id}**: ${s.earned} / ${s.max} (${s.passed}/${s.total} passed, ${s.failed} failed, ${s.skipped} skipped)`,
    );
  }
  if (!appendix) {
    console.log(`\n**Overall (weighted by mapped tests only):** ${Math.round(totalEarned * 10) / 10} / ${totalMax}`);
    console.log(
      '\nNote: n/a modules had no tests in this JSON export (different grep or project). Full GA needs the full pre-release suite.',
    );
  } else {
    console.log(`\n**Appendix subtotal (mapped):** ${Math.round(totalEarned * 10) / 10} / ${totalMax}`);
  }

  const failed = tests.filter((t) => t.status === 'failed' || t.status === 'timedOut');
  if (failed.length) {
    console.log('\n## Failed / timed out\n');
    for (const t of failed) {
      console.log(`- ${t.status}: ${t.fullTitle}`);
    }
  }
}

main();
