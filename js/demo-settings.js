/* Demo mode only: a made-up class (the real roster lives privately in Roster.gs), no teacher PIN,
   and "Simulate class" plays every name except the one you pick. */
var ROSTER = [
  ['1','Mint'],['2','Fern'],['3','Kaew'],['4','Ploy'],['5','Bow'],['6','Namtan'],['7','Praew'],['8','Mint'],
  ['9','Fah'],['10','Gift'],['11','Jaja'],['12','Kwan'],['13','Mook'],['14','Noon'],['15','Oil'],['16','Pang'],
  ['17','Ice'],['18','Bam'],['19','Cream'],['20','Dao'],['21','Earn'],['22','Faii'],['23','Ging'],['24','Hana']
].map(function (r) { return { sid: r[0], name: r[1] }; });
var TEACHER_PIN = '';
