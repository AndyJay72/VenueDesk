/**
 * email_loop_guard.spec.js
 *
 * Structural integrity tests for the $runIndex > 50 safety guard that
 * prevents infinite SMTP loops when SplitInBatches workflows are run
 * with pinned test data (Pattern 29 incident — September 2026).
 *
 * These tests read the workflow JSON files directly from disk.
 * No browser, no live API, no mocking required.
 *
 * Nodes under test:
 *   UnpaidBookingLifecycle.json   — Code: Build Warning Email  (ubl-006)
 *   UnpaidBookingLifecycle.json   — Code: Build Cancel Email   (ubl-010)
 *   PendingLifecycleScheduler.json — Code: Build Warning Email (pls-code-002)
 *
 * Regression contract: if any of these assertions fail, the guard has been
 * accidentally removed. Do NOT disable these tests to make a commit pass.
 */

const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.resolve(__dirname, '../../n8n-workflows');

const GUARD_LINE_1 = 'const runIndex = $runIndex || 0;';
const GUARD_LINE_2 = 'if (runIndex > 50) {';
const GUARD_MSG    = 'Safety limit reached: Loop exceeded 50 iterations. Halting to prevent SMTP spam.';

function loadWorkflow(filename) {
  const fp = path.join(WORKFLOWS_DIR, filename);
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function getNode(workflow, nodeId) {
  return workflow.nodes.find(n => n.id === nodeId);
}

function getJsCode(node) {
  return node?.parameters?.jsCode ?? '';
}

// ── Shared guard assertions ───────────────────────────────────────────────────

function assertGuardPresent(jsCode, label) {
  const lines = jsCode.split('\n');

  expect(lines[0], `${label}: guard line 1 must be first line`).toBe(GUARD_LINE_1);
  expect(lines[1], `${label}: guard line 2 must be second line`).toBe(GUARD_LINE_2);
  expect(jsCode,   `${label}: guard error message must be present`).toContain(GUARD_MSG);
}

function assertGuardBeforeBusinessLogic(jsCode, label, firstBusinessToken) {
  const guardPos    = jsCode.indexOf(GUARD_LINE_1);
  const businessPos = jsCode.indexOf(firstBusinessToken);
  expect(guardPos,    `${label}: guard must be present`).toBeGreaterThanOrEqual(0);
  expect(businessPos, `${label}: business logic must be present`).toBeGreaterThan(0);
  expect(guardPos,    `${label}: guard must precede business logic`).toBeLessThan(businessPos);
}

// ── UnpaidBookingLifecycle ────────────────────────────────────────────────────

test.describe('UnpaidBookingLifecycle — loop guards', () => {
  let workflow;

  test.beforeAll(() => {
    workflow = loadWorkflow('UnpaidBookingLifecycle.json');
  });

  test('workflow file parses and has nodes array', () => {
    expect(Array.isArray(workflow.nodes)).toBe(true);
    expect(workflow.nodes.length).toBeGreaterThan(0);
  });

  test('Code: Build Warning Email — guard is first code', () => {
    const node = getNode(workflow, 'ubl-006');
    expect(node, 'node ubl-006 must exist').toBeTruthy();
    expect(node.name).toBe('Code: Build Warning Email');

    const code = getJsCode(node);
    assertGuardPresent(code, 'UBL / Code: Build Warning Email');
  });

  test('Code: Build Warning Email — guard precedes tenant config fetch', () => {
    const code = getJsCode(getNode(workflow, 'ubl-006'));
    assertGuardBeforeBusinessLogic(code,
      'UBL / Code: Build Warning Email',
      'tenantId_w');
  });

  test('Code: Build Cancel Email — guard is first code', () => {
    const node = getNode(workflow, 'ubl-010');
    expect(node, 'node ubl-010 must exist').toBeTruthy();
    expect(node.name).toBe('Code: Build Cancel Email');

    const code = getJsCode(node);
    assertGuardPresent(code, 'UBL / Code: Build Cancel Email');
  });

  test('Code: Build Cancel Email — guard precedes tenant config fetch', () => {
    const code = getJsCode(getNode(workflow, 'ubl-010'));
    assertGuardBeforeBusinessLogic(code,
      'UBL / Code: Build Cancel Email',
      'tenantId_c');
  });

  test('SplitInBatches nodes are NOT in pinData (Pattern 29)', () => {
    const pinData = workflow.pinData ?? {};
    const splitNodes = workflow.nodes
      .filter(n => n.type === 'n8n-nodes-base.splitInBatches')
      .map(n => n.name);

    for (const name of splitNodes) {
      expect(
        Object.prototype.hasOwnProperty.call(pinData, name),
        `${name} must not be pinned — pinning causes infinite loops`
      ).toBe(false);
    }
  });
});

// ── PendingLifecycleScheduler ─────────────────────────────────────────────────

test.describe('PendingLifecycleScheduler — loop guard', () => {
  let workflow;

  test.beforeAll(() => {
    workflow = loadWorkflow('PendingLifecycleScheduler.json');
  });

  test('workflow file parses and has nodes array', () => {
    expect(Array.isArray(workflow.nodes)).toBe(true);
    expect(workflow.nodes.length).toBeGreaterThan(0);
  });

  test('Code: Build Warning Email — guard is first code', () => {
    const node = getNode(workflow, 'pls-code-002');
    expect(node, 'node pls-code-002 must exist').toBeTruthy();
    expect(node.name).toBe('Code: Build Warning Email');

    const code = getJsCode(node);
    assertGuardPresent(code, 'PLS / Code: Build Warning Email');
  });

  test('Code: Build Warning Email — guard precedes tenant config fetch', () => {
    const code = getJsCode(getNode(workflow, 'pls-code-002'));
    assertGuardBeforeBusinessLogic(code,
      'PLS / Code: Build Warning Email',
      'tenantId');
  });

  test('Split: Warning Batch is NOT in pinData (Pattern 29)', () => {
    const pinData = workflow.pinData ?? {};
    expect(
      Object.prototype.hasOwnProperty.call(pinData, 'Split: Warning Batch'),
      'Split: Warning Batch must not be pinned — pinning causes infinite loops'
    ).toBe(false);
  });
});

// ── Cron schedule audit ───────────────────────────────────────────────────────

test.describe('Cron schedule audit — no runaway schedules', () => {
  const SCHEDULED_WORKFLOWS = [
    'UnpaidBookingLifecycle.json',
    'PendingLifecycleScheduler.json',
    'BillingCycleTrigger.json',
    'RecurringPaymentReminder.json',
    'RecurringPaymentChaser.json',
    'CycleSweepCron.json',
  ];

  for (const filename of SCHEDULED_WORKFLOWS) {
    test(`${filename} — no every-minute cron`, () => {
      const wf = loadWorkflow(filename);
      for (const node of wf.nodes) {
        if (!node.type?.includes('scheduleTrigger')) continue;
        const intervals = node.parameters?.rule?.interval ?? [];
        for (const iv of intervals) {
          const expr = iv.expression ?? '';
          expect(expr, `${filename} / ${node.name}: must not run every minute`)
            .not.toBe('* * * * *');
          // Also block sub-hourly patterns like */5 * * * * unless it is the
          // intentional Health Pulse node in OnboardingManager
          if (expr.startsWith('*/') && node.name !== 'Cron: Health Pulse') {
            const mins = parseInt(expr.split(' ')[0].replace('*/', ''), 10);
            expect(mins, `${filename} / ${node.name}: sub-hourly interval must be >= 30 mins`)
              .toBeGreaterThanOrEqual(30);
          }
        }
      }
    });
  }
});
