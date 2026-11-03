import { test, expect } from '@playwright/test';

// BITS SSO is not set up in CI (no SAML_* settings): the login page must keep
// the password form for everyone, show no BITS button, and the SAML routes stay
// closed. The SAML flow itself is covered by the fake-IdP unit tests.
test.describe('BITS sign-in while it is not set up', () => {
  test('login page keeps the password form and shows no BITS button', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByTestId('bits-sso-button')).toHaveCount(0);
    await expect(page.getByTestId('admin-password-login')).toHaveCount(0);
  });

  test('the SAML routes stay closed', async ({ request }) => {
    expect((await request.get('/api/saml/metadata')).status()).toBe(404);
    const res = await request.get('/api/saml/login', { maxRedirects: 0 });
    expect(res.status()).toBe(303);
    expect(res.headers()['location']).toContain('/login?sso=unavailable');
  });

  test('a refused BITS sign-in explains what to do', async ({ page }) => {
    await page.goto('/login?sso=not_set_up');
    await expect(page.getByTestId('sso-notice')).toContainText('contact the Instruction Cell');
  });
});
