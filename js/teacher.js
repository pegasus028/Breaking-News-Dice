/* Breaking News Dice — teacher board (made for the projector).
   Students play individually at their own speed; the board shows a live leaderboard,
   the best fact-checked posts (tap Front Page for +5) and the controls. */
(function () {
  var POLL_MS = BND_LIVE ? 5000 : 1000;   // every teacher action already returns the board state
  var pin = '';
  try { pin = sessionStorage.getItem('bnd-pin') || ''; } catch (e) { /* storage blocked */ }
  var t = null;                 // last teacher state
  var stageSig = '', ctrlSig = '', drawerOpen = false;
  var sim = !BND_LIVE && bndStore('bnd-demo-sim') === '1';
  var prevTotals = {}, deltas = {};
  var setupMode = false;        // New game chosen: show the setup screen until the game is opened

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
      if (!out.ok && out.busy) { if (req.action !== 'tstate') flash('The game is busy. Try that again.'); return out; }
      if (!out.ok) { flash(out.error); return out; }
      if (out.session !== undefined) { t = out; render(); }
      return out;
    }).catch(function () { document.body.classList.add('offline'); });
  }

  function poll() {
    if (sim && t && t.session && t.session.phase === 'open') bndBotsTick(JSON.parse(bndStore('bnd-demo-real') || '[]'));
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
    $('gate').classList.remove('hidden');
    $('pinMsg').textContent = wrong && pin ? 'That PIN did not work. Try again.' : '';
    $('pin').focus();
  }
  $('gateForm').onsubmit = function (e) {
    e.preventDefault();
    pin = $('pin').value.trim();
    try { sessionStorage.setItem('bnd-pin', pin); } catch (err) { /* ignore */ }
    $('gate').classList.add('hidden');
    poll();
  };

  /* ---------------- top bar ---------------- */
  function renderTop() {
    var s = setupMode ? null : t && t.session;
    var c = t && t.counts;
    $('round').innerHTML = s ? (s.phase === 'final' ? 'Game over' : 'Live game') +
      '<span class="ph">' + (s.phase === 'final' ? 'Final scores' : c ? c.players + ' playing · ' + c.filed + ' posts filed' : '') + '</span>' : 'No game yet';
    $('timer').textContent = '';
    var b = [];
    if (s && s.phase === 'open') b.push(['finish', 'End game', 'alert']);
    if (s && s.phase === 'final') b.push(['podium', '🏆 Podium', 'primary'], ['export', 'Download results', 'primary'], ['new', 'New game', '']);
    b.push(['arena', '🏆 Arena view', '']);
    b.push(['drawer', 'Players & posts', ''], ['clean', document.body.classList.contains('clean') ? 'Show controls' : 'Hide controls', '']);
    var sig = JSON.stringify(b);
    if (sig === ctrlSig) return;
    ctrlSig = sig;
    $('ctrl').innerHTML = b.map(function (x) {
      return '<button class="btn ' + x[2] + '" data-a="' + x[0] + '"' + (x[0] === 'clean' ? ' id="btnClean"' : '') + '>' + x[1] + '</button>';
    }).join('');
  }

  $('ctrl').onclick = function (e) {
    var b = e.target.closest('button[data-a]');
    if (!b) return;
    var a = b.getAttribute('data-a');
    if (a === 'drawer') { drawerOpen = !drawerOpen; renderDrawer(); return; }
    if (a === 'clean') { document.body.classList.toggle('clean'); ctrlSig = ''; renderTop(); return; }
    if (a === 'new') { if (armed(b)) { setupMode = true; stageSig = ''; ctrlSig = ''; render(); } return; }
    if (a === 'export') { exportCsv(); return; }
    if (a === 'arena') { bndArena.toggle(true); return; }
    if (a === 'podium') { bndArena.showPodium(); return; }
    if (a === 'finish') { if (armed(b)) call({ action: 'finish' }).then(function () { ctrlSig = ''; renderTop(); }); }
  };

  /* ---------------- stage ---------------- */
  function render() {
    renderTop();
    renderStage();
    if (drawerOpen) renderDrawer();
    bndArena.update(setupMode ? null : t);
  }

  function studentUrl() {
    var u = location.href.split('#')[0].split('?')[0];
    return u.replace(/teacher\.html$/, '').replace(/\/$/, '') + '/student.html';
  }

  function renderStage() {
    var st = $('stage');
    var s = t && !setupMode && t.session;
    if (!s) { if (stageSig !== 'setup') { stageSig = 'setup'; st.innerHTML = setupHtml(); bindSetup(); } return; }
    if (s.phase === 'open' && !t.posts.length && t.players.length < Math.max(3, Math.ceil(t.roster.length / 2))) {
      // check-in screen until half the class is in or the first post is filed
      var sig = 'join' + JSON.stringify(t.players.map(function (p) { return p.sid; }));
      if (sig === stageSig) return;
      stageSig = sig;
      var joined = {};
      t.players.forEach(function (p) { joined[p.sid] = 1; });
      st.innerHTML = '<div class="joinbox"><div class="qr" id="qr"></div><div><h1 class="tc-title">Tap your name to play</h1>' +
        '<p>Open the link, tap <b>your name</b> and start rolling. Everyone plays at her own speed: more rounds, more points.</p>' +
        '<p class="url">' + bndEsc(studentUrl()) + '</p>' +
        '<p class="tc-status"><span><span class="num">' + t.players.length + '</span>/' + t.roster.length + ' playing</span></p></div></div>' +
        '<div class="namechips">' + t.roster.map(function (r) { return '<span class="' + (joined[r.sid] ? '' : 'wait') + '">' + bndEsc(r.label) + '</span>'; }).join('') + '</div>';
      drawQr();
      return;
    }
    var c = t.counts;
    var status = s.phase === 'final' ? '' :
      '<span><span class="num">' + c.players + '</span> playing</span><span><span class="num">' + c.filed + '</span> posts</span>' +
      '<span><span class="num">' + c.checks + '</span> fact-checks</span>' +
      '<span class="small muted" style="font-weight:400">Join: ' + bndEsc(studentUrl()) + '</span>';
    var panel = s.phase === 'final' ? finalHtml() : candidatesHtml();
    var sigTop = s.phase + status + panel;
    if (stageSig.indexOf('board|') !== 0 || stageSig.slice(6) !== sigTop) {
      var lb = stageSig.indexOf('board|') === 0 ? $('lb') : null;
      st.innerHTML = '<div class="tc-status">' + status + '</div><div id="panel">' + panel + '</div>';
      if (lb) st.appendChild(lb); else st.insertAdjacentHTML('beforeend', '<div class="lb" id="lb"></div>');
      stageSig = 'board|' + sigTop;
      var cl = st.querySelector('.cands');
      if (cl) cl.onclick = function (e) {
        var b = e.target.closest('button[data-front]');
        if (b) call({ action: 'front', key: b.getAttribute('data-front') });
      };
    }
    renderBoard();
  }

  /* The leaderboard: one row per student, water level = score, sorted by rank. */
  function renderBoard() {
    var lb = $('lb');
    if (!lb || !t || !t.players) return;
    var players = t.players.slice().sort(function (a, b) { return (a.rank - b.rank) || a.label.localeCompare(b.label); });
    var top = Math.max(10, players.length ? players[0].total : 0);
    var perCol = Math.max(1, Math.ceil(players.length / 2));
    lb.style.gridTemplateRows = 'repeat(' + perCol + ', minmax(0, 1fr))';
    var final = t.session.phase === 'final';
    players.forEach(function (p, i) {
      if (prevTotals[p.sid] !== undefined && p.total > prevTotals[p.sid]) deltas[p.sid] = { v: p.total - prevTotals[p.sid], at: Date.now() };
      prevTotals[p.sid] = p.total;
      var row = lb.querySelector('[data-sid="' + p.sid + '"]');
      if (!row) {
        row = document.createElement('div');
        row.className = 'lbrow';
        row.setAttribute('data-sid', p.sid);
        row.innerHTML = '<span class="rk"></span><span class="nm"></span><span class="track"><span class="water"></span></span><span class="tot"></span><span class="meta"></span>';
        lb.appendChild(row);
      }
      row.style.order = i;
      row.style.gridColumn = i < perCol ? '1' : '2';
      row.style.gridRow = String((i % perCol) + 1);
      row.classList.toggle('leader', p.rank === 1 && p.total > 0);
      row.querySelector('.rk').textContent = '#' + p.rank;
      row.querySelector('.nm').textContent = p.label;
      row.querySelector('.water').style.width = Math.round(p.total / top * 100) + '%';
      var dl = deltas[p.sid];
      row.querySelector('.tot').innerHTML = p.total + (dl && Date.now() - dl.at < 4000 ? ' <small>+' + dl.v + '</small>' : '');
      row.querySelector('.meta').textContent = final ? p.filed + ' posts' : (p.stage === 'done' ? 'done' : 'R' + p.round + (p.stage === 'check' ? ' ✓' : ''));
    });
    lb.querySelectorAll('.lbrow').forEach(function (row) {
      if (!players.some(function (p) { return p.sid === row.getAttribute('data-sid'); })) row.remove();
    });
  }

  /* Latest Front Page plus the best fact-checked posts not yet picked. */
  function candidatesHtml() {
    var front = t.front[t.front.length - 1];
    var posts = t.posts.filter(function (p) { return !p.score.spiked && !p.score.front && p.score.checks > 0; });
    posts.sort(function (a, b) { return (b.score.stars - a.score.stars) || (b.score.total - a.score.total) || (b.at - a.at); });
    var cards = [];
    if (front) cards.push('<div class="cand front"><div class="post-show"><span class="tag">FRONT PAGE</span> ' + bndHighlight(front.text, front.words) +
      '</div><div class="meta"><b>' + bndEsc(front.author) + '</b><button class="btn" data-front="' + bndEsc(front.key) + '" style="margin-left:auto">Undo</button></div></div>');
    posts.slice(0, front ? 1 : 2).forEach(function (p) {
      cards.push('<div class="cand"><div class="post-show"><span class="tag">BREAKING</span> ' + bndHighlight(p.text, p.words) + '</div>' +
        '<div class="meta"><b>' + bndEsc(p.author) + '</b><span>' + '★'.repeat(p.score.stars || 0) + ' · ' + p.score.total + ' pts</span>' +
        '<button class="btn" data-front="' + bndEsc(p.key) + '" style="margin-left:auto">Front Page</button></div></div>');
    });
    if (!cards.length) return '<p class="tc-status" style="font-weight:400;font-size:20px">The best fact-checked posts appear here. Tap <b>Front Page</b> to give one +' + BND_RULES.ptsFront + '.</p>';
    return '<div class="cands two">' + cards.join('') + '</div>';
  }

  function finalHtml() {
    var win = t.players.filter(function (p) { return p.rank === 1; });
    return '<h1 class="tc-title">' + (win.length ? win.map(function (p) { return bndEsc(p.label); }).join(' and ') + ' win' + (win.length > 1 ? '' : 's') + '!' : 'Game over') + '</h1>' +
      (win.length ? '<p class="tc-status" style="font-weight:400">' + win[0].total + ' points</p>' : '');
  }

  /* ---------------- setup (no game yet) ---------------- */
  function setupHtml() {
    return '<div class="setup"><h1 class="tc-title">Breaking News Dice</h1>' +
      '<p>Each student taps her name and plays at her own speed: roll two Unit 5 flood words, write a breaking news post (at least 15 words, aim for 15–25) ' +
      'that meets every rule, fact-check a classmate’s post, next round. Bonus points for complex sentences and richer vocabulary.</p>' +
      '<div class="row"><label>Most rounds per student<select id="sRounds"><option value="10">10</option><option value="15">15</option><option value="20" selected>20</option></select></label>' +
      '<label class="tick"><input type="checkbox" id="sPassive" checked> A passive is required to file</label></div>' +
      '<button class="btn big primary" id="start" style="max-width:420px">Open the game</button>' +
      (BND_LIVE ? '' : '<p class="small muted" style="margin-top:18px">Demo mode: the game lives in this browser. Turn on <b>Simulate class</b> in Players &amp; posts to fill it with pretend students, and open the student page in another tab to play one of them.</p>') +
      '</div>';
  }
  function bindSetup() {
    $('start').onclick = function () {
      setupMode = false;
      prevTotals = {}; deltas = {};
      if (!BND_LIVE) bndStore('bnd-demo-real', null);
      call({ action: 'newSession', settings: { maxRounds: Number($('sRounds').value), requirePassive: $('sPassive').checked } });
    };
  }

  function drawQr() {
    var box = $('qr');
    if (!box) return;
    if (window.QRCode) { try { new QRCode(box, { text: studentUrl(), width: 228, height: 228, correctLevel: QRCode.CorrectLevel.M }); return; } catch (e) { /* fall through */ } }
    box.innerHTML = '<p class="small muted">QR code unavailable. Use the link.</p>';
  }

  /* ---------------- drawer: players, posts, settings ---------------- */
  function renderDrawer() {
    var dr = $('drawer');
    if (!drawerOpen) { dr.classList.add('hidden'); return; }
    dr.classList.remove('hidden');
    if (!t || !t.session || setupMode) { dr.innerHTML = '<button class="btn close" data-x="close">Close</button><h2>No game yet</h2>' + demoHtml(); bindDrawer(); return; }
    var s = t.session;
    var players = t.players.slice().sort(function (a, b) { return a.label.localeCompare(b.label); });
    var h = '<button class="btn close" data-x="close">Close</button><h2>Players (' + players.length + ')</h2>' +
      '<p class="small muted">A lock means she is signed in on one device. <b>Release</b> lets her sign in on another (for example after a flat battery).</p>' +
      players.map(function (p) {
        return '<div class="dk"><header>' + bndEsc(p.label) + ' <span class="muted">#' + p.rank + ' · ' + p.total + ' pts · ' + p.filed + ' posts · R' + p.round + '</span>' +
          (p.locked ? '<button class="btn" data-release="' + bndEsc(p.sid) + '">🔒 Release</button>' : '') + '</header></div>';
      }).join('');
    if (t.posts.length) {
      var posts = t.posts.slice().sort(function (a, b) { return b.at - a.at; });
      h += '<h2>Posts, newest first (' + posts.length + ')</h2>' + posts.map(function (p) {
        var sc = p.score;
        return '<div class="post' + (sc.spiked ? ' spiked' : '') + '"><b>' + bndEsc(p.author) + '</b> <span class="muted">R' + p.round + ' · ' + sc.total + ' pts' +
          (sc.checks ? ' · checked' : '') + '</span><div>' + bndHighlight(p.text, p.words) + '</div>' +
          '<div class="acts"><button class="btn" data-spike="' + bndEsc(p.key) + '">' + (sc.spiked ? 'Restore' : 'Remove (0 pts)') + '</button>' +
          '<button class="btn" data-front="' + bndEsc(p.key) + '">' + (sc.front ? 'Undo Front Page' : 'Front Page') + '</button></div></div>';
      }).join('');
    }
    h += '<h2>Settings</h2><div class="setup"><div class="row">' +
      '<label>Most rounds<select id="dRounds">' + [5, 10, 15, 20].map(function (n) { return '<option' + (n === s.maxRounds ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
      '<label class="tick"><input type="checkbox" id="dPassive"' + (s.requirePassive ? ' checked' : '') + '> Passive required to file</label></div></div>' +
      '<h2>Game</h2><p><button class="btn" data-x="export">Download results (CSV)</button> <button class="btn alert" data-x="new">New game</button></p>' + demoHtml();
    var top = dr.scrollTop;
    if (dr.getAttribute('data-sig') !== h) { dr.innerHTML = h; dr.setAttribute('data-sig', h); dr.scrollTop = top; bindDrawer(); }
  }

  function demoHtml() {
    if (BND_LIVE) return '';
    return '<h2>Demo</h2><label class="tick"><input type="checkbox" id="simBox"' + (sim ? ' checked' : '') +
      '> Simulate class (pretend students join, write and fact-check)</label>' +
      '<p><button class="btn alert" data-x="reset">Reset demo</button></p>';
  }

  function bindDrawer() {
    var dr = $('drawer');
    dr.onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var x = b.getAttribute('data-x');
      if (x === 'close') { drawerOpen = false; renderDrawer(); return; }
      if (x === 'export') { exportCsv(); return; }
      if (x === 'new') { if (armed(b)) { drawerOpen = false; setupMode = true; stageSig = ''; ctrlSig = ''; render(); } return; }
      if (x === 'reset') { if (armed(b)) { bndDemoReset(); bndStore('bnd-demo-real', null); bndStore('bnd-demo-sim', null); location.reload(); } return; }
      if (b.hasAttribute('data-release')) { call({ action: 'release', sid: b.getAttribute('data-release') }); return; }
      if (b.hasAttribute('data-spike')) { call({ action: 'spike', key: b.getAttribute('data-spike') }); return; }
      if (b.hasAttribute('data-front')) { call({ action: 'front', key: b.getAttribute('data-front') }); return; }
    };
    dr.onchange = function (e) {
      if (e.target.id === 'simBox') { sim = e.target.checked; bndStore('bnd-demo-sim', sim ? '1' : '0'); return; }
      if (e.target.id === 'dRounds' || e.target.id === 'dPassive') {
        call({ action: 'settings', maxRounds: Number($('dRounds').value), requirePassive: $('dPassive').checked });
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

  /* ---------------- start ---------------- */
  bndArena.init({ call: call, armed: armed, exportCsv: exportCsv, studentUrl: studentUrl,
    onToggle: function () { ctrlSig = ''; renderTop(); } });
  if (BND_LIVE && !pin) showGate(false); else poll();
  setInterval(function () { if (!$('gate').classList.contains('hidden')) return; poll(); }, POLL_MS);
  setInterval(function () { if ($('lb') && t && t.players) renderBoard(); }, 1000);
})();
