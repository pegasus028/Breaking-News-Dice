/* Breaking News Dice — game engine.
   Runs inside Google Apps Script (copied into apps-script/Code.gs by
   tools/build.js) and, unchanged, in the browser for Demo mode, where
   js/mock-gas.js stands in for SpreadsheetApp, LockService and CacheService.
   Needs globals from words.js, check.js and a settings file (TEACHER_PIN, SHEET_ID). */

var BND_DESK_NAMES = ['Chao Phraya Chronicle', 'Klong Courier', 'Monsoon Mail', 'Riverside Report',
  'Soi Sentinel', 'Dusit Dispatch', 'Thonburi Times', 'Bang Na Bulletin', 'Silom Standard',
  'Pratunam Post', 'Ari Herald', 'Rama IV Record', 'Lumpini Ledger', 'Rangsit Wire', 'Nonthaburi News',
  'Ayutthaya Advertiser'];
var BND_TEAM_COUNT = 15;         // team numbers 1–15 on the student screen
var BND_TEAM_MAX = 2;            // two players per team, like Conditionals Arena
var BND_GRACE_MS = 8000;          // drafts still saved this long after a writing timer ends
var BND_RESULT_SECS = 25;        // a team's round results stay up this long (or until Next round)
var BND_CACHE_KEY = 'bnd-store-v1';

/* ---------- storage: one "Store" sheet of key | json | updated ---------- */
/* SHEET_ID (in Roster.gs) points a standalone script at its Sheet; a script bound to the Sheet needs none. */
function bndSS_() {
  return (typeof SHEET_ID !== 'undefined' && SHEET_ID) ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}
function bndSheet_() {
  var ss = bndSS_();
  var sh = ss.getSheetByName('Store');
  if (!sh) {
    sh = ss.insertSheet('Store');
    sh.getRange(1, 1, 1, 3).setValues([['key', 'json', 'updated']]);
  }
  return sh;
}

function bndRead_(useCache) {
  var cache = CacheService.getScriptCache();
  var raw = useCache ? cache.get(BND_CACHE_KEY) : null;
  var rows;
  if (raw) { rows = JSON.parse(raw); }
  else {
    var vals = bndSheet_().getDataRange().getValues();
    rows = [];
    for (var i = 1; i < vals.length; i++) if (vals[i][0]) rows.push([String(vals[i][0]), String(vals[i][1])]);
    bndCachePut_(rows);
  }
  var db = { map: {}, order: [], rowOf: {} };
  rows.forEach(function (r, i) { db.map[r[0]] = JSON.parse(r[1]); db.order.push(r[0]); db.rowOf[r[0]] = i + 2; });
  return db;
}

function bndCachePut_(rows) {
  try { CacheService.getScriptCache().put(BND_CACHE_KEY, JSON.stringify(rows), 20); } catch (e) { /* too big: skip cache */ }
}

function bndWrite_(db, key, obj) {
  var sh = bndSheet_();
  var row = [key, JSON.stringify(obj), new Date().toISOString()];
  if (db.rowOf[key]) sh.getRange(db.rowOf[key], 1, 1, 3).setValues([row]);
  else { sh.appendRow(row); db.order.push(key); db.rowOf[key] = sh.getLastRow(); }
  db.map[key] = obj;
  db.dirty = true;
}

function bndFlushCache_(db) {
  if (!db.dirty) return;
  bndCachePut_(db.order.map(function (k) { return [k, JSON.stringify(db.map[k])]; }));
}

function bndWithLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var db = bndRead_(false);
    var out = fn(db);
    bndFlushCache_(db);
    return out;
  } finally { lock.releaseLock(); }
}

