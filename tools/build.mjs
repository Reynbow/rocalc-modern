// Builds dist/ from the current upstream release plus our app.
//
//   dist/engine.html  rocalc's own page, untouched apart from link fixes.
//                     It runs in a hidden frame and does all the maths.
//   dist/index.html   our interface, which drives the engine's form.
//
// rocalc's scripts, stylesheet and images are copied byte for byte.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = fs.readFileSync(path.join(root, 'upstream', 'CURRENT'), 'utf8').trim();
const src = path.join(root, 'upstream', version);
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(src, dist, { recursive: true, filter: f => path.basename(f) !== 'snapshot.json' });

// ---- engine.html ----
let engine = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
fs.rmSync(path.join(dist, 'index.html'));
const problems = [];
if (!/<form name="calcForm"/i.test(engine)) problems.push('<form name="calcForm">');
engine = engine.replace(/<head>/i, `<head>\n<meta name="robots" content="noindex">`);
// Relative links to pages that aren't part of the mirror go to rocalc.com.
engine = engine.replace(/href=(["'])(?!https?:|#|mailto:|javascript:)([^"']+\.html?)\1/gi, (m, q, href) =>
  fs.existsSync(path.join(dist, href)) ? m : `href=${q}https://rocalc.com/${href}${q}`);
fs.writeFileSync(path.join(dist, 'engine.html'), engine);

// ---- our app ----
fs.cpSync(path.join(root, 'app'), dist, { recursive: true });
const appIndex = path.join(dist, 'index.html');
fs.writeFileSync(appIndex, fs.readFileSync(appIndex, 'utf8').replaceAll('{{RELEASE}}', version));

if (problems.length) {
  console.error(`rocalc's page is missing: ${problems.join(', ')}. It probably changed its layout; check before deploying.`);
  process.exit(1);
}
console.log(`Built dist/ from rocalc ${version}`);
