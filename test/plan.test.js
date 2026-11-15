/* Run: node test/plan.test.js   (no dependencies) */
const assert = require('assert');
const P = require('../public/plan.js');
const { handler } = require('../netlify/functions/send-plan.js');

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
};
const allItems = (plan) => plan.sections.map((s) => s.items.join('\n')).join('\n');
const base = { adults: 2, children: 2, housing: 'apartment', tenure: 'rent', startDate: '2026-11-14' };
const build = (extra) => P.buildPlan(P.validate(Object.assign({}, base, extra)).answers);

(async () => {
  await test('water math: 4 people = 12 gal for 3 days, 56 for 14', () => {
    const plan = build();
    assert.strictEqual(plan.numbers[0].value, '4');
    assert.strictEqual(plan.numbers[1].value, '12 gal');
    assert.strictEqual(plan.numbers[2].value, '56 gal');
    assert.strictEqual(plan.numbers[3].value, '30 days');
  });

  await test('dates: Day 1-7 from Nov 14 is Nov 14 to Nov 20; Day 61-90 crosses the year', () => {
    const plan = build();
    assert.strictEqual(plan.sections[0].dates, 'Nov 14 to Nov 20');
    assert.strictEqual(plan.sections[3].dates, 'Jan 13 to Feb 11');
  });

  await test('dorm: smaller targets, no door hardware, no camp stove, campus plan', () => {
    const plan = build({ adults: 1, children: 0, housing: 'dorm', tenure: 'own' });
    const text = allItems(plan);
    assert.strictEqual(plan.numbers[3].value, '14 days');
    assert.ok(/campus emergency plan/.test(text));
    assert.ok(!/3-inch screws/.test(text));
    assert.ok(!/Camp stoves/.test(text));
    assert.ok(!/deed/.test(text));
  });

  await test('owner gets deed and title items; renter gets renters insurance', () => {
    assert.ok(/name is on the deed/.test(allItems(build({ housing: 'house', tenure: 'own' }))));
    const renter = allItems(build());
    assert.ok(/renters insurance/.test(renter));
    assert.ok(!/name is on the deed/.test(renter));
  });

  await test('health flags add their items and only theirs', () => {
    const none = allItems(build());
    assert.ok(!/dialysis/i.test(none) && !/insulin/.test(none) && !/medical needs list/.test(none));
    const some = allItems(build({ health: ['coldmeds', 'powered', 'dialysis', 'bogus'] }));
    assert.ok(/insulin/.test(some) && /medical needs list/.test(some) && /dialysis clinic/.test(some));
  });

  await test('well water, high floor, no car, living alone, infants, pets all tailor the plan', () => {
    const text = allItems(build({ water: 'well', floor: 'high', vehicle: 'no', network: 'alone', infants: 1, pets: 2, elders: 1 }));
    assert.ok(/well pump needs electricity/.test(text));
    assert.ok(/Above the fifth floor/.test(text));
    assert.ok(/No car:/.test(text));
    assert.ok(/You live alone/.test(text));
    assert.ok(/1 baby/.test(text));
    assert.ok(/2 pets/.test(text));
  });

  await test('house forces ground floor; elders cannot exceed adults', () => {
    const a = P.validate({ housing: 'house', floor: 'high', adults: 2, elders: 9 }).answers;
    assert.strictEqual(a.floor, 'ground');
    assert.strictEqual(a.elders, 2);
  });

  await test('validation: bad values fall back, counts are clamped, bad email is rejected', () => {
    const v = P.validate({ adults: 999, children: -5, housing: 'castle', email: 'not-an-email', startDate: '2026-02-31' });
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.answers.adults, 12);
    assert.strictEqual(v.answers.children, 0);
    assert.strictEqual(v.answers.housing, 'apartment');
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(v.answers.startDate) && v.answers.startDate !== '2026-02-31');
    assert.strictEqual(P.validate({ email: 'a@b.co' }).ok, true);
    assert.strictEqual(P.validate({}).ok, true);
  });

  await test('name cannot inject HTML into the email', () => {
    const v = P.validate(Object.assign({}, base, { firstName: '<script>alert(1)</script>"Bo' }));
    const html = P.renderEmail(P.buildPlan(v.answers));
    assert.ok(!/<script/i.test(html));
    assert.ok(html.indexOf('&#9744;') > 0);
  });

  await test('text version lists every checklist item', () => {
    const plan = build();
    const text = P.renderText(plan);
    const count = plan.sections.reduce((n, s) => n + s.items.length, 0);
    assert.strictEqual((text.match(/^\[ \] /gm) || []).length, count);
  });

  /* ---- function tests, with fetch mocked ---- */
  const post = (body) => handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  const realFetch = global.fetch;

  await test('function: rejects GET, bad JSON, missing email', async () => {
    assert.strictEqual((await handler({ httpMethod: 'GET' })).statusCode, 405);
    assert.strictEqual((await handler({ httpMethod: 'POST', body: '{nope' })).statusCode, 400);
    assert.strictEqual((await post(base)).statusCode, 400);
  });

  await test('function: 503 when email is not configured', async () => {
    delete process.env.RESEND_API_KEY; delete process.env.FROM_EMAIL;
    const r = await post(Object.assign({ email: 'a@b.co' }, base));
    assert.strictEqual(r.statusCode, 503);
    assert.strictEqual(JSON.parse(r.body).error, 'email_not_configured');
  });

  await test('function: honeypot gets a fake success and sends nothing', async () => {
    process.env.RESEND_API_KEY = 'k'; process.env.FROM_EMAIL = 'Plan <p@example.com>';
    let called = false;
    global.fetch = async () => { called = true; return { ok: true }; };
    const r = await post(Object.assign({ email: 'a@b.co', website: 'spam' }, base));
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(called, false);
  });

  await test('function: sends a server-built plan to the given address only', async () => {
    let sent;
    global.fetch = async (url, opts) => { sent = { url, opts, body: JSON.parse(opts.body) }; return { ok: true }; };
    const r = await post(Object.assign({ email: 'a@b.co', firstName: 'Ada', html: '<b>injected</b>' }, base));
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(sent.url, 'https://api.resend.com/emails');
    assert.strictEqual(sent.opts.headers.Authorization, 'Bearer k');
    assert.deepStrictEqual(sent.body.to, ['a@b.co']);
    assert.strictEqual(sent.body.subject, "Ada's 90 Days Ready plan");
    assert.ok(!/injected/.test(sent.body.html));
    assert.ok(/56 gal/.test(sent.body.html));
  });

  await test('function: 502 when the email provider fails', async () => {
    global.fetch = async () => ({ ok: false });
    assert.strictEqual((await post(Object.assign({ email: 'a@b.co' }, base))).statusCode, 502);
    global.fetch = async () => { throw new Error('down'); };
    assert.strictEqual((await post(Object.assign({ email: 'a@b.co' }, base))).statusCode, 502);
  });

  global.fetch = realFetch;
  console.log('\n' + passed + ' passed' + (process.exitCode ? ', with failures' : ''));
})();
