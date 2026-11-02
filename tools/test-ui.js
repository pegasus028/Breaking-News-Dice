// Browser flow test in Demo mode: teacher board + one real student + pretend class.
// Students play individually at their own speed; filing is allowed only when every rule is met.
// Usage: (serve the folder on :8765) NODE_PATH=$(npm root -g) node tools/test-ui.js <outdir>
const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp/bnd-shots';
const BASE = 'http://127.0.0.1:8765/';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  let browser;
  const glob = d => { try { return require('fs').readdirSync(d); } catch (e) { return []; } };
  const exe = process.env.CHROME || glob('/opt/pw-browsers').filter(d => /^chromium-\d+$/.test(d)).sort().reverse()
    .map(d => ['chrome-linux64', 'chrome-linux'].map(x => '/opt/pw-browsers/' + d + '/' + x + '/chrome')).flat()
    .find(f => require('fs').existsSync(f));
  try { browser = await chromium.launch(exe ? { executablePath: exe } : {}); }
  catch (e) { browser = await chromium.launch(); }
  const ctx = await browser.newContext();
  const errors = [];
  const watch = (p, name) => {
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts|qrcode|cdnjs|ERR_/.test(m.text()) && !/favicon/.test((m.location() || {}).url || '')) errors.push(name + ' console: ' + m.text() + ' ' + ((m.location() || {}).url || '')); });
  };
  const T = await ctx.newPage(); watch(T, 'teacher');
  await T.setViewportSize({ width: 1280, height: 720 });
  await T.goto(BASE + 'teacher.html?demo');
  await T.evaluate(() => { localStorage.clear(); });
  await T.reload();
  await T.screenshot({ path: OUT + '/t0-setup.png' });
  await T.click('#start');
  await T.waitForSelector('.joinbox');

  // the page is never empty before the script runs (static briefing + noscript)
  const NJ = await browser.newContext({ javaScriptEnabled: false });
  const nj = await NJ.newPage();
  await nj.setViewportSize({ width: 360, height: 740 });
  await nj.goto(BASE + 'student.html?demo');
  const noJs = await nj.evaluate(() => document.querySelector('#app').innerText);
  if (!/Your mission/.test(noJs) || !/needs JavaScript/.test(noJs)) errors.push('no static briefing / noscript message without JS');
  await nj.screenshot({ path: OUT + '/s0-nojs.png', fullPage: true });
  await NJ.close();

  const S = await ctx.newPage(); watch(S, 'student');
  await S.setViewportSize({ width: 390, height: 844 });
  await S.goto(BASE + 'student.html?demo');
  await S.waitForSelector('.names button');
  await S.screenshot({ path: OUT + '/s1-pick.png' });
  const names = await S.$$eval('.names button', bs => bs.map(b => b.textContent));
  if (names.slice(-3).join(',') !== 'Guest 1,Guest 2,Guest 3') errors.push('guest seats missing or not last: ' + names.slice(-4).join(','));
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
    if (round === 1) {
      // newsroom tools: phrasebank chip, reporter mission, help-sheet phrases, pace timer, copy
      if (!/Practice mode/.test(await S.$eval('#saveNote', e => e.innerText))) errors.push('practice-mode banner missing');
      await S.click('#phrasebank summary');
      await S.click('.pb-chip:has-text("According to officials")');
      const after = await S.$eval('#post', t => t.value);
      if (!/According to officials, $/.test(after)) errors.push('phrasebank chip did not append: ' + JSON.stringify(after.slice(-40)));
      await S.fill('#post', 'According to officials, ' + good + ' They had warned residents; nevertheless, water levels have risen.');
      await S.click('#mission summary');
      await S.waitForTimeout(150);
      const mc = await S.$eval('#mcount', e => e.textContent);
      if (mc !== '4/4') errors.push('reporter mission count ' + mc + ' (expected 4/4): ' + await S.$eval('#missionList', e => e.innerText));
      await S.click('#paceBtn');
      await S.waitForTimeout(400);
      if (!/Phase 1/.test(await S.$eval('#pacePhase', e => e.innerText))) errors.push('pace timer phase 1 not shown');
      await S.screenshot({ path: OUT + '/s3-write.png', fullPage: true });
      await S.click('.die[data-w]');
      await S.waitForSelector('.sheet');
      if (!await S.$('.sheet ul.np li')) errors.push('news phrases missing from help sheet');
      await S.screenshot({ path: OUT + '/s3b-help.png' });
      await S.click('.sheet button');
      if (await S.$eval('#copyBtn', b => b.classList.contains('hidden'))) errors.push('copy button hidden while drafting');
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
      await S.click('#copyBtn');
      await S.waitForSelector('#toast.show');
      if (!/Copied/.test(await S.$eval('#toast', e => e.textContent))) errors.push('copy toast wrong');
      const clip = await S.evaluate(() => navigator.clipboard.readText()).catch(() => '');
      if (clip && !/BREAKING \(Round 1/.test(clip)) errors.push('copied text wrong: ' + clip.slice(0, 60));
      for (const w of [360, 390, 420]) {
        await S.setViewportSize({ width: w, height: 844 });
        if (await S.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) errors.push('write screen scrolls sideways at ' + w + 'px');
      }
      await S.setViewportSize({ width: 390, height: 844 });
      await S.fill('#post', good);
    }
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