/* ---------- web app entry points ---------- */
function doGet(e) {
  var q = (e && e.parameter && e.parameter.q) ? JSON.parse(e.parameter.q) : { action: 'ping' };
  return bndOut_(bndHandle(q));
}
function doPost(e) {
  var q = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  return bndOut_(bndHandle(q));
}
function bndOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function bndHandle(req) {
  try {
    var a = req.action;
    if (a === 'ping') return { ok: true, now: Date.now() };
    if (a === 'state') return bndStudentState_(req);
    if (a === 'join' || a === 'team') return bndJoin_(req);
    if (a === 'leaveTeam') return bndLeaveTeam_(req);
    if (a === 'roll') return bndRoll_(req);
    if (a === 'save') return bndSave_(req);
    if (a === 'check') return bndCheck_(req);
    if (a === 'next') return bndNext_(req);
    // teacher actions
    if (typeof TEACHER_PIN !== 'undefined' && TEACHER_PIN && String(req.pin || '') !== String(TEACHER_PIN)) {
      return { ok: false, error: 'pin' };
    }
    if (a === 'tstate') return bndTeacherRead_();
    if (a === 'newSession') return bndNewSession_(req);
    if (a === 'settings') return bndSettings_(req);
    if (a === 'move') return bndMove_(req);
    if (a === 'startSolo') return bndStartSolo_(req);
    if (a === 'finish') return bndFinish_(req);
    if (a === 'front') return bndFront_(req);
    if (a === 'spike') return bndSpike_(req);
    if (a === 'export') return bndExport_();
    return { ok: false, error: 'unknown action ' + a };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

/* ---------- players ----------
   No names: a player is an anonymous device id (clientId) known only as
   "Team n · Player 1/2". The first to tap a team number is Player 1, the second Player 2. */
var BND_CUR_ = null;               // session last loaded, used for labels
function bndValidId_(sid) { return /^[A-Za-z0-9_-]{4,64}$/.test(String(sid || '')); }
function bndLabel_(sid) {
  var p = BND_CUR_ && BND_CUR_.players[String(sid)];
  return 'Player ' + ((p && p.role) || 1);
}
function bndFullLabel_(sid) {
  var d = BND_CUR_ && bndDeskOf_(BND_CUR_, sid);
  return (d ? 'Team ' + d.num + ' · ' : '') + bndLabel_(sid);
}
function bndNextRole_(s, desk) {
  var taken = {};
  desk.members.forEach(function (m) { if (s.players[m]) taken[s.players[m].role] = 1; });
  var r = 1;
  while (taken[r]) r++;
  return r;
}

/* ---------- session ----------
   phase: 'open' while teams play (each team runs its own rounds), 'final' after Finish game.
   Each desk (team) has its own round and stage: wait → write → check → result → … → done. */
function bndBlankSession_(settings) {
  settings = settings || {};
  return {
    id: 'S' + Date.now(), created: Date.now(), phase: 'open',
    rounds: settings.rounds || 3, writeSecs: settings.writeSecs || 180, verifySecs: settings.verifySecs || 90,
    players: {}, desks: [], rolls: {}, assign: {}, front: {}, spiked: {}
  };
}
function bndSession_(db) { BND_CUR_ = db.map.session || null; return BND_CUR_; }

function bndNewSession_(req) {
  return bndWithLock_(function (db) {
    var sh = bndSheet_();
    var old = bndSession_(db);
    if (old && db.order.length) {
      var ss = bndSS_();
      var ar = ss.getSheetByName('Archive') || ss.insertSheet('Archive');
      var rows = db.order.map(function (k) { return [old.id, k, JSON.stringify(db.map[k]), new Date().toISOString()]; });
      ar.getRange(ar.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
    }
    sh.clearContents();
    sh.getRange(1, 1, 1, 3).setValues([['key', 'json', 'updated']]);
    db.map = {}; db.order = []; db.rowOf = {};
    bndWrite_(db, 'session', bndBlankSession_(req.settings));
    return bndTeacherState_(db);
  });
}

function bndSettings_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (!s) return { ok: false, error: 'no session' };
    ['rounds', 'writeSecs', 'verifySecs'].forEach(function (k) {
      if (req[k]) s[k] = Math.max(1, Math.min(k === 'rounds' ? 5 : 600, Number(req[k])));
    });
    bndWrite_(db, 'session', s);
    return bndTeacherState_(db);
  });
}

