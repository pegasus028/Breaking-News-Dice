/* Breaking News Dice — automatic post checks.
   Shared by both consoles (live feedback while typing) and the Apps Script
   backend (the score that counts). Plain ES5-style functions, no DOM. */
var BND_RULES = {
  minWords: 15,
  maxWords: 25,
  ptsWord: 2,        // each dice word found (any listed form)
  ptsLength: 1,      // post is 15–25 words
  ptsPassive: 2,     // at least one passive (be/get + past participle)
  ptsPeerWord: 3,    // fact-checker agrees the word is used with the right meaning
  ptsFront: 5,       // teacher's Front Page pick
  ptsCheck: 1,       // each fact-check a student completes earns her 1
  ptsStructure: 1,   // bonus per kind of complex structure (max 3)
  maxStructure: 3,
  ptsExtraWord: 1,   // bonus per extra Unit 5 word beyond the two dice words (max 2)
  maxExtraWords: 2,
  ptsRichVocab: 1,   // bonus for 3+ long words (9+ letters) besides the dice words
  richMin: 3
};

/* Complex sentence structure: one bonus point per kind found. */
var BND_STRUCTURES = [
  { id: 'sub', label: 'subordinate clause (after, because, although, while \u2026)',
    re: /\b(after|before|while|although|though|because|since|unless|until|whereas|once|as soon as|even though|so that|even if)\b/i },
  { id: 'rel', label: 'relative clause (which, who, where, whose \u2026)',
    re: /\b(which|who|whom|whose|where)\b/i },
  { id: 'adv', label: 'advanced passive (has been / is being / must be / is thought to \u2026)',
    re: /\b((has|have|had)\s+been|(is|are|was|were)\s+being|(must|should|could|would|might|may|can|will)\s+(have\s+)?be(en)?|it\s+(is|was)\s+(said|thought|believed|reported|expected|feared|estimated)\s+that|(is|are|was|were)\s+(said|thought|believed|reported|expected|feared|estimated)\s+to\s+(be|have))\s+[a-z]+/i },
  { id: 'part', label: 'participle phrase (families displaced by \u2026 / Having \u2026)',
    re: /(\b(?!(?:am|is|are|was|were|be|been|being|has|have|had|get|got|gets)\b)[a-z]+\s+[a-z]+ed\s+by\b)|(^|[.!?;,]\s*)having\s+[a-z]+/i }
];

var BND_IRREGULAR_PP = ('arisen awoken beaten become begun bent bet bitten blown broken brought built burnt burned ' +
  'bought caught chosen come cost cut dealt done drawn driven drunk eaten fallen fed felt fought found flown ' +
  'forbidden forgotten forgiven frozen given gone grown hung had heard hidden hit held hurt kept known laid led ' +
  'left lent let lit lost made meant met paid put quit read rung ridden run said seen sought sold sent set shaken ' +
  'shown shut sung sunk sat slept slid spoken spent spread stood stolen stuck struck sworn swept swum taken taught ' +
  'torn told thought thrown understood upset woken worn won wound written withdrawn overtaken overrun undone').split(' ');

/* Verbs that cannot be passive. "be + one of these" is a classic error. */
var BND_NO_PASSIVE = {
  subsided: 'subside has no passive: write "the water subsided", not "was subsided".',
  happened: 'happen has no passive: write "it happened", not "was happened".',
  occurred: 'occur has no passive: write "it occurred", not "was occurred".',
  arrived: 'arrive has no passive: write "help arrived", not "was arrived".',
  died: 'die has no passive: write "the plants died", not "were died".',
  risen: 'rise has no passive: write "the river has risen", not "was risen".',
  disappeared: 'disappear has no passive: write "the road disappeared", not "was disappeared".',
  existed: 'exist has no passive: write "the problem existed", not "was existed".'
};

/* Words ending in -ed that are not past participles after "be". */
var BND_NOT_PP = { unprecedented: 1, red: 1, need: 1, bed: 1, speed: 1, indeed: 1, seed: 1, hundred: 1,
  naked: 1, wicked: 1, sacred: 1, shed: 1, feed: 1, weed: 1, greed: 1, deed: 1 };

function bndEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function bndWordRegex(id) {
  var w = BND_WORD_BY_ID[id];
  var alts = w.forms.slice().sort(function (a, b) { return b.length - a.length; })
    .map(function (f) { return bndEscape(f).replace(/ /g, '\\s+'); });
  return new RegExp('\\b(' + alts.join('|') + ')\\b', 'gi');
}

