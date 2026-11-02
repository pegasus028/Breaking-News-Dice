/* Breaking News Dice — game engine.
   Runs inside Google Apps Script (copied into apps-script/Code.gs by
   tools/build.js) and, unchanged, in the browser for Demo mode, where
   js/mock-gas.js stands in for SpreadsheetApp, LockService and CacheService.
   Needs globals from words.js, check.js and a roster file (ROSTER, TEACHER_PIN). */

var BND_DESK_NAMES = ['Chao Phraya Chronicle', 'Klong Courier', 'Monsoon Mail', 'Riverside Report',
  'Soi Sentinel', 'Dusit Dispatch', 'Thonburi Times', 'Bang Na Bulletin', 'Silom Standard',
  'Pratunam Post', 'Ari Herald', 'Rama IV Record', 'Lumpini Ledger', 'Rangsit Wire', 'Nonthaburi News',
  'Ayutthaya Advertiser'];
var BND_GRACE_MS = 15000;          // late saves accepted this long after a timer ends
var BND_CACHE_KEY = 'bnd-store-v1';

/* ---------- storage: one "Store" sheet of key | json | updated ---------- */
function bndSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
    if (a === 'roster') return { ok: true, roster: bndRosterPublic_() };
    if (a === 'state') return bndStudentState_(req);
    if (a === 'join') return bndJoin_(req);
    if (a === 'roll') return bndRoll_(req);
    if (a === 'save') return bndSave_(req);
    if (a === 'check') return bndCheck_(req);
    // teacher actions
    if (typeof TEACHER_PIN !== 'undefined' && TEACHER_PIN && String(req.pin || '') !== String(TEACHER_PIN)) {
      return { ok: false, error: 'pin' };
    }
    if (a === 'tstate') return bndTeacherState_(bndRead_(true));
    if (a === 'newSession') return bndNewSession_(req);
    if (a === 'settings') return bndSettings_(req);
    if (a === 'pair') return bndPair_(req);
    if (a === 'move') return bndMove_(req);
    if (a === 'release') return bndRelease_(req);
    if (a === 'go') return bndGo_(req);
    if (a === 'extend') return bndExtend_(req);
    if (a === 'front') return bndFront_(req);
    if (a === 'spike') return bndSpike_(req);
    if (a === 'export') return bndExport_();
    return { ok: false, error: 'unknown action ' + a };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

/* ---------- roster ---------- */
function bndRoster_() { return (typeof ROSTER !== 'undefined' && ROSTER) ? ROSTER : []; }
function bndRosterPublic_() {
  var r = bndRoster_();
  var counts = {};
  r.forEach(function (s) { counts[s.name] = (counts[s.name] || 0) + 1; });
  return r.map(function (s) {
    return { sid: String(s.sid), name: s.name, label: counts[s.name] > 1 ? s.name + ' (No. ' + s.sid + ')' : s.name };
  }).sort(function (x, y) { return x.label.localeCompare(y.label); });
}
function bndLabel_(sid) {
  var r = bndRosterPublic_();
  for (var i = 0; i < r.length; i++) if (r[i].sid === String(sid)) return r[i].label;
  return 'No. ' + sid;
}
function bndBand_(sid) {
  var r = bndRoster_();
  for (var i = 0; i < r.length; i++) if (String(r[i].sid) === String(sid)) return r[i].band || 2;
  return 2;
}

/* ---------- session ---------- */
function bndBlankSession_(settings) {
  settings = settings || {};
  return {
    id: 'S' + Date.now(), created: Date.now(), phase: 'lobby', round: 0,
    rounds: settings.rounds || 3, writeSecs: settings.writeSecs || 180, verifySecs: settings.verifySecs || 90,
    phaseEnds: 0, players: {}, desks: [], rolls: {}, assign: {}, front: {}, spiked: {}
  };
}
function bndSession_(db) { return db.map.session || null; }