function bndDeskOf_(s, sid) {
  for (var i = 0; i < s.desks.length; i++) if (s.desks[i].members.indexOf(String(sid)) >= 0) return s.desks[i];
  return null;
}
/* Team n is desk 'd' + n with a fixed newsroom name, so the number students tap is the number on the board. */
function bndDeskByNum_(s, n) {
  for (var i = 0; i < s.desks.length; i++) if (s.desks[i].num === n) return s.desks[i];
  var d = { id: 'd' + n, num: n, name: BND_DESK_NAMES[n - 1] || 'Desk ' + n, members: [], round: 0, stage: 'wait', stageEnds: 0 };
  s.desks.push(d);
  s.desks.sort(function (a, b) { return a.num - b.num; });
  return d;
}
function bndTidyDesks_(s) {
  s.desks = s.desks.filter(function (d) { return d.members.length > 0 || d.round > 0; });
}

/* ---------- the per-team clock ---------- */
function bndPostKey_(round, sid) { return 'post:' + round + ':' + sid; }
function bndCheckKey_(round, sid) { return 'check:' + round + ':' + sid; }

function bndStartRound_(s, d, r, now) {
  d.round = r; d.stage = 'write'; d.stageEnds = now + s.writeSecs * 1000;
}

/* Move every team on whose stage is finished. Returns true if anything changed (caller writes the session). */
function bndAdvance_(db, s, now) {
  if (!s || s.phase !== 'open') return false;
  var changed = false;
  s.desks.forEach(function (d) {
    var guard = 0;
    while (guard++ < 4) {
      var st = d.stage;
      if (st === 'wait') {
        if (d.members.length >= BND_TEAM_MAX) { bndStartRound_(s, d, 1, now); changed = true; continue; }
        break;
      }
      if (st === 'write') {
        var allFiled = d.members.length > 0 && d.members.every(function (m) { var p = db.map[bndPostKey_(d.round, m)]; return p && p.filed; });
        if (allFiled || now > d.stageEnds + BND_GRACE_MS) {
          // time's up: whatever each player wrote is final
          d.members.forEach(function (m) {
            var k = bndPostKey_(d.round, m), p = db.map[k];
            if (p && !p.filed) { p.filed = true; bndWrite_(db, k, p); }
          });
          d.stage = 'check'; d.stageEnds = now + s.verifySecs * 1000; changed = true;
          d.members.forEach(function (m) { bndAssignCheck_(db, s, d, m); });
          continue;
        }
        break;
      }
      if (st === 'check') {
        d.members.forEach(function (m) { if (!s.assign[m + ':' + d.round]) { bndAssignCheck_(db, s, d, m); changed = true; } });
        var allChecked = d.members.every(function (m) { return !!db.map[bndCheckKey_(d.round, m)]; });
        if (allChecked || now > d.stageEnds) { d.stage = 'result'; d.stageEnds = now + BND_RESULT_SECS * 1000; changed = true; continue; }
        break;
      }
      if (st === 'result') {
        if (now > d.stageEnds) {
          if (d.round < s.rounds) bndStartRound_(s, d, d.round + 1, now); else { d.stage = 'done'; d.stageEnds = 0; }
          changed = true; continue;
        }
        break;
      }
      break;
    }
  });
  return changed;
}

function bndAdvanceDue_(db, s, now) {
  if (!s || s.phase !== 'open') return false;
  return s.desks.some(function (d) {
    if (d.stage === 'wait') return d.members.length >= BND_TEAM_MAX;
    if (d.stage === 'write') return now > d.stageEnds + BND_GRACE_MS ||
      (d.members.length > 0 && d.members.every(function (m) { var p = db.map[bndPostKey_(d.round, m)]; return p && p.filed; }));
    if (d.stage === 'check') return now > d.stageEnds || d.members.some(function (m) { return !s.assign[m + ':' + d.round]; }) ||
      d.members.every(function (m) { return !!db.map[bndCheckKey_(d.round, m)]; });
    if (d.stage === 'result') return now > d.stageEnds;
    return false;
  });
}

