// Browser flow test in Demo mode: teacher board + one real student + pretend class.
// Each team plays on its own: the real student's team starts when a pretend partner joins.
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
  // short timers so the test runs quickly
  await T.selectOption('#sWrite', '150'); await T.selectOption('#sVerify', '60');
  await T.click('#start');
  await T.waitForSelector('.joinbox');

  const S = await ctx.newPage(); watch(S, 'student');
  await S.setViewportSize({ width: 390, height: 844 });
  await S.goto(BASE + 'student.html?demo');
  await S.waitForSelector('.teams button');
  await S.click('.teams button[data-team="12"]');
  await S.screenshot({ path: OUT + '/s1-pick.png' });
  await S.click('#enter');
  await S.waitForSelector('text=Waiting for your partner');
  await S.screenshot({ path: OUT + '/s2-waiting.png' });
  await T.screenshot({ path: OUT + '/t1-lobby.png' });

  // pretend class joins; the first pretend player fills team 12 and our game starts
  await T.click('button[data-a="drawer"]');
  await T.check('#simBox');
  await T.click('button[data-x="close"]');
  for (let round = 1; round <= 3; round++) {
    await S.waitForSelector('#roll, #post', { timeout: 30000 });
    if (await S.$('#roll')) { if (round === 1) await S.screenshot({ path: OUT + '/s3-roll.png' }); await S.click('#roll'); }
    await S.waitForSelector('#post', { timeout: 15000 });
    const words = await S.$$eval('.die[data-w]', ds => ds.map(d => d.getAttribute('data-w')));
    const text = await T.evaluate(w => bndBotPost(w).replace('.', ' after the water was subsided.'), words);
    await S.fill('#post', text);
    await S.waitForTimeout(300);
    if (round === 1) {
      await S.screenshot({ path: OUT + '/s4-write.png', fullPage: true });
      if (!await S.$('.checks li.trap')) errors.push('subside trap not shown');
    }
    await S.click('#file');
    // our team moves to fact-check when the partner files (or the timer ends)
    await S.waitForSelector('#send, text=Finding a post', { timeout: 200000 }).catch(() => {});
    await S.waitForSelector('#send', { timeout: 60000 });
    await S.click('.seg[data-i="0"] button[data-v="1"]');
    await S.click('.seg[data-i="1"] button[data-v="0"]');
    await S.click('#stars button[data-s="3"]');
    if (round === 1) await S.screenshot({ path: OUT + '/s5-check.png', fullPage: true });
    await S.click('#send');
    await S.waitForSelector('#next', { timeout: 90000 });
    if (round === 1) {
      await S.screenshot({ path: OUT + '/s6-results.png', fullPage: true });
      await T.screenshot({ path: OUT + '/t2-live.png' });
    }
    await S.click('#next');
  }
  await S.waitForSelector('text=All rounds done', { timeout: 30000 });
  await S.screenshot({ path: OUT + '/s7-done.png', fullPage: true });
  // pick a Front Page from the board if one is offered
  const fp = await T.$('.cand button[data-front]');
  if (fp) { await fp.click(); await T.waitForSelector('.cand.front', { timeout: 10000 }); }
  await T.waitForTimeout(1500);
  await T.screenshot({ path: OUT + '/t3-front.png' });
  await T.click('button[data-a="finish"]');
  await T.click('button[data-a="finish"]');
  await T.waitForSelector('text=win', { timeout: 15000 });
  await T.waitForTimeout(1500);
  await T.screenshot({ path: OUT + '/t4-final.png' });
  await S.waitForSelector('.bigrank', { timeout: 15000 });
  await S.waitForSelector('text=Final scores', { timeout: 15000 });
  await S.screenshot({ path: OUT + '/s8-final.png', fullPage: true });
  await T.click('button[data-a="drawer"]');
  await T.screenshot({ path: OUT + '/t5-drawer.png' });
  if (await S.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) errors.push('student page scrolls sideways at 390px');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO PAGE ERRORS');
  await browser.close();
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