function bndNewSession_(req) {
  return bndWithLock_(function (db) {
    var sh = bndSheet_();
    var old = bndSession_(db);
    if (old && db.order.length) {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
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
function bndNextDeskName_(s) {
  var used = s.desks.map(function (d) { return d.name; });
  for (var i = 0; i < BND_DESK_NAMES.length; i++) if (used.indexOf(BND_DESK_NAMES[i]) < 0) return BND_DESK_NAMES[i];
  return 'Desk ' + (s.desks.length + 1);
}
function bndNewDeskId_(s) {
  var n = 1;
  while (s.desks.some(function (d) { return d.id === 'd' + n; })) n++;
  return 'd' + n;
}

/* ---------- student actions ---------- */
function bndJoin_(req) {
  var sid = String(req.sid || '');
  if (!bndRoster_().some(function (r) { return String(r.sid) === sid; })) return { ok: false, error: 'Unknown name.' };
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (!s) return { ok: false, error: 'The game has not started yet. Wait for T.Chris.' };
    var p = s.players[sid];
    if (p && p.device && req.device && p.device !== req.device) {
      return { ok: false, error: 'This name is already signed in on another device. Ask T.Chris to release it.' };
    }
    s.players[sid] = { joined: p ? p.joined : Date.now(), device: req.device || (p && p.device) || '' };
    // late arrival after pairing: add to the smallest desk
    if (s.desks.length && !bndDeskOf_(s, sid)) {
      var smallest = s.desks.slice().sort(function (x, y) { return x.members.length - y.members.length; })[0];
      smallest.members.push(sid);
    }
    bndWrite_(db, 'session', s);
    return bndStudentView_(db, sid);
  });
}

function bndRoll_(req) {
  var sid = String(req.sid || '');
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (!s || s.phase !== 'write') return { ok: false, error: 'You can roll when the round starts.' };
    var desk = bndDeskOf_(s, sid);
    if (!desk) return { ok: false, error: 'You are not at a desk yet.' };
    s.rolls[desk.id] = s.rolls[desk.id] || {};
    if (!s.rolls[desk.id][s.round]) {
      s.rolls[desk.id][s.round] = bndPickWords_(s, desk.id);
      bndWrite_(db, 'session', s);
    }
    return bndStudentView_(db, sid);
  });
}