/* Read for a poll: if some team is due to move on, take the lock and move it. */
function bndReadFresh_() {
  var db = bndRead_(true);
  var s = bndSession_(db);
  if (bndAdvanceDue_(db, s, Date.now())) {
    return bndWithLock_(function (db2) {
      var s2 = bndSession_(db2);
      if (bndAdvance_(db2, s2, Date.now())) bndWrite_(db2, 'session', s2);
      return db2;
    });
  }
  return db;
}

/* Fact-check: another team's finished post — least-checked first, same round preferred.
   If nothing is ready yet (e.g. the first team to finish), a practice post from the sample bank. */
function bndAssignCheck_(db, s, d, sid) {
  var key = sid + ':' + d.round;
  if (s.assign[key]) return;
  var seen = {}, counts = {};
  db.order.forEach(function (k) {
    if (k.indexOf('check:') !== 0) return;
    var c = db.map[k];
    counts[c.post] = (counts[c.post] || 0) + 1;
    if (c.sid === sid) seen[c.post] = 1;
  });
  var best = null, bestScore = null;
  db.order.forEach(function (k) {
    if (k.indexOf('post:') !== 0) return;
    var p = db.map[k];
    if (!p.filed || !p.text || !p.text.trim() || p.desk === d.id || p.sid === sid || seen[k] || s.spiked[k]) return;
    var score = [counts[k] || 0, Math.abs(p.round - d.round), p.at];
    if (!bestScore || score[0] < bestScore[0] || (score[0] === bestScore[0] && (score[1] < bestScore[1] ||
      (score[1] === bestScore[1] && score[2] < bestScore[2])))) { best = k; bestScore = score; }
  });
  if (!best) {
    var ids = BND_WORDS.map(function (w) { return w.id; });
    var i = Math.floor(Math.random() * ids.length), j = (i + 1 + Math.floor(Math.random() * (ids.length - 1))) % ids.length;
    best = 'sample:' + ids[i] + ':' + ids[j] + ':' + Math.floor(Math.random() * 2) + Math.floor(Math.random() * 2);
  }
  s.assign[key] = best;
}

function bndSamplePost_(key) {
  var bits = key.split(':');
  var a = BND_SAMPLE_LINES[bits[1]], b = BND_SAMPLE_LINES[bits[2]], ix = bits[3] || '00';
  return { text: a[Number(ix[0])] + ' ' + b[Number(ix[1])], words: [bits[1], bits[2]] };
}

/* ---------- student actions ---------- */
/* Tap a team number and Enter: claims Player 1 or Player 2 on that team (two players max). */
function bndJoin_(req) {
  var sid = String(req.sid || '');
  if (!bndValidId_(sid)) return { ok: false, error: 'Reload the page and try again.' };
  var n = Math.floor(Number(req.team));
  if (!(n >= 1 && n <= BND_TEAM_COUNT)) return { ok: false, error: 'Pick a team number.' };
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (!s) return { ok: false, error: 'The game has not started yet. Wait for T.Chris.' };
    if (s.phase === 'final') return { ok: false, error: 'This game has finished.' };
    var from = bndDeskOf_(s, sid);
    if (from && from.num === n) return bndStudentView_(db, sid);
    if (from && from.round > 0) return { ok: false, error: 'Your team has started. Ask T.Chris to move you.' };
    var to = bndDeskByNum_(s, n);
    if (to.members.length >= BND_TEAM_MAX) {
      bndTidyDesks_(s);
      return { ok: false, full: true, error: 'Team ' + n + ' already has two players. Please choose a different team.' };
    }
    if (from) from.members = from.members.filter(function (m) { return m !== sid; });
    var role = bndNextRole_(s, to);
    to.members.push(sid);
    s.players[sid] = { joined: Date.now(), role: role };
    bndTidyDesks_(s);
    bndAdvance_(db, s, Date.now());          // the second player starts the team's game
    bndWrite_(db, 'session', s);
    return bndStudentView_(db, sid);
  });
}

