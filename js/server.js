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
var BND_MAX_ROUNDS = 20;         // rounds are open-ended: faster students simply play more of them
var BND_CACHE_KEY = 'bnd-store-v2';

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
  var raw = useCache ? bndCacheGet_() : null;
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

/* The cache holds 100 KB per key, so a big game is stored in chunks. */
function bndCachePut_(rows) {
  try {
    var str = JSON.stringify(rows), size = 90000, parts = {}, n = Math.ceil(str.length / size) || 1;
    for (var i = 0; i < n; i++) parts[BND_CACHE_KEY + ':' + i] = str.slice(i * size, (i + 1) * size);
    parts[BND_CACHE_KEY] = String(n);
    CacheService.getScriptCache().putAll(parts, 20);
  } catch (e) { /* cache unavailable: reads fall back to the sheet */ }
}
function bndCacheGet_() {
  try {
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get(BND_CACHE_KEY));
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(BND_CACHE_KEY + ':' + i);
    var got = cache.getAll(keys), str = '';
    for (i = 0; i < n; i++) { if (got[keys[i]] === undefined || got[keys[i]] === null) return null; str += got[keys[i]]; }
    return str;
  } catch (e) { return null; }
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
    if (a === 'release') return bndRelease_(req);
    if (a === 'finish') return bndFinish_(req);
    if (a === 'front') return bndFront_(req);
    if (a === 'spike') return bndSpike_(req);
    if (a === 'export') return bndExport_();
    return { ok: false, error: 'unknown action ' + a };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

/* ---------- roster (Roster.gs): students sign in by tapping their name ---------- */
function bndRoster_() { return (typeof ROSTER !== 'undefined' && ROSTER) ? ROSTER : []; }
function bndRosterPublic_() {
  var r = bndRoster_();
  var counts = {};
  r.forEach(function (s) { counts[s.name] = (counts[s.name] || 0) + 1; });
  return r.map(function (s) {
    return { sid: String(s.sid), name: s.name, label: counts[s.name] > 1 ? s.name + ' (No. ' + s.sid + ')' : s.name };
  }).sort(function (x, y) { return x.label.localeCompare(y.label); });
}
var BND_LABELS_ = null;
function bndLabel_(sid) {
  if (!BND_LABELS_) { BND_LABELS_ = {}; bndRosterPublic_().forEach(function (r) { BND_LABELS_[r.sid] = r.label; }); }
  return BND_LABELS_[String(sid)] || ('No. ' + sid);
}

/* ---------- session ----------
   phase: 'open' while students play (each at her own speed), 'final' after Finish game.
   Each player: round 1, 2, 3 … and stage 'write' (roll + write + file) → 'check' (fact-check one post) → next round. */
function bndBlankSession_(settings) {
  settings = settings || {};
  return {
    id: 'S' + Date.now(), created: Date.now(), phase: 'open',
    maxRounds: settings.maxRounds || BND_MAX_ROUNDS,
    requirePassive: settings.requirePassive === undefined ? true : !!settings.requirePassive,
    front: {}, spiked: {}
  };
}
function bndSession_(db) { return db.map.session || null; }

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
    if (req.maxRounds) s.maxRounds = Math.max(1, Math.min(BND_MAX_ROUNDS, Number(req.maxRounds)));
    if (req.requirePassive !== undefined) s.requirePassive = !!req.requirePassive;
    bndWrite_(db, 'session', s);
    return bndTeacherState_(db);
  });
}

function bndPostKey_(round, sid) { return 'post:' + round + ':' + sid; }
/* Each student's progress is her own row ('player:<sid>'), so students never overwrite each other. */
function bndPlayerKey_(sid) { return 'player:' + sid; }
function bndPlayer_(db, sid) { return db.map[bndPlayerKey_(sid)] || null; }
function bndPlayerIds_(db) { return db.order.filter(function (k) { return k.indexOf('player:') === 0; }).map(function (k) { return k.slice(7); }); }
function bndCheckKey_(round, sid) { return 'check:' + round + ':' + sid; }

/* The filing rule: every checklist item must be met. */
function bndCriteria_(a, s) {
  var miss = [];
  if (!a.used[0] || !a.used[1]) miss.push('use both dice words');
  if (!a.inRange) miss.push('write at least ' + BND_RULES.minWords + ' words');
  if (s.requirePassive && !a.passive) miss.push('include a passive');
  if (a.traps.length) miss.push('fix the passive error');
  return miss;
}