/* Two words this desk has not had yet, favouring words the class has drawn least. */
function bndPickWords_(s, deskId) {
  var had = {}, thisRound = {}, overall = {};
  Object.keys(s.rolls).forEach(function (d) {
    Object.keys(s.rolls[d]).forEach(function (r) {
      s.rolls[d][r].forEach(function (w) {
        overall[w] = (overall[w] || 0) + 1;
        if (Number(r) === s.round) thisRound[w] = (thisRound[w] || 0) + 1;
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

function bndPostKey_(round, sid) { return 'post:' + round + ':' + sid; }
function bndCheckKey_(round, sid) { return 'check:' + round + ':' + sid; }

function bndSave_(req) {
  var sid = String(req.sid || '');
  var text = String(req.text || '').slice(0, 600);
  return bndWithLock_(function (db) {
    var r = bndSaveIn_(db, sid, text, !!req.filed);
    if (!r.ok) return r;
    return bndStudentView_(db, sid);
  });
}

function bndSaveIn_(db, sid, text, filed) {
  var s = bndSession_(db);
  if (!s) return { ok: false, error: 'No game running.' };
  var round = s.round;
  var late = Date.now() > s.phaseEnds + BND_GRACE_MS;
  var open = (s.phase === 'write' && !(s.phaseEnds && late)) ||
    (s.phase === 'verify' && s.writeClosedAt && Date.now() < s.writeClosedAt + BND_GRACE_MS);
  if (!open) return { ok: false, error: 'Writing time is over for this round.' };
  var desk = bndDeskOf_(s, sid);
  if (!desk) return { ok: false, error: 'You are not at a desk yet.' };
  var words = (s.rolls[desk.id] || {})[round];
  if (!words) return { ok: false, error: 'Roll the dice first.' };
  var key = bndPostKey_(round, sid);
  var old = db.map[key];
  if (old && old.text === text && (old.filed || !filed)) return { ok: true };
  bndWrite_(db, key, { sid: sid, round: round, desk: desk.id, words: words, text: text,
    filed: filed || !!(old && old.filed), at: Date.now() });
  return { ok: true };
}

function bndCheck_(req) {
  var sid = String(req.sid || '');
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (!s || s.phase !== 'verify' || (s.phaseEnds && Date.now() > s.phaseEnds + BND_GRACE_MS)) {
      return { ok: false, error: 'Fact-checking is closed.' };
    }
    var task = (s.assign[s.round] || {})[sid];
    if (!task) return { ok: false, error: 'You have no post to check this round.' };
    var desk = bndDeskOf_(s, sid);
    var ok = (req.ok || []).map(function (v) { return !!v; });
    var stars = Math.max(1, Math.min(3, Number(req.stars) || 2));
    bndWrite_(db, bndCheckKey_(s.round, sid), { sid: sid, round: s.round, post: task, desk: desk ? desk.id : '',
      ok: ok, stars: stars, at: Date.now() });
    return bndStudentView_(db, sid);
  });
}

/* ---------- teacher actions ---------- */
function bndShuffle_(arr) {
  for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  return arr;
}

function bndPair_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (!s) return { ok: false, error: 'no session' };
    if (s.round > 0) return { ok: false, error: 'Pairs are locked once round 1 starts. Use Move instead.' };
    var sids = bndShuffle_(Object.keys(s.players));
    if (req.mode !== 'random') {
      // mixed ability: strongest with weakest, working inwards
      sids.sort(function (a, b) { return bndBand_(a) - bndBand_(b); });
    }
    var groups = [];
    var lo = 0, hi = sids.length - 1;
    while (lo < hi) { groups.push([sids[lo], sids[hi]]); lo++; hi--; }
    if (lo === hi) {
      if (groups.length) groups[groups.length - 1].push(sids[lo]); else groups.push([sids[lo]]);
    }
    var names = bndShuffle_(BND_DESK_NAMES.slice());
    s.desks = groups.map(function (g, i) { return { id: 'd' + (i + 1), name: names[i] || 'Desk ' + (i + 1), members: g }; });
    s.rolls = {};
    if (s.phase === 'lobby') s.phase = 'paired';
    bndWrite_(db, 'session', s);
    return bndTeacherState_(db);
  });
}

function bndMove_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    var sid = String(req.sid);
    var from = bndDeskOf_(s, sid);
    if (from) from.members = from.members.filter(function (m) { return m !== sid; });
    if (req.desk === 'new') {
      s.desks.push({ id: bndNewDeskId_(s), name: bndNextDeskName_(s), members: [sid] });
    } else if (req.desk) {
      var to = s.desks.filter(function (d) { return d.id === req.desk; })[0];
      if (to) to.members.push(sid);
    }
    s.desks = s.desks.filter(function (d) { return d.members.length > 0 || (s.rolls[d.id] && Object.keys(s.rolls[d.id]).length); });
    bndWrite_(db, 'session', s);
    return bndTeacherState_(db);
  });
}

function bndRelease_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    var p = s && s.players[String(req.sid)];
    if (p) { p.device = ''; bndWrite_(db, 'session', s); }
    return bndTeacherState_(db);
  });
}

