// Gecerli surum numarasini yazar (bat dosyasi kullanir): node surum.js  ->  v6
const list = require('./surumler.json');
console.log('v' + Math.max(...list.map((x) => x.v)));
