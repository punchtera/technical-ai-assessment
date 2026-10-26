import { expect, test, type Page } from '@playwright/test';
import { E2E_API_URL } from '../playwright.config';

/**
 * Principal reviewer journeys against the real stack. Texts are synthetic
 * requests from data/synthetic; the expected recommendations were observed
 * with the deterministic test provider (see docs/demo.md), not assumed.
 */
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  // The reviewer handle is chosen by the user; tests set one explicitly.
  await page.addInitScript(() => localStorage.setItem('fis.reviewerHandle', 'pm.e2e'));
});

async function submitAndOpen(page: Page, title: string, description: string) {
  await page.goto('/submit');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill(description);
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.getByText('Request received.')).toBeVisible();
  await page.getByRole('link', { name: 'Open request' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  // Poll (the page refreshes itself) until the triage pipeline has finished.
  await expect(page.locator('.badge--proc-completed').first()).toBeVisible({ timeout: 20_000 });
  return page.url().split('/requests/')[1]!;
}

async function apiGet(path: string) {
  const response = await fetch(`${E2E_API_URL}/api/v1${path}`);
  expect(response.ok).toBe(true);
  return response.json();
}

let approvedRequestId = '';

test('Scenario 1 — review the evidence and approve a match', async ({ page }) => {
  await expect(async () => {
    await page.goto('/');
    await expect(page.getByText('Demo mode.')).toBeVisible();
  }).toPass();

  const id = await submitAndOpen(
    page,
    'Email notifications are too frequent',
    'Email notifications are way too frequent, I get hundreds per day.',
  );
  approvedRequestId = id;

  const recommendation = page.locator('section', {
    has: page.getByRole('heading', { name: 'Recommendation' }),
  });
  await expect(recommendation.getByText('Proposed (not approved):')).toBeVisible();
  await expect(recommendation.getByText('Link to existing group')).toBeVisible();
  await expect(
    recommendation.getByRole('link', { name: 'Fewer, consolidated notifications' }),
  ).toBeVisible();
  await expect(recommendation.getByText('Demo provider · not AI').first()).toBeVisible();
  await expect(recommendation.getByText('verified verbatim').first()).toBeVisible();
  await expect(recommendation.getByText('approved member request')).toBeVisible();
  // Not grouped before the human decision.
  expect((await apiGet(`/requests/${id}`)).activeMembership).toBeNull();

  await page.getByRole('button', { name: /Approve: link to/ }).click();
  await page.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approved. The request is now in the group.')).toBeVisible();
  await expect(page.getByText('Approved · in group').first()).toBeVisible();

  const history = page.locator('#history');
  await expect(history.getByText('Assignment to group approved')).toBeVisible();
  await expect(history.getByText('followed the recommendation')).toBeVisible();
  await expect(history.getByText('pm.e2e').first()).toBeVisible();

  await page.getByRole('link', { name: 'Fewer, consolidated notifications' }).first().click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Fewer, consolidated notifications' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Email notifications are too frequent' }),
  ).toBeVisible();
});

test('Scenario 2 — reject a recommendation without creating a membership', async ({ page }) => {
  const id = await submitAndOpen(
    page,
    'Weekly summary email',
    'A weekly roll-up of activity on the projects I follow would replace the dozens of separate emails I get.',
  );
  const recommendation = page.locator('section', {
    has: page.getByRole('heading', { name: 'Recommendation' }),
  });
  await expect(recommendation.getByText('Create a new group')).toBeVisible();

  await page.getByRole('button', { name: 'Reject recommendation' }).click();
  await page
    .getByLabel('Why is this wrong? (optional)')
    .fill('This belongs to the existing notifications need.');
  await page.getByRole('button', { name: 'Confirm rejection' }).click();
  await expect(page.getByText('Recommendation rejected. No group was assigned.')).toBeVisible();
  await expect(page.locator('.badge--sugg-rejected')).toHaveText('suggestion rejected');

  const detail = await apiGet(`/requests/${id}`);
  expect(detail.activeMembership).toBeNull();
  expect(detail.reviewStatus).toBe('pending_review');
  const history = await apiGet(`/requests/${id}/history`);
  expect(history.events.map((e: { type: string }) => e.type)).toContain('SUGGESTION_REJECTED');
  expect(history.events.map((e: { type: string }) => e.type)).not.toContain('MEMBERSHIP_APPROVED');
  await expect(page.locator('#history').getByText('Recommendation rejected')).toBeVisible();
  await expect(
    page.locator('#history').getByText('Note: This belongs to the existing notifications need.'),
  ).toBeVisible();
});

test('Scenario 3 — create a new group through an explicit decision', async ({ page }) => {
  const id = await submitAndOpen(
    page,
    'Recover deleted tasks',
    "Someone accidentally deleted a task with three weeks of comments. There's no trash or undo, so it was gone for good.",
  );
  await page.getByRole('button', { name: 'Create new group…' }).click();
  await page.getByLabel('Group title').fill('Recover deleted work');
  await page
    .getByLabel('Underlying need')
    .fill('Users need a way to recover from accidental deletions and destructive mistakes.');
  await page.getByRole('button', { name: 'Create group and assign request' }).click();
  await expect(page.getByText('Group “Recover deleted work” created')).toBeVisible();

  // Persisted: reload and check through the UI and the API.
  await page.reload();
  await expect(page.getByRole('link', { name: 'Recover deleted work' }).first()).toBeVisible();
  const detail = await apiGet(`/requests/${id}`);
  expect(detail.activeMembership.groupTitle).toBe('Recover deleted work');
  await page.goto('/groups');
  await expect(page.getByRole('link', { name: 'Recover deleted work' })).toBeVisible();
});

test('Scenario 4 — reverse an assignment; both decisions stay in the history', async ({ page }) => {
  expect(approvedRequestId).not.toBe('');
  await page.goto(`/requests/${approvedRequestId}`);
  await page.getByRole('button', { name: 'Reverse assignment…' }).click();
  await page
    .getByLabel('Reason (kept in the audit history)')
    .fill('Approved by mistake during the demo.');
  await page.getByRole('button', { name: 'Confirm reversal' }).click();
  await expect(
    page.getByText('Assignment reversed. The request is back in the queue.'),
  ).toBeVisible();

  const history = page.locator('#history');
  await expect(history.getByText('Assignment to group approved')).toBeVisible();
  await expect(history.getByText('Assignment reversed')).toBeVisible();
  await expect(history.getByText('Note: Approved by mistake during the demo.')).toBeVisible();
  const detail = await apiGet(`/requests/${approvedRequestId}`);
  expect(detail.activeMembership).toBeNull();
  expect(detail.reviewStatus).toBe('pending_review');
});

test('Scenario 5 — vague request needs manual attention; validation blocks bad input', async ({
  page,
}) => {
  await submitAndOpen(page, 'notifications', 'too much noise');
  await expect(page.getByText('Needs manual attention').first()).toBeVisible();
  await expect(page.getByText('The request is too vague to identify a clear need.')).toBeVisible();

  await page.goto('/submit');
  await page.getByLabel('Title').fill('x');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.locator('.field-error').first()).toBeVisible();
  await expect(page.getByText('Request received.')).toHaveCount(0);
});
