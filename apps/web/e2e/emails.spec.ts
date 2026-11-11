import { test, expect, type Page } from '@playwright/test';
import { prisma } from '@hmp/db';

// v1.4.3 (§4, §7) — Admin → Notifications: edit an email's wording (refused with an unknown placeholder),
// preview it with a real request, send a test, find it in the email log, set the reply-to; and the
// welcome tick box on Add person (on by default). Everything it changes is put back afterwards.

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

const started = new Date();
let settingsBefore: { emailReplyTo: string | null; emailHelp: string | null } | null = null;

test.beforeAll(async () => {
  settingsBefore = await prisma.workflowConfig.findUnique({
    where: { key: 'default' },
    select: { emailReplyTo: true, emailHelp: true },
  });
});

test.afterAll(async () => {
  const admin = await prisma.user.findUnique({
    where: { email: 'admin@hmp.local' },
    select: { id: true },
  });
  if (admin) {
    const rows = await prisma.notification.findMany({
      where: {
        userId: admin.id,
        createdAt: { gte: started },
        meta: { path: ['kind'], equals: 'email.test' },
      },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: rows.map((r) => r.id) } } });
    await prisma.notification.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    await prisma.auditLog.deleteMany({
      where: {
        actorId: admin.id,
        createdAt: { gte: started },
        action: { in: ['email.test', 'email.wording', 'email.wording-reset', 'email.settings'] },
      },
    });
  }
  await prisma.notificationTemplate.deleteMany({
    where: { key: 'email:sent-back:FACULTY', editedAt: { gte: started } },
  });
  if (settingsBefore)
    await prisma.workflowConfig.update({ where: { key: 'default' }, data: settingsBefore });
  await prisma.$disconnect();
});

test('Admin edits an email’s wording, previews it with a real request and sends a test', async ({
  page,
}) => {
  await signIn(page, 'admin@hmp.local');
  await page.goto('/admin/notifications');
  await expect(page.getByTestId('email-list')).toBeVisible();
  await page.getByTestId('edit-sent-back:FACULTY').click();

  const editor = page.getByTestId('email-editor');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('preview-subject')).toContainText('[HMP] Changes needed:', {
    timeout: 30_000,
  });
  const frame = page.frameLocator('iframe[title="Email preview"]');
  await expect(frame.getByText('Handout details')).toBeVisible();
  await expect(frame.getByText('What you need to do', { exact: false })).toBeVisible();

  // An unknown placeholder is refused.
  await page.getByTestId('wording-subject').fill('Please revise {{nmae}}');
  await page.getByTestId('wording-save').click();
  await expect(editor.getByRole('alert')).toContainText('{{nmae}}');

  // A real edit: saved, marked Edited, and the preview follows.
  await page.getByTestId('wording-subject').fill('Please revise: {{courseCode}} ({{semester}})');
  await page.getByTestId('wording-save').click();
  await expect(editor.getByRole('status').first()).toContainText('Saved.');
  await page.getByTestId('preview-refresh').click();
  await expect(page.getByTestId('preview-subject')).toContainText('[HMP] Please revise:');
  await expect(page.getByTestId('email-list').getByText('Edited')).toBeVisible();

  // Test send: to the Admin's own address, then in the email log.
  await page.getByTestId('send-test').click();
  await expect(editor.getByText(/It is in the email log/)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('tab-log').click();
  await expect(page.getByTestId('email-log')).toBeVisible();
  await expect(
    page
      .getByTestId('email-log')
      .getByText(/\[HMP\] TEST — Please revise:/)
      .first(),
  ).toBeVisible();

  // Back to the original wording.
  await page.goto('/admin/notifications?tab=emails&edit=sent-back%3AFACULTY');
  await page.getByTestId('wording-original').click();
  await page.getByTestId('wording-save').click();
  await expect(editor.getByRole('status').first()).toContainText('Back to the original wording.');
  await expect(page.getByTestId('email-list').getByText('Edited')).toHaveCount(0);
});

test('Admin sets the reply-to; emails then say where replies go', async ({ page }) => {
  await signIn(page, 'admin@hmp.local');
  await page.goto('/admin/notifications?tab=settings');
  await page.getByTestId('settings-reply-to').fill('ic-desk@hmp.local');
  await page.getByTestId('settings-help').fill('Instruction Cell desk');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('email-settings').getByRole('status')).toContainText('Saved.');
  await page.goto('/admin/notifications?tab=emails&edit=request.new%3AHOG');
  const frame = page.frameLocator('iframe[title="Email preview"]');
  await expect(frame.getByText('Replies to this email go to ic-desk@hmp.local.')).toBeVisible({
    timeout: 30_000,
  });
  await expect(frame.getByText('Help: Instruction Cell desk')).toBeVisible();
});

test('Add person: “Send a welcome email” is ticked by default', async ({ page }) => {
  await signIn(page, 'admin@hmp.local');
  await page.goto('/admin/people/new');
  await expect(page.getByTestId('person-welcome')).toBeChecked();
});
