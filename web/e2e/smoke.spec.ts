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

  test('a second household for the same address is refused', async ({ request }) => {
    const email = `${unique('twice')}@e2e.se`;
    const cookie = `budget_session=${devSessionCookie(email)}`;

    expect((await request.post('/api/households', { headers: { cookie }, data: HOUSEHOLD })).status())
      .toBe(201);
    expect((await request.post('/api/households', { headers: { cookie }, data: HOUSEHOLD })).status())
      .toBe(409);
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

  test('the last admin cannot demote or remove themselves', async ({ request }) => {
    const h = await household(request);

    const demote = await request.put(`/api/members/${h.adminId}`, {
      headers: { cookie: h.admin },
      data: {
        id: h.adminId,
        name: 'Anton',
        email: `${unique('x')}@e2e.se`,
        role: 'member',
        status: 'active',
        baselineIncome: 0,
      },
    });
    expect(demote.status()).toBe(409);

    const remove = await request.delete(`/api/members/${h.adminId}`, { headers: { cookie: h.admin } });
    expect(remove.status()).toBe(409);

    // Still an admin, so the household can still be administered.
    expect(
      (await request.put('/api/household', { headers: { cookie: h.admin }, data: { name: 'Fortfarande' } })).status(),
    ).toBe(204);
  });

  test('renaming is held to the same length as creating', async ({ request }) => {
    const h = await household(request);
    const response = await request.put('/api/household', {
      headers: { cookie: h.admin },
      data: { name: 'x'.repeat(200) },
    });
    expect(response.status()).toBe(400);
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

/**
 * The whole first-run path, on a household that has just been created. Each
 * question is derived from the data, so this also proves a household cannot get
 * stuck between steps.
 */
test.describe('first steps', () => {
  test('walks a new household from nothing to a number', async ({ page, context, request }) => {
    const email = `${unique('new')}@e2e.se`;
    await signIn(context, email);
    const cookie = `budget_session=${devSessionCookie(email)}`;
    expect((await request.post('/api/households', { headers: { cookie }, data: HOUSEHOLD })).status())
      .toBe(201);

    await page.goto('/');

    // Nothing entered: no figure is stated, because there is nothing to state.
    await expect(page.locator('.hero')).toContainText(/Inget att räkna på än|Nothing to work out yet/);
    await expect(page.locator('.first-step')).toContainText(/vanlig månad|normal month/);
    await expect(page.locator('.first-step')).toContainText(/[Ee]fter skatt|[Aa]fter tax/);

    // Answering moves the figure above it, which is the only reward on offer.
    await page.locator('.first-step input').fill('32000');
    await page.locator('.first-step button').click();

    await expect(page.locator('.hero .value')).toBeVisible();
    await expect(page.locator('.first-step')).toContainText(/delar ni på|do you share/);

    // The costs section explains itself while it is empty.
    await page.goto('/#costs');
    await expect(page.locator('.card').first()).toContainText(/hyra, el|rent, power/);
  });

  test('stops asking once the household says it is one person', async ({ page, context, request }) => {
    const email = `${unique('solo')}@e2e.se`;
    await signIn(context, email);
    const cookie = `budget_session=${devSessionCookie(email)}`;
    const created = await request.post('/api/households', { headers: { cookie }, data: HOUSEHOLD });
    const budget = await created.json();
    const memberId = budget.members[0].id;

    expect(
      (
        await request.put(`/api/members/${memberId}`, {
          headers: { cookie },
          data: { ...budget.members[0], baselineIncome: 32000 },
        })
      ).status(),
    ).toBe(204);

    const costId = unique('c');
    expect(
      (
        await request.put(`/api/costs/${costId}`, {
          headers: { cookie },
          data: {
            id: costId,
            category: 'Boende',
            description: 'Hyra',
            amount: 12000,
            intervalMonths: 1,
            firstCharge: '2026-01',
            payerId: null,
          },
        })
      ).status(),
    ).toBe(204);

    await page.goto('/');
    await expect(page.locator('.first-step')).toContainText(/fler i hushållet|else in the household/);

    await page.getByRole('button', { name: /bara jag|just me/i }).click();
    await expect(page.locator('.first-step')).toHaveCount(0);

    // And it stays gone.
    await page.reload();
    await expect(page.locator('.first-step')).toHaveCount(0);
  });
});

test.describe('buffer', () => {
  test('any member may set the goal, and only within none to twelve months', async ({ request }) => {
    const email = `${unique('bufadmin')}@e2e.se`;
    const admin = `budget_session=${devSessionCookie(email)}`;
    const created = await request.post('/api/households', { headers: { cookie: admin }, data: HOUSEHOLD });
    expect(created.status()).toBe(201);

    const memberEmail = `${unique('bufmember')}@e2e.se`;
    const memberId = unique('m');
    await request.put(`/api/members/${memberId}`, {
      headers: { cookie: admin },
      data: { id: memberId, name: 'Petra', email: memberEmail, role: 'member', status: 'active', baselineIncome: 25500 },
    });
    const member = `budget_session=${devSessionCookie(memberEmail)}`;

    // Shared account, shared responsibility: not an admin-only setting.
    expect((await request.put('/api/household/buffer', { headers: { cookie: member }, data: { months: 3 } })).status())
      .toBe(204);

    // Zero is a real answer: it means no buffer, which is not the same as never
    // having chosen, and that is what the default of one month covers.
    expect((await request.put('/api/household/buffer', { headers: { cookie: admin }, data: { months: 0 } })).status())
      .toBe(204);
    await request.put('/api/household/buffer', { headers: { cookie: member }, data: { months: 3 } });

    for (const months of [-1, 13]) {
      expect((await request.put('/api/household/buffer', { headers: { cookie: admin }, data: { months } })).status())
        .toBe(400);
    }

    const budget = await (await request.get('/api/budget', { headers: { cookie: admin } })).json();
    expect(budget.household.bufferMonths).toBe(3);
  });

  test('a good month sets a little aside, a normal one does not', async ({ page, context, request }) => {
    const email = `${unique('buf')}@e2e.se`;
    const cookie = `budget_session=${devSessionCookie(email)}`;
    await signIn(context, email);
    const budget = await (await request.post('/api/households', { headers: { cookie }, data: HOUSEHOLD })).json();
    const me = budget.members[0];
    await request.put(`/api/members/${me.id}`, { headers: { cookie }, data: { ...me, baselineIncome: 48000 } });

    const costId = unique('c');
    await request.put(`/api/costs/${costId}`, {
      headers: { cookie },
      data: { id: costId, category: 'Boende', description: 'Hyra', amount: 12000, intervalMonths: 1, firstCharge: '2026-01', payerId: null },
    });

    const month = new Date().toISOString().slice(0, 7);
    await request.put('/api/account-balance', { headers: { cookie }, data: { month, amount: 5000 } });
    await request.put('/api/household/buffer', { headers: { cookie }, data: { months: 2 } });

    // Nothing entered yet, so the month is an estimate and never a good one.
    await page.goto('/');
    await expect(page.getByText(/bufferten|the buffer/i)).toHaveCount(0);

    await request.put(`/api/income/${month}/${me.id}`, { headers: { cookie }, data: { amount: 58000, enteredById: null } });
    await page.reload();
    await expect(page.getByText(/bufferten|the buffer/i)).toBeVisible();
  });
});

test('a month can opt out of its own buffer', async ({ page, context, request }) => {
  const email = `${unique('skip')}@e2e.se`;
  const cookie = `budget_session=${devSessionCookie(email)}`;
  await signIn(context, email);
  const budget = await (await request.post('/api/households', { headers: { cookie }, data: HOUSEHOLD })).json();
  const me = budget.members[0];
  await request.put(`/api/members/${me.id}`, { headers: { cookie }, data: { ...me, baselineIncome: 48000 } });

  const costId = unique('c');
  await request.put(`/api/costs/${costId}`, {
    headers: { cookie },
    data: { id: costId, category: 'Boende', description: 'Hyra', amount: 12000, intervalMonths: 1, firstCharge: '2026-01', payerId: null },
  });

  const month = new Date().toISOString().slice(0, 7);
  await request.put('/api/account-balance', { headers: { cookie }, data: { month, amount: 5000 } });
  await request.put(`/api/income/${month}/${me.id}`, { headers: { cookie }, data: { amount: 58000, enteredById: null } });

  await page.goto('/');
  await expect(page.getByText(/bufferten|the buffer/i)).toBeVisible();

  await page.getByRole('button', { name: /hoppa över|skip this month/i }).click();
  await expect(page.getByText(/Ingen buffert den här månaden|No buffer this month/i)).toBeVisible();

  // It is the household's answer, not this browser's.
  await page.reload();
  await expect(page.getByText(/Ingen buffert den här månaden|No buffer this month/i)).toBeVisible();

  await page.getByRole('button', { name: /ångra|undo/i }).click();
  await expect(page.getByText(/bufferten|the buffer/i)).toBeVisible();
});