/* Leave the team before it starts (to pick another number). */
function bndLeaveTeam_(req) {
  var sid = String(req.sid || '');
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    var from = s && bndDeskOf_(s, sid);
    if (!from) return bndStudentView_(db, sid);
    if (from.round > 0) return { ok: false, error: 'Your team has started. Ask T.Chris to move you.' };
    from.members = from.members.filter(function (m) { return m !== sid; });
    delete s.players[sid];
    bndTidyDesks_(s);
    bndWrite_(db, 'session', s);
    return bndStudentView_(db, sid);
  });
}

function bndRoll_(req) {
  var sid = String(req.sid || '');
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    var desk = s && bndDeskOf_(s, sid);
    if (!desk || s.phase !== 'open' || desk.stage !== 'write') return { ok: false, error: 'You can roll when your round starts.' };
    s.rolls[desk.id] = s.rolls[desk.id] || {};
    if (!s.rolls[desk.id][desk.round]) {
      s.rolls[desk.id][desk.round] = bndPickWords_(s, desk.id, desk.round);
      bndWrite_(db, 'session', s);
    }
    return bndStudentView_(db, sid);
  });
}

/* Two words this team has not had yet, favouring words the class has drawn least. */
function bndPickWords_(s, deskId, round) {
  var had = {}, thisRound = {}, overall = {};
  Object.keys(s.rolls).forEach(function (d) {
    Object.keys(s.rolls[d]).forEach(function (r) {
      s.rolls[d][r].forEach(function (w) {
        overall[w] = (overall[w] || 0) + 1;
        if (Number(r) === round) thisRound[w] = (thisRound[w] || 0) + 1;
        if (d === deskId) had[w] = 1;
      });
    });
  });
  var pool = BND_WORDS.map(function (w) { return w.id; }).filter(function (id) { return !had[id]; });
  if (pool.length < 2) pool = BND_WORDS.map(function (w) { return w.id; });
  var tie = {};
  pool.forEach(function (id) { tie[id] = Math.random(); });
  pool.sort(function (a, b) {
    return ((thisRound[a] || 0) - (thisRound[b] || 0)) || ((overall[a] || 0) - (overall[b] || 0)) || (tie[a] - tie[b]);
  });
  return [pool[0], pool[1]];
}

function bndSave_(req) {
  var sid = String(req.sid || '');
  var text = String(req.text || '').slice(0, 600);
  return bndWithLock_(function (db) {
    var r = bndSaveIn_(db, sid, text, !!req.filed);
    if (!r.ok) return r;
    var s = bndSession_(db);
    if (bndAdvance_(db, s, Date.now())) bndWrite_(db, 'session', s);
    return bndStudentView_(db, sid);
  });
}

function bndSaveIn_(db, sid, text, filed) {
  var s = bndSession_(db);
  if (!s || s.phase !== 'open') return { ok: false, error: 'No game running.' };
  var desk = bndDeskOf_(s, sid);
  if (!desk) return { ok: false, error: 'Join a team first.' };
  var open = desk.stage === 'write' && Date.now() <= desk.stageEnds + BND_GRACE_MS;
  if (!open) return { ok: false, error: 'Writing time is over for this round.' };
  var words = (s.rolls[desk.id] || {})[desk.round];
  if (!words) return { ok: false, error: 'Roll the dice first.' };
  var key = bndPostKey_(desk.round, sid);
  var old = db.map[key];
  if (old && old.text === text && (old.filed || !filed)) return { ok: true };
  bndWrite_(db, key, { sid: sid, round: desk.round, desk: desk.id, words: words, text: text,
    filed: filed || !!(old && old.filed), at: Date.now() });
  return { ok: true };
}

function bndCheck_(req) {
  var sid = String(req.sid || '');
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    var desk = s && bndDeskOf_(s, sid);
    if (!desk || s.phase !== 'open' || desk.stage !== 'check') return { ok: false, error: 'Fact-checking is closed for your team.' };
    var task = s.assign[sid + ':' + desk.round];
    if (!task) return { ok: false, error: 'You have no post to check yet.' };
    var ok = (req.ok || []).map(function (v) { return !!v; });
    var stars = Math.max(1, Math.min(3, Number(req.stars) || 2));
    bndWrite_(db, bndCheckKey_(desk.round, sid), { sid: sid, round: desk.round, post: task, desk: desk.id,
      ok: ok, stars: stars, at: Date.now() });
    if (bndAdvance_(db, s, Date.now())) bndWrite_(db, 'session', s);
    return bndStudentView_(db, sid);
  });
}

