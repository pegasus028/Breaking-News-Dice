/* Breaking News Dice — student console.
   Each student signs in with her name from the roster and plays at her own speed:
   roll → write (file only when every rule is met) → fact-check one post → next round. */
(function () {
  var app = document.getElementById('app');
  var topDesk = document.getElementById('topDesk');
  /* Polling (2 Nov 2026): the server replies to every action with the full view, so a poll is only for
     changes made by others (the game ending, a release, points from fact-checks). 23 students at 3 s with a draft
     sent every 8 s overloaded Apps Script's single lock in class; now 10 s (± 2 s jitter) with a draft at most
     every 30 s, no polls while the tab is hidden, and the gap doubles (to 60 s) while the server is unreachable. */
  var POLL_MS = BND_LIVE ? 10000 : 1200;
  var DRAFT_MS = BND_LIVE ? 30000 : 4000;
  var pollDelay = POLL_MS, pollTimer = null;
  var SID_KEY = BND_LIVE ? 'bnd-sid' : 'bnd-demo-sid';
  var sid = bndStore(SID_KEY);
  var st = null;              // last state from the server
  var screen = '';            // current screen key; re-render only when it changes
  var draft = { text: '', dirty: false, sentAt: 0, key: '' };
  var verdict = { ok: [null, null], stars: 0 };
  var rolling = false, busy = false, lastError = '';
  var autoJoined = {};
  var actionAt = 0;           // a poll that started before the latest action is stale: ignore it

  function demoMarkReal() {
    if (BND_LIVE || !sid) return;
    var list = JSON.parse(bndStore('bnd-demo-real') || '[]');
    if (list.indexOf(sid) < 0) { list.push(sid); bndStore('bnd-demo-real', JSON.stringify(list)); }
  }

  /* ---------------- polling ---------------- */
  function schedule(ms) {
    clearTimeout(pollTimer);
    var jitter = BND_LIVE ? (Math.random() - 0.5) * 0.4 * ms : 0;
    pollTimer = setTimeout(poll, Math.max(500, ms + jitter));
  }
  function poll() {
    if (!sid) { schedule(pollDelay); return; }
    if (poll.busy) return;
    if (document.hidden && st) { schedule(pollDelay); return; }   // a hidden tab waits; visibilitychange polls at once
    var req = { action: 'state', sid: sid };
    if (draft.dirty && st && st.stage === 'write' && Date.now() - draft.sentAt > DRAFT_MS) {
      req.draft = draft.text; draft.sentAt = Date.now(); draft.dirty = false;
    }
    poll.busy = true;
    var sentAt = Date.now();
    bndApi(req).then(function (v) {
      poll.busy = false;
      if (v && v.busy) throw new Error('busy');   // the server is saturated: back off like a network failure, keep the screen
      if (req.draft !== undefined && !(v && v.ok)) draft.dirty = true;
      pollDelay = POLL_MS;
      if (sentAt >= actionAt) apply(v);
      schedule(pollDelay);
    }).catch(function () {
      poll.busy = false; document.body.classList.add('offline');
      if (req.draft !== undefined) draft.dirty = true;          // send that draft again next time
      pollDelay = Math.min(60000, pollDelay * 2);
      schedule(pollDelay);
    });
  }

  function apply(v) {
    document.body.classList.remove('offline');
    if (v && v.ok) pollDelay = POLL_MS;
    if (!poll.busy) schedule(pollDelay);
    if (!v.ok && !v.session) { lastError = v.error || 'Something went wrong.'; render(true); return; }
    st = v;
    // a new game started after she picked her name: join it automatically, once
    if (v.session && !v.joined && v.session.phase === 'open' && sid && !autoJoined[v.session.id]) { autoJoined[v.session.id] = 1; join(sid); }
    render(false);
  }

  /* ---------------- rendering ---------------- */
  function screenKey() {
    if (!sid) return 'pick';
    if (!st) return 'loading';
    var s = st.session;
    if (!s) return 'nosession';
    if (!st.joined) return s.phase === 'final' ? 'over' : 'rejoin';
    if (s.phase === 'final') return 'final-' + st.me.total + '-' + st.me.rank;
    if (st.stage === 'done') return 'done-' + st.me.total + '-' + st.me.rank;
    if (st.stage === 'write') return (st.words ? 'write-' : 'roll-') + st.round;
    if (st.stage === 'check') return 'check-' + st.round + '-' + (st.task ? st.task.key : '');
    return 'loading';
  }

  function render(force) {
    renderTop();
    var key = screenKey();
    if (key !== screen || force) {
      if (key !== screen) stopPace();
      screen = key;
      var fn = { pick: pickScreen, loading: loadingScreen, nosession: waitScreen, rejoin: rejoinScreen, over: overScreen,
        roll: rollScreen, write: writeScreen, check: checkScreen, done: doneScreen, final: finalScreen }[key.split('-')[0]];
      app.innerHTML = '';
      fn();
      showError();
      window.scrollTo(0, 0);
    } else {
      showError();
    }
  }

  function showError() {
    if (!lastError) return;
    var old = app.querySelector('.err.top');
    if (old) old.remove();
    app.insertAdjacentHTML('afterbegin', '<div class="err top" role="alert">' + bndEsc(lastError) + '</div>');
    lastError = '';
  }

  function renderTop() {
    copyBtn.classList.toggle('hidden', !reportText());
    if (!st || !st.joined || !st.me || !st.session) { topDesk.innerHTML = ''; return; }
    var finished = st.stage === 'done' || st.session.phase === 'final';
    topDesk.innerHTML = '<div class="desk"><b>' + bndEsc(st.me.label) + '</b>' +
      (finished ? 'All rounds' : 'Round ' + st.round) + ' · #' + st.me.rank + ' of ' + st.playerCount +
      '</div><div class="score" aria-label="Your score">' + st.me.total + '</div>';
  }

  function head(title) { return '<div class="st-phase"><h1>' + title + '</h1></div>'; }

  function loadingScreen() { app.innerHTML = '<p class="lead">Connecting to the newsroom…</p>'; }

  function howTo() {
    var needPassive = !(st && st.session && st.session.requirePassive === false);
    return '<div class="card soft"><h3>How it works</h3>' +
      '<p style="margin:6px 0"><b>Your mission:</b> turn two random flood words into a professional breaking news post, written in formal news English.</p><ol class="steps">' +
      '<li><b>Roll</b> the dice to get two flood words.</li>' +
      '<li><b>Write</b> a breaking news post: both words, at least ' + BND_RULES.minWords + ' words (aim for ' + BND_RULES.minWords + '–' + BND_RULES.maxWords + ')' +
      (needPassive ? ', at least one passive (<i>were evacuated</i>)' : '') + '. You can file only when every rule is met.</li>' +
      '<li><b>Bonus points</b> for complex sentences (<i>which, although, has been, families displaced by…</i>) and richer vocabulary.</li>' +
      '<li><b>Fact-check</b> one classmate’s post, then your next round starts. Go at your own speed: more rounds, more points.</li></ol></div>';
  }

  /* ---------- sign in ---------- */
  function pickScreen() {
    app.innerHTML = head('Who are you?') + '<p class="lead">Tap your name.</p><div class="names" id="names"><p class="muted">Loading names…</p></div>';
    bndApi({ action: 'roster' }).then(function (r) {
      var box = document.getElementById('names');
      if (!box) return;
      box.innerHTML = r.roster.map(function (p) { return '<button data-sid="' + bndEsc(p.sid) + '">' + bndEsc(p.label) + '</button>'; }).join('');
      box.onclick = function (e) {
        var b = e.target.closest('button');
        if (b) join(b.getAttribute('data-sid'));
      };
    }).catch(function () { lastError = 'Cannot reach the game. Check the Wi-Fi and reload.'; render(true); });
  }

  function join(chosen) {
    (actionAt = Date.now(), bndApi({ action: 'join', sid: chosen, device: bndDevice() })).then(function (v) {
      var notStarted = !v.ok && /not started/.test(v.error || '');
      if (v.ok || notStarted) { sid = chosen; bndStore(SID_KEY, sid); demoMarkReal(); }
      if (!v.ok) { if (!notStarted) lastError = v.busy ? 'The game is busy. Tap your name again.' : v.error; render(true); if (notStarted) poll(); return; }
      apply(v);
    }).catch(function () { lastError = 'Cannot reach the game. Check the Wi-Fi and try again.'; render(true); });
  }

  function notMe() { return '<p class="small"><button class="btn" id="notme" style="min-height:40px">Not you? Change name</button></p>'; }
  function bindNotMe() {
    var b = document.getElementById('notme');
    if (b) b.onclick = function () { sid = null; bndStore(SID_KEY, null); st = null; screen = ''; render(true); };
  }

  function waitScreen() { app.innerHTML = head('Waiting for T.Chris') + '<p class="lead">The game has not started yet. This page updates by itself.</p>' + howTo() + notMe(); bindNotMe(); }
  function rejoinScreen() {
    app.innerHTML = head('Join the game') + '<p class="lead">Tap below to play as <b>' + bndEsc(st.me.label) + '</b>.</p>' +
      '<button class="btn big primary" id="rejoin">Join</button>' + notMe();
    document.getElementById('rejoin').onclick = function () { join(sid); };
    bindNotMe();
  }
  function overScreen() { app.innerHTML = head('Game over') + '<p class="lead">This game has finished. Watch the big screen for the results.</p>'; }

  /* ---------- roll ---------- */
  function dieFace(n) {
    var map = { 3: [0, 4, 8], 5: [0, 2, 4, 6, 8] };
    var on = map[n], h = '';
    for (var i = 0; i < 9; i++) h += '<i class="' + (on.indexOf(i) >= 0 ? '' : 'o') + '"></i>';
    return '<div class="pips">' + h + '</div>';
  }
  function rollScreen() {
    app.innerHTML = head('Round ' + st.round + ': roll the dice') + lastPostCard() +
      '<div class="dice"><div class="die" id="die1">' + dieFace(5) + '</div><div class="die" id="die2">' + dieFace(3) + '</div></div>' +
      '<button class="btn big primary" id="roll">Roll the dice</button>' + (st.round === 1 ? howTo() + notMe() : '');
    document.getElementById('roll').onclick = roll;
    bindNotMe();
  }
  function roll() {
    if (rolling) return;
    rolling = true;
    document.getElementById('roll').disabled = true;
    ['die1', 'die2'].forEach(function (id) { var d = document.getElementById(id); if (d) d.classList.add('rolling'); });
    var t0 = Date.now();
    (actionAt = Date.now(), bndApi({ action: 'roll', sid: sid })).then(function (v) {
      setTimeout(function () { rolling = false; apply(v); }, Math.max(0, 900 - (Date.now() - t0)));
    }).catch(function () { rolling = false; lastError = 'The roll did not reach the server. Try again.'; render(true); });
  }

  function lastPostCard() {
    var lp = st.lastPost;
    if (!lp || !lp.score) return '';
    var sc = lp.score;
    return '<div class="card soft"><b>Round ' + lp.round + ' filed: ' + sc.total + ' points so far</b>' +
      '<div class="small muted">' + (sc.checks ? 'Fact-checked ' + '★'.repeat(sc.stars) : 'Fact-check points arrive when a classmate checks it.') +
      (sc.front ? ' · <b>Front Page!</b>' : '') + '</div></div>';
  }

  /* ---------- write ---------- */
  /* The draft also lives in this browser (keyed by game, round and words), so a reload shows it at once and a
     draft typed since the last 30-s sync is never lost; the server copy is for a student who changes device. */
  function draftKey(key) { return 'bnd-draft:' + (st.session ? st.session.id : '') + ':' + key; }
  function saveLocalDraft() { if (draft.key) bndStore(draftKey(draft.key), draft.text); }
  function writeScreen() {
    var words = st.words, key = st.round + ':' + words.join(',');
    if (draft.key !== key) {
      var local = bndStore(draftKey(key));
      draft = { text: local !== null && local !== undefined ? local : (st.draft || ''), dirty: false, sentAt: 0, key: key };
      if (local && local !== (st.draft || '') && local.length >= (st.draft || '').length) draft.dirty = true;   // the server copy is behind: sync it
    }
    app.innerHTML = head('Round ' + st.round + ': write your post') +
      '<div class="dice" aria-label="Your dice words">' + words.map(function (w) {
        var x = BND_WORD_BY_ID[w];
        var len = x.word.replace(/ .*/, '').length;
        return '<button class="die' + (len > 10 ? ' len3' : len > 8 ? ' len2' : '') + '" data-w="' + w + '" aria-label="' + bndEsc(x.word) + ': show meaning">' +
          bndEsc(x.word) + '<span class="pos">' + bndEsc(x.pos) + ' · 💡 tap: meaning + news phrases</span></button>';
      }).join('') + '</div>' +
      paceHtml() +
      '<label class="post-head" for="post"><span class="tag">BREAKING</span><b>Your news post</b></label>' +
      '<textarea id="post" class="post-in" maxlength="2000" placeholder="e.g. Hundreds of families were evacuated from…" autocomplete="off" autocapitalize="sentences"></textarea>' +
      phrasebankHtml() +
      '<p class="small" style="margin:10px 0 2px"><b>To file, you need</b></p><ul class="checks" id="must" aria-live="polite"></ul>' +
      '<button class="btn big primary" id="file">File my post</button>' +
      '<p class="small" style="margin:14px 0 2px"><b>Bonus points</b></p><ul class="checks" id="bonus"></ul>' +
      missionHtml();
    app.querySelector('.dice').onclick = function (e) { var b = e.target.closest('[data-w]'); if (b) helpSheet(b.getAttribute('data-w')); };
    var ta = document.getElementById('post');
    ta.value = draft.text;
    ta.oninput = function () { draft.text = ta.value; draft.dirty = true; saveLocalDraft(); updateChecks(); };
    document.getElementById('file').onclick = file;
    bindPhrasebank(ta);
    document.getElementById('paceBtn').onclick = function () { if (pace.timer) stopPace(); else startPace(); };
    updateChecks();
  }

  /* ---------- Anchor Desk phrasebank: tap a chip to put it into the post ---------- */
  function phrasebankHtml() {
    return '<details class="tools" id="phrasebank"><summary>🎙️ Anchor Desk Phrasebank <span class="muted">(B2/C1 boosters: tap to add)</span></summary>' +
      BND_PHRASEBANK.map(function (g, gi) {
        return '<div class="pb-group"><b>' + bndEsc(g.title) + '</b>' + (g.note ? '<span class="small muted"> · ' + bndEsc(g.note) + '</span>' : '') +
          '<div class="pb-chips">' + g.chips.map(function (c, ci) {
            return '<button type="button" class="pb-chip" data-g="' + gi + '" data-c="' + ci + '">' + bndEsc(c.label || c.text.replace(/\s+$/, '') + (/[.:]\s*$/.test(c.text) ? '' : ' …')) + '</button>';
          }).join('') + '</div></div>';
      }).join('') + '</details>';
  }
  function bindPhrasebank(ta) {
    var pb = document.getElementById('phrasebank');
    pb.onclick = function (e) {
      var b = e.target.closest('.pb-chip'); if (!b) return;
      var c = BND_PHRASEBANK[Number(b.getAttribute('data-g'))].chips[Number(b.getAttribute('data-c'))];
      insertAtCursor(ta, c.text);
    };
  }
  function insertAtCursor(ta, text) {
    var v = ta.value, a = typeof ta.selectionStart === 'number' ? ta.selectionStart : v.length, z = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : a;
    if (document.activeElement !== ta && a === 0 && z === 0 && v.length) { a = z = v.length; }   // never focused: add at the end
    var before = v.slice(0, a), after = v.slice(z);
    if (before && !/\s$/.test(before)) text = ' ' + text;
    ta.value = before + text + after;
    var at = (before + text).length;
    try { ta.focus(); ta.setSelectionRange(at, at); } catch (e) { /* old browsers */ }
    draft.text = ta.value; draft.dirty = true; saveLocalDraft(); updateChecks();
  }

  /* ---------- Reporter mission: B2 news habits, detected while typing (no points) ---------- */
  function missionHtml() {
    return '<details class="tools mission" id="mission"><summary>🗞️ Reporter mission <span class="muted">(B2 challenge · no points)</span> <span class="mcount" id="mcount"></span></summary>' +
      '<p class="small muted" style="margin:6px 0">Real reporters do these four things. Each one turns green when the game spots it in your post.</p>' +
      '<ul class="checks" id="missionList"></ul></details>';
  }
  function updateMission(text) {
    var list = document.getElementById('missionList'), cnt = document.getElementById('mcount');
    if (!list) return;
    var done = 0, h = '';
    BND_MISSION.forEach(function (m) {
      var hit = text ? m.test(text) : '';
      if (hit) done++;
      h += li(!!hit, '<b>' + bndEsc(m.label) + '</b><br><span class="small ' + (hit ? '' : 'muted') + '">' +
        (hit ? 'Found: <i>' + bndEsc(hit) + '</i>' : 'e.g. <i>' + bndEsc(m.eg) + '</i>') + '</span>', '');
    });
    list.innerHTML = h;
    cnt.textContent = done + '/' + BND_MISSION.length;
    cnt.className = 'mcount' + (done === BND_MISSION.length ? ' all' : '');
  }

  /* ---------- optional 2-minute pace timer ---------- */
  var pace = { timer: null, end: 0 };
  function paceHtml() {
    return '<div class="pace"><button type="button" class="btn" id="paceBtn" aria-pressed="false">⏱️ Start 2-min pace timer</button>' +
      '<span class="small muted">Optional: no points, just a guide.</span>' +
      '<div class="pace-box hidden" id="paceBox"><div class="pace-bar"><i id="paceFill"></i></div>' +
      '<div class="pace-phase" id="pacePhase" aria-live="polite"></div></div></div>';
  }
  function startPace() {
    pace.end = Date.now() + BND_PACE.seconds * 1000;
    var btn = document.getElementById('paceBtn');
    if (btn) { btn.textContent = '■ Stop timer'; btn.setAttribute('aria-pressed', 'true'); }
    document.getElementById('paceBox').classList.remove('hidden');
    pace.phase = -1;
    tickPace();
    pace.timer = setInterval(tickPace, 250);
  }
  function stopPace() {
    if (pace.timer) clearInterval(pace.timer);
    pace.timer = null;
    var btn = document.getElementById('paceBtn');
    if (btn) { btn.textContent = '⏱️ Start 2-min pace timer'; btn.setAttribute('aria-pressed', 'false'); }
    var box = document.getElementById('paceBox');
    if (box) box.classList.add('hidden');
  }
  function tickPace() {
    var fill = document.getElementById('paceFill'), ph = document.getElementById('pacePhase');
    if (!fill || !ph) { stopPace(); return; }
    var left = Math.max(0, (pace.end - Date.now()) / 1000), secs = Math.ceil(left);
    fill.style.width = (100 * (1 - left / BND_PACE.seconds)) + '%';
    if (left <= 0) {
      clearInterval(pace.timer); pace.timer = null;
      ph.innerHTML = '<b>Time!</b> File your post as soon as the list above is complete.';
      var btn = document.getElementById('paceBtn');
      if (btn) { btn.textContent = '⏱️ Restart pace timer'; btn.setAttribute('aria-pressed', 'false'); }
      return;
    }
    var idx = 0;
    BND_PACE.phases.forEach(function (p, i) { if (secs <= p.from) idx = i; });
    var p = BND_PACE.phases[idx];
    ph.className = 'pace-phase' + (idx === 2 ? ' last' : '');
    // rewrite the banner only when the phase or the clock changes, so screen readers hear each phase once
    var clock = bndClock(secs);
    if (idx !== pace.phase) { pace.phase = idx; ph.innerHTML = '<b>' + bndEsc(p.title) + '</b> <span class="pace-clock">' + clock + '</span><br>' + bndEsc(p.text); }
    else { var c = ph.querySelector('.pace-clock'); if (c) c.textContent = clock; }
  }

  function li(state, txt, pts) {
    var cls = state === 'trap' ? 'trap' : state ? 'yes' : '';
    return '<li class="' + cls + '"><span class="ic">' + (state === 'trap' ? '!' : state ? '✓' : '') + '</span><span>' + txt + '</span>' +
      (pts ? '<span class="pts">' + pts + '</span>' : '') + '</li>';
  }

  var BONUS_NAMES = { sub: 'Subordinate clause (after, because, although…)', rel: 'Relative clause (which, who, where…)',
    adv: 'Advanced passive (has been, is being, must be, is thought to…)', part: 'Participle phrase (families displaced by…, Having…)' };

  function updateChecks() {
    var must = document.getElementById('must'), bonus = document.getElementById('bonus');
    if (!must || !st.words) return;
    var a = bndAnalyse(draft.text, st.words), R = BND_RULES, needPassive = st.session.requirePassive !== false;
    var h = '';
    st.words.forEach(function (w, i) { h += li(a.used[i], 'Use <b>' + bndEsc(bndWordName(w)) + '</b>', '+' + R.ptsWord); });
    h += li(a.inRange, a.count + ' words <span class="muted">(at least ' + R.minWords + '; aim for ' + R.minWords + '–' + R.maxWords + ')</span>', '+' + R.ptsLength);
    h += li(a.passive, (a.passive ? 'Passive: <i>' + bndEsc(a.passives[0]) + '</i>' : 'A passive (<i>be + past participle</i>)') + (needPassive ? '' : ' <span class="muted">(optional)</span>'), '+' + R.ptsPassive);
    a.traps.forEach(function (t) { h += li('trap', bndEsc(t.msg), ''); });
    must.innerHTML = h;
    var b = '';
    BND_STRUCTURES.forEach(function (sx) { b += li(a.structures.indexOf(sx.id) >= 0, BONUS_NAMES[sx.id], '+' + R.ptsStructure); });
    b += li(a.extraWords.length > 0, 'Another Unit 5 word' + (a.extraWords.length ? ': <i>' + a.extraWords.map(bndWordName).map(bndEsc).join(', ') + '</i>' : '') +
      ' <span class="muted">(+1 each, max ' + R.maxExtraWords + ')</span>', a.extraPts ? '+' + a.extraPts : '+1');
    b += li(a.richPts > 0, R.richMin + ' long words of 9+ letters' + (a.longWords.length ? ': <i>' + a.longWords.map(bndEsc).join(', ') + '</i>' : ''), '+' + R.ptsRichVocab);
    bonus.innerHTML = b;
    updateMission(draft.text);
    copyBtn.classList.toggle('hidden', !reportText());
    var miss = !a.used[0] || !a.used[1] || !a.inRange || (needPassive && !a.passive) || a.traps.length > 0;
    var btn = document.getElementById('file');
    btn.disabled = busy || miss;
    btn.textContent = miss ? 'Complete the list to file' : 'File my post (+' + a.autoPts + ')';
  }

  function file() {
    busy = true; updateChecks();
    (actionAt = Date.now(), bndApi({ action: 'save', sid: sid, text: draft.text, filed: true })).then(function (v) {
      busy = false;
      if (!v.ok) {
        lastError = v.error;
        if (v.session && v.stage && v.stage !== 'write') { apply(v); return; }   // it was filed after all (a timed-out first try)
        showError(); updateChecks(); return;
      }
      draft.dirty = false;
      if (draft.key) bndStore(draftKey(draft.key), null);
      apply(v);
    }).catch(function () { busy = false; lastError = 'Not filed: no connection. Try again.'; showError(); updateChecks(); });
  }

  function helpSheet(id) {
    var w = BND_WORD_BY_ID[id];
    var bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + bndEsc(w.word) + '"><h2>' + bndEsc(w.word) +
      '</h2><span class="pos">' + bndEsc(w.pos) + '</span><dl><dt>Meaning</dt><dd>' + bndEsc(w.def) + '</dd><dt>Thai</dt><dd lang="th">' +
      bndEsc(w.thai) + '</dd><dt>Use it like this</dt><dd>' + bndEsc(w.pattern) + '</dd>' +
      ((BND_NEWS_PHRASES[id] || []).length ? '<dt>💡 News phrases (B2/C1)</dt><dd><ul class="np">' + BND_NEWS_PHRASES[id].map(function (x) { return '<li>' + bndEsc(x) + '</li>'; }).join('') + '</ul></dd>' : '') +
      '</dl><button class="btn big">Close</button></div>';
    bg.onclick = function (e) { if (e.target === bg || e.target.tagName === 'BUTTON') bg.remove(); };
    document.body.appendChild(bg);
    bg.querySelector('button').focus();
  }

  /* ---------- fact-check ---------- */
  function checkScreen() {
    var t = st.task;
    if (!t) { app.innerHTML = head('Fact-check') + '<p class="lead">Finding a post for you to check…</p>'; return; }
    verdict = { ok: [null, null], stars: 0 };
    var used = bndAnalyse(t.text, t.words).used;
    app.innerHTML = head('Round ' + st.round + ': fact-check') +
      (t.sample ? '<p class="lead">Practice fact-check: nobody else has filed a post yet.</p>'
        : '<p class="lead">Read a classmate’s post. Be fair: it’s her score.</p>') +
      '<div class="card post-show"><span class="tag">BREAKING</span>' + bndHighlight(t.text, t.words) + '</div>' +
      t.words.map(function (w, i) {
        var x = BND_WORD_BY_ID[w];
        return '<div class="q"><b>Is <i>' + bndEsc(x.word) + '</i> used with the right meaning?</b><p class="def">' +
          (used[i] ? bndEsc(x.word) + ' = ' + bndEsc(x.def) : 'This word is missing, so it scores 0. Choose “Not quite”.') +
          '</p><div class="seg" data-i="' + i + '"><button data-v="1">✓ Yes</button><button class="no" data-v="0">✗ Not quite</button></div></div>';
      }).join('') +
      '<div class="q"><b>Would you click on this headline?</b><p class="def">1 = not really · 2 = maybe · 3 = definitely</p>' +
      '<div class="seg stars" id="stars"><button data-s="1">★</button><button data-s="2">★★</button><button data-s="3">★★★</button></div></div>' +
      '<button class="btn big primary" id="send" disabled>Send and start round ' + (st.round + 1) + '</button>';
    app.querySelectorAll('.seg[data-i]').forEach(function (seg) {
      seg.onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        verdict.ok[Number(seg.getAttribute('data-i'))] = b.getAttribute('data-v') === '1';
        seg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        ready();
      };
    });
    document.getElementById('stars').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      verdict.stars = Number(b.getAttribute('data-s'));
      this.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      ready();
    };
    document.getElementById('send').onclick = function () {
      busy = true; this.disabled = true;
      (actionAt = Date.now(), bndApi({ action: 'check', sid: sid, ok: verdict.ok, stars: verdict.stars })).then(function (v) {
        busy = false;
        if (!v.ok) { lastError = v.busy ? 'The game is busy. Tap Send again.' : v.error; if (v.session && !v.busy) { apply(v); render(true); } else { render(true); } return; }
        apply(v);
      }).catch(function () { busy = false; lastError = 'Not sent: no connection. Try again.'; render(true); });
    };
    function ready() {
      document.getElementById('send').disabled = busy || verdict.ok[0] === null || verdict.ok[1] === null || !verdict.stars;
    }
  }

  /* ---------- end ---------- */
  function doneScreen() {
    app.innerHTML = head('All rounds done!') + '<p class="lead">You are ranked</p>' + rankHtml() +
      '<p class="lead">Your score can still rise as classmates fact-check your posts. Watch the big screen.</p>' + frontHtml();
  }
  function finalScreen() { app.innerHTML = head('Final scores') + '<p class="lead">You finished</p>' + rankHtml() + frontHtml(); }
  function rankHtml() {
    return '<div class="bigrank">#' + st.me.rank + ' <span class="muted" style="font-size:24px">of ' + st.playerCount + '</span></div>' +
      '<p class="lead">with <b>' + st.me.total + '</b> points from ' + st.me.filed + ' posts and ' + st.me.checks + ' fact-checks.</p>';
  }
  function frontHtml() {
    return (st.front || []).length ? '<h3 style="margin-top:20px">Today’s Front Page</h3>' + st.front.map(function (f) {
      return '<div class="card post-show"><span class="tag">FRONT PAGE</span>' + bndHighlight(f.text, f.words) +
        '<div class="small muted">' + bndEsc(f.author) + '</div></div>';
    }).join('') : '';
  }

  /* ---------------- Copy my report ---------------- */
  function reportText() {
    if (!st || !st.joined || !st.me) return '';
    var who = st.me.label || '';
    if (st.stage === 'write' && st.words && draft.text.trim()) {
      return 'BREAKING (Round ' + st.round + ': ' + st.words.map(bndWordName).join(' + ') + ')\n' + draft.text.trim() + '\n— ' + who;
    }
    var lp = st.lastPost;
    if (lp && lp.text) return 'BREAKING (Round ' + lp.round + ': ' + (lp.words || []).map(bndWordName).join(' + ') + ')\n' + String(lp.text).trim() + '\n— ' + who;
    return '';
  }
  function copyReport() {
    var t = reportText();
    if (!t) { toast('Nothing to copy yet: write your post first.'); return; }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-1000px';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      toast(ok ? 'Copied to clipboard!' : 'Could not copy. Select your post and copy it by hand.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { toast('Copied to clipboard!'); }, fallback);
    } else fallback();
  }
  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  /* ---------------- start ---------------- */
  var copyBtn = document.getElementById('copyBtn');
  document.getElementById('saveNote').classList.remove('hidden');
  document.getElementById('saveNote').innerHTML = BND_LIVE
    ? '<b>Live game:</b> your draft saves to the class game every few seconds. T.Chris sees a post only when you file it.'
    : '<b>Practice mode:</b> your work is saved only in this browser, so T.Chris will not see it. Use <b>Copy</b> to keep your report before you close the page.';
  copyBtn.onclick = copyReport;
  demoMarkReal();
  render(true);
  poll();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { pollDelay = POLL_MS; poll(); } });
})();
