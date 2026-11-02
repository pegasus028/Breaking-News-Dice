/* Breaking News Dice — student console. */
(function () {
  var app = document.getElementById('app');
  var topDesk = document.getElementById('topDesk');
  var POLL_MS = BND_LIVE ? 3000 : 1200;
  var SID_KEY = BND_LIVE ? 'bnd-sid' : 'bnd-demo-sid';
  var sid = bndStore(SID_KEY);
  var st = null;              // last state from the server
  var screen = '';            // current screen key; re-render only when it changes
  var draft = { text: '', dirty: false, sentAt: 0, round: 0 };
  var verdict = { ok: [null, null], stars: 0 };
  var rolling = false, busy = false, lastError = '';
  var timer = null;

  function demoMarkReal() {
    if (BND_LIVE || !sid) return;
    var list = JSON.parse(bndStore('bnd-demo-real') || '[]');
    if (list.indexOf(sid) < 0) { list.push(sid); bndStore('bnd-demo-real', JSON.stringify(list)); }
  }

  /* ---------------- polling ---------------- */
  function poll() {
    if (!sid) return;
    var req = { action: 'state', sid: sid };
    var s = st && st.session;
    var writing = s && s.phase === 'write';
    if (draft.dirty && (writing || (s && s.phase === 'verify')) && (Date.now() - draft.sentAt > 6000 || !writing)) {
      req.draft = draft.text; draft.sentAt = Date.now(); draft.dirty = false;
    }
    if (poll.busy) return;
    poll.busy = true;
    bndApi(req).then(function (v) { poll.busy = false; apply(v); }).catch(function () { poll.busy = false; setConn(false); });
  }
  function setConn(okConn) { document.body.classList.toggle('offline', !okConn); }

  function apply(v) {
    setConn(true);
    if (!v.ok) { lastError = v.error || 'Something went wrong.'; render(true); return; }
    if (v.saveError && draft.text) lastError = v.saveError;
    var prevPhase = st && st.session && st.session.phase;
    st = v;
    // a game started (or restarted) after she picked her name: join it automatically, once
    if (v.session && !v.joined && sid && !autoJoined[v.session.id]) { autoJoined[v.session.id] = 1; join(sid); }
    // writing just closed: send the latest draft straight away
    if (prevPhase === 'write' && v.session && v.session.phase !== 'write' && draft.dirty) {
      bndApi({ action: 'save', sid: sid, text: draft.text, filed: true }).catch(function () {});
      draft.dirty = false;
    }
    render(false);
  }

  /* ---------------- rendering ---------------- */
  function screenKey() {
    if (!sid) return 'pick';
    if (!st) return 'loading';
    var s = st.session;
    if (!s) return 'nosession';
    if (!st.joined) return 'rejoin';
    if (!st.desk) return 'lobby';
    if (s.phase === 'lobby' || s.phase === 'paired') return 'paired-' + st.desk.id + '-' + st.desk.members.length;
    if (s.phase === 'write') return st.desk.words ? 'write-' + s.round : 'roll-' + s.round;
    if (s.phase === 'verify') return st.task ? (st.task.done ? 'checked-' + s.round : 'check-' + s.round) : 'nocheck-' + s.round;
    if (s.phase === 'reveal') return 'reveal-' + s.round + '-' + JSON.stringify(st.myPost && st.myPost.score);
    return 'final-' + st.desk.total + '-' + st.desk.rank;
  }

  function render(force) {
    renderTop();
    var key = screenKey();
    if (key !== screen || force) {
      screen = key;
      var k = key.split('-')[0];
      var fn = { pick: pickScreen, loading: loadingScreen, nosession: waitScreen, rejoin: rejoinScreen, lobby: lobbyScreen,
        paired: pairedScreen, roll: rollScreen, write: writeScreen, check: checkScreen, checked: checkedScreen,
        nocheck: noCheckScreen, reveal: revealScreen, final: finalScreen }[k];
      app.innerHTML = '';
      fn();
      if (lastError) { app.insertAdjacentHTML('afterbegin', '<div class="err" role="alert">' + bndEsc(lastError) + '</div>'); lastError = ''; }
      window.scrollTo(0, 0);
    } else {
      if (lastError) { var e = app.querySelector('.err'); if (!e) app.insertAdjacentHTML('afterbegin', '<div class="err" role="alert">' + bndEsc(lastError) + '</div>'); lastError = ''; }
      refreshLive();
    }
  }

  function renderTop() {
    if (!st || !st.desk) { topDesk.innerHTML = sid && st && st.me ? '<span>' + bndEsc(st.me.label) + '</span>' : ''; return; }
    var d = st.desk;
    var mates = d.members.filter(function (m) { return m.sid !== sid; }).map(function (m) { return m.label; }).join(' & ');
    topDesk.innerHTML = '<div class="desk"><b>' + bndEsc(d.name) + '</b>' + bndEsc(st.me.label) + (mates ? ' with ' + bndEsc(mates) : '') +
      '</div><div class="score" aria-label="Desk score">' + d.total + '</div>';
  }

  function head(title, withTimer) {
    var s = st && st.session;
    return '<div class="st-phase"><h1>' + title + '</h1>' + (withTimer ? '<span class="st-timer" id="timer"></span>' : '') + '</div>' +
      (s && s.round ? '<p class="muted small" style="margin:0">Round ' + s.round + ' of ' + s.rounds + '</p>' : '');
  }

  function tickTimer() {
    var el = document.getElementById('timer');
    if (!el || !st || !st.session) return;
    var left = bndSecsLeft(st.session);
    el.textContent = left === null ? '' : bndClock(left);
    el.classList.toggle('low', left !== null && left <= 20);
    // time's up while writing: file whatever is there
    if (left === 0 && st.session.phase === 'write' && draft.text.trim() && !(st.myPost && st.myPost.filed) && !busy) {
      file(true);
    }
  }

  function loadingScreen() { app.innerHTML = '<p class="lead">Connecting to the newsroom…</p>'; }

  function pickScreen() {
    app.innerHTML = head('Who are you?') + '<p class="lead">Tap your name to check in.</p><div class="names" id="names"><p class="muted">Loading names…</p></div>';
    bndApi({ action: 'roster' }).then(function (r) {
      var box = document.getElementById('names');
      if (!box) return;
      box.innerHTML = r.roster.map(function (p) { return '<button data-sid="' + bndEsc(p.sid) + '">' + bndEsc(p.label) + '</button>'; }).join('');
      box.onclick = function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        join(b.getAttribute('data-sid'));
      };
    }).catch(function () { lastError = 'Cannot reach the game. Check the Wi-Fi and reload.'; render(true); });
  }

  function join(chosen) {
    bndApi({ action: 'join', sid: chosen, device: bndDevice() }).then(function (v) {
      var notStarted = !v.ok && /not started/.test(v.error || '');
      if (v.ok || notStarted) { sid = chosen; bndStore(SID_KEY, sid); demoMarkReal(); }
      if (!v.ok) { if (!notStarted) lastError = v.error; else poll(); render(true); return; }
      apply(v);
    }).catch(function () { lastError = 'Cannot reach the game. Check the Wi-Fi and try again.'; render(true); });
  }
  var autoJoined = {};

  function notMe() {
    return '<p class="small"><button class="btn" id="notme" style="min-height:40px">Not you? Change name</button></p>';
  }
  function bindNotMe() {
    var b = document.getElementById('notme');
    if (b) b.onclick = function () { sid = null; bndStore(SID_KEY, null); st = null; screen = ''; render(true); };
  }

  function howTo() {
    return '<div class="card soft"><h3>How it works</h3><ol class="steps">' +
      '<li><b>Roll</b> the dice. Your desk gets two flood words.</li>' +
      '<li><b>Write</b> a breaking news post (15–25 words) that uses both words. A passive (<i>were evacuated</i>) earns a bonus.</li>' +
      '<li><b>Fact-check</b> a post from another desk: are the words used with the right meaning?</li>' +
      '<li><b>Watch the screen</b>: T.Chris picks the Front Page post each round.</li></ol>' +
      '<p class="small muted" style="margin:6px 0 0">You and your partner each write your own post. Both scores go to your desk.</p></div>';
  }

  function waitScreen() {
    app.innerHTML = head('Waiting for T.Chris') + '<p class="lead">The game has not started yet. This page updates by itself.</p>' + howTo() + notMe();
    bindNotMe();
  }

  function rejoinScreen() {
    app.innerHTML = head('Check in again') + '<p class="lead">A new game has started. Tap below to join it as <b>' + bndEsc(st.me.label) + '</b>.</p>' +
      '<button class="btn big primary" id="rejoin">Join the new game</button>' + notMe();
    document.getElementById('rejoin').onclick = function () { join(sid); };
    bindNotMe();
  }

  function lobbyScreen() {
    app.innerHTML = head('You’re checked in') + '<p class="lead">T.Chris is making the desks. Your desk and partner will appear here.</p>' + howTo() + notMe();
    bindNotMe();
  }

  function pairedScreen() {
    var d = st.desk;
    var mates = d.members.filter(function (m) { return m.sid !== sid; });
    app.innerHTML = head(bndEsc(d.name)) +
      '<p class="lead">' + (mates.length ? 'Sit with <b>' + mates.map(function (m) { return bndEsc(m.label); }).join('</b> and <b>') + '</b>. You are a news desk now.'
        : 'You are on your own for now. T.Chris may add a partner.') + '</p>' + howTo();
  }

  /* ---------- roll ---------- */
  function dieFace(n) {
    var map = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
    var on = map[n], h = '';
    for (var i = 0; i < 9; i++) h += '<i class="' + (on.indexOf(i) >= 0 ? '' : 'o') + '"></i>';
    return '<div class="pips">' + h + '</div>';
  }
  function rollScreen() {
    app.innerHTML = head('Roll the dice', true) +
      '<p class="lead">Either partner can roll. You both get the same two words.</p>' +
      '<div class="dice"><div class="die" id="die1">' + dieFace(5) + '</div><div class="die" id="die2">' + dieFace(3) + '</div></div>' +
      '<button class="btn big primary" id="roll">Roll the dice</button>';
    document.getElementById('roll').onclick = roll;
    tickTimer();
  }
  function roll() {
    if (rolling) return;
    rolling = true;
    var b = document.getElementById('roll');
    if (b) b.disabled = true;
    ['die1', 'die2'].forEach(function (id) { var d = document.getElementById(id); if (d) d.classList.add('rolling'); });
    var t0 = Date.now();
    bndApi({ action: 'roll', sid: sid }).then(function (v) {
      setTimeout(function () { rolling = false; apply(v); }, Math.max(0, 900 - (Date.now() - t0)));
    }).catch(function () { rolling = false; lastError = 'The roll did not reach the server. Try again.'; render(true); });
  }

  /* ---------- write ---------- */
  function writeScreen() {
    var s = st.session, words = st.desk.words;
    if (draft.round !== s.round) {
      draft = { text: (st.myPost && st.myPost.text) || '', dirty: false, sentAt: 0, round: s.round };
    }
    app.innerHTML = head('Write your post', true) +
      '<div class="dice" aria-label="Your dice words">' + words.map(function (w) {
        var x = BND_WORD_BY_ID[w];
        var len = x.word.replace(/ .*/, '').length;
        return '<button class="die' + (len > 10 ? ' len3' : len > 8 ? ' len2' : '') + '" data-w="' + w + '" aria-label="' + bndEsc(x.word) + ': show meaning">' + bndEsc(x.word) + '<span class="pos">' + bndEsc(x.pos) + ' · tap for help</span></button>';
      }).join('') + '</div>' +
      '<label class="post-head" for="post"><span class="tag">BREAKING</span><b>Your news post</b></label>' +
      '<textarea id="post" class="post-in" maxlength="600" placeholder="e.g. Hundreds of families were evacuated from…" autocomplete="off" autocapitalize="sentences"></textarea>' +
      '<ul class="checks" id="checks" aria-live="polite"></ul>' +
      '<button class="btn big primary" id="file">File my post</button>' +
      '<p class="small muted" id="fileNote">You can keep improving it until the time is up. Your last version counts.</p>' +
      '<div id="partner"></div>';
    app.querySelector('.dice').onclick = function (e) { var b = e.target.closest('[data-w]'); if (b) helpSheet(b.getAttribute('data-w')); };
    var ta = document.getElementById('post');
    ta.value = draft.text;
    ta.oninput = function () { draft.text = ta.value; draft.dirty = true; updateChecks(); updateFileBtn(); };
    document.getElementById('file').onclick = function () { file(false); };
    updateChecks(); updateFileBtn(); refreshPartner(); tickTimer();
  }

  function updateChecks() {
    var ul = document.getElementById('checks');
    if (!ul || !st.desk.words) return;
    var a = bndAnalyse(draft.text, st.desk.words), R = BND_RULES, h = '';
    st.desk.words.forEach(function (w, i) {
      h += li(a.used[i], 'Uses <b>' + bndEsc(bndWordName(w)) + '</b>', '+' + R.ptsWord);
    });
    h += li(a.inRange, a.count + ' words <span class="muted">(aim for ' + R.minWords + '–' + R.maxWords + ')</span>', '+' + R.ptsLength);
    h += li(a.passive, a.passive ? 'Passive spotted: <i>' + bndEsc(a.passives[0]) + '</i>' : 'Bonus: use a passive (<i>be + past participle</i>)', '+' + R.ptsPassive);
    a.traps.forEach(function (t) { h += '<li class="trap"><span class="ic">!</span><span>' + bndEsc(t.msg) + '</span></li>'; });
    ul.innerHTML = h;
    function li(yes, txt, pts) {
      return '<li class="' + (yes ? 'yes' : '') + '"><span class="ic">' + (yes ? '✓' : '') + '</span><span>' + txt + '</span><span class="pts">' + pts + '</span></li>';
    }
  }

  function updateFileBtn() {
    var b = document.getElementById('file');
    if (!b) return;
    var filed = st.myPost && st.myPost.filed && st.myPost.text === draft.text;
    b.textContent = filed ? 'Filed ✓' : (st.myPost && st.myPost.filed ? 'File the new version' : 'File my post');
    b.disabled = busy || !draft.text.trim() || filed;
  }

  function file(auto) {
    busy = true; updateFileBtn();
    draft.dirty = false; draft.sentAt = Date.now();
    bndApi({ action: 'save', sid: sid, text: draft.text, filed: true }).then(function (v) {
      busy = false;
      if (!v.ok) { if (!auto) lastError = v.error; render(true); return; }
      apply(v);
    }).catch(function () { busy = false; draft.dirty = true; lastError = 'Not filed: no connection. Try again.'; render(true); });
  }

  function refreshPartner() {
    var box = document.getElementById('partner');
    if (!box) return;
    var pp = (st.partnerPosts || []).filter(function (p) { return p.text && p.text.trim(); });
    box.innerHTML = pp.length ? '<h3 style="margin-top:18px">Your partner’s post</h3>' + pp.map(function (p) {
      return '<div class="partner"><b>' + bndEsc(p.label) + ':</b> ' + bndHighlight(p.text, st.desk.words) + '</div>';
    }).join('') : '';
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
    verdict = { ok: [null, null], stars: 0 };
    app.innerHTML = head('Fact-check', true) +
      '<p class="lead">Read this post from another desk. Be fair: it’s their score.</p>' +
      '<div class="card post-show"><span class="tag">BREAKING</span>' + bndHighlight(t.text, t.words) + '</div>' +
      t.words.map(function (w, i) {
        var x = BND_WORD_BY_ID[w];
        var present = bndAnalyse(t.text, t.words).used[i];
        return '<div class="q"><b>Is <i>' + bndEsc(x.word) + '</i> used with the right meaning?</b><p class="def">' +
          (present ? bndEsc(x.word) + ' = ' + bndEsc(x.def) : 'This word is missing from the post, so it scores 0. Choose “Not quite”.') +
          '</p><div class="seg" data-i="' + i + '"><button data-v="1">✓ Yes</button><button class="no" data-v="0">✗ Not quite</button></div></div>';
      }).join('') +
      '<div class="q"><b>Would you click on this headline?</b><p class="def">1 = not really · 2 = maybe · 3 = definitely</p>' +
      '<div class="seg stars" id="stars"><button data-s="1">★</button><button data-s="2">★★</button><button data-s="3">★★★</button></div></div>' +
      '<button class="btn big primary" id="send" disabled>Send my fact-check</button>';
    app.querySelectorAll('.seg[data-i]').forEach(function (seg) {
      seg.onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        verdict.ok[Number(seg.getAttribute('data-i'))] = b.getAttribute('data-v') === '1';
        seg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        sendState();
      };
    });
    document.getElementById('stars').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      verdict.stars = Number(b.getAttribute('data-s'));
      this.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      sendState();
    };
    document.getElementById('send').onclick = function () {
      busy = true; this.disabled = true;
      bndApi({ action: 'check', sid: sid, ok: verdict.ok, stars: verdict.stars }).then(function (v) {
        busy = false;
        if (!v.ok) { lastError = v.error; render(true); return; }
        apply(v);
      }).catch(function () { busy = false; lastError = 'Not sent: no connection. Try again.'; render(true); });
    };
    tickTimer();
    function sendState() {
      document.getElementById('send').disabled = busy || verdict.ok[0] === null || verdict.ok[1] === null || !verdict.stars;
    }
  }

  function checkedScreen() {
    app.innerHTML = head('Fact-check sent', true) + '<p class="lead">Thank you. That earned your desk +' + BND_RULES.ptsCheck +
      '. Results appear on the big screen soon.</p>' + myPostCard();
    tickTimer();
  }
  function noCheckScreen() {
    app.innerHTML = head('Fact-check', true) + '<p class="lead">There is no post for you to check this round. Read your partner’s post and help each other spot mistakes.</p>' + myPostCard();
    tickTimer();
  }

  function myPostCard() {
    var p = st.myPost;
    if (!p || !p.text) return '<div class="card soft"><p style="margin:0">You did not file a post this round.</p></div>';
    return '<h3 style="margin-top:18px">Your post</h3><div class="card post-show"><span class="tag">BREAKING</span>' + bndHighlight(p.text, p.words) + '</div>';
  }

  /* ---------- results ---------- */
  function revealScreen() {
    var p = st.myPost, sc = p && p.score, R = BND_RULES;
    var h = head('Round ' + st.session.round + ' results') + '<p class="lead">Look at the big screen for the Front Page.</p>' + myPostCard();
    if (sc) {
      var rows = [];
      p.words.forEach(function (w, i) { rows.push(['Used <i>' + bndEsc(bndWordName(w)) + '</i>', sc.used[i] ? R.ptsWord : 0]); });
      rows.push([sc.count + ' words' + (sc.inRange ? '' : ' (outside 15–25)'), sc.inRange ? R.ptsLength : 0]);
      rows.push(['Passive', sc.passive ? R.ptsPassive : 0]);
      rows.push(['Fact-checker: right meaning' + (sc.checks ? '' : ' (not checked: benefit of the doubt)'), sc.peerPts]);
      rows.push(['Headline stars', sc.stars]);
      if (sc.front) rows.push(['<b>Front Page!</b>', R.ptsFront]);
      h += '<table class="breakdown">' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') +
        '<tr class="total"><td>Your post</td><td>' + (sc.spiked ? '0 (removed by T.Chris)' : sc.total) + '</td></tr></table>';
    }
    h += '<p class="small muted">Desk scores are scaled so a trio and a pair compete fairly.</p>';
    app.innerHTML = h;
  }

  function finalScreen() {
    var d = st.desk;
    app.innerHTML = head('Final scores') + '<p class="lead">' + bndEsc(d.name) + ' finished</p>' +
      '<div class="bigrank">#' + d.rank + ' <span class="muted" style="font-size:24px">of ' + d.deskCount + '</span></div>' +
      '<p class="lead">with <b>' + d.total + '</b> points.</p>' +
      ((st.front || []).length ? '<h3 style="margin-top:20px">Today’s Front Page</h3>' + st.front.map(function (f) {
        return '<div class="card post-show"><span class="tag">ROUND ' + f.round + '</span>' + bndHighlight(f.text, f.words) +
          '<div class="small muted">' + bndEsc(f.desk) + '</div></div>';
      }).join('') : '');
  }

  function refreshLive() {
    tickTimer();
    if (screen.indexOf('write-') === 0) { updateFileBtn(); refreshPartner(); }
  }

  /* ---------------- start ---------------- */
  if (!BND_LIVE) document.getElementById('demoNote').classList.remove('hidden');
  demoMarkReal();
  render(true);
  poll();
  setInterval(poll, POLL_MS);
  timer = setInterval(tickTimer, 500);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
})();
