import { expect, test, type BrowserContext } from '@playwright/test';
import { devSessionCookie } from './session';

const HOUSEHOLD = { householdName: 'E2E-hushållet', name: 'Anton' };

const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function signIn(context: BrowserContext, email: string) {
  await context.addCookies([
    {
      name: 'budget_session',
      value: devSessionCookie(email),
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('signed out', () => {
  test('the landing page offers a way in and says nothing else', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.landing-mark')).toContainText('pnkt');
    await expect(page.locator('.landing-line')).toBeVisible();
    await expect(page.getByRole('button', { name: /logga in|sign in/i })).toBeVisible();

    // Nothing about a household should reach someone who is not in one.
    await expect(page.locator('.nav')).toHaveCount(0);
    await expect(page.getByText(/SEK/)).toHaveCount(0);
  });

  test('the API refuses a budget without a session', async ({ request }) => {
    expect((await request.get('/api/health')).status()).toBe(200);
    expect((await request.get('/api/budget')).status()).toBe(401);
  });

  test('a cookie signed with the wrong key is not a session', async ({ request }) => {
    const response = await request.get('/api/budget', {
      headers: { cookie: `budget_session=${devSessionCookie('anton@e2e.se', 'wrong-seed')}` },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe('signed in', () => {
  test('creates a household and renders it', async ({ page, context, request }) => {
    const email = `${unique('anton')}@e2e.se`;
    await signIn(context, email);

    const created = await request.post('/api/households', {
      headers: { cookie: `budget_session=${devSessionCookie(email)}` },
      data: HOUSEHOLD,
    });
    expect(created.status()).toBe(201);

    await page.goto('/');
    await expect(page.locator('.nav')).toBeVisible();

    await page.goto('/#settings');
    await expect(page.getByText(HOUSEHOLD.householdName)).toBeVisible();
  });

  test('holds a household to five members', async ({ request }) => {
    const email = `${unique('full')}@e2e.se`;
    const cookie = `budget_session=${devSessionCookie(email)}`;
    expect((await request.post('/api/households', { headers: { cookie }, data: HOUSEHOLD })).status())
      .toBe(201);

    const add = () => {
      const id = unique('m');
      return request.put(`/api/members/${id}`, {
        headers: { cookie },
        data: {
          id,
          name: 'Medlem',
          email: `${id}@e2e.se`,
          role: 'member',
          status: 'invited',
          baselineIncome: 0,
        },
      });
    };

    // The creator is already a member, so four more fill it and the next is refused.
    for (let n = 0; n < 4; n++) expect((await add()).status()).toBe(204);
    expect((await add()).status()).toBe(409);
  });

  test('refuses a name longer than an invite mail should carry', async ({ request }) => {
    const email = `${unique('long')}@e2e.se`;
    const response = await request.post('/api/households', {
      headers: { cookie: `budget_session=${devSessionCookie(email)}` },
      data: { householdName: 'x'.repeat(200), name: 'Anton' },
    });
    expect(response.status()).toBe(400);
  });

  test('refuses a push endpoint that is not a push service', async ({ request }) => {
    const email = `${unique('push')}@e2e.se`;
    const cookie = `budget_session=${devSessionCookie(email)}`;
    await request.post('/api/households', { headers: { cookie }, data: HOUSEHOLD });

    const response = await request.put('/api/push', {
      headers: { cookie },
      data: { endpoint: 'https://attacker.example/collect', p256dh: 'x', auth: 'y' },
    });
    expect(response.status()).toBe(400);
  });
});

/**
 * The UI has always drawn a line between an admin and a member. Until now the API
 * did not, so the line was a drawing.
 */
test.describe('roles', () => {
  /** A household with an admin and a plain member, and a cookie for each. */
  async function household(request: import('@playwright/test').APIRequestContext) {
    const adminEmail = `${unique('admin')}@e2e.se`;
    const memberEmail = `${unique('member')}@e2e.se`;
    const admin = `budget_session=${devSessionCookie(adminEmail)}`;
    const member = `budget_session=${devSessionCookie(memberEmail)}`;

    const created = await request.post('/api/households', {
      headers: { cookie: admin },
      data: HOUSEHOLD,
    });
    expect(created.status()).toBe(201);
    const budget = await created.json();
    const adminId = budget.members[0].id;

    const memberId = unique('m');
    expect(
      (
        await request.put(`/api/members/${memberId}`, {
          headers: { cookie: admin },
          data: {
            id: memberId,
            name: 'Petra',
            email: memberEmail,
            role: 'member',
            status: 'active',
            baselineIncome: 25500,
          },
        })
      ).status(),
    ).toBe(204);

    return { admin, member, adminId, memberId, memberEmail };
  }

  test('a member cannot make themselves an admin', async ({ request }) => {
    const h = await household(request);

    const response = await request.put(`/api/members/${h.memberId}`, {
      headers: { cookie: h.member },
      data: {
        id: h.memberId,
        name: 'Petra',
        email: h.memberEmail,
        role: 'admin',
        status: 'active',
        baselineIncome: 25500,
      },
    });

    // The write is allowed, because this is also how preferences are saved.
    expect(response.status()).toBe(204);

    // The role is not.
    const budget = await (await request.get('/api/budget', { headers: { cookie: h.member } })).json();
    expect(budget.members.find((m: { id: string }) => m.id === h.memberId).role).toBe('member');
  });

  test('a member cannot rewrite their own income upwards through another member', async ({ request }) => {
    const h = await household(request);

    const own = await request.put(`/api/income/2026-08/${h.memberId}`, {
      headers: { cookie: h.member },
      data: { amount: 25500, enteredById: null },
    });
    expect(own.status()).toBe(204);

    const other = await request.put(`/api/income/2026-08/${h.adminId}`, {
      headers: { cookie: h.member },
      data: { amount: 1, enteredById: null },
    });
    expect(other.status()).toBe(403);
  });

  test('an admin may fill in on someone else behalf', async ({ request }) => {
    const h = await household(request);
    const response = await request.put(`/api/income/2026-08/${h.memberId}`, {
      headers: { cookie: h.admin },
      data: { amount: 25500, enteredById: h.adminId },
    });
    expect(response.status()).toBe(204);
  });

  test('a member cannot rename the household, change its split, or remove anyone', async ({ request }) => {
    const h = await household(request);

    expect(
      (await request.put('/api/household', { headers: { cookie: h.member }, data: { name: 'Kapat' } })).status(),
    ).toBe(403);
    expect(
      (await request.put('/api/household/split', { headers: { cookie: h.member }, data: { split: 'even' } })).status(),
    ).toBe(403);
    expect(
      (await request.delete(`/api/members/${h.adminId}`, { headers: { cookie: h.member } })).status(),
    ).toBe(403);
  });

  test('a member may still save their own preferences', async ({ request }) => {
    const h = await household(request);

    const response = await request.put(`/api/members/${h.memberId}`, {
      headers: { cookie: h.member },
      data: {
        id: h.memberId,
        name: 'Petra',
        email: h.memberEmail,
        role: 'member',
        status: 'active',
        baselineIncome: 25500,
        language: 'en',
        theme: 'dark',
        emailReminders: false,
      },
    });
    expect(response.status()).toBe(204);

    const budget = await (await request.get('/api/budget', { headers: { cookie: h.member } })).json();
    const me = budget.members.find((m: { id: string }) => m.id === h.memberId);
    expect(me.language).toBe('en');
    expect(me.emailReminders).toBe(false);
  });
});
