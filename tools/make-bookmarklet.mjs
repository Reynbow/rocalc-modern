// Prints tools/bookmarklet.src.js as a javascript: link to paste into a
// bookmark's address field, and writes it to bookmarklet.txt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'bookmarklet.src.js'), 'utf8')
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
  .replace(/\s*\n\s*/g, ' ').trim();
const link = 'javascript:' + encodeURIComponent(src);
fs.writeFileSync(path.join(here, '..', 'bookmarklet.txt'), link + '\n');
console.log(link);
console.log('\nAlso written to bookmarklet.txt. Make a bookmark in Chrome and paste this as its URL.');
