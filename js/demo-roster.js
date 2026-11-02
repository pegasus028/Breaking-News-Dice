/* Demo mode only: a made-up class of 24 so the demo never shows real students.
   The real roster lives in Roster.gs inside the Apps Script project. */
var ROSTER = [
  ['1','Mint',1],['2','Fern',2],['3','Kaew',3],['4','Ploy',4],['5','Bow',1],['6','Namtan',2],
  ['7','Praew',3],['8','Mint',4],['9','Fah',1],['10','Gift',2],['11','Jaja',3],['12','Kwan',4],
  ['13','Mook',1],['14','Noon',2],['15','Oil',3],['16','Pang',4],['17','Ice',1],['18','Bam',2],
  ['19','Cream',3],['20','Dao',4],['21','Earn',1],['22','Faii',2],['23','Ging',3],['24','Hana',4]
].map(function (r) { return { sid: r[0], name: r[1], band: r[2] }; });
var TEACHER_PIN = '';