/* Every span of the given word ids in the text: [{start, end, id}] sorted. */
function bndFindSpans(text, ids) {
  var spans = [];
  (ids || []).forEach(function (id) {
    if (!BND_WORD_BY_ID[id]) return;
    var re = bndWordRegex(id), m;
    while ((m = re.exec(text))) spans.push({ start: m.index, end: m.index + m[0].length, id: id });
  });
  spans.sort(function (a, b) { return a.start - b.start; });
  return spans;
}

function bndCountWords(text) {
  var toks = String(text || '').trim().split(/\s+/);
  return toks.filter(function (t) { return /[A-Za-z0-9]/.test(t); }).length;
}

/* Passive finder: be/get (+ up to two adverbs or "being") + past participle. */
function bndPassives(text) {
  var src = String(text || '').toLowerCase().replace(/[’']/g, "'");
  var re = /\b(am|is|are|was|were|be|been|being|get|gets|got|gotten|getting|'re)\s+((?:(?:not|never|also|still|already|just|now|all|being|been|\w+ly)\s+){0,2})([a-z-]+)/g;
  var found = [], traps = [], m;
  while ((m = re.exec(src))) {
    var head = m[1], mid = m[2], pp = m[3];
    var phrase = (head + ' ' + mid + pp).replace(/\s+/g, ' ');
    if (BND_NO_PASSIVE[pp]) { traps.push({ phrase: phrase, msg: BND_NO_PASSIVE[pp] }); }
    else if (!BND_NOT_PP[pp] && ((pp.length > 3 && /ed$/.test(pp)) || BND_IRREGULAR_PP.indexOf(pp) >= 0)) {
      found.push(phrase);
    }
    // let "are being housed" match again starting at "being"
    re.lastIndex = m.index + head.length;
  }
  // de-duplicate overlapping finds ("are being housed" + "being housed")
  var uniq = [];
  found.forEach(function (p) {
    if (!uniq.some(function (u) { return u.indexOf(p) >= 0 || p.indexOf(u) >= 0; })) uniq.push(p);
  });
  var utraps = [];
  traps.forEach(function (t) { if (!utraps.some(function (u) { return u.msg === t.msg; })) utraps.push(t); });
  return { passives: uniq, traps: utraps };
}

/* The automatic part of a post's score. ids = the desk's two dice words. */
function bndAnalyse(text, ids) {
  text = String(text || '');
  var used = (ids || []).map(function (id) { return bndWordRegex(id).test(text); });
  var count = bndCountWords(text);
  var inRange = count >= BND_RULES.minWords && count <= BND_RULES.maxWords;
  var p = bndPassives(text);
  var passive = p.passives.length > 0;
  var R = BND_RULES;
  // bonus: complex structure
  var structures = BND_STRUCTURES.filter(function (st) { return st.re.test(text); }).map(function (st) { return st.id; });
  var structPts = Math.min(R.maxStructure, structures.length * R.ptsStructure);
  // bonus: vocabulary (extra Unit 5 words; several long words)
  var extra = BND_WORDS.map(function (w) { return w.id; }).filter(function (id) {
    return (ids || []).indexOf(id) < 0 && bndWordRegex(id).test(text);
  });
  // long words that are not Unit 5 words (those already score on their own)
  var unitSpans = bndFindSpans(text, BND_WORDS.map(function (w) { return w.id; }));
  var longWords = [];
  var re = /[A-Za-z][A-Za-z'-]{8,}/g, m;
  while ((m = re.exec(text))) {
    var st0 = m.index, lw = m[0].toLowerCase();
    var isUnit = unitSpans.some(function (sp) { return st0 >= sp.start && st0 < sp.end; });
    if (!isUnit && longWords.indexOf(lw) < 0) longWords.push(lw);
  }
  var extraPts = Math.min(R.maxExtraWords, extra.length * R.ptsExtraWord);
  var richPts = longWords.length >= R.richMin ? R.ptsRichVocab : 0;
  var pts = used.filter(Boolean).length * R.ptsWord +
    (inRange ? R.ptsLength : 0) + (passive ? R.ptsPassive : 0) + structPts + extraPts + richPts;
  return { used: used, count: count, inRange: inRange, passive: passive,
    passives: p.passives, traps: p.traps, structures: structures, structPts: structPts,
    extraWords: extra, extraPts: extraPts, longWords: longWords, richPts: richPts, autoPts: pts };
}
