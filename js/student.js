/* Breaking News Dice — student console.
   Each student signs in with her name from the roster and plays at her own speed:
   roll → write (file only when every rule is met) → fact-check one post → next round. */
(function () {
  var app = document.getElementById('app');
  var topDesk = document.getElementById('topDesk');
  var POLL_MS = BND_LIVE ? 3000 : 1200;
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
  function poll() {
    if (!sid || poll.busy) return;
    var req = { action: 'state', sid: sid };
    if (draft.dirty && st && st.stage === 'write' && Date.now() - draft.sentAt > 8000) {
      req.draft = draft.text; draft.sentAt = Date.now(); draft.dirty = false;
    }
    poll.busy = true;
    var sentAt = Date.now();
    bndApi(req).then(function (v) { poll.busy = false; if (sentAt >= actionAt) apply(v); }).catch(function () { poll.busy = false; document.body.classList.add('offline'); });
  }

  function apply(v) {
    document.body.classList.remove('offline');
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
    return '<div class="card soft"><h3>How it works</h3><ol class="steps">' +
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
      if (!v.ok) { if (!notStarted) lastError = v.error; render(true); if (notStarted) poll(); return; }
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
  function writeScreen() {
    var words = st.words, key = st.round + ':' + words.join(',');
    if (draft.key !== key) draft = { text: st.draft || '', dirty: false, sentAt: 0, key: key };
    app.innerHTML = head('Round ' + st.round + ': write your post') +
      '<div class="dice" aria-label="Your dice words">' + words.map(function (w) {
        var x = BND_WORD_BY_ID[w];
        var len = x.word.replace(/ .*/, '').length;
        return '<button class="die' + (len > 10 ? ' len3' : len > 8 ? ' len2' : '') + '" data-w="' + w + '" aria-label="' + bndEsc(x.word) + ': show meaning">' +
          bndEsc(x.word) + '<span class="pos">' + bndEsc(x.pos) + ' · tap for help</span></button>';
      }).join('') + '</div>' +
      '<label class="post-head" for="post"><span class="tag">BREAKING</span><b>Your news post</b></label>' +
      '<textarea id="post" class="post-in" maxlength="2000" placeholder="e.g. Hundreds of families were evacuated from…" autocomplete="off" autocapitalize="sentences"></textarea>' +
      '<p class="small" style="margin:10px 0 2px"><b>To file, you need</b></p><ul class="checks" id="must" aria-live="polite"></ul>' +
      '<button class="btn big primary" id="file">File my post</button>' +
      '<p class="small" style="margin:14px 0 2px"><b>Bonus points</b></p><ul class="checks" id="bonus"></ul>';
    app.querySelector('.dice').onclick = function (e) { var b = e.target.closest('[data-w]'); if (b) helpSheet(b.getAttribute('data-w')); };
    var ta = document.getElementById('post');
    ta.value = draft.text;
    ta.oninput = function () { draft.text = ta.value; draft.dirty = true; updateChecks(); };
    document.getElementById('file').onclick = file;
    updateChecks();
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
    var miss = !a.used[0] || !a.used[1] || !a.inRange || (needPassive && !a.passive) || a.traps.length > 0;
    var btn = document.getElementById('file');
    btn.disabled = busy || miss;
    btn.textContent = miss ? 'Complete the list to file' : 'File my post (+' + a.autoPts + ')';
  }

  function file() {
    busy = true; updateChecks();
    (actionAt = Date.now(), bndApi({ action: 'save', sid: sid, text: draft.text, filed: true })).then(function (v) {
      busy = false;
      if (!v.ok) { lastError = v.error; showError(); updateChecks(); return; }
      draft.dirty = false;
      apply(v);
    }).catch(function () { busy = false; lastError = 'Not filed: no connection. Try again.'; showError(); updateChecks(); });
  }

  function helpSheet(id) {
    var w = BND_WORD_BY_ID[id];
    var bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + bndEsc(w.word) + '"><h2>' + bndEsc(w.word) +
      '</h2><span class="pos">' + bndEsc(w.pos) + '</span><dl><dt>Meaning</dt><dd>' + bndEsc(w.def) + '</dd><dt>Thai</dt><dd lang="th">' +
      bndEsc(w.thai) + '</dd><dt>Use it like this</dt><dd>' + bndEsc(w.pattern) + '</dd></dl><button class="btn big">Close</button></div>';
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
        if (!v.ok) { lastError = v.error; render(true); return; }
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

  /* ---------------- start ---------------- */
  if (!BND_LIVE) document.getElementById('demoNote').classList.remove('hidden');
  demoMarkReal();
  render(true);
  poll();
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
})();