/* ---------- student actions ---------- */
function bndJoin_(req) {
  var sid = String(req.sid || '');
  if (!bndRoster_().some(function (r) { return String(r.sid) === sid; })) return { ok: false, error: 'Unknown name.' };
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (!s) return { ok: false, error: 'The game has not started yet. Wait for T.Chris.' };
    if (s.phase === 'final') return { ok: false, error: 'This game has finished.' };
    var p = bndPlayer_(db, sid);
    if (p && p.device && req.device && p.device !== req.device) {
      return { ok: false, error: 'This name is already signed in on another device. Ask T.Chris to release it.' };
    }
    if (!p) p = { sid: sid, joined: Date.now(), round: 1, stage: 'write', words: null, task: null };
    p.device = req.device || p.device || '';
    bndWrite_(db, bndPlayerKey_(sid), p);
    return bndStudentView_(db, sid);
  });
}

function bndRoll_(req) {
  var sid = String(req.sid || '');
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    var p = s && bndPlayer_(db, sid);
    if (!p || s.phase !== 'open' || p.stage !== 'write') return { ok: false, error: 'You can roll at the start of a round.' };
    if (!p.words) {
      p.words = bndPickWords_(db, sid);
      bndWrite_(db, bndPlayerKey_(sid), p);
    }
    return bndStudentView_(db, sid);
  });
}

/* Two words she has not had yet (repeats only after all 15), favouring words the class has drawn least. */
function bndPickWords_(db, sid) {
  var had = {}, overall = {};
  db.order.forEach(function (k) {
    if (k.indexOf('post:') !== 0) return;
    var p = db.map[k];
    p.words.forEach(function (w) {
      overall[w] = (overall[w] || 0) + 1;
      if (p.sid === sid) had[w] = (had[w] || 0) + 1;
    });
  });
  var ids = BND_WORDS.map(function (w) { return w.id; });
  var tie = {};
  ids.forEach(function (id) { tie[id] = Math.random(); });
  ids.sort(function (a, b) {
    return ((had[a] || 0) - (had[b] || 0)) || ((overall[a] || 0) - (overall[b] || 0)) || (tie[a] - tie[b]);
  });
  return [ids[0], ids[1]];
}

function bndSave_(req) {
  var sid = String(req.sid || '');
  var text = String(req.text || '').slice(0, 2000);
  return bndWithLock_(function (db) {
    var r = bndSaveIn_(db, sid, text, !!req.filed);
    if (!r.ok) { var v = bndStudentView_(db, sid); v.ok = false; v.error = r.error; v.missing = r.missing; return v; }
    return bndStudentView_(db, sid);
  });
}

function bndSaveIn_(db, sid, text, filed) {
  var s = bndSession_(db);
  var p = s && bndPlayer_(db, sid);
  if (!p || s.phase !== 'open') return { ok: false, error: 'No game running.' };
  if (p.stage !== 'write') return { ok: false, error: 'You have already filed this round.' };
  var words = p.words;
  if (!words) return { ok: false, error: 'Roll the dice first.' };
  if (filed) {
    var miss = bndCriteria_(bndAnalyse(text, words), s);
    if (miss.length) return { ok: false, error: 'Not yet: ' + miss.join(', ') + '.', missing: miss };
  }
  var key = bndPostKey_(p.round, sid);
  var old = db.map[key];
  if (!(old && old.text === text && !filed)) {
    bndWrite_(db, key, { sid: sid, round: p.round, words: words, text: text, filed: filed, at: Date.now() });
  }
  if (filed) {
    p.stage = 'check';
    p.task = bndPickCheck_(db, s, sid);
    bndWrite_(db, bndPlayerKey_(sid), p);
  }
  return { ok: true };
}

/* Fact-check: another student's filed post — least-checked first, newest preferred, never her own.
   If nobody else has filed yet, a practice post from the sample bank. */
function bndPickCheck_(db, s, sid) {
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
    if (!p.filed || p.sid === sid || seen[k] || s.spiked[k]) return;
    var score = [counts[k] || 0, -p.at];
    if (!bestScore || score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) { best = k; bestScore = score; }
  });
  if (best) return best;
  var ids = BND_WORDS.map(function (w) { return w.id; });
  var i = Math.floor(Math.random() * ids.length), j = (i + 1 + Math.floor(Math.random() * (ids.length - 1))) % ids.length;
  return 'sample:' + ids[i] + ':' + ids[j] + ':' + Math.floor(Math.random() * 2) + Math.floor(Math.random() * 2);
}