/* go: move to the next phase. `from` makes double clicks harmless. */
function bndGo_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (!s) return { ok: false, error: 'no session' };
    if (req.from && (req.from.phase !== s.phase || Number(req.from.round) !== s.round)) return bndTeacherState_(db);
    var now = Date.now();
    if (s.phase === 'lobby' || s.phase === 'paired' || s.phase === 'reveal') {
      if (!s.desks.length) return { ok: false, error: 'Make the desks first.' };
      if (s.phase === 'reveal' && s.round >= s.rounds) { s.phase = 'final'; s.phaseEnds = 0; }
      else { s.round += 1; s.phase = 'write'; s.phaseEnds = now + s.writeSecs * 1000; s.writeClosedAt = 0; }
    } else if (s.phase === 'write') {
      s.phase = 'verify'; s.writeClosedAt = now; s.phaseEnds = now + s.verifySecs * 1000;
      s.assign[s.round] = bndAssign_(db, s);
    } else if (s.phase === 'verify') {
      s.phase = 'reveal'; s.phaseEnds = 0;
    } else if (s.phase === 'final') {
      return bndTeacherState_(db);
    }
    bndWrite_(db, 'session', s);
    return bndTeacherState_(db);
  });
}

/* Each student checks one post from another desk; posts are shared out evenly. */
function bndAssign_(db, s) {
  var deskIndex = {};
  s.desks.forEach(function (d, i) { deskIndex[d.id] = i; });
  var posts = db.order.filter(function (k) {
    var p = db.map[k];
    return k.indexOf('post:' + s.round + ':') === 0 && p.text && p.text.trim();
  }).sort(function (a, b) { return (deskIndex[db.map[a].desk] || 0) - (deskIndex[db.map[b].desk] || 0); });
  var judges = [];
  s.desks.forEach(function (d) { d.members.forEach(function (m) { judges.push({ sid: m, desk: d.id }); }); });
  var out = {};
  if (!posts.length) return out;
  var best = null, bestBad = 1e9;
  for (var off = 1; off <= Math.max(posts.length, judges.length); off++) {
    var bad = 0, trial = {};
    judges.forEach(function (j, i) {
      var k = posts[(i + off) % posts.length];
      if (db.map[k].desk === j.desk) bad++;
      trial[j.sid] = k;
    });
    if (bad < bestBad) { best = trial; bestBad = bad; }
    if (!bad) break;
  }
  // a judge still holding her own desk's post (tiny classes): give her any other desk's post
  judges.forEach(function (j) {
    if (db.map[best[j.sid]].desk === j.desk) {
      var other = posts.filter(function (k) { return db.map[k].desk !== j.desk; })[0];
      if (other) best[j.sid] = other; else delete best[j.sid];
    }
  });
  return best;
}

function bndExtend_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (s && (s.phase === 'write' || s.phase === 'verify')) {
      s.phaseEnds = Math.max(s.phaseEnds, Date.now()) + (Number(req.secs) || 30) * 1000;
      bndWrite_(db, 'session', s);
    }
    return bndTeacherState_(db);
  });
}

function bndFront_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    var p = db.map[req.key];
    if (s && p) {
      if (s.front[p.round] === req.key) delete s.front[p.round]; else s.front[p.round] = req.key;
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
  var rows = [['Round', 'Desk', 'Student', 'Word 1', 'Word 2', 'Post', 'Words', 'Passive', 'Auto', 'Peer', 'Stars', 'Front page', 'Score']];
  Object.keys(sc.posts).forEach(function (k) {
    var p = db.map[k], b = sc.posts[k];
    var desk = s.desks.filter(function (d) { return d.id === p.desk; })[0];
    rows.push([p.round, desk ? desk.name : p.desk, bndLabel_(p.sid), p.words[0], p.words[1], p.text, b.count,
      b.passive ? 'yes' : 'no', b.autoPts, b.peerPts, b.stars, b.front ? 'yes' : '', b.total]);
  });
  return { ok: true, rows: rows };
}

/* ---------- scoring ---------- */
function bndRoundStage_(s, round) {
  // 'write' (auto points only), 'verify' (auto + checks so far), 'done' (unchecked posts get the benefit of the doubt)
  if (round < s.round) return 'done';
  if (round > s.round) return 'none';
  if (s.phase === 'write') return 'write';
  if (s.phase === 'verify') return 'verify';
  return 'done';
}

