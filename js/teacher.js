/* Breaking News Dice — teacher console (made for the projector). */
(function () {
  var POLL_MS = BND_LIVE ? 2000 : 1000;
  var pin = sessionStorage.getItem('bnd-pin') || '';
  var t = null;                 // last teacher state
  var stageSig = '', ctrlSig = '', drawerOpen = false, selSid = null, busy = false;
  var sim = !BND_LIVE && bndStore('bnd-demo-sim') === '1';
  var prevTotals = {}, deltas = {};
  var setupMode = false;      // teacher chose New game: show the setup screen until she opens check-in

  var $ = function (id) { return document.getElementById(id); };

  /* Destructive buttons need a second click within 4 s (confirm() dialogs are blocked in some viewers). */
  function armed(btn) {
    if (btn.getAttribute('data-armed') === '1') return true;
    var old = btn.textContent;
    btn.setAttribute('data-armed', '1');
    btn.textContent = 'Click again to confirm';
    setTimeout(function () { btn.removeAttribute('data-armed'); btn.textContent = old; }, 4000);
    return false;
  }

  function call(req) {
    req.pin = pin;
    return bndApi(req).then(function (out) {
      if (!out.ok && out.error === 'pin') { showGate(true); return out; }
      if (!out.ok) { flash(out.error); return out; }
      if (out.session !== undefined) { t = out; render(); }
      return out;
    }).catch(function () { document.body.classList.add('offline'); });
  }

  function poll() {
    if (sim && t && t.session) {
      bndBotsTick();
    }
    if (poll.busy) return;
    poll.busy = true;
    call({ action: 'tstate' }).then(function () { poll.busy = false; document.body.classList.remove('offline'); }, function () { poll.busy = false; });
  }

  function flash(msg) {
    var el = $('flash');
    el.textContent = msg; el.classList.remove('hidden');
    clearTimeout(flash.tm); flash.tm = setTimeout(function () { el.classList.add('hidden'); }, 5000);
  }

  /* ---------------- PIN gate (live mode only) ---------------- */
  function showGate(wrong) {
    var g = $('gate');
    g.classList.remove('hidden');
    $('pinMsg').textContent = wrong && pin ? 'That PIN did not work. Try again.' : '';
    $('pin').focus();
  }
  $('gateForm').onsubmit = function (e) {
    e.preventDefault();
    pin = $('pin').value.trim();
    sessionStorage.setItem('bnd-pin', pin);
    $('gate').classList.add('hidden');
    poll();
  };

  /* ---------------- top bar ---------------- */
  function renderTop() {
    var s = setupMode ? null : t.session;
    var c0 = t && t.counts;
    $('round').innerHTML = s ? (s.phase === 'final' ? 'Game over' : 'Live game') +
      '<span class="ph">' + (s.phase === 'final' ? 'Final scores' : (c0 ? c0.playing + ' playing \u00b7 ' + c0.done + ' done \u00b7 ' + c0.waiting + ' waiting' : '')) + '</span>' : 'No game yet';
    var c = [];
    if (s) {
      if (s.phase === 'open') c.push(['finish', 'Finish game', 'alert']);
      if (s.phase === 'final') c.push(['export', 'Download results', 'primary'], ['new', 'New game', '']);
    }
    c.push(['drawer', 'Teams & posts', ''], ['clean', document.body.classList.contains('clean') ? 'Show controls' : 'Hide controls', '']);
    var sig = JSON.stringify(c) + busy;
    if (sig === ctrlSig) return;
    ctrlSig = sig;
    $('ctrl').innerHTML = c.map(function (b) {
      return '<button class="btn ' + b[2] + '" data-a="' + b[0] + '"' + (b[0] === 'clean' ? ' id="btnClean"' : '') + (busy && b[0] === 'go' ? ' disabled' : '') + '>' + b[1] + '</button>';
    }).join('');
  }

  $('ctrl').onclick = function (e) {
    var b = e.target.closest('button[data-a]');
    if (!b) return;
    var a = b.getAttribute('data-a');
    var s = t && t.session;
    if (a === 'drawer') { drawerOpen = !drawerOpen; renderDrawer(); return; }
    if (a === 'clean') { document.body.classList.toggle('clean'); ctrlSig = ''; renderTop(); return; }
    if (a === 'new') { if (armed(b)) { setupMode = true; stageSig = ''; ctrlSig = ''; render(); } return; }
    if (a === 'export') { exportCsv(); return; }
    if (a === 'finish') { if (armed(b)) { call({ action: 'finish' }).then(function () { ctrlSig = ''; renderTop(); }); } return; }
  };

  function tickTimer() {
    var el = $('timer');
    el.textContent = '';             // each team has its own clock now (on the student screens)
  }

  /* ---------------- stage ---------------- */
  function render() {
    renderTop();
    tickTimer();
    renderStage();
    if (drawerOpen) renderDrawer();
  }

  function studentUrl() {
    var u = location.href.split('#')[0].split('?')[0];
    return u.replace(/teacher\.html$/, '').replace(/\/$/, '') + '/student.html';
  }

  function renderStage() {
    var st = $('stage');
    var s = t && !setupMode && t.session;
    if (!s) { if (stageSig !== 'setup') { stageSig = 'setup'; st.innerHTML = setupHtml(); bindSetup(); } return; }
    var p = s.phase;
    var started = t.desks.some(function (d) { return d.round > 0; });
    if (p === 'open' && !started) {
      var sig = 'lobby' + JSON.stringify([t.players, t.desks.map(function (d) { return [d.num, d.members]; })]);
      if (sig === stageSig) return;
      stageSig = sig;
      var nPlayers = 0, full = 0;
      t.desks.forEach(function (d) { nPlayers += d.members.length; if (d.members.length >= 2) full++; });
      st.innerHTML = '<div class="joinbox"><div class="qr" id="qr"></div><div><h1 class="tc-title">Choose your team number</h1>' +
        '<p>Open the link and tap <b>your team number</b>. Partners tap the <b>same number</b>. ' +
        'The first to join is Player 1, the second is Player 2. Each team starts as soon as both partners are in.</p>' +
        '<p class="url">' + bndEsc(studentUrl()) + '</p>' +
        '<p class="tc-status"><span><span class="num">' + nPlayers + '</span> players</span>' +
        '<span><span class="num">' + full + '</span>/' + t.desks.length + ' teams complete</span></p></div></div>' +
        (t.desks.length ? '<div class="teamgrid">' + t.desks.map(function (d) {
          var two = d.members.length >= 2;
          return '<div class="teamcard' + (two ? '' : ' half') + '"><b>' + d.num + '</b><i>' + bndEsc(d.name) + '</i><span>' +
            (two ? 'Playing \u2713' : 'Waiting for partner\u2026') + '</span></div>';
        }).join('') + '</div>' : '<p class="tc-status" style="font-weight:400">Teams appear here as students join.</p>');
      drawQr();
      return;
    }
    // live game / final: status line, top posts, gauge board
    var c = t.counts;
    var status = p === 'final' ? '' :
      '<span><span class="num">' + c.playing + '</span> playing</span><span><span class="num">' + c.done + '</span> done</span>' +
      (c.waiting ? '<span><span class="num">' + c.waiting + '</span> waiting</span>' : '') +
      '<span class="small muted" style="font-weight:400">Late? ' + bndEsc(studentUrl()) + '</span>';
    var panel = p === 'final' ? finalHtml() : candidatesHtml();
    var sigTop = p + status + panel;
    if (stageSig.indexOf('board|') !== 0 || stageSig.slice(6) !== sigTop) {
      var keepBoard = stageSig.indexOf('board|') === 0 && $('board');
      var boardEl = keepBoard ? $('gaugewrap') : null;
      st.innerHTML = '<div class="tc-status" id="status">' + status + '</div><div id="panel">' + panel + '</div>';
      if (boardEl) st.appendChild(boardEl);
      else st.insertAdjacentHTML('beforeend', '<div class="gauge-wrap" id="gaugewrap"><div class="gauge-axis" id="axis"></div><div class="gauge-board" id="board"></div></div>');
      stageSig = 'board|' + sigTop;
      var cl = st.querySelector('.cands');
      if (cl) cl.onclick = function (e) {
        var b = e.target.closest('button[data-front]');
        if (b) call({ action: 'front', key: b.getAttribute('data-front') });
      };
    }
    renderBoard();
  }

  function stageLabel(d) {
    if (t.session.phase === 'final') return 'final';
    return { wait: 'waiting', write: 'R' + d.round + ' writing', check: 'R' + d.round + ' checking',
      result: 'R' + d.round + ' results', done: 'done \u2713' }[d.stage] || '';
  }

  function renderBoard() {
    var board = $('board'), axis = $('axis');
    if (!board) return;
    var desks = t.desks;
    var LABH = 126;                              // label strip under each tube (matches --labh)
    var ids = desks.map(function (d) { return d.id; }).join();
    if (board.getAttribute('data-ids') !== ids) {
      board.setAttribute('data-ids', ids);
      board.style.gridTemplateColumns = 'repeat(' + desks.length + ', minmax(0, 1fr))';
      board.innerHTML = desks.map(function (d) {
        return '<div class="gauge" data-d="' + d.id + '"><div class="tube"><div class="staff"></div><div class="water" style="height:0"></div>' +
          '<div class="tot" style="bottom:4px">0</div></div><div class="lab"></div></div>';
      }).join('');
    }
    var top = Math.max.apply(null, desks.map(function (d) { return d.total; }).concat([0]));
    var max = Math.max(20, Math.ceil(top * 1.15 / 10) * 10);
    var tube = board.querySelector('.tube');
    var tubeH = tube ? tube.clientHeight : 300;
    var usable = Math.max(60, tubeH - 66);       // headroom for the number above the water
    var step = (max > 120 || usable / (max / 10) < 16) ? 20 : 10, ax = '';
    board.style.setProperty('--seg', (usable / (max / step)) + 'px');
    for (var v = 0; v <= max; v += step) ax += '<span style="bottom:' + (LABH + 4 + v / max * usable) + 'px">' + v + '</span>';
    if (axis.innerHTML !== ax) axis.innerHTML = ax;
    desks.forEach(function (d) {
      if (prevTotals[d.id] !== undefined && d.total > prevTotals[d.id]) deltas[d.id] = { v: d.total - prevTotals[d.id], at: Date.now() };
      prevTotals[d.id] = d.total;
      var g = board.querySelector('[data-d="' + d.id + '"]');
      var hh = Math.round(d.total / max * usable);
      g.classList.toggle('leader', d.total > 0 && d.total === top);
      g.querySelector('.water').style.height = hh + 'px';
      var tot = g.querySelector('.tot');
      tot.style.bottom = (hh + 6) + 'px';
      var dl = deltas[d.id];
      var th = (dl && Date.now() - dl.at < 4000 ? '<small>+' + dl.v + '</small>' : '') + d.total;
      if (tot.innerHTML !== th) tot.innerHTML = th;
      var lab = '<span class="num">Team ' + d.num + '</span><b>' + bndEsc(d.name) + '</b>' +
        '<span class="rk">#' + d.rank + ' \u00b7 ' + stageLabel(d) + '</span>';
      var le = g.querySelector('.lab');
      if (le.innerHTML !== lab) le.innerHTML = lab;
    });
  }

  /* Latest Front Page plus the best fact-checked posts not yet picked. */
  function candidatesHtml() {
    var front = t.front[t.front.length - 1];
    var posts = t.posts.filter(function (p) { return p.filed && p.text.trim() && !p.score.spiked && !p.score.front && p.score.checks > 0; });
    posts.sort(function (a, b) { return (b.score.stars - a.score.stars) || (b.score.total - a.score.total) || (b.at - a.at); });
    var cards = [];
    if (front) cards.push('<div class="cand front"><div class="post-show"><span class="tag">FRONT PAGE</span> ' + bndHighlight(front.text, front.words) +
      '</div><div class="meta"><b>' + bndEsc(front.desk) + '</b><button class="btn" data-front="' + bndEsc(front.key) + '" style="margin-left:auto">Undo</button></div></div>');
    posts.slice(0, front ? 2 : 3).forEach(function (p) {
      cards.push('<div class="cand"><div class="post-show"><span class="tag">BREAKING</span> ' + bndHighlight(p.text, p.words) + '</div>' +
        '<div class="meta"><b>' + bndEsc(p.deskName) + '</b><span>' + '\u2605'.repeat(p.score.stars || 0) + '</span>' +
        '<button class="btn" data-front="' + bndEsc(p.key) + '" style="margin-left:auto">Front Page</button></div></div>');
    });
    if (!cards.length) return '<p class="tc-status" style="font-weight:400">The best fact-checked posts appear here. Tap <b>Front Page</b> to give one +' + BND_RULES.ptsFront + '.</p>';
    return '<div class="cands">' + cards.join('') + '</div>';
  }

  function finalHtml() {
    var sorted = t.desks.slice().sort(function (a, b) { return a.rank - b.rank; });
    var win = sorted.filter(function (d) { return d.rank === 1; });
    return '<h1 class="tc-title">' + win.map(function (d) { return 'Team ' + d.num + ' ' + bndEsc(d.name); }).join(' and ') + ' win' + (win.length > 1 ? '' : 's') + '!</h1>' +
      '<p class="tc-status" style="font-weight:400">' + win.map(function (d) {
        return d.total + ' points';
      }).join('<br>') + '</p>';
  }

  /* ---------------- setup (no game yet) ---------------- */
  function setupHtml() {
    return '<div class="setup"><h1 class="tc-title">Breaking News Dice</h1>' +
      '<p>Students tap a team number; each team starts by itself as soon as both partners are in, then plays every round at its own pace: ' +
      'roll two Unit 5 flood words, write a 15\u201325-word breaking news post, fact-check another team\u2019s post, see the round score. About 15\u201320 minutes.</p>' +
      '<div class="row"><label>Rounds<select id="sRounds"><option>2</option><option selected>3</option><option>4</option></select></label>' +
      '<label>Writing time<select id="sWrite"><option value="150">2:30</option><option value="180" selected>3:00</option><option value="240">4:00</option></select></label>' +
      '<label>Fact-check time<select id="sVerify"><option value="60">1:00</option><option value="90" selected>1:30</option><option value="120">2:00</option></select></label></div>' +
      '<button class="btn big primary" id="start" style="max-width:420px">Open the game</button>' +
      (BND_LIVE ? '' : '<p class="small muted" style="margin-top:18px">Demo mode: the game lives in this browser. Turn on <b>Simulate class</b> in Teams &amp; posts to fill it with pretend students, and open the student console in another tab to play one of them.</p>') +
      '</div>';
  }
  function bindSetup() {
    $('start').onclick = function () {
      setupMode = false;
      call({ action: 'newSession', settings: { rounds: Number($('sRounds').value), writeSecs: Number($('sWrite').value), verifySecs: Number($('sVerify').value) } });
      prevTotals = {}; deltas = {};
    };
  }

  function drawQr() {
    var box = $('qr');
    if (!box) return;
    if (window.QRCode) { try { new QRCode(box, { text: studentUrl(), width: 228, height: 228, correctLevel: QRCode.CorrectLevel.M }); return; } catch (e) { /* fall through */ } }
    box.innerHTML = '<p class="small muted">QR code unavailable. Use the link.</p>';
  }

  /* ---------------- drawer ---------------- */
  function renderDrawer() {
    var dr = $('drawer');
    if (!drawerOpen) { dr.classList.add('hidden'); return; }
    dr.classList.remove('hidden');
    if (!t || !t.session || setupMode) { dr.innerHTML = '<button class="btn close" data-x="close">Close</button><h2>No game yet</h2>' + demoHtml(); bindDrawer(); return; }
    var s = t.session;
    var unseated = t.players.filter(function (p) { return !p.desk; });
    var h = '<button class="btn close" data-x="close">Close</button><h2>Teams</h2>' +
      '<p class="small muted">Students choose their own team number; a team starts when both partners are in. To fix a mistake, tap a player, then <b>Move here</b> on another team. ' +
      'If a partner is absent, <b>Start solo</b> lets the other student play alone.</p>';
    if (selSid) h += '<p><b>Selected: ' + bndEsc(label(selSid)) + '</b> ' +
      '<button class="btn" data-x="newdesk" style="min-height:36px">Move to a new team</button> <button class="btn" data-x="unsel" style="min-height:36px">Cancel</button></p>';
    t.desks.forEach(function (d) {
      h += '<div class="dk"><header>Team ' + d.num + ' \u00b7 ' + bndEsc(d.name) + ' <span class="muted">' + d.total + ' pts \u00b7 ' + stageLabel(d) + '</span>' +
        (selSid ? '<button class="btn" data-move="' + d.id + '">Move here</button>' :
          (d.stage === 'wait' && d.members.length === 1 && s.phase === 'open' ? '<button class="btn" data-solo="' + d.id + '">Start solo</button>' : '')) + '</header>' +
        d.members.map(function (m) {
          return '<button class="mem' + (selSid === m.sid ? ' sel' : '') + '" data-sid="' + m.sid + '">' + bndEsc(m.label) + '</button>';
        }).join('') + '</div>';
    });
    if (unseated.length) h += '<div class="dk"><header>Not in a team yet</header>' + unseated.map(function (m) {
      return '<button class="mem' + (selSid === m.sid ? ' sel' : '') + '" data-sid="' + m.sid + '">' + bndEsc(m.label) + '</button>';
    }).join('') + '</div>';
    if (t.posts.length) {
      var posts = t.posts.slice().sort(function (a, b) { return b.at - a.at; });
      h += '<h2>Posts, newest first (' + posts.length + ')</h2>' + posts.map(function (p) {
        var sc = p.score;
        return '<div class="post' + (sc.spiked ? ' spiked' : '') + '"><b>' + bndEsc(p.author) + '</b> <span class="muted">' + bndEsc(p.deskName) +
          ' · R' + p.round + (p.filed ? '' : ' · draft') + ' · ' + sc.total + ' pts' + (sc.traps ? ' · passive error' : '') + '</span><div>' + bndHighlight(p.text, p.words) + '</div>' +
          '<div class="acts"><button class="btn" data-spike="' + bndEsc(p.key) + '">' + (sc.spiked ? 'Restore' : 'Remove (0 pts)') + '</button>' +
          (p.filed ? '<button class="btn" data-front="' + bndEsc(p.key) + '">' + (sc.front ? 'Undo Front Page' : 'Front Page') + '</button>' : '') +
          '</div></div>';
      }).join('');
    }
    h += '<h2>Timing</h2><div class="setup"><div class="row">' +
      '<label>Rounds<select id="dRounds">' + [2, 3, 4, 5].map(function (n) { return '<option' + (n === s.rounds ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
      '<label>Writing<select id="dWrite">' + [120, 150, 180, 240, 300].map(function (n) { return '<option value="' + n + '"' + (n === s.writeSecs ? ' selected' : '') + '>' + bndClock(n) + '</option>'; }).join('') + '</select></label>' +
      '<label>Fact-check<select id="dVerify">' + [60, 90, 120, 150].map(function (n) { return '<option value="' + n + '"' + (n === s.verifySecs ? ' selected' : '') + '>' + bndClock(n) + '</option>'; }).join('') + '</select></label>' +
      '</div><p class="small muted">Changes apply from each team\u2019s next round.</p></div>' +
      '<h2>Game</h2><p><button class="btn" data-x="export">Download results (CSV)</button> <button class="btn alert" data-x="new">New game</button></p>' + demoHtml();
    // keep scroll position while the drawer refreshes
    var top = dr.scrollTop, sig = h;
    if (dr.getAttribute('data-sig') !== sig) { dr.innerHTML = h; dr.setAttribute('data-sig', sig); dr.scrollTop = top; bindDrawer(); }
  }

  function demoHtml() {
    if (BND_LIVE) return '';
    return '<h2>Demo</h2><label style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="simBox"' + (sim ? ' checked' : '') +
      ' style="width:24px;height:24px"> Simulate class (pretend students join, roll, write and fact-check)</label>' +
      '<p><button class="btn alert" data-x="reset">Reset demo</button></p>';
  }

  function label(sid) {
    var p = (t.players || []).filter(function (x) { return x.sid === sid; })[0];
    return p ? p.label : 'Player';
  }

  function bindDrawer() {
    var dr = $('drawer');
    dr.onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var x = b.getAttribute('data-x');
      if (x === 'close') { drawerOpen = false; renderDrawer(); return; }
      if (x === 'unsel') { selSid = null; dr.removeAttribute('data-sig'); renderDrawer(); return; }
      if (x === 'newdesk') { call({ action: 'move', sid: selSid, desk: 'new' }); selSid = null; return; }
      if (x === 'export') { exportCsv(); return; }
      if (x === 'new') { if (armed(b)) { drawerOpen = false; setupMode = true; stageSig = ''; ctrlSig = ''; render(); } return; }
      if (x === 'reset') { if (armed(b)) { bndDemoReset(); bndStore('bnd-demo-sim', null); location.reload(); } return; }
      if (b.hasAttribute('data-sid')) { selSid = selSid === b.getAttribute('data-sid') ? null : b.getAttribute('data-sid'); dr.removeAttribute('data-sig'); renderDrawer(); return; }
      if (b.hasAttribute('data-move')) { call({ action: 'move', sid: selSid, desk: b.getAttribute('data-move') }); selSid = null; return; }
      if (b.hasAttribute('data-solo')) { call({ action: 'startSolo', desk: b.getAttribute('data-solo') }); return; }
      if (b.hasAttribute('data-spike')) { call({ action: 'spike', key: b.getAttribute('data-spike') }); return; }
      if (b.hasAttribute('data-front')) { call({ action: 'front', key: b.getAttribute('data-front') }); return; }
    };
    dr.onchange = function (e) {
      if (e.target.id === 'simBox') { sim = e.target.checked; bndStore('bnd-demo-sim', sim ? '1' : '0'); return; }
      if (/^d(Rounds|Write|Verify)$/.test(e.target.id)) {
        call({ action: 'settings', rounds: Number($('dRounds').value), writeSecs: Number($('dWrite').value), verifySecs: Number($('dVerify').value) });
      }
    };
  }

  /* ---------------- export ---------------- */
  function exportCsv() {
    call({ action: 'export' }).then(function (out) {
      if (!out || !out.ok) return;
      var csv = out.rows.map(function (r) {
        return r.map(function (c) { c = String(c === undefined ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',');
      }).join('\r\n');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      a.download = 'breaking-news-dice-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'h' || e.key === 'H') { document.body.classList.toggle('clean'); ctrlSig = ''; renderTop(); }
  });
  window.addEventListener('resize', function () { if ($('board')) renderBoard(); });

  /* ---------------- start ---------------- */
  if (BND_LIVE && !pin) showGate(false); else poll();
  setInterval(function () { if (!$('gate').classList.contains('hidden')) return; poll(); }, POLL_MS);
  setInterval(function () { tickTimer(); if ($('board') && t && t.desks) renderBoard(); }, 500);
})();
