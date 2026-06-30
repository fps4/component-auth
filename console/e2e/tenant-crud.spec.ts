import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedAuth } from './fake-auth';

// Regression coverage for the tenant drill-down + client/user CRUD (PR #44) and the error boundary that
// keeps a backend hiccup from rendering Next's opaque "client-side exception" page.

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

test('create a client from the tenant detail page — no client-side exception', async ({ context, page, baseURL }) => {
  await seedAuth(context, baseURL!);
  const errors = trackErrors(page);

  await page.goto('/tenants/t1');
  await expect(page.getByText('Clients (service accounts)')).toBeVisible();

  // Scope to the add-client form so we don't hit the hidden name field of the suspend/activate form.
  const addForm = page.locator('form', { has: page.getByRole('button', { name: 'Add client' }) });
  await addForm.locator('input[name="name"]').fill('repro-svc');
  await addForm.locator('input[name="grantTypes"]').fill('client_credentials');
  await addForm.getByRole('button', { name: 'Add client' }).click();

  // The freshly-created client appears; no error page.
  await expect(page.getByText('repro-svc')).toBeVisible();
  await expect(page.getByText(/application error/i)).toHaveCount(0);
  expect(errors, 'no uncaught browser errors').toEqual([]);
});

test('create a client from the /clients page (SelectField path) — no client-side exception', async ({ context, page, baseURL }) => {
  await seedAuth(context, baseURL!);
  const errors = trackErrors(page);

  await page.goto('/clients');
  const addForm = page.locator('form', { has: page.getByRole('button', { name: 'Create client' }) });
  await addForm.locator('select[name="tenantId"]').selectOption('t1');
  await addForm.locator('input[name="name"]').fill('repro-svc-2');
  await addForm.locator('input[name="grantTypes"]').fill('client_credentials');
  await addForm.getByRole('button', { name: 'Create client' }).click();
  await page.waitForTimeout(1500);

  await expect(page.getByText(/application error/i)).toHaveCount(0);
  expect(errors, 'no uncaught browser errors').toEqual([]);
});

test('a backend failure renders a readable card, not an opaque crash', async ({ context, page, baseURL }) => {
  await seedAuth(context, baseURL!);
  const errors = trackErrors(page);

  await page.goto('/tenants/boom'); // stub returns 500 for this id

  await expect(page.getByText("Couldn't load this tenant")).toBeVisible();
  await expect(page.getByText(/application error/i)).toHaveCount(0);
  expect(errors, 'no uncaught browser errors').toEqual([]);
});
