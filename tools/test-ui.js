// Browser flow test in Demo mode: teacher board + one real student + pretend class.
// Students play individually at their own speed; filing is allowed only when every rule is met.
// Usage: (serve the folder on :8765) NODE_PATH=$(npm root -g) node tools/test-ui.js <outdir>
const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp/bnd-shots';
const BASE = 'http://127.0.0.1:8765/';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  let browser;
  try { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium/chrome-linux/chrome' }); }
  catch (e) { browser = await chromium.launch(); }
  const ctx = await browser.newContext();
  const errors = [];
  const watch = (p, name) => {
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts|qrcode|cdnjs|ERR_/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
  };
  const T = await ctx.newPage(); watch(T, 'teacher');
  await T.setViewportSize({ width: 1280, height: 720 });
  await T.goto(BASE + 'teacher.html?demo');
  await T.evaluate(() => { localStorage.clear(); });
  await T.reload();
  await T.screenshot({ path: OUT + '/t0-setup.png' });
  await T.click('#start');
  await T.waitForSelector('.joinbox');

  const S = await ctx.newPage(); watch(S, 'student');
  await S.setViewportSize({ width: 390, height: 844 });
  await S.goto(BASE + 'student.html?demo');
  await S.waitForSelector('.names button');
  await S.screenshot({ path: OUT + '/s1-pick.png' });
  await S.click('.names button:has-text("Hana")');
  await S.waitForSelector('#roll');
  await S.screenshot({ path: OUT + '/s2-roll.png', fullPage: true });
  await T.screenshot({ path: OUT + '/t1-join.png' });

  await T.click('button[data-a="drawer"]');
  await T.check('#simBox');
  await T.click('button[data-x="close"]');

  for (let round = 1; round <= 3; round++) {
    await S.waitForSelector('#roll', { timeout: 15000 });
    await S.click('#roll');
    await S.waitForSelector('#post', { timeout: 15000 });
    const words = await S.$$eval('.die[data-w]', ds => ds.map(d => d.getAttribute('data-w')));
    // a weak draft first: the file button must stay locked
    await S.fill('#post', 'It ' + words[0] + '.');
    if (!await S.$eval('#file', b => b.disabled)) errors.push('file button open for a weak draft');
    const good = await T.evaluate(w => {
      const f = id => BND_WORD_BY_ID[id].forms[0];
      return 'Families displaced by the storm were moved, although ' + f(w[0]) + ' and ' + f(w[1]) + ' were reported by officials who visited Rangsit.';
    }, words);
    await S.fill('#post', good + ' The water was subsided.');
    await S.waitForTimeout(200);
    if (round === 1) {
      if (!await S.$('.checks li.trap')) errors.push('subside trap not shown');
      if (!await S.$eval('#file', b => b.disabled)) errors.push('file open despite passive error');
    }
    await S.fill('#post', good);
    await S.waitForTimeout(200);
    if (round === 1) await S.screenshot({ path: OUT + '/s3-write.png', fullPage: true });
    if (await S.$eval('#file', b => b.disabled)) { errors.push('file locked for a good post: ' + good + ' / ' + await S.$eval('#must', u => u.innerText)); break; }
    await S.click('#file');
    await S.waitForSelector('#send', { timeout: 15000 });
    await S.click('.seg[data-i="0"] button[data-v="1"]');
    await S.click('.seg[data-i="1"] button[data-v="0"]');
    await S.click('#stars button[data-s="3"]');
    if (round === 1) await S.screenshot({ path: OUT + '/s4-check.png', fullPage: true });
    await S.click('#send');
  }
  await S.waitForSelector('#roll', { timeout: 15000 });
  await S.screenshot({ path: OUT + '/s5-round4.png', fullPage: true });
  await T.waitForTimeout(12000);
  await T.screenshot({ path: OUT + '/t2-live.png' });
  const fp = await T.$('.cand button[data-front]');
  if (fp) { await fp.click(); await T.waitForSelector('.cand.front', { timeout: 10000 }); }
  await T.waitForTimeout(1500);
  await T.screenshot({ path: OUT + '/t3-front.png' });
  await T.click('button[data-a="finish"]');
  await T.click('button[data-a="finish"]');
  await T.waitForSelector('text=Game over', { timeout: 15000 });
  await T.waitForTimeout(1500);
  await T.screenshot({ path: OUT + '/t4-final.png' });
  await S.waitForSelector('text=Final scores', { timeout: 15000 });
  await S.screenshot({ path: OUT + '/s6-final.png', fullPage: true });
  await T.click('button[data-a="drawer"]');
  await T.screenshot({ path: OUT + '/t5-drawer.png' });
  if (await S.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) errors.push('student page scrolls sideways at 390px');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO PAGE ERRORS');
  await browser.close();
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
