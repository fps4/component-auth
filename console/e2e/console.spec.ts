import { test, expect } from '@playwright/test';
import { seedAuth, OPERATOR_EMAIL } from './fake-auth';

// Smoke: with an operator session seeded, the gate lets the dashboard render, the console forwards the
// operator token to the (stubbed) plane, and the operator chip shows the signed-in identity (RQ-0008).

test('authenticated operator sees the dashboard and their identity', async ({ context, page, baseURL }) => {
  await seedAuth(context, baseURL!);

  await page.goto('/');

  // Stats served by the stub render (proves the server forwarded the Bearer token — the stub 401s without it).
  await expect(page.getByText('Dashboard')).toBeVisible();
  await expect(page.getByText('Tenants')).toBeVisible();
  await expect(page.getByText(OPERATOR_EMAIL)).toBeVisible();
});

test('an unauthenticated visit is redirected to /login', async ({ page }) => {
  await page.goto('/tenants');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(/sign in to the admin console/i)).toBeVisible();
});
