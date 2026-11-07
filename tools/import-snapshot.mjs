// Unpacks a rocalc snapshot (the JSON made by the bookmarklet in your Chrome)
// into upstream/<version>/ untouched, and points upstream/CURRENT at it.
//
//   node tools/import-snapshot.mjs [path-to-snapshot.json]
//
// With no path it takes the newest rocalc-*.json in your Downloads folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function newestSnapshot() {
  const dir = path.join(os.homedir(), 'Downloads');
  const hits = fs.readdirSync(dir)
    .filter(f => /^rocalc-.*\.json$/i.test(f))
    .map(f => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!hits.length) throw new Error(`No rocalc-*.json in ${dir}`);
  return hits[0];
}

const src = process.argv[2] ? path.resolve(process.argv[2]) : newestSnapshot();
const snap = JSON.parse(fs.readFileSync(src, 'utf8'));
if (!snap.files || !snap.files['index.html']) throw new Error('Not a rocalc snapshot: no index.html');

// Only keep what the page itself is made of; drop anything that failed.
const files = Object.entries(snap.files).filter(([name, f]) =>
  f.status === 200 && /^(index\.html|[\w.-]+\.(js|css)|images\/[\w.-]+\.(png|gif|jpe?g|svg|webp))$/i.test(name));

const html = Buffer.from(snap.files['index.html'].b64, 'base64').toString('utf8');
if (/One moment, please/i.test(html) && html.length < 20000) {
  throw new Error('Snapshot holds the bot-check page, not rocalc. Load rocalc.com fully, then run the bookmarklet again.');
}

// rocalc stamps its scripts with the release date: head_2026-04-06.js
const dates = [...html.matchAll(/_(\d{4}-\d{2}-\d{2})\.js/g)].map(m => m[1]).sort();
const version = dates.at(-1) || snap.fetched.slice(0, 10);

const dest = path.join(root, 'upstream', version);
const existed = fs.existsSync(dest);
fs.mkdirSync(dest, { recursive: true });
for (const [name, f] of files) {
  const out = path.resolve(dest, name);
  if (!out.startsWith(dest + path.sep)) throw new Error(`Bad path in snapshot: ${name}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(f.b64, 'base64'));
}
fs.writeFileSync(path.join(dest, 'snapshot.json'), JSON.stringify({
  source: snap.source, fetched: snap.fetched, files: Object.fromEntries(files.map(([n, f]) => [n, f.size])),
}, null, 2) + '\n');

const currentFile = path.join(root, 'upstream', 'CURRENT');
const previous = fs.existsSync(currentFile) ? fs.readFileSync(currentFile, 'utf8').trim() : null;
fs.writeFileSync(currentFile, version + '\n');

console.log(`${existed ? 'Refreshed' : 'Imported'} rocalc ${version} (${files.length} files) from ${src}`);
if (previous && previous !== version) console.log(`New upstream release: ${previous} -> ${version}`);
else if (previous === version) console.log('Same release as before.');