/* Either partner taps Next round on the results screen. */
function bndNext_(req) {
  var sid = String(req.sid || '');
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    var desk = s && bndDeskOf_(s, sid);
    if (desk && s.phase === 'open' && desk.stage === 'result' && (!req.round || Number(req.round) === desk.round)) {
      desk.stageEnds = 0;
      bndAdvance_(db, s, Date.now());
      bndWrite_(db, 'session', s);
    }
    return bndStudentView_(db, sid);
  });
}

/* ---------- teacher actions ---------- */
function bndMove_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    var sid = String(req.sid);
    var from = bndDeskOf_(s, sid);
    if (from) from.members = from.members.filter(function (m) { return m !== sid; });
    var to = null;
    if (req.desk === 'new') {
      var n = 1;
      while (n <= BND_TEAM_COUNT && s.desks.some(function (d) { return d.num === n; })) n++;
      to = bndDeskByNum_(s, n);
    } else if (req.desk) {
      to = s.desks.filter(function (d) { return d.id === req.desk; })[0];
    }
    if (to) { s.players[sid] = s.players[sid] || { joined: Date.now() }; s.players[sid].role = bndNextRole_(s, to); to.members.push(sid); }
    bndTidyDesks_(s);
    bndAdvance_(db, s, Date.now());
    bndWrite_(db, 'session', s);
    return bndTeacherState_(db);
  });
}

/* A player whose partner is absent can play alone. */
function bndStartSolo_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    var d = s && s.desks.filter(function (x) { return x.id === req.desk; })[0];
    if (d && d.stage === 'wait' && d.members.length && s.phase === 'open') {
      bndStartRound_(s, d, 1, Date.now());
      bndWrite_(db, 'session', s);
    }
    return bndTeacherState_(db);
  });
}

function bndFinish_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (s && s.phase === 'open') {
      s.desks.forEach(function (d) {
        d.members.forEach(function (m) {
          var k = bndPostKey_(d.round, m), p = db.map[k];
          if (p && !p.filed) { p.filed = true; bndWrite_(db, k, p); }
        });
      });
      s.phase = 'final';
      bndWrite_(db, 'session', s);
    }
    return bndTeacherState_(db);
  });
}

function bndFront_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (s && db.map[req.key]) {
      if (s.front[req.key]) delete s.front[req.key]; else s.front[req.key] = Date.now();
      bndWrite_(db, 'session', s);
    }
    return bndTeacherState_(db);
  });
}

function bndSpike_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (s && db.map[req.key]) {
      if (s.spiked[req.key]) delete s.spiked[req.key]; else s.spiked[req.key] = true;
      bndWrite_(db, 'session', s);
    }
    return bndTeacherState_(db);
  });
}

function bndExport_() {
  var db = bndRead_(false);
  var s = bndSession_(db);
  var sc = bndScores_(db);
  var rows = [['Round', 'Team', 'Player', 'Word 1', 'Word 2', 'Post', 'Words', 'Passive', 'Auto', 'Peer', 'Stars', 'Front page', 'Score']];
  Object.keys(sc.posts).forEach(function (k) {
    var p = db.map[k], b = sc.posts[k];
    var desk = s.desks.filter(function (d) { return d.id === p.desk; })[0];
    rows.push([p.round, desk ? 'Team ' + desk.num + ' ' + desk.name : p.desk, bndLabel_(p.sid), p.words[0], p.words[1], p.text, b.count,
      b.passive ? 'yes' : 'no', b.autoPts, b.peerPts, b.stars, b.front ? 'yes' : '', b.total]);
  });
  return { ok: true, rows: rows };
}

/* ---------- scoring ----------
   Automatic points count as soon as there is text; fact-check points arrive as checks come in;
   at Finish game, posts nobody checked get the benefit of the doubt. */