function bndScores_(db) {
  var s = bndSession_(db);
  var R = BND_RULES;
  var checksByPost = {};
  var checkPts = {};
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
    var stage = bndRoundStage_(s, p.round);
    if (stage === 'none') return;
    var a = bndAnalyse(p.text, p.words);
    var checks = checksByPost[k] || [];
    var peer = 0, stars = 0;
    if (stage !== 'write') {
      if (checks.length) {
        a.used.forEach(function (u, i) {
          if (!u) return;
          var yes = checks.filter(function (c) { return c.ok[i]; }).length;
          if (yes * 2 >= checks.length) peer += R.ptsPeerWord;
        });
        stars = Math.round(checks.reduce(function (t, c) { return t + c.stars; }, 0) / checks.length);
      } else if (stage === 'done' && p.text.trim()) {
        peer = a.used.filter(Boolean).length * R.ptsPeerWord;
        stars = 2;
      }
    }
    var front = s.front[p.round] === k;
    var spiked = !!s.spiked[k];
    var total = spiked ? 0 : a.autoPts + peer + stars + (front ? R.ptsFront : 0);
    posts[k] = { autoPts: a.autoPts, peerPts: peer, stars: stars, front: front, spiked: spiked, total: total,
      count: a.count, inRange: a.inRange, passive: a.passive, used: a.used, traps: a.traps.length,
      checks: checks.length, checkYes: checks.map(function (c) { return c.ok; }) };
    deskPts[p.desk] = (deskPts[p.desk] || 0) + total;
    deskRound[p.desk] = deskRound[p.desk] || {};
    deskRound[p.desk][p.round] = (deskRound[p.desk][p.round] || 0) + total;
  });
  var desks = s.desks.map(function (d) {
    var size = Math.max(2, d.members.length);
    var raw = (deskPts[d.id] || 0) + (checkPts[d.id] || 0);
    var byRound = {};
    Object.keys(deskRound[d.id] || {}).forEach(function (r) { byRound[r] = Math.round(deskRound[d.id][r] * 2 / size); });
    return { id: d.id, name: d.name, members: d.members.map(function (m) { return { sid: m, label: bndLabel_(m) }; }),
      total: Math.round(raw * 2 / size), byRound: byRound, checkPts: checkPts[d.id] || 0 };
  });
  var sorted = desks.slice().sort(function (a, b) { return b.total - a.total; });
  desks.forEach(function (d) {
    d.rank = 1 + sorted.filter(function (x) { return x.total > d.total; }).length;
  });
  return { posts: posts, desks: desks };
}

/* ---------- views ---------- */
function bndPublicSession_(s) {
  return { id: s.id, phase: s.phase, round: s.round, rounds: s.rounds, phaseEnds: s.phaseEnds,
    writeSecs: s.writeSecs, verifySecs: s.verifySecs };
}

function bndStudentState_(req) {
  var sid = String(req.sid || '');
  if (req.draft !== undefined && req.draft !== null) {
    // piggy-backed autosave: only takes the lock when the text has changed
    var dbr = bndRead_(true);
    var s0 = bndSession_(dbr);
    var old = s0 && dbr.map[bndPostKey_(s0.round, sid)];
    if (!old || old.text !== String(req.draft).slice(0, 600)) {
      return bndWithLock_(function (db) {
        var r = bndSaveIn_(db, sid, String(req.draft).slice(0, 600), false);
        var v = bndStudentView_(db, sid);
        if (!r.ok) v.saveError = r.error;
        return v;
      });
    }
    return bndStudentView_(dbr, sid);
  }
  return bndStudentView_(bndRead_(true), sid);
}

