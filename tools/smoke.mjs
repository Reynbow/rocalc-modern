// Smoke test for dist/: loads the calculator in headless Chrome and drives it
// through our interface the way a player would. Run before every deploy; a
// failure means the new rocalc release broke something, so don't ship.
//
//   node tools/smoke.mjs          (uses CHROME_PATH or the usual install paths)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from './serve.mjs';

const chromePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(p => p && fs.existsSync(p));
if (!chromePath) { console.error('No Chrome found. Set CHROME_PATH.'); process.exit(1); }

const server = await startServer(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-gpu', '--no-first-run'] });

const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'pass' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };
const wait = ms => new Promise(r => setTimeout(r, ms));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // A native dialog would block the page; our UI shows rocalc's alerts inline.
  page.on('dialog', d => { errors.push(`unexpected dialog: ${d.message().slice(0, 60)}`); d.dismiss().catch(() => {}); });

  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('.tabs .tab', { timeout: 20000 }).catch(() => {});

  // Helpers that run in the page. Mirrors carry the rocalc field name as their label.
  await page.evaluate(() => {
    window.__t = {
      sel: name => document.querySelector(`select[aria-label="${name}"]`),
      set(name, test) {
        const s = this.sel(name);
        if (!s) return null;
        const i = [...s.options].findIndex(o => test(o.text));
        if (i < 0) return null;
        s.selectedIndex = i;
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return s.options[i].text;
      },
      avg: () => document.querySelector('.damage .avg b')?.textContent.trim() || '',
      engine: () => document.getElementById('engine').contentDocument.forms.calcForm,
      tab: id => document.getElementById('tab-' + id).click(),
    };
  });

  const basics = await page.evaluate(() => ({
    tabs: document.querySelectorAll('.tabs .tab').length,
    loading: !!document.getElementById('loading'),
    jobs: __t.sel('A_JOB')?.options.length || 0,
    enemies: __t.sel('B_Enemy')?.options.length || 0,
    stats: document.querySelectorAll('.stats select').length,
    derived: document.querySelectorAll('.kv dt').length,
    release: document.querySelector('meta[name="rocalc-release"]')?.content,
  }));
  check(!basics.loading && basics.tabs >= 5, `interface built (${basics.tabs} tabs)`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(basics.release || ''), `release stamped (${basics.release})`);
  check(basics.jobs > 10, `class list mirrored (${basics.jobs})`);
  check(basics.enemies > 100, `monster list mirrored (${basics.enemies})`);
  check(basics.stats === 6, `six stat steppers (${basics.stats})`);
  check(basics.derived > 10, `derived stats listed (${basics.derived})`);

  // A Knight with a weapon has to hit for more than 1.
  const build = await page.evaluate(async () => {
    const r = {};
    r.job = __t.set('A_JOB', t => t === 'Knight');
    r.base = __t.set('A_BaseLV', t => t === '99');
    r.str = __t.set('A_STR', t => t === '90');
    __t.tab('equipment');
    await new Promise(x => setTimeout(x, 300));
    r.before = __t.avg();
    r.weapon = __t.set('A_weapon1', t => /[a-z]{3}/i.test(t) && !/^\(no/i.test(t));
    await new Promise(x => setTimeout(x, 300));
    r.after = __t.avg();
    r.engineWeapon = __t.engine().A_weapon1.selectedOptions[0]?.text;
    return r;
  });
  check(build.job === 'Knight' && build.str === '90', 'class and stats set through the mirrors');
  check(!!build.weapon && build.engineWeapon === build.weapon, `weapon reached rocalc (${build.weapon})`);
  const avgNum = parseFloat(String(build.after).replace(/[^\d.]/g, ''));
  check(avgNum > 1 && build.after !== build.before, `damage updated (${build.before} -> ${build.after})`);

  // The search list on the monster picker.
  const box = await page.evaluate(() => {
    const s = __t.sel('B_Enemy');
    s.scrollIntoView({ block: 'center' });
    const r = s.getBoundingClientRect();
    return { x: r.left + 10, y: r.top + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  const popOpen = await page.$('.pop input');
  check(!!popOpen, 'search list opens on the monster picker');
  if (popOpen) {
    const target = await page.evaluate(() => [...__t.sel('B_Enemy').options].map(o => o.text).find(t => /^[A-Z][a-z]{4,}/.test(t)) || '');
    await page.keyboard.type(target.slice(0, 6));
    const counts = await page.evaluate(() => ({ shown: document.querySelectorAll('.pop .opt').length, total: __t.sel('B_Enemy').options.length }));
    check(counts.shown > 0 && counts.shown < counts.total, `search filters (${counts.shown} of ${counts.total} for "${target.slice(0, 6)}")`);
    await page.keyboard.press('Enter');
    await wait(300);
    const picked = await page.evaluate(() => ({ ours: __t.sel('B_Enemy').selectedOptions[0]?.text, rocalc: __t.engine().B_Enemy.selectedOptions[0]?.text }));
    check(picked.ours === picked.rocalc && picked.ours?.startsWith(target.slice(0, 6)), `monster picked (${picked.ours})`);
  }

  // A buff group: open it, switch something on, the damage and the markers follow.
  const buff = await page.evaluate(async () => {
    __t.tab('buffs');
    await new Promise(x => setTimeout(x, 200));
    const group = [...document.querySelectorAll('#panel-buffs .disclose')][0];
    if (!group) return { err: 'no buff groups' };
    const before = document.querySelectorAll('#panel-buffs select').length;
    group.click();
    await new Promise(x => setTimeout(x, 300));
    const after = document.querySelectorAll('#panel-buffs select').length;
    const dmg0 = __t.avg();
    // The first new list with more than one setting.
    const s = [...document.querySelectorAll('#panel-buffs select')].slice(before).find(x => x.options.length > 1 && x.selectedIndex === 0);
    if (!s) return { err: 'no buff setting appeared', before, after };
    s.selectedIndex = s.options.length - 1;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(x => setTimeout(x, 300));
    return {
      opened: after > before,
      field: s.getAttribute('aria-label'),
      active: /Active/.test([...document.querySelectorAll('#panel-buffs .disclose')][0].textContent),
      dot: !document.querySelector('#tab-buffs .dot').hidden,
      dmg0, dmg1: __t.avg(),
    };
  });
  check(!buff.err && buff.opened, `buff group opens${buff.err ? ' (' + buff.err + ')' : ''}`);
  check(buff.active && buff.dot, `buff marked active (${buff.field})`);

  // Every tab draws something.
  const tabs = await page.evaluate(async () => {
    const out = [];
    for (const b of document.querySelectorAll('.tabs .tab')) {
      b.click();
      await new Promise(x => setTimeout(x, 150));
      const panel = document.getElementById(b.getAttribute('aria-controls'));
      out.push([b.textContent.trim(), panel.querySelectorAll('select, input, button, dd, .t').length]);
    }
    return out;
  });
  tabs.forEach(([name, n]) => check(n > 0, `tab "${name}" has content (${n})`));

  // Share links point at this page, not the hidden engine.
  const link = await page.evaluate(async () => {
    __t.tab('saves');
    await new Promise(x => setTimeout(x, 200));
    const btn = [...document.querySelectorAll('#panel-saves button')].find(b => /URL/i.test(b.textContent) && /save/i.test(b.textContent));
    if (!btn) return 'no save-as-link button';
    btn.click();
    await new Promise(x => setTimeout(x, 300));
    const box = [...document.querySelectorAll('#panel-saves input')].find(i => /#/.test(i.value));
    return box ? box.value : 'no link produced';
  });
  check(/#/.test(link) && !/engine\.html/.test(link), `share link (${link.slice(0, 60)}...)`);

  check(errors.length === 0, `no script errors${errors.length ? ': ' + errors.slice(0, 3).join(' / ') : ''}`);
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed. Don't deploy this build.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