function bndScores_(db) {
  var s = bndSession_(db);
  var R = BND_RULES;
  var final = s.phase === 'final';
  var checksByPost = {}, checkPts = {};
  db.order.forEach(function (k) {
    if (k.indexOf('check:') !== 0) return;
    var c = db.map[k];
    (checksByPost[c.post] = checksByPost[c.post] || []).push(c);
    if (c.desk) checkPts[c.desk] = (checkPts[c.desk] || 0) + R.ptsCheck;
  });
  var posts = {}, deskPts = {}, deskRound = {};
  db.order.forEach(function (k) {
    if (k.indexOf('post:') !== 0) return;
    var p = db.map[k];
    var a = bndAnalyse(p.text, p.words);
    var checks = checksByPost[k] || [];
    var peer = 0, stars = 0;
    if (checks.length) {
      a.used.forEach(function (u, i) {
        if (!u) return;
        var yes = checks.filter(function (c) { return c.ok[i]; }).length;
        if (yes * 2 >= checks.length) peer += R.ptsPeerWord;
      });
      stars = Math.round(checks.reduce(function (t, c) { return t + c.stars; }, 0) / checks.length);
    } else if (final && p.text.trim()) {
      peer = a.used.filter(Boolean).length * R.ptsPeerWord;
      stars = 2;
    }
    var front = !!s.front[k];
    var spiked = !!s.spiked[k];
    var total = spiked ? 0 : a.autoPts + peer + stars + (front ? R.ptsFront : 0);
    posts[k] = { autoPts: a.autoPts, peerPts: peer, stars: stars, front: front, spiked: spiked, total: total,
      count: a.count, inRange: a.inRange, passive: a.passive, used: a.used, traps: a.traps.length, checks: checks.length };
    deskPts[p.desk] = (deskPts[p.desk] || 0) + total;
    deskRound[p.desk] = deskRound[p.desk] || {};
    deskRound[p.desk][p.round] = (deskRound[p.desk][p.round] || 0) + total;
  });
  var desks = s.desks.map(function (d) {
    var size = Math.max(1, d.members.length);
    var raw = (deskPts[d.id] || 0) + (checkPts[d.id] || 0);
    var byRound = {};
    Object.keys(deskRound[d.id] || {}).forEach(function (r) { byRound[r] = Math.round(deskRound[d.id][r] * 2 / size); });
    return { id: d.id, num: d.num, name: d.name, members: d.members.map(function (m) { return { sid: m, label: bndLabel_(m) }; }),
      total: Math.round(raw * 2 / size), byRound: byRound, round: d.round, stage: d.stage, stageEnds: d.stageEnds };
  });
  var sorted = desks.slice().sort(function (a, b) { return b.total - a.total; });
  desks.forEach(function (d) { d.rank = 1 + sorted.filter(function (x) { return x.total > d.total; }).length; });
  return { posts: posts, desks: desks };
}

/* ---------- views ---------- */
function bndPublicSession_(s) {
  return { id: s.id, phase: s.phase, rounds: s.rounds, writeSecs: s.writeSecs, verifySecs: s.verifySecs };
}

function bndStudentState_(req) {
  var sid = String(req.sid || '');
  var db = bndReadFresh_();
  if (req.draft !== undefined && req.draft !== null) {
    // piggy-backed autosave: only takes the lock when the text has changed
    var s0 = bndSession_(db), d0 = s0 && bndDeskOf_(s0, sid);
    var old = d0 && db.map[bndPostKey_(d0.round, sid)];
    if (d0 && d0.stage === 'write' && (!old || old.text !== String(req.draft).slice(0, 600))) {
      return bndWithLock_(function (db2) {
        var r = bndSaveIn_(db2, sid, String(req.draft).slice(0, 600), false);
        var v = bndStudentView_(db2, sid);
        if (!r.ok) v.saveError = r.error;
        return v;
      });
    }
  }
  return bndStudentView_(db, sid);
}