function bndStudentView_(db, sid) {
  var s = bndSession_(db);
  var out = { ok: true, now: Date.now(), session: s ? bndPublicSession_(s) : null };
  if (!s) return out;
  out.joined = !!s.players[sid];
  out.me = { sid: sid, label: bndLabel_(sid) };
  var desk = bndDeskOf_(s, sid);
  if (!desk) return out;
  var sc = bndScores_(db);
  var ds = sc.desks.filter(function (d) { return d.id === desk.id; })[0];
  out.desk = { id: desk.id, name: desk.name, members: ds.members, total: ds.total, rank: ds.rank,
    deskCount: s.desks.length, byRound: ds.byRound,
    words: (s.rolls[desk.id] || {})[s.round] || null };
  var myKey = bndPostKey_(s.round, sid);
  var mine = db.map[myKey];
  out.myPost = mine ? { text: mine.text, filed: !!mine.filed, words: mine.words } : null;
  if (mine && (s.phase === 'reveal' || s.phase === 'final')) out.myPost.score = sc.posts[myKey];
  // partners' posts: visible once she has filed her own or writing has closed
  if ((mine && mine.filed) || s.phase !== 'write') {
    out.partnerPosts = desk.members.filter(function (m) { return m !== sid; }).map(function (m) {
      var p = db.map[bndPostKey_(s.round, m)];
      return { label: bndLabel_(m), text: p ? p.text : '', filed: !!(p && p.filed) };
    });
  }
  if (s.phase === 'verify') {
    var tk = (s.assign[s.round] || {})[sid];
    if (tk && db.map[tk]) out.task = { key: tk, text: db.map[tk].text, words: db.map[tk].words,
      done: !!db.map[bndCheckKey_(s.round, sid)] };
  }
  out.front = bndFrontList_(db, s);
  return out;
}

function bndFrontList_(db, s) {
  return Object.keys(s.front).map(function (r) {
    var p = db.map[s.front[r]];
    if (!p) return null;
    var d = s.desks.filter(function (x) { return x.id === p.desk; })[0];
    return { round: Number(r), key: s.front[r], text: p.text, words: p.words, desk: d ? d.name : '', author: bndLabel_(p.sid) };
  }).filter(Boolean).sort(function (a, b) { return a.round - b.round; });
}

function bndTeacherState_(db) {
  var s = bndSession_(db);
  var out = { ok: true, now: Date.now(), session: s ? bndPublicSession_(s) : null, roster: bndRosterPublic_() };
  if (!s) return out;
  var sc = bndScores_(db);
  out.players = Object.keys(s.players).map(function (sid) {
    var d = bndDeskOf_(s, sid);
    return { sid: sid, label: bndLabel_(sid), desk: d ? d.id : null, locked: !!s.players[sid].device };
  });
  out.desks = sc.desks.map(function (d) {
    var raw = s.desks.filter(function (x) { return x.id === d.id; })[0];
    d.words = (s.rolls[d.id] || {})[s.round] || null;
    d.allWords = s.rolls[d.id] || {};
    return d;
  });
  var deskName = {};
  s.desks.forEach(function (d) { deskName[d.id] = d.name; });
  out.posts = Object.keys(sc.posts).map(function (k) {
    var p = db.map[k];
    var b = sc.posts[k];
    return { key: k, round: p.round, sid: p.sid, author: bndLabel_(p.sid), desk: p.desk, deskName: deskName[p.desk] || '',
      words: p.words, text: p.text, filed: p.filed, score: b };
  });
  var r = s.round;
  var members = 0;
  s.desks.forEach(function (d) { members += d.members.length; });
  out.counts = {
    joined: Object.keys(s.players).length,
    seated: members,
    rolled: s.desks.filter(function (d) { return s.rolls[d.id] && s.rolls[d.id][r]; }).length,
    writing: out.posts.filter(function (p) { return p.round === r && p.text.trim(); }).length,
    filed: out.posts.filter(function (p) { return p.round === r && p.filed; }).length,
    checks: db.order.filter(function (k) { return k.indexOf('check:' + r + ':') === 0; }).length,
    toCheck: Object.keys(s.assign[r] || {}).length
  };
  out.front = bndFrontList_(db, s);
  return out;
}
