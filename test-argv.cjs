const fs = require('fs');
fs.writeFileSync('/tmp/electron-argv.json', JSON.stringify({
  argv: process.argv,
  cwd: process.cwd(),
  execPath: process.execPath,
  type: process.type,
}, null, 2));
console.log('ARGV WRITTEN');