function bndSamplePost_(key) {
  var bits = key.split(':');
  var a = BND_SAMPLE_LINES[bits[1]], b = BND_SAMPLE_LINES[bits[2]], ix = bits[3] || '00';
  return { text: a[Number(ix[0])] + ' ' + b[Number(ix[1])], words: [bits[1], bits[2]] };
}

function bndCheck_(req) {
  var sid = String(req.sid || '');
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    var p = s && bndPlayer_(db, sid);
    if (!p || s.phase !== 'open' || p.stage !== 'check') return { ok: false, error: 'There is nothing to fact-check right now.' };
    var task = p.task || bndPickCheck_(db, s, sid);
    var ok = (req.ok || []).map(function (v) { return !!v; });
    var stars = Math.max(1, Math.min(3, Number(req.stars) || 2));
    bndWrite_(db, bndCheckKey_(p.round, sid), { sid: sid, round: p.round, post: task, ok: ok, stars: stars, at: Date.now() });
    // straight on to the next round
    p.task = null; p.words = null;
    if (p.round >= s.maxRounds) p.stage = 'done'; else { p.round += 1; p.stage = 'write'; }
    bndWrite_(db, bndPlayerKey_(sid), p);
    return bndStudentView_(db, sid);
  });
}

/* ---------- teacher actions ---------- */
function bndRelease_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    var p = bndPlayer_(db, String(req.sid));
    if (p) { p.device = ''; bndWrite_(db, bndPlayerKey_(String(req.sid)), p); }
    return bndTeacherState_(db);
  });
}

