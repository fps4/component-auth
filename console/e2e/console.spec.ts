import { test, expect } from '@playwright/test';
import { seedAuth } from './fake-auth';

// Smoke: with an operator session seeded, the gate lets the dashboard render and the console forwards the
// operator token to the (stubbed) plane (RQ-0008). The signed-in shell shows the Sign out affordance.
// (The identity chip text is sourced from localStorage, which this cookie-only seed does not populate.)

test('authenticated operator sees the dashboard and the signed-in shell', async ({ context, page, baseURL }) => {
  await seedAuth(context, baseURL!);

  await page.goto('/');

  // Stats served by the stub render (proves the server forwarded the Bearer token — the stub 401s without it).
  // Use role-scoped locators: "Dashboard"/"Tenants" appear in both the nav and the page body.
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tenants' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});

test('an unauthenticated visit is redirected to /login', async ({ page }) => {
  await page.goto('/tenants');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(/sign in to the admin console/i)).toBeVisible();
});
