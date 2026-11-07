// Runs on rocalc.com from a bookmark. Collects the files the page is made of
// and downloads them as one rocalc-<release>.json for import-snapshot.mjs.
// Turn it into a bookmark with: npm run bookmarklet
(async () => {
  if (location.hostname.replace(/^www\./, '') !== 'rocalc.com') { alert('Open rocalc.com first, then click this bookmark.'); return; }
  if (!document.forms.calcForm) { alert('rocalc has not finished loading yet. Wait for the calculator to appear, then click again.'); return; }
  const path = u => { try { const x = new URL(u, location.href); return x.origin === location.origin ? x.pathname : null; } catch (e) { return null; } };
  const found = new Set(['/']);
  document.querySelectorAll('script[src], link[href], img[src]').forEach(e => { const p = path(e.src || e.href); if (p) found.add(p); });
  performance.getEntriesByType('resource').forEach(r => { const p = path(r.name); if (p) found.add(p); });
  // Images that only the stylesheet mentions.
  for (const s of document.styleSheets) {
    try { for (const r of s.cssRules) (r.cssText.match(/url\(["']?([^"')]+)/g) || []).forEach(m => { const p = path(new URL(m.replace(/^url\(["']?/, ''), s.href || location.href).href); if (p) found.add(p); }); } catch (e) {}
  }
  const wanted = [...found].filter(p => p === '/' || /\.(js|css|png|gif|jpe?g|svg|webp)$/i.test(p) && !p.includes('cdn-cgi'));
  const b64 = buf => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const files = {};
  for (const p of wanted) {
    try {
      const r = await fetch(p, { cache: 'no-store' });
      const buf = await r.arrayBuffer();
      files[p === '/' ? 'index.html' : p.replace(/^\//, '')] = { status: r.status, type: r.headers.get('content-type'), size: buf.byteLength, b64: b64(buf) };
    } catch (e) { /* a missing image is not worth failing over */ }
  }
  const html = files['index.html'] ? atob(files['index.html'].b64) : '';
  const release = (html.match(/_(\d{4}-\d{2}-\d{2})\.js/g) || []).map(m => m.slice(1, 11)).sort().pop() || new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify({ source: location.origin, fetched: new Date().toISOString(), files })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rocalc-${release}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  alert(`Saved rocalc release ${release} (${Object.keys(files).length} files). Now run: npm run sync`);
})();