function bndFinish_(req) {
  return bndWithLock_(function (db) {
    var s = bndSession_(db);
    if (s && s.phase === 'open') { s.phase = 'final'; bndWrite_(db, 'session', s); }
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
  var sc = bndScores_(db);
  var rows = [['Student', 'Round', 'Word 1', 'Word 2', 'Post', 'Words', 'Passive', 'Auto', 'Peer', 'Stars', 'Front page', 'Score']];
  Object.keys(sc.posts).forEach(function (k) {
    var p = db.map[k], b = sc.posts[k];
    rows.push([bndLabel_(p.sid), p.round, p.words[0], p.words[1], p.text, b.count,
      b.passive ? 'yes' : 'no', b.autoPts, b.peerPts, b.stars, b.front ? 'yes' : '', b.total]);
  });
  rows.push([]);
  rows.push(['Student', 'Rounds filed', 'Fact-checks', 'Total', 'Rank']);
  sc.players.forEach(function (p) { rows.push([p.label, p.filed, p.checks, p.total, p.rank]); });
  return { ok: true, rows: rows };
}

/* ---------- scoring ----------
   Points for a filed post count at once; fact-check points arrive as other students check it;
   at Finish game, filed posts nobody checked get the benefit of the doubt. Each fact-check sent earns +1. */
function bndScores_(db) {
  var s = bndSession_(db);
  var R = BND_RULES;
  var final = s.phase === 'final';
  var checksByPost = {}, checkPts = {}, checkCount = {};
  db.order.forEach(function (k) {
    if (k.indexOf('check:') !== 0) return;
    var c = db.map[k];
    (checksByPost[c.post] = checksByPost[c.post] || []).push(c);
    checkPts[c.sid] = (checkPts[c.sid] || 0) + R.ptsCheck;
    checkCount[c.sid] = (checkCount[c.sid] || 0) + 1;
  });
  var posts = {}, ptsBy = {}, filedBy = {};
  db.order.forEach(function (k) {
    if (k.indexOf('post:') !== 0) return;
    var p = db.map[k];
    if (!p.filed) return;
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
    } else if (final) {
      peer = a.used.filter(Boolean).length * R.ptsPeerWord;
      stars = 2;
    }
    var front = !!s.front[k], spiked = !!s.spiked[k];
    var total = spiked ? 0 : a.autoPts + peer + stars + (front ? R.ptsFront : 0);
    posts[k] = { autoPts: a.autoPts, peerPts: peer, stars: stars, front: front, spiked: spiked, total: total,
      count: a.count, inRange: a.inRange, passive: a.passive, used: a.used, traps: a.traps.length, checks: checks.length };
    ptsBy[p.sid] = (ptsBy[p.sid] || 0) + total;
    filedBy[p.sid] = (filedBy[p.sid] || 0) + 1;
  });
  var players = bndPlayerIds_(db).map(function (sid) {
    var pl = bndPlayer_(db, sid);
    return { sid: sid, label: bndLabel_(sid), total: (ptsBy[sid] || 0) + (checkPts[sid] || 0), filed: filedBy[sid] || 0,
      checks: checkCount[sid] || 0, round: pl.round, stage: pl.stage, locked: !!pl.device };
  });
  var sorted = players.slice().sort(function (a, b) { return b.total - a.total; });
  players.forEach(function (p) { p.rank = 1 + sorted.filter(function (x) { return x.total > p.total; }).length; });
  return { posts: posts, players: players };
}

/* ---------- views ---------- */
function bndPublicSession_(s) {
  return { id: s.id, phase: s.phase, maxRounds: s.maxRounds, requirePassive: s.requirePassive };
}

function bndStudentState_(req) {
  var sid = String(req.sid || '');
  var db = bndRead_(true);
  if (req.draft !== undefined && req.draft !== null) {
    // piggy-backed autosave: only takes the lock when the text has changed
    var p0 = bndPlayer_(db, sid);
    var old = p0 && db.map[bndPostKey_(p0.round, sid)];
    if (p0 && p0.stage === 'write' && p0.words && (!old || old.text !== String(req.draft).slice(0, 2000))) {
      return bndWithLock_(function (db2) {
        bndSaveIn_(db2, sid, String(req.draft).slice(0, 2000), false);
        return bndStudentView_(db2, sid);
      });
    }
  }
  return bndStudentView_(db, sid);
}

function bndStudentView_(db, sid) {
  var s = bndSession_(db);
  var out = { ok: true, now: Date.now(), session: s ? bndPublicSession_(s) : null };
  if (!s) return out;
  var p = bndPlayer_(db, sid);
  out.joined = !!p;
  out.me = { sid: sid, label: bndLabel_(sid) };
  if (!p) return out;
  var sc = bndScores_(db);
  var me = sc.players.filter(function (x) { return x.sid === sid; })[0];
  out.me.total = me.total; out.me.rank = me.rank; out.me.filed = me.filed; out.me.checks = me.checks;
  out.playerCount = sc.players.length;
  out.round = p.round; out.stage = p.stage;
  out.words = p.words || null;
  var mine = db.map[bndPostKey_(p.round, sid)];
  out.draft = mine && !mine.filed ? mine.text : '';
  // her latest filed post and its score so far
  for (var r = p.round; r >= 1; r--) {
    var k = bndPostKey_(r, sid);
    if (db.map[k] && db.map[k].filed) { out.lastPost = { round: r, text: db.map[k].text, words: db.map[k].words, score: sc.posts[k] }; break; }
  }
  if (p.stage === 'check') {
    var tk = p.task;
    if (tk) {
      var post = tk.indexOf('sample:') === 0 ? bndSamplePost_(tk) : db.map[tk];
      out.task = { key: tk, text: post.text, words: post.words, sample: tk.indexOf('sample:') === 0 };
    }
  }
  out.front = bndFrontList_(db, s);
  return out;
}

function bndFrontList_(db, s) {
  return Object.keys(s.front).map(function (k) {
    var p = db.map[k];
    if (!p) return null;
    return { at: s.front[k], round: p.round, key: k, text: p.text, words: p.words, author: bndLabel_(p.sid) };
  }).filter(Boolean).sort(function (a, b) { return a.at - b.at; });
}

function bndTeacherState_(db) {
  var s = bndSession_(db);
  var out = { ok: true, now: Date.now(), session: s ? bndPublicSession_(s) : null, roster: bndRosterPublic_() };
  if (!s) return out;
  var sc = bndScores_(db);
  out.players = sc.players;
  out.posts = Object.keys(sc.posts).map(function (k) {
    var p = db.map[k];
    return { key: k, round: p.round, sid: p.sid, author: bndLabel_(p.sid), words: p.words, text: p.text, at: p.at, score: sc.posts[k] };
  });
  var c = { players: sc.players.length, filed: out.posts.length, checks: 0, writing: 0, checking: 0, done: 0 };
  db.order.forEach(function (k) { if (k.indexOf('check:') === 0) c.checks++; });
  sc.players.forEach(function (p) { if (p.stage === 'write') c.writing++; else if (p.stage === 'check') c.checking++; else c.done++; });
  out.counts = c;
  out.front = bndFrontList_(db, s);
  return out;
}
