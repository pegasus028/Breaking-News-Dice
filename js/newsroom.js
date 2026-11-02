/* Breaking News Dice — newsroom scaffolding for the student console (no points; browser only).
   - BND_PHRASEBANK: the "Anchor Desk Phrasebank" chips. Tapping a chip puts its text into the post.
   - BND_NEWS_PHRASES: 3 newsroom collocations per Unit 5 word, shown in the word's help sheet.
   - BND_MISSION: the "Reporter mission" self-check (B2 habits of real news writing), detected while typing.
   - BND_PACE: the optional 2-minute pace timer phases.
   Not used by the Apps Script backend, so editing this file needs no redeploy. Keep it ES5 (old iPads). */

var BND_PHRASEBANK = [
  { title: 'Break the news', chips: [
    { text: 'BREAKING: ' },
    { text: 'Dramatic scenes unfolded earlier today in ' },
    { text: 'Unconfirmed reports are emerging that ' }
  ] },
  { title: 'Distancing and passive reporting', note: 'Use these when you are not 100% sure: the report, not you, makes the claim.', chips: [
    { text: 'Eyewitnesses claim to have seen ' },
    { text: 'The flooding is believed to have been triggered by ' },
    { text: 'Local authorities are said to be investigating ' },
    { text: 'It is reported that ' },
    { text: 'According to officials, ' }
  ] },
  { title: 'Sources and twists', chips: [
    { text: 'Speaking from the scene, a spokesperson stated that ' },
    { text: 'In an unexpected turn of events, it was revealed that ' },
    { text: 'Nevertheless, ' },
    { text: 'Meanwhile, ' },
    { text: 'As a result, ' }
  ] },
  { title: 'Sign off', chips: [
    { text: 'We will bring you further updates as this developing story unfolds.' }
  ] },
  { title: 'Upgrade an everyday word', note: 'Tap to add the news word.', chips: [
    { label: 'big problem → major crisis', text: 'major crisis' },
    { label: 'very bad → severe', text: 'severe' },
    { label: 'people → residents', text: 'residents' },
    { label: 'help → assistance', text: 'assistance' },
    { label: 'everywhere → widespread', text: 'widespread' },
    { label: 'said → confirmed', text: 'confirmed' }
  ] }
];

var BND_NEWS_PHRASES = {
  'evacuate': ['were ordered to evacuate', 'a mass evacuation', 'evacuees were moved to shelters'],
  'submerged': ['left submerged', 'partially submerged', 'submerged under a metre of water'],
  'inundate': ['inundated with calls', 'inundated low-lying areas', 'widespread inundation'],
  'displaced': ['displaced residents', 'displaced by rising floodwater', 'thousands remain displaced'],
  'aftermath': ['in the immediate aftermath', 'the aftermath of the storm', 'deal with the aftermath'],
  'devastate': ['devastating floods', 'left devastated', 'the scale of the devastation'],
  'resilient': ['remarkably resilient', 'a resilient community', 'build resilience against floods'],
  'mitigate': ['mitigate the impact', 'flood mitigation measures', 'mitigate the risk of further damage'],
  'exacerbate': ['exacerbated by heavy rain', 'exacerbate the crisis', 'further exacerbating delays'],
  'prolonged': ['prolonged heavy rain', 'a prolonged power cut', 'prolonged exposure to floodwater'],
  'unprecedented': ['on an unprecedented scale', 'unprecedented water levels', 'an unprecedented emergency'],
  'discharge': ['discharged from the dam', 'increase the discharge', 'water is being discharged'],
  'relief': ['relief supplies', 'emergency relief efforts', 'a relief centre'],
  'subside': ['once the water subsides', 'floodwater began to subside', 'is expected to subside by Friday'],
  'trying-times': ['in these trying times', 'trying times for local farmers', 'support each other through trying times']
};

/* Is w a past participle? (-ed words and the irregular list in check.js) */
function bndIsPP(w) {
  w = String(w || '').toLowerCase();
  if (w === 'been') return true;
  if (BND_NOT_PP[w]) return false;
  if (BND_NO_PASSIVE[w] || w === 'fled') return true;   // risen, happened… are past participles, just never passive
  return (w.length > 3 && /ed$/.test(w)) || BND_IRREGULAR_PP.indexOf(w) >= 0;
}

/* Each test returns the phrase it found (truthy) or ''. */
var BND_MISSION = [
  { id: 'tense', label: 'Breaking-news tense: start with the latest news, not “Yesterday…”',
    eg: 'has risen · have been evacuated · are being moved',
    test: function (t) {
      var re = /\b(has|have|'s|'ve|is|are|am|'re)\s+((?:not|never|just|already|now|still|\w+ly)\s+)?([a-z'-]+)/gi, m;
      t = t.replace(/[’]/g, "'");
      while ((m = re.exec(t))) {
        var aux = m[1].toLowerCase(), w = m[3].toLowerCase();
        if (/^(has|have|'ve)$/.test(aux) && bndIsPP(w)) return m[0];
        if (/^(is|are|am|'re)$/.test(aux) && /ing$/.test(w) && w.length > 4) return m[0];
      }
      return '';
    } },
  { id: 'report', label: 'Reporting verb or distancing',
    eg: 'is said to · is believed to · according to · officials confirmed that',
    test: function (t) {
      var m = t.match(/\b(reportedly|allegedly|apparently|according to)\b/i) ||
        t.match(/\b(is|are|was|were|has been|have been)\s+(said|believed|reported|thought|feared|expected|estimated|alleged|understood|known|rumoured|rumored)\s+to\b/i) ||
        t.match(/\bit\s+(is|was|has been)\s+(said|believed|reported|thought|feared|expected|estimated|alleged|understood|confirmed|revealed|announced)\s+that\b/i) ||
        t.match(/\b(claim|claims|claimed|allege|alleges|alleged|state|states|stated|confirm|confirms|confirmed|announce|announces|announced|warn|warns|warned|insist|insists|insisted|report|reports|reported|reveal|reveals|revealed|deny|denies|denied|admit|admits|admitted|say|says|said|told\s+\w+)\s+(that|to)\b/i);
      return m ? m[0] : '';
    } },
  { id: 'pastperf', label: 'Past perfect for background (what happened before)',
    eg: 'had warned · had been evacuated · had already risen',
    test: function (t) {
      var re = /\bhad\s+((?:not|never|already|just|\w+ly)\s+)?([a-z'-]+)/gi, m;
      while ((m = re.exec(t))) { if (bndIsPP(m[2])) return m[0]; }
      return '';
    } },
  { id: 'connect', label: 'Connector upgrade for the twist',
    eg: 'nevertheless · consequently · meanwhile · despite · as a result',
    test: function (t) {
      var m = t.match(/\b(nevertheless|nonetheless|consequently|meanwhile|despite|in spite of|as a result|subsequently|moreover|furthermore|therefore)\b/i);
      return m ? m[0] : '';
    } }
];

/* Optional pace timer: 120 s in three phases (seconds left at which each phase starts). */
var BND_PACE = {
  seconds: 120,
  phases: [
    { from: 120, title: 'Phase 1 · The angle', text: 'Connect your two dice words: who, where and what happened?' },
    { from: 90, title: 'Phase 2 · The facts', text: 'Write your post: both words, at least 15 words, a passive.' },
    { from: 30, title: 'Phase 3 · Polish', text: 'Upgrade one everyday word (big problem → major crisis) and add a bonus structure.' }
  ]
};
