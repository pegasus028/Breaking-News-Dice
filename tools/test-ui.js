// Browser flow test in Demo mode: teacher board + one real student + simulated class.
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
  await T.click('#start');
  await T.waitForSelector('.joinbox');

  const S = await ctx.newPage(); watch(S, 'student');
  await S.setViewportSize({ width: 390, height: 844 });
  await S.goto(BASE + 'student.html?demo');
  await S.waitForSelector('.teams button');
  await S.screenshot({ path: OUT + '/s2-teams.png' });
  await S.click('.teams button[data-team="12"]');
  await S.screenshot({ path: OUT + '/s1-pick.png' });
  await S.click('#enter');
  await S.waitForSelector('text=Waiting for your partner');

  // turn on Simulate class
  await T.click('button[data-a="drawer"]');
  await T.check('#simBox');
  await T.click('button[data-x="close"]');
  await T.waitForFunction(() => document.querySelectorAll('.teamcard:not(.half)').length >= 11, null, { timeout: 40000 });
  await T.screenshot({ path: OUT + '/t1-lobby.png' });
  await S.waitForSelector('text=Your partner has joined');
  await S.screenshot({ path: OUT + '/s2-desk.png' });

  for (let round = 1; round <= 3; round++) {
    await T.click('button[data-a="go"]');            // start round
    await S.waitForSelector('#roll, #post', { timeout: 15000 });
    if (await S.$('#roll')) {
      if (round === 1) await S.screenshot({ path: OUT + '/s3-roll.png' });
      await S.click('#roll');
    }
    await S.waitForSelector('#post', { timeout: 15000 });
    const words = await S.$$eval('.die[data-w]', ds => ds.map(d => d.getAttribute('data-w')));
    const text = await T.evaluate(w => bndBotPost(w).replace('.', ' after the water was subsided.'), words);
    await S.fill('#post', text);
    await S.waitForTimeout(300);
    if (round === 1) await S.screenshot({ path: OUT + '/s4-write.png', fullPage: true });
    const trap = await S.$('.checks li.trap');
    if (round === 1 && !trap) errors.push('subside trap not shown');
    await S.click('#file');
    await S.waitForSelector('#file:has-text("Filed")');
    await T.waitForTimeout(6000);                       // let the pretend class write
    if (round === 1) await T.screenshot({ path: OUT + '/t3-write.png' });
    await T.click('button[data-a="go"]');            // fact-check
    await S.waitForTimeout(800); await S.waitForSelector('#send, .st-phase:has-text("Fact-check")', { timeout: 15000 });
    if (await S.$('#send')) {
      await S.click('.seg[data-i="0"] button[data-v="1"]');
      await S.click('.seg[data-i="1"] button[data-v="0"]');
      await S.click('#stars button[data-s="3"]');
      if (round === 1) await S.screenshot({ path: OUT + '/s5-check.png', fullPage: true });
      await S.click('#send');
      await S.waitForSelector('text=Fact-check sent');
    }
    await T.waitForTimeout(5000);
    if (round === 1) await T.screenshot({ path: OUT + '/t4-verify.png' });
    await T.click('button[data-a="go"]');            // results
    await T.waitForSelector('.cands, .frontpage', { timeout: 10000 });
    if (round === 1) await T.screenshot({ path: OUT + '/t5-reveal.png' });
    await T.click('.cand button[data-front]');
    await T.waitForSelector('.frontpage');
    if (round === 1) await T.screenshot({ path: OUT + '/t6-front.png' });
    await S.waitForSelector('.breakdown', { timeout: 10000 });
    if (round === 1) await S.screenshot({ path: OUT + '/s6-results.png', fullPage: true });
  }
  await T.click('button[data-a="go"]');              // finish
  await T.waitForSelector('text=win');
  await T.waitForTimeout(1500);
  await T.screenshot({ path: OUT + '/t7-final.png' });
  await S.waitForSelector('.bigrank', { timeout: 10000 });
  await S.screenshot({ path: OUT + '/s7-final.png', fullPage: true });
  // drawer view
  await T.click('button[data-a="drawer"]');
  await T.screenshot({ path: OUT + '/t8-drawer.png' });
  // phone overflow check on every student screen we visited is covered by final; check now
  const over = await S.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (over) errors.push('student page scrolls sideways at 390px');
  // home + demo pages load
  const H = await ctx.newPage(); watch(H, 'home');
  await H.setViewportSize({ width: 390, height: 844 });
  await H.goto(BASE + 'index.html'); await H.screenshot({ path: OUT + '/h1-home.png' });
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO PAGE ERRORS');
  await browser.close();
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
