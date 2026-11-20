'use strict';
// Lint sans dépendance : syntaxe de chaque fichier JS, cohérence d'action.yml.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
let bad = 0;
const files = ['src', 'test', 'scripts'].flatMap((d) =>
  fs.readdirSync(path.join(root, d)).filter((f) => /\.m?js$/.test(f)).map((f) => path.join(root, d, f)));
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error(r.stderr); }
}
const yml = fs.readFileSync(path.join(root, 'action.yml'), 'utf8');
for (const key of ['name:', 'description:', 'runs:', "using: 'node20'", "main: 'src/main.js'", 'branding:', 'icon:', 'color:']) {
  if (!yml.includes(key)) { bad++; console.error(`action.yml: missing ${key}`); }
}
const main = yml.match(/main: '([^']+)'/);
if (!main || !fs.existsSync(path.join(root, main[1]))) { bad++; console.error('action.yml: main file not found'); }
const desc = (yml.match(/^description: '(.*)'$/m) || [])[1] || '';
if (desc.length === 0 || desc.length > 125) { bad++; console.error(`action.yml: description must be 1-125 characters (${desc.length})`); }
if (yml.includes('\t')) { bad++; console.error('action.yml: tab character'); }
if (bad) process.exit(1);
console.log(`lint ok (${files.length} files)`);