function bndStudentView_(db, sid) {
  var s = bndSession_(db);
  var out = { ok: true, now: Date.now(), session: s ? bndPublicSession_(s) : null };
  if (!s) return out;
  out.joined = !!s.players[sid];
  out.me = { sid: sid, label: bndLabel_(sid) };
  out.teamCount = BND_TEAM_COUNT;
  out.teamMax = BND_TEAM_MAX;
  var desk = bndDeskOf_(s, sid);
  if (!desk || desk.stage === 'wait') {
    out.teams = s.desks.map(function (d) { return { num: d.num, members: d.members.map(bndLabel_) }; });
  }
  if (!desk) return out;
  var sc = bndScores_(db);
  var ds = sc.desks.filter(function (d) { return d.id === desk.id; })[0];
  out.desk = { id: desk.id, num: desk.num, name: desk.name, members: ds.members, total: ds.total, rank: ds.rank,
    deskCount: s.desks.length, byRound: ds.byRound, round: desk.round, stage: desk.stage, stageEnds: desk.stageEnds,
    words: (s.rolls[desk.id] || {})[desk.round] || null };
  var myKey = bndPostKey_(desk.round, sid);
  var mine = db.map[myKey];
  out.myPost = mine ? { text: mine.text, filed: !!mine.filed, words: mine.words } : null;
  if (mine && (desk.stage === 'result' || desk.stage === 'done' || s.phase === 'final')) out.myPost.score = sc.posts[myKey];
  if ((mine && mine.filed) || desk.stage !== 'write') {
    out.partnerPosts = desk.members.filter(function (m) { return m !== sid; }).map(function (m) {
      var p = db.map[bndPostKey_(desk.round, m)];
      return { label: bndLabel_(m), text: p ? p.text : '', filed: !!(p && p.filed) };
    });
  }
  if (desk.stage === 'check') {
    var tk = s.assign[sid + ':' + desk.round];
    if (tk) {
      var post = tk.indexOf('sample:') === 0 ? bndSamplePost_(tk) : db.map[tk];
      out.task = { key: tk, text: post.text, words: post.words, sample: tk.indexOf('sample:') === 0,
        done: !!db.map[bndCheckKey_(desk.round, sid)] };
    }
  }
  out.front = bndFrontList_(db, s);
  return out;
}

function bndFrontList_(db, s) {
  return Object.keys(s.front).map(function (k) {
    var p = db.map[k];
    if (!p) return null;
    var d = s.desks.filter(function (x) { return x.id === p.desk; })[0];
    return { at: s.front[k], round: p.round, key: k, text: p.text, words: p.words, desk: d ? 'Team ' + d.num + ' ' + d.name : '' };
  }).filter(Boolean).sort(function (a, b) { return a.at - b.at; });
}

function bndTeacherRead_() { return bndTeacherState_(bndReadFresh_()); }

function bndTeacherState_(db) {
  var s = bndSession_(db);
  var out = { ok: true, now: Date.now(), session: s ? bndPublicSession_(s) : null };
  if (!s) return out;
  var sc = bndScores_(db);
  out.players = Object.keys(s.players).map(function (sid) {
    var d = bndDeskOf_(s, sid);
    return { sid: sid, label: bndFullLabel_(sid), desk: d ? d.id : null };
  });
  out.desks = sc.desks.map(function (d) {
    d.words = (s.rolls[d.id] || {})[d.round] || null;
    d.allWords = s.rolls[d.id] || {};
    return d;
  });
  var deskName = {};
  s.desks.forEach(function (d) { deskName[d.id] = 'Team ' + d.num + ' ' + d.name; });
  out.posts = Object.keys(sc.posts).map(function (k) {
    var p = db.map[k];
    return { key: k, round: p.round, sid: p.sid, author: bndLabel_(p.sid), desk: p.desk, deskName: deskName[p.desk] || '',
      words: p.words, text: p.text, filed: p.filed, at: p.at, score: sc.posts[k] };
  });
  var c = { players: Object.keys(s.players).length, teams: s.desks.length, waiting: 0, playing: 0, done: 0 };
  s.desks.forEach(function (d) { if (d.stage === 'wait') c.waiting++; else if (d.stage === 'done') c.done++; else c.playing++; });
  out.counts = c;
  out.front = bndFrontList_(db, s);
  return out;
}
