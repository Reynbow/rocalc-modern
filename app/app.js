// RO Classic + calculator.
//
// rocalc runs untouched in a hidden frame (engine.html). This page never
// calculates anything: every control here is a mirror of one of rocalc's
// form fields. Changing a mirror sets the real field and fires its event, so
// rocalc's own handlers run; after that every mirror and readout is refreshed
// from rocalc's page. Parts we have no hand-made layout for are drawn by a
// generic renderer straight from rocalc's markup, so fields a new rocalc
// release adds still show up.
(function () {
  'use strict';

  // Everything we draw lives in a shadow root on #app, so the page around it
  // (the roclassicplus.com theme, Bootstrap) can't restyle it and it can't
  // restyle the page. Files are found next to this script, so the same code
  // runs from /calc/ on the website and from dist/ on its own.
  var host = document.getElementById('app');
  var BASE = new URL('.', (document.currentScript && document.currentScript.src) || location.href).href;
  var RELEASE = host.getAttribute('data-release') || '';
  var shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<link rel="stylesheet" href="' + BASE + 'calc.css?v=' + encodeURIComponent(RELEASE) + '">' +
    '<div class="root"><p class="loading" id="loading">Loading the calculator...</p></div>';
  var app = shadow.querySelector('.root');

  // rocalc itself, out of sight. It does every calculation.
  var frame = document.createElement('iframe');
  frame.title = 'rocalc engine';
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:absolute; left:-12000px; top:0; width:1400px; height:900px; border:0; visibility:hidden;';
  var EW, ED, form;

  // ---------------------------------------------------------------- utils

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'className') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function svg(path) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = path;
    return s;
  }
  var ICON = { chevron: '<path d="M6 3l5 5-5 5"/>', minus: '<path d="M3.5 8h9"/>', plus: '<path d="M8 3.5v9M3.5 8h9"/>' };
  function clean(t) { return (t || '').replace(/\s+/g, ' ').trim(); }
  var ids = new WeakMap(), nextId = 1;
  function oid(o) { if (!ids.has(o)) ids.set(o, nextId++); return ids.get(o); }

  // ---------------------------------------------------------------- engine access

  function eng(name) {
    var e = form.elements[name];
    if (e && !e.tagName && e.length) e = e[0];
    return e || ED.getElementById(name);
  }
  function byId(id) { return ED.getElementById(id); }
  function shown(e) {
    if (!e || !e.isConnected) return false;
    if (!e.getClientRects().length) return false;
    return EW.getComputedStyle(e).visibility !== 'hidden';
  }
  function fire(e, type) { e.dispatchEvent(new EW.Event(type, { bubbles: true })); }
  function section(re) {
    var hs = ED.querySelectorAll('h3');
    for (var i = 0; i < hs.length; i++) if (re.test(hs[i].textContent)) return hs[i].nextElementSibling;
    return null;
  }
  // rocalc builds share links from its own (engine) address; people should
  // get this page with the same #fragment.
  function ourUrl(v) {
    var s = String(v || ''), i = s.indexOf('#');
    return i < 0 ? s : location.href.split('#')[0] + s.slice(i);
  }

  // Inline colours carry meaning in rocalc (over weight in red and so on).
  var colourCache = {};
  function colourClass(c) {
    if (!c) return '';
    if (c in colourCache) return colourCache[c];
    var p = document.createElement('i');
    p.style.color = c;
    var m = (p.style.color || '').match(/(\d+),\s*(\d+),\s*(\d+)/);
    var out = '';
    if (m) {
      var r = m[1] / 255, g = m[2] / 255, b = m[3] / 255;
      var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, hue = 0;
      if (d > 0.18 && max > 0.25) {
        if (max === r) hue = ((g - b) / d + 6) % 6; else if (max === g) hue = (b - r) / d + 2; else hue = (r - g) / d + 4;
        hue *= 60;
        if (hue < 25 || hue >= 330) out = 'c-danger';
        else if (hue < 70) out = 'c-gold';
        else if (hue < 170) out = 'c-success';
        else if (hue < 270) out = 'c-accent';
      }
    }
    colourCache[c] = out;
    return out;
  }

  // ---------------------------------------------------------------- mirrors

  var mirrors = new Map();   // key -> mirror
  var afterAction = [];

  function mirrorKey(e) { return e.name ? 'n:' + e.name : e.id ? 'i:' + e.id : 'o:' + oid(e); }

  // A mirror for a field we know by name; it follows the field if rocalc
  // replaces it (it rebuilds some selects with innerHTML).
  function P(name, opts) {
    var e = eng(name);
    var m = mirrors.get('n:' + name) || mirrors.get('i:' + name);
    if (!m) m = makeMirror(e, name);
    if (opts && opts.className) m.node.classList.add.apply(m.node.classList, opts.className.split(' '));
    m.curated = true;
    return m.node;
  }

  function mirrorFor(e) {
    var m = mirrors.get(mirrorKey(e));
    if (m) { if (m.eng !== e) m.eng = e; return m; }
    return makeMirror(e, e.name || null);
  }

  function makeMirror(e, name) {
    var m = { eng: e, name: name, node: null, sig: '' };
    var tag = e ? e.tagName : 'SELECT';
    var type = e && e.type;
    if (tag === 'SELECT') {
      m.kind = 'select';
      m.node = h('select', { 'aria-label': name || 'option', onchange: function () {
        var x = cur(m); if (!x) return;
        x.selectedIndex = m.node.selectedIndex;
        act(x, 'change');
      } });
    } else if (tag === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
      m.kind = 'check';
      m.node = h('input', { type: 'checkbox', onchange: function () {
        var x = cur(m); if (!x) return;
        act(x, 'click');
      } });
    } else if ((tag === 'INPUT' && (type === 'button' || type === 'submit')) || tag === 'BUTTON') {
      m.kind = 'button';
      m.node = h('button', { type: 'button', className: 'btn', onclick: function () {
        var x = cur(m); if (!x) return;
        act(x, 'click');
        if (/URLOUT/.test(x.getAttribute('onclick') || '')) copyShareLink();
      } });
    } else {
      m.kind = 'text';
      m.node = h(tag === 'TEXTAREA' ? 'textarea' : 'input', { type: tag === 'TEXTAREA' ? null : 'text',
        oninput: function () { var x = cur(m); if (!x) return; x.value = m.node.value; fire(x, 'input'); fire(x, 'keyup'); schedule(); },
        onchange: function () { var x = cur(m); if (!x) return; x.value = m.node.value; act(x, 'change'); },
      });
    }
    mirrors.set(e ? mirrorKey(e) : 'n:' + name, m);
    syncMirror(m);
    return m;
  }

  function cur(m) {
    if (m.name) {
      var e = eng(m.name);
      if (e && e !== m.eng) { m.eng = e; m.sig = ''; }
    }
    return m.eng && m.eng.isConnected ? m.eng : null;
  }

  // Run one of rocalc's events, then refresh everything at once.
  function act(x, type) {
    try {
      if (type === 'click') x.click(); else fire(x, type);
    } catch (err) {
      console.error('rocalc error', err);
    }
    update();
  }

  function syncMirror(m) {
    var e = cur(m), n = m.node;
    if (!e) { n.hidden = true; return; }
    if (m.curated) n.hidden = !shown(e);
    if (m.kind === 'select') {
      var sig = e.options.length + '\u0002' + e.innerHTML.length + '\u0002' + (e.options.length ? e.options[0].text + e.options[e.options.length - 1].text : '');
      if (sig !== m.sig) { n.innerHTML = e.innerHTML; m.sig = sig; m.wordy = null; }
      if (n.selectedIndex !== e.selectedIndex) n.selectedIndex = e.selectedIndex;
      n.disabled = e.disabled;
      n.classList.toggle('searchable', isSearchable(m));
      if (e.title) n.title = e.title;
    } else if (m.kind === 'check') {
      n.checked = e.checked; n.disabled = e.disabled;
    } else if (m.kind === 'button') {
      var label = e.tagName === 'BUTTON' ? textWithoutTips(e) : e.value;
      if (n.textContent !== label) n.textContent = label;
      n.disabled = e.disabled;
      var tip = e.querySelector && e.querySelector('.nametext');
      if (tip) n.title = clean(tip.textContent);
    } else {
      if (shadow.activeElement !== n) n.value = e.name === 'URL_TEXT' ? ourUrl(e.value) : e.value;
      n.placeholder = e.placeholder || '';
      n.disabled = e.disabled;
      n.readOnly = e.readOnly;
    }
  }

  function textWithoutTips(e) {
    var c = e.cloneNode(true);
    c.querySelectorAll('.nametext').forEach(function (t) { t.remove(); });
    return clean(c.textContent);
  }

  function copyShareLink() {
    var v = ourUrl((eng('URL_TEXT') || {}).value);
    if (!v) return;
    if (navigator.clipboard) navigator.clipboard.writeText(v).catch(function () {});
    // Like rocalc: the address bar now holds the character, ready to bookmark.
    var hash = v.indexOf('#') >= 0 ? v.slice(v.indexOf('#')) : '';
    if (hash) history.replaceState(null, '', hash);
  }

  // rocalc's alert() messages, shown in the page instead of a blocking box.
  // They are written in English, then Spanish; we show the English part.
  var toastTimer = null;
  function toast(msg) {
    var box = shadow.getElementById('toast');
    if (!box) { box = h('div', { id: 'toast', className: 'toast', role: 'status' }); shadow.appendChild(box); }
    box.textContent = String(msg).split(/\n\s*\n/)[0].trim();
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.hidden = true; }, 6000);
  }

  // ---------------------------------------------------------------- text readouts

  var readouts = [];
  // Live text of one of rocalc's elements, keeping its colour meaning.
  function T(id, opts) {
    var span = h('span', { className: (opts && opts.className) || null });
    readouts.push({ id: id, node: span, fmt: opts && opts.fmt, empty: opts && 'empty' in opts ? opts.empty : '-' });
    return span;
  }
  function syncReadout(r) {
    var e = byId(r.id);
    var t = e ? clean(e.textContent) : '';
    if (r.fmt) t = r.fmt(t);
    t = t || r.empty;
    if (r.node.textContent !== t) r.node.textContent = t;
    var coloured = e && (e.querySelector('[style*="color"], font[color]') || (e.style && e.style.color ? e : null));
    var cls = coloured ? colourClass(coloured.style.color || coloured.getAttribute('color')) : '';
    r.node.classList.remove('c-danger', 'c-success', 'c-accent', 'c-gold');
    if (cls) r.node.classList.add(cls);
  }

  // ---------------------------------------------------------------- label/value lists

  // Pairs from a rocalc table: a td.right label followed by its value cell.
  var lists = [];
  function KV(getTable, opts) {
    opts = opts || {};
    var dl = h('dl', { className: 'kv' + (opts.one ? ' kv--one' : '') });
    lists.push({ get: getTable, node: dl, opts: opts, sig: '' });
    return dl;
  }
  function pairsOf(table, opts) {
    var out = [];
    if (!table) return out;
    var rows = table.rows;
    var on = !opts.from;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (opts.from && row.querySelector(opts.from)) on = true;
      if (opts.until && row.querySelector(opts.until)) on = false;
      if (!on || !shown(row)) continue;
      var cells = row.cells;
      for (var j = 0; j < cells.length - 1; j++) {
        var lab = cells[j];
        if (!lab.classList.contains('right')) continue;
        var val = cells[j + 1];
        var k = textWithoutTips(lab), v = textWithoutTips(val);
        if (!k || (opts.skip && opts.skip(val, k))) continue;
        var coloured = val.querySelector('[style*="color"], font[color]');
        var tip = val.querySelector('.nametext');
        out.push({ k: k, v: v || '-', tip: tip ? clean(tip.textContent) : '', c: coloured ? colourClass(coloured.style.color || coloured.getAttribute('color')) : '' });
      }
    }
    return out;
  }
  function syncList(l) {
    var pairs = pairsOf(l.get(), l.opts);
    var sig = pairs.map(function (p) { return p.k; }).join('|');
    if (sig !== l.sig) {
      l.node.textContent = '';
      pairs.forEach(function () { l.node.appendChild(h('div', null, [h('dt'), h('dd')])); });
      l.sig = sig;
    }
    var items = l.node.children;
    pairs.forEach(function (p, i) {
      var dt = items[i].firstChild, dd = items[i].lastChild;
      if (dt.textContent !== p.k) dt.textContent = p.k;
      if (dd.textContent !== p.v) dd.textContent = p.v;
      dd.className = p.c + (p.tip ? ' tip' : '');
      if (p.tip) dd.title = p.tip; else dd.removeAttribute('title');
    });
  }

  // ---------------------------------------------------------------- generic renderer

  var projections = [];
  // Draws a part of rocalc's page as rows of labels and mirrors.
  function G(getRoot, opts) {
    opts = opts || {};
    var node = h('div', { className: 'proj' + (opts.inline ? ' proj--inline' : '') });
    projections.push({ get: typeof getRoot === 'function' ? getRoot : function () { return getRoot; }, node: node, opts: opts, sig: null, texts: [] });
    return node;
  }

  var BLOCK = /^(TR|TABLE|TBODY|THEAD|DIV|P|H[1-6]|UL|OL|LI|CENTER|FORM)$/;
  var SKIP = /^(SCRIPT|STYLE|OPTION|OPTGROUP|IMG|NOSCRIPT)$/;

  function flatten(root, opts) {
    var lines = [], cur = [], table = null;
    function nl() { if (cur.length) { cur.table = table; lines.push(cur); } cur = []; }
    function walk(n, ctx) {
      if (n.nodeType === 3) {
        var v = n.data.replace(/\s+/g, ' ');
        if (v.trim()) cur.push({ k: 't', v: v, b: ctx.b, s: ctx.s, c: ctx.c, head: ctx.head });
        return;
      }
      if (n.nodeType !== 1) return;
      var tag = n.tagName;
      if (SKIP.test(tag)) return;
      if (tag === 'BR') { nl(); return; }
      if (opts.skip && opts.skip(n)) return;
      if (n !== root && !shown(n)) return;
      if (tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON' || (tag === 'INPUT' && n.type !== 'hidden')) {
        cur.push({ k: 'ctl', el: n, head: ctx.head });
        return;
      }
      if (n.classList.contains('nametext')) {
        var last = cur[cur.length - 1];
        if (last && last.k === 't') last.tip = clean(n.textContent);
        return;
      }
      if (tag === 'A') { cur.push({ k: 'a', href: n.getAttribute('href') || '', v: clean(n.textContent) }); return; }
      if (n.getAttribute('onclick') && !n.querySelector('select,input,button,textarea')) {
        cur.push({ k: 'act', el: n, v: textWithoutTips(n), block: /^(TD|TH)$/.test(tag) || n.classList.contains('subheader') });
        return;
      }
      var head = n.classList.contains('subheader') || tag === 'TH';
      var block = BLOCK.test(tag) || head;
      if (block) nl();
      var colour = n.style && n.style.color && !n.classList.contains('main') ? n.style.color : (tag === 'FONT' && n.getAttribute('color')) || ctx.c;
      var c2 = { b: ctx.b || tag === 'B' || tag === 'STRONG', s: ctx.s || tag === 'S' || tag === 'STRIKE', c: colour, head: ctx.head || head };
      var outer = table;
      if (tag === 'TABLE') table = n;
      for (var ch = n.firstChild; ch; ch = ch.nextSibling) walk(ch, c2);
      if (tag === 'TD' || tag === 'TH') cur.push({ k: 'gap' });
      if (block) nl();
      if (tag === 'TABLE') table = outer;
    }
    if (root) walk(root, { b: false, s: false, c: '', head: false });
    nl();
    // Drop empty lines and stray gaps.
    return lines.map(function (l) {
      var out = [];
      l.forEach(function (t) {
        if (t.k === 'gap' && (!out.length || out[out.length - 1].k === 'gap')) return;
        out.push(t);
      });
      while (out.length && out[out.length - 1].k === 'gap') out.pop();
      out.table = l.table;
      out.cells = 1 + out.filter(function (t) { return t.k === 'gap'; }).length;
      return out;
    }).filter(function (l) { return l.some(function (t) { return t.k !== 'gap'; }); });
  }

  function actLabel(v) {
    var on = /\[active\]/i.test(v);
    var state = /click to hide\)/i.test(v) ? 'open' : /click to show\)/i.test(v) ? 'closed' : '';
    var label = clean(v.replace(/\[active\]/ig, '').replace(/\((click to )?(show|hide)[^)]*\)/ig, ''));
    return { on: on, state: state, label: label };
  }

  function syncProjection(p) {
    var root = p.get();
    var lines = flatten(root, p.opts);
    var sig = lines.map(function (l) {
      return (l.table ? oid(l.table) : '') + ':' + l.map(function (t) { return t.k + (t.el ? oid(t.el) : ''); }).join(',');
    }).join('|');
    if (sig !== p.sig) {
      buildProjection(p, lines);
      p.sig = sig;
    } else {
      patchProjection(p, lines);
    }
  }

  function buildProjection(p, lines) {
    var keepFocus = shadow.activeElement;
    p.node.textContent = '';
    p.texts = [];
    // Rows of one rocalc table with the same number of cells share a grid,
    // so its columns stay lined up.
    var grid = null, gridKey = null;
    lines.forEach(function (line) {
      var isHead = line.some(function (t) { return t.head; }) && !line.some(function (t) { return t.k === 'act'; });
      var useGrid = line.table && line.cells > 1 && !line.some(function (t) { return t.k === 'act' && t.block; });
      var key = useGrid ? oid(line.table) + ':' + line.cells : null;
      var row, cell;
      if (useGrid) {
        if (key !== gridKey) {
          grid = h('div', { className: 'grid' });
          grid.style.gridTemplateColumns = 'repeat(' + line.cells + ', minmax(0, max-content))';
          p.node.appendChild(grid);
          gridKey = key;
        }
        row = grid;
        cell = h('div', { className: 'cell' + (isHead ? ' cell--head' : '') });
        row.appendChild(cell);
      } else {
        grid = gridKey = null;
        row = h('div', { className: 'row' + (isHead ? ' row--head' : '') });
        cell = row;
      }
      line.forEach(function (t) {
        var n;
        if (t.k === 't') { n = h('span'); p.texts.push(n); }
        else if (t.k === 'gap') {
          if (useGrid) { cell = h('div', { className: 'cell' + (isHead ? ' cell--head' : '') }); row.appendChild(cell); return; }
          n = h('span', { className: 'gap' });
        }
        else if (t.k === 'a') {
          n = h('a', { href: new URL(t.href, ED.baseURI).href, target: '_blank', rel: 'noopener' });
          p.texts.push(n);
        } else if (t.k === 'act') {
          (function (el) {
            n = t.block
              ? h('button', { type: 'button', className: 'disclose', onclick: function () { act(el, 'click'); } })
              : h('button', { type: 'button', className: 'btn', onclick: function () { act(el, 'click'); } });
          })(t.el);
          p.texts.push(n);
        } else if (t.k === 'ctl') {
          var m = mirrorFor(t.el);
          syncMirror(m);
          n = m.node;
          if (m.kind === 'check') {
            // A checkbox and the text after it make one clickable label.
            n = h('label', { className: 'check' }, [m.node]);
            m.labelFor = n;
          }
        }
        if (n) cell.appendChild(n);
      });
      if (!useGrid) p.node.appendChild(row);
    });
    patchProjection(p, lines);
    if (keepFocus && keepFocus !== shadow.activeElement && shadow.contains(keepFocus)) keepFocus.focus();
  }

  function patchProjection(p, lines) {
    var i = 0;
    lines.forEach(function (line) {
      line.forEach(function (t) {
        if (t.k === 't') {
          var n = p.texts[i++];
          var v = t.v;
          if (n.textContent !== v) n.textContent = v;
          var cls = 't' + (t.b || t.head ? ' t--b' : '') + (t.s ? ' t--strike' : '') + (t.c ? ' ' + colourClass(t.c) : '') + (t.tip ? ' tip' : '');
          if (n.className !== cls) n.className = cls;
          if (t.tip) n.title = t.tip; else n.removeAttribute('title');
        } else if (t.k === 'a') {
          var a = p.texts[i++];
          if (a.textContent !== t.v) a.textContent = t.v;
        } else if (t.k === 'act') {
          var b = p.texts[i++];
          var s = actLabel(t.v);
          var key = s.label + '|' + s.on + '|' + s.state;
          if (b.dataset.key !== key) {
            b.dataset.key = key;
            b.textContent = '';
            if (b.classList.contains('disclose')) {
              if (s.state) { b.appendChild(svg(ICON.chevron)); b.setAttribute('aria-expanded', String(s.state === 'open')); }
              else b.removeAttribute('aria-expanded');
            }
            b.appendChild(document.createTextNode(s.label || 'Show'));
            if (s.on) b.appendChild(h('span', { className: 'on', text: 'Active' }));
          }
        } else if (t.k === 'ctl') {
          syncMirror(mirrorFor(t.el));
        }
      });
    });
  }

  // ---------------------------------------------------------------- refresh loop

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; update(); });
  }
  var refreshers = [];
  function update() {
    if (!form) return;
    mirrors.forEach(function (m) { if (m.curated) syncMirror(m); });
    readouts.forEach(syncReadout);
    lists.forEach(syncList);
    projections.forEach(syncProjection);
    refreshers.forEach(function (f) { f(); });
  }

  // ---------------------------------------------------------------- search list

  var MIN_OPTIONS = 30;
  function isSearchable(m) {
    var s = m.node;
    if (m.kind !== 'select' || s.disabled || s.options.length < MIN_OPTIONS) return false;
    if (m.wordy == null) {
      var words = 0;
      for (var i = 0; i < s.options.length; i++) if (/[a-z]{2}/i.test(s.options[i].text)) words++;
      m.wordy = words > s.options.length / 2;
    }
    return m.wordy;
  }
  var pop = null;
  shadow.addEventListener('mousedown', function (e) {
    var s = e.target.closest && e.target.closest('select.searchable');
    if (!s || e.button !== 0) return;
    e.preventDefault();
    s.focus();
    if (pop && pop.select === s) closePop(); else openPop(s, '');
  }, true);
  shadow.addEventListener('keydown', function (e) {
    var s = e.target;
    if (pop || !s.classList || !s.classList.contains('searchable') || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown')) { e.preventDefault(); openPop(s, ''); }
    else if (e.key.length === 1 && !e.altKey && /\S/.test(e.key)) { e.preventDefault(); openPop(s, e.key); }
  }, true);

  function esc(t) { return t.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function openPop(select, query) {
    closePop();
    var input = h('input', { type: 'search', placeholder: 'Type to search', 'aria-label': 'Search the list', autocomplete: 'off', spellcheck: 'false' });
    var count = h('div', { className: 'count' });
    var list = h('div', { className: 'list', role: 'listbox' });
    var box = h('div', { className: 'pop' }, [input, count, list]);
    shadow.appendChild(box);
    // Fixed to the viewport; it closes when the page scrolls.
    var r = select.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var width = Math.min(Math.max(r.width, 300), vw - 16);
    box.style.width = width + 'px';
    box.style.left = Math.max(8, Math.min(r.left, vw - width - 8)) + 'px';
    var below = window.innerHeight - r.bottom;
    if (below < 280 && r.top > below) { box.style.top = (r.top - 4) + 'px'; box.style.transform = 'translateY(-100%)'; }
    else box.style.top = (r.bottom + 4) + 'px';

    var all = [].map.call(select.options, function (o, i) {
      var g = o.parentNode && o.parentNode.tagName === 'OPTGROUP' ? o.parentNode.label : '';
      return { i: i, text: o.text, low: o.text.toLowerCase(), group: g, disabled: o.disabled };
    });
    var shownOpts = [], hi = 0;
    function render() {
      var words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      shownOpts = all.filter(function (o) { return !o.disabled && words.every(function (w) { return o.low.indexOf(w) !== -1; }); });
      var html = '', lastGroup = null;
      shownOpts.forEach(function (o, n) {
        if (o.group !== lastGroup) { if (o.group) html += '<div class="group">' + esc(o.group) + '</div>'; lastGroup = o.group; }
        var label = esc(o.text);
        words.forEach(function (w) {
          label = label.replace(new RegExp('(' + esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<]*>)', 'gi'), '<mark>$1</mark>');
        });
        html += '<div class="opt' + (o.i === select.selectedIndex ? ' is-current' : '') + '" role="option" data-n="' + n + '">' + label + '</div>';
      });
      list.innerHTML = html || '<div class="empty">Nothing matches "' + esc(input.value.trim()) + '"</div>';
      count.textContent = words.length ? shownOpts.length + ' of ' + all.length : all.length + ' to choose from';
      var curIdx = shownOpts.findIndex(function (o) { return o.i === select.selectedIndex; });
      hi = words.length ? 0 : Math.max(0, curIdx);
      paint(true);
    }
    function paint(scroll) {
      var opts = list.querySelectorAll('.opt');
      opts.forEach(function (d, n) { d.classList.toggle('is-hi', n === hi); });
      if (scroll && opts[hi]) opts[hi].scrollIntoView({ block: 'nearest' });
    }
    function pick(n) {
      var o = shownOpts[n];
      closePop();
      select.focus();
      if (!o || o.i === select.selectedIndex) return;
      select.selectedIndex = o.i;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    input.addEventListener('input', render);
    input.addEventListener('keydown', function (e) {
      var step = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 }[e.key];
      if (step) { e.preventDefault(); hi = Math.max(0, Math.min(shownOpts.length - 1, hi + step)); paint(true); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(hi); }
      else if (e.key === 'Escape') { e.preventDefault(); closePop(); select.focus(); }
      else if (e.key === 'Tab') closePop();
    });
    list.addEventListener('mousemove', function (e) { var d = e.target.closest('.opt'); if (d && +d.dataset.n !== hi) { hi = +d.dataset.n; paint(false); } });
    list.addEventListener('mousedown', function (e) { e.preventDefault(); });
    list.addEventListener('click', function (e) { var d = e.target.closest('.opt'); if (d) pick(+d.dataset.n); });
    pop = { box: box, select: select, at: Date.now() };
    input.value = query;
    render();
    input.focus({ preventScroll: true });
  }
  function closePop() { if (pop) { pop.box.remove(); pop = null; } }
  document.addEventListener('mousedown', function (e) {
    if (!pop) return;
    var path = e.composedPath();
    if (path.indexOf(pop.box) === -1 && path.indexOf(pop.select) === -1) closePop();
  });
  window.addEventListener('scroll', function () { if (pop && Date.now() - pop.at > 250) closePop(); });
  window.addEventListener('resize', closePop);

  // ---------------------------------------------------------------- views

  function card(title, kids, aside) {
    return h('section', { className: 'card' }, [h('h2', null, [title, aside ? h('span', { className: 'aside' }, [aside]) : null])].concat(kids));
  }
  function fields(rows) {
    var g = h('div', { className: 'fields' });
    rows.forEach(function (r) { if (!r) return; g.appendChild(h('div', { className: 'k', text: r[0] })); g.appendChild(h('div', { className: 'v' }, r.slice(1))); });
    return g;
  }
  function check(name, label) { return h('label', { className: 'check' }, [P(name), label]); }

  // Class, level and the rest of rocalc's first character table.
  function characterView() {
    var statsTable = eng('A_STR') && eng('A_STR').closest('table');
    var infoTable = eng('A_JOB') && eng('A_JOB').closest('table');
    var derivedTable = byId('A_MaxHP') && byId('A_MaxHP').closest('table');

    var info = card('Class and level', [
      fields([
        ['Class', P('A_JOB')],
        ['Base level', P('A_BaseLV', { className: 'narrow' }), check('BLVauto', 'Auto-adjust to stats')],
        ['Job level', P('A_JobLV', { className: 'narrow' })],
        ['Adopted', check('A_adopted', 'Baby class')],
        ['Race and size', T('A_BodySIZE')],
        ['Body element', T('A_BodyELEMENT')],
      ]),
      // Anything else rocalc puts in this table.
      G(function () { return infoTable; }, { skip: function (n) { return n.tagName === 'TR' && n.parentNode && n.parentNode.parentNode === infoTable && knownInfoRow(n); } }),
    ]);

    var stats = h('div', { className: 'stats' });
    var rows = statsTable ? [].slice.call(statsTable.rows) : [];
    rows.forEach(function (row) {
      var sel = row.querySelector('select');
      if (!sel) return;
      var bonus = row.querySelector('span[id]');
      var mirror = P(sel.name);
      stats.appendChild(h('span', { className: 'name', text: clean(row.cells[0].textContent) }));
      stats.appendChild(h('span', { className: 'stepper' }, [
        h('button', { type: 'button', className: 'btn btn--icon', 'aria-label': 'Lower ' + clean(row.cells[0].textContent), onclick: function () { step(mirror, -1); } }, [svg(ICON.minus)]),
        mirror,
        h('button', { type: 'button', className: 'btn btn--icon', 'aria-label': 'Raise ' + clean(row.cells[0].textContent), onclick: function () { step(mirror, 1); } }, [svg(ICON.plus)]),
      ]));
      stats.appendChild(bonus ? T(bonus.id, { className: 'bonus', empty: '', fmt: function (t) { return t.replace(/^\+\s*0$/, ''); } }) : h('span'));
    });
    var points = h('span', { className: 'points' }, ['Points left ', h('b', null, [T('A_STPOINT')])]);
    refreshers.push(function () {
      var v = parseInt((byId('A_STPOINT') || {}).textContent, 10);
      points.classList.toggle('is-over', v < 0);
    });

    return h('div', { className: 'tabpanel' }, [
      h('div', { className: 'cols' }, [info, card('Stats', [stats], points)]),
      card('Derived stats', [KV(function () { return derivedTable; })]),
    ]);
  }
  function knownInfoRow(tr) {
    return !!tr.querySelector('select[name="A_JOB"], select[name="A_BaseLV"], select[name="A_JobLV"], input[name="A_adopted"], #A_BodySIZE, #A_BodyELEMENT');
  }
  function step(sel, d) {
    var i = sel.selectedIndex + d;
    if (i < 0 || i >= sel.options.length) return;
    sel.selectedIndex = i;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  var SLOTS = [
    ['Upper headgear', 'A_HEAD_REFINE', 'A_head1', 'A_head1_card'],
    ['Middle headgear', null, 'A_head2', 'A_head2_card'],
    ['Lower headgear', null, 'A_head3', null, 'A_HSE_HEAD1'],
    ['Shield', 'A_LEFT_REFINE', 'A_left', 'A_left_card'],
    ['Armour', 'A_BODY_REFINE', 'A_body', 'A_body_card', 'A_HSE'],
    ['Garment', 'A_SHOULDER_REFINE', 'A_shoulder', 'A_shoulder_card'],
    ['Footgear', 'A_SHOES_REFINE', 'A_shoes', 'A_shoes_card'],
    ['Accessory 1', null, 'A_acces1', 'A_acces1_card'],
    ['Accessory 2', null, 'A_acces2', 'A_acces2_card'],
  ];

  function equipmentView() {
    var equipTable = byId('A_w1') && byId('A_w1').closest('table.tborder');
    var weaponCell = byId('A_w1') && byId('A_w1').closest('table').closest('td');
    var gearCell = eng('A_head1') && eng('A_head1').closest('table').closest('td');
    var known = {};
    SLOTS.forEach(function (s) { s.slice(1).forEach(function (n) { if (n) known[n] = 1; }); });

    var grid = h('div', { className: 'equip' }, [
      h('span', { className: 'head', text: 'Slot' }), h('span', { className: 'head', text: 'Refine' }),
      h('span', { className: 'head', text: 'Item' }), h('span', { className: 'head', text: 'Card' }), h('span', { className: 'head', text: 'Enchant' }),
    ]);
    SLOTS.forEach(function (s) {
      if (!eng(s[2])) return;
      grid.appendChild(h('span', { className: 'slot', text: s[0] }));
      grid.appendChild(s[1] && eng(s[1]) ? P(s[1]) : h('span'));
      grid.appendChild(P(s[2], { className: 'wide' }));
      grid.appendChild(s[3] && eng(s[3]) ? P(s[3], { className: 'wide' }) : h('span'));
      grid.appendChild(s[4] && eng(s[4]) ? P(s[4], { className: 'wide' }) : h('span'));
    });

    var weapon = card('Weapon', [
      G(function () { return weaponCell; }),
      G(function () { return byId('leftweapon'); }),
    ], h('span', null, [P('A_Arrow')]));

    var gear = card('Armour and accessories', [
      grid,
      // Any gear field rocalc adds that the grid above doesn't know about.
      G(function () { return gearCell; }, { skip: function (n) { return n.tagName === 'SELECT' && known[n.name]; } }),
    ], h('span', null, [P('episode')]));

    var itemData = byId('ITEM_TITLE') && byId('ITEM_TITLE').closest('table');
    var otherInfo = eng('A_Kakutyou') && eng('A_Kakutyou').closest('table');
    var charSection = section(/character/i);
    var handled = [byId('A_MaxHP') && byId('A_MaxHP').closest('table.tborder'), equipTable, itemData, otherInfo];

    return h('div', { className: 'tabpanel' }, [
      h('div', { className: 'cols' }, [weapon, card('Item details', [G(function () { return itemData; })])]),
      gear,
      h('div', { className: 'cols' }, [
        card('Other info', [G(function () { return otherInfo; })]),
      // Whatever else rocalc has in the character section.
      card('More character settings', [G(function () { return charSection; }, { skip: function (n) {
        return handled.indexOf(n) !== -1 || (eng('A_JOB') && n.contains(eng('A_JOB')) && n.tagName === 'TABLE' && n.classList.contains('tborder'));
      } })]),
      ]),
    ]);
  }

  function resultsView() {
    var enemyTable = byId('fixable') && byId('fixable').querySelector('table');
    var cresults = byId('cresults');
    var big = { strID_0: 1, strID_1: 1, strID_2: 1 };

    var enemy = card('Enemy', [
      fields([
        ['Monster', P('B_Enemy')],
        ['Place', P('ENEMY_SORT2')],
        ['Sort by', P('ENEMY_SORT')],
      ]),
      h('hr', { className: 'rule' }),
      KV(function () { return enemyTable; }),
    ]);

    var attack = card('Your attack', [
      fields([
        ['Skill', P('A_ActiveSkill'), P('A_ActiveSkillLV', { className: 'narrow' })],
      ]),
      h('p', { className: 'skillnote' }, [T('AASkill', { empty: '' })]),
      h('div', { className: 'damage' }, [
        h('div', null, [h('span', { text: 'Minimum' }), h('b', null, [T('strID_0')])]),
        h('div', { className: 'avg' }, [h('span', { text: 'Average damage' }), h('b', null, [T('strID_1')])]),
        h('div', null, [h('span', { text: 'Maximum' }), h('b', null, [T('strID_2')])]),
      ]),
      KV(function () { return cresults; }, { one: true, until: 'select[name="B_AtkRange"]', skip: function (val) { return val.id in big; } }),
      h('hr', { className: 'rule' }),
      h('div', { className: 'fields' }, [
        h('div', { className: 'k', text: 'Compare' }), h('div', { className: 'v' }, [check('all_dmgSkills', 'All damage skills'), P('ReCalcButton')]),
      ]),
    ]);

    var defence = card('Enemy attacking you', [
      fields([
        ['Range', P('B_AtkRange')],
        ['Skill', P('B_AtkSkill')],
        ['Element', P('B_AtkElem')],
      ]),
      h('p', { className: 'skillnote' }, [T('BBSkill', { empty: '' })]),
      KV(function () { return cresults; }, { one: true, from: 'select[name="B_AtkRange"]' }),
    ]);

    return h('aside', { className: 'results', 'aria-label': 'Results' }, [attack, enemy, defence]);
  }

  function buildApp() {
    // rocalc fills the gear lists the first time the pointer crosses them.
    var firstNovis = ED.querySelector('[onmouseover*="FirstNovis"]');
    if (firstNovis) fire(firstNovis, 'mouseover');

    var intro = ED.querySelector('h1 + .main');
    var themeSel = byId('theme');
    var optionsCell = themeSel ? themeSel.closest('td') : null;
    var changelogCell = optionsCell ? optionsCell.previousElementSibling : null;
    var skipTheme = function (n) { return n === themeSel; };

    var tabs = [
      { id: 'character', label: 'Character', view: characterView },
      { id: 'equipment', label: 'Equipment', view: equipmentView },
      { id: 'buffs', label: 'Buffs and items', view: function () {
        return h('div', { className: 'tabpanel' }, [card('Buffs, items and other effects', [G(function () { return section(/buffs/i); })], 'Open a group to set it')]);
      }, dot: function () { return /\[active\]/i.test((section(/buffs/i) || {}).textContent || ''); } },
      { id: 'combat', label: 'Combat', view: function () {
        return h('div', { className: 'tabpanel' }, [card('Combat simulator', [G(function () { return section(/combat/i); }, { skip: function (n) { return n.id === 'fixable'; } })])]);
      } },
      { id: 'saves', label: 'Save and load', view: function () {
        return h('div', { className: 'tabpanel' }, [card('Save and load', [G(function () { return section(/save/i); })], 'Saves stay in this browser')]);
      } },
      { id: 'settings', label: 'Server and options', view: function () {
        return h('div', { className: 'tabpanel' }, [
          card('Server and options', [G(function () { return optionsCell; }, { skip: skipTheme })]),
          card('Changelog', [G(function () { return changelogCell; })]),
          card('Credits', [G(function () { return byId('foot'); }), G(function () { return ED.querySelector('.links'); })]),
        ]);
      } },
    ];
    if (!intro) tabs.pop();

    var bar = h('div', { className: 'tabs', role: 'tablist', 'aria-label': 'Calculator sections' });
    var panels = h('div');
    var built = {};
    var stored = null;
    try { stored = localStorage.getItem('rcp-calc-tab'); } catch (e) {}
    var current = tabs.some(function (t) { return t.id === stored; }) ? stored : 'character';

    tabs.forEach(function (t) {
      t.button = h('button', { type: 'button', className: 'tab', role: 'tab', id: 'tab-' + t.id, 'aria-controls': 'panel-' + t.id,
        onclick: function () { select(t.id); } }, [t.label]);
      t.dotNode = h('span', { className: 'dot', hidden: true, title: 'Something here is switched on' });
      t.button.appendChild(t.dotNode);
      bar.appendChild(t.button);
      t.panel = h('div', { role: 'tabpanel', id: 'panel-' + t.id, 'aria-labelledby': 'tab-' + t.id, hidden: true });
      panels.appendChild(t.panel);
    });
    bar.addEventListener('keydown', function (e) {
      var i = tabs.findIndex(function (t) { return t.id === current; });
      var d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      var n = tabs[(i + d + tabs.length) % tabs.length];
      select(n.id); n.button.focus();
    });
    function select(id) {
      current = id;
      try { localStorage.setItem('rcp-calc-tab', id); } catch (e) {}
      tabs.forEach(function (t) {
        var on = t.id === id;
        if (on && !built[t.id]) { t.panel.appendChild(t.view()); built[t.id] = 1; }
        t.button.setAttribute('aria-selected', String(on));
        t.button.tabIndex = on ? 0 : -1;
        t.panel.hidden = !on;
      });
      update();
    }
    refreshers.push(function () { tabs.forEach(function (t) { if (t.dot) t.dotNode.hidden = !t.dot(); }); });

    var summary = h('div', { className: 'summary', 'aria-hidden': 'true' }, [
      h('span', null, ['Average damage ', h('b', null, [T('strID_1')])]),
      h('span', null, ['Per second ', h('b', null, [T('AveSecondATK')])]),
    ]);

    app.textContent = '';
    app.appendChild(h('div', { className: 'layout' }, [h('div', null, [bar, panels]), resultsView()]));
    app.appendChild(summary);
    select(current);
  }

  // ---------------------------------------------------------------- builds sent from the game

  // The Stats window's "Open in calculator" button links here with
  // #build=<base64url JSON>:
  //   { v: 1, job: rocalc's A_JOB value, baby, lv, jlv, st: [str, agi, vit, int, dex, luk],
  //     gear: [{ s: slot, n: item name, r: refine, c: [card names], f: { el, stars } }],
  //     sk: [[skill name, level], ...] }
  // Names are matched against rocalc's own lists here, when the page loads,
  // so the match always follows the rocalc release that is installed.
  function readBuild() {
    var m = location.hash.match(/^#build=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    try {
      var b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var bytes = Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); });
      var b = JSON.parse(new TextDecoder().decode(bytes));
      return b && b.v === 1 ? b : null;
    } catch (e) { return null; }
  }

  // "Abysmal Knight Helm (iRO) [1]" and "Abysmal Knight Helm" should meet.
  function nameKey(t) { return String(t || '').toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/[^a-z0-9]/g, ''); }
  function bareKey(t) { return nameKey(String(t || '').replace(/\([^)]*\)/g, '').replace(/_+\s*$/, '')); }
  // Skill names differ in small ways between translations: "Two-Handed Sword
  // Mastery" / "Two-Hand Sword Mastery", "Increase" / "Increased", "Twohand".
  // Each word loses a trailing -ed, -e or -s before the words are joined.
  function skillKey(t) {
    return String(t || '').toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9]+/).filter(Boolean).map(function (w) {
      return w.length > 3 ? w.replace(/(ed|e|s)$/, '') : w;
    }).join('');
  }

  // The best option in one of rocalc's lists for one of our names, or -1.
  // An exact name wins; then the same name without rocalc's server and
  // variant tags, preferring the plainest entry; then one half of a
  // "Bacsojin / White Lady" style card entry.
  function pick(sel, name) {
    if (!sel || !name) return -1;
    var k = nameKey(name), b = bareKey(name), best = -1, bestScore = 0;
    for (var i = 0; i < sel.options.length; i++) {
      var t = sel.options[i].text;
      if (/^\(/.test(t)) continue; // "(no card)" and the like
      var score = 0;
      if (nameKey(t) === k) score = 100;
      else if (bareKey(t) === b) score = 80;
      else if (t.indexOf('/') !== -1 && t.split('/').some(function (p) { return bareKey(p) === b; })) score = 70;
      if (!score) continue;
      score -= (t.match(/\(/g) || []).length * 3 + (/_\s*$/.test(t) ? 4 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }
  function choose(sel, i) {
    if (!sel || i < 0) return false;
    if (sel.selectedIndex !== i) { sel.selectedIndex = i; fire(sel, 'change'); }
    return true;
  }
  function chooseValue(name, v) {
    var sel = eng(name);
    if (!sel || v == null) return false;
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === String(v)) return choose(sel, i);
    return false;
  }
  // The highest level the list offers that is not above lv.
  function chooseLevel(sel, lv) {
    if (!sel) return false;
    var best = -1, bestV = -1;
    for (var i = 0; i < sel.options.length; i++) {
      var v = parseInt(String(sel.options[i].value).replace(/^\+/, ''), 10);
      if (!isNaN(v) && v <= lv && v > bestV) { bestV = v; best = i; }
    }
    return choose(sel, best);
  }
  function tick(name, on) { var e = eng(name); if (e && e.checked !== !!on) e.click(); }

  // slot: [item list, refine, card lists, attribute]
  var GEAR = {
    weapon: ['A_weapon1', 'A_Weapon_refine', ['A_weapon1_card1', 'A_weapon1_card2', 'A_weapon1_card3', 'A_weapon1_card4'], 'A_Weapon_element'],
    head1: ['A_head1', 'A_HEAD_REFINE', ['A_head1_card']],
    head2: ['A_head2', null, ['A_head2_card']],
    head3: ['A_head3', null, []],
    shield: ['A_left', 'A_LEFT_REFINE', ['A_left_card']],
    body: ['A_body', 'A_BODY_REFINE', ['A_body_card']],
    garment: ['A_shoulder', 'A_SHOULDER_REFINE', ['A_shoulder_card']],
    shoes: ['A_shoes', 'A_SHOES_REFINE', ['A_shoes_card']],
    acc1: ['A_acces1', null, ['A_acces1_card']],
    acc2: ['A_acces2', null, ['A_acces2_card']],
  };
  // The weapon first: it decides whether a shield or a left hand fits.
  var GEAR_ORDER = ['weapon', 'weapon2', 'shield', 'head1', 'head2', 'head3', 'body', 'garment', 'shoes', 'acc1', 'acc2', 'ammo'];

  // Sets the whole build in rocalc. Returns the names rocalc had no entry
  // for, or null when it doesn't have the class.
  function applyOnce(b) {
    var missed = [];
    if (!chooseValue('A_JOB', b.job)) return null;
    tick('A_adopted', !!b.baby);
    tick('BLVauto', false); // keep the exact base level
    chooseValue('A_BaseLV', b.lv);
    chooseValue('A_JobLV', b.jlv);
    ['A_STR', 'A_AGI', 'A_VIT', 'A_INT', 'A_DEX', 'A_LUK'].forEach(function (n, i) { chooseValue(n, (b.st || [])[i]); });

    var bySlot = {};
    (b.gear || []).forEach(function (g) { if (g && g.s) bySlot[g.s] = g; });
    GEAR_ORDER.forEach(function (s) {
      var g = bySlot[s];
      if (!g || !g.n) return;
      if (s === 'ammo') {
        if (!choose(eng('A_Arrow'), pick(eng('A_Arrow'), g.n))) missed.push(g.n);
        return;
      }
      var sel, refineSel, cards;
      if (s === 'weapon2') {
        sel = eng('A_weapon2');
        if (!choose(sel, pick(sel, g.n))) { missed.push(g.n); return; }
        // Its refine and cards only exist once a weapon is in the left hand.
        var left = [].slice.call((byId('leftweapon') || ED).querySelectorAll('select')).filter(function (x) { return x.name !== 'A_weapon2'; });
        refineSel = left.filter(function (x) { return x.options.length > 1 && /^\+\d+$/.test(x.options[1].text); })[0];
        cards = left.filter(function (x) { return x !== refineSel; });
      } else {
        var slot = GEAR[s];
        sel = eng(slot[0]);
        if (!choose(sel, pick(sel, g.n))) { missed.push(g.n); return; }
        refineSel = slot[1] ? eng(slot[1]) : null;
        cards = slot[2].map(eng);
        if (g.f && slot[3]) {
          // A forged weapon: an element and Star Crumbs instead of cards.
          var elSel = eng(slot[3]);
          if (g.f.el) choose(elSel, pick(elSel, g.f.el));
          for (var k = 0; k < (g.f.stars || 0) && k < cards.length; k++) choose(cards[k], pick(cards[k], 'Star Crumb'));
        }
      }
      if (refineSel && g.r) chooseLevel(refineSel, g.r);
      if (!g.f) (g.c || []).forEach(function (c, i) {
        if (!c) return;
        var cs = cards[i];
        if (!cs || !choose(cs, pick(cs, String(c).replace(/\s*card$/i, '')))) missed.push(c);
      });
    });

    // Learned skills onto rocalc's passive and self-cast list, by name. A
    // label can carry a second name in its tooltip ("Alt. name:Over Thrust").
    var rows = [].slice.call(form.querySelectorAll('select')).filter(function (x) { return /^A_skill\d+$/.test(x.name); }).map(function (x) {
      var td = x.closest('td'), lab = td && td.previousElementSibling;
      var keys = [];
      if (lab) {
        keys.push(skillKey(textWithoutTips(lab)));
        var tip = lab.querySelector('.nametext');
        if (tip) keys.push(skillKey(tip.textContent.replace(/^\s*alt\.?\s*name\s*:/i, '')));
      }
      return { sel: x, keys: keys.filter(Boolean) };
    });
    (b.sk || []).forEach(function (pair) {
      var k = skillKey(pair && pair[0]);
      if (!k) return;
      var row = rows.filter(function (r) { return r.keys.indexOf(k) !== -1; })[0] || rows.filter(function (r) {
        return r.keys.some(function (rk) { return k.length >= 6 && rk.length >= 6 && (rk.indexOf(k) === 0 || k.indexOf(rk) === 0); });
      })[0];
      if (row) chooseLevel(row.sel, Number(pair[1]) || 0);
    });
    return missed;
  }

  function applyBuild(b) {
    var missed = applyOnce(b);
    if (missed === null) { notice([h('p', { text: "rocalc doesn't have this class, so the build couldn't be loaded." })]); return; }
    var unrestricted = false;
    var jobBox = eng('restrict_jobequip');
    if (missed.length && jobBox && jobBox.checked) {
      // This server lets some classes wear gear rocalc keeps from them. Lift
      // rocalc's job restriction (which clears the build) and set it again.
      var before = missed.length;
      jobBox.click();
      var again = applyOnce(b) || missed;
      if (again.length < before) { missed = again; unrestricted = true; }
      else { jobBox.click(); missed = applyOnce(b) || missed; }
    }
    try { if (EW.calc) EW.calc(); } catch (e) {}
    update();

    var job = eng('A_JOB');
    var lines = [h('p', { text: 'Loaded your ' + (job ? job.options[job.selectedIndex].text : 'character') + ' from the game: base level ' + b.lv + ', job level ' + b.jlv + ', stats, gear and skills.' })];
    if (missed.length) lines.push(h('p', { text: "rocalc has no entry for these, so they're left out: " + missed.join(', ') + '.' }));
    if (unrestricted) lines.push(h('p', { text: 'Equipment job restrictions are off so all of your gear fits. You can turn them back on under Server and options.' }));
    lines.push(h('p', { className: 'quiet', text: "Self-cast skills are on at the level you learned. Turn off any you don't keep up." }));
    notice(lines);
  }

  function notice(lines) {
    var box = h('div', { className: 'notice', role: 'status' });
    box.appendChild(h('div', { className: 'notice-body' }, lines));
    box.appendChild(h('button', { type: 'button', className: 'btn', onclick: function () { box.remove(); } }, ['Dismiss']));
    app.insertBefore(box, app.firstChild);
  }

  // ---------------------------------------------------------------- boot

  function fail(msg) {
    var l = shadow.getElementById('loading');
    if (l) { l.textContent = msg; l.classList.add('is-error'); }
  }

  function boot() {
    try {
      EW = frame.contentWindow; ED = frame.contentDocument; form = ED && ED.forms.calcForm;
    } catch (e) { form = null; }
    var tries = 0;
    (function wait() {
      var ready = form && form.A_JOB && form.A_JOB.options.length > 1 && form.B_Enemy && form.B_Enemy.options.length > 1;
      if (ready) {
        EW.alert = toast;
        // rocalc copies its own (engine) address and the hidden frame never
        // has focus; copyShareLink() copies the right one instead.
        try {
          if (EW.navigator.clipboard) Object.defineProperty(EW.navigator.clipboard, 'writeText', { value: function () { return Promise.resolve(); } });
        } catch (e) {}
        buildApp();
        if (incoming) applyBuild(incoming);
        new EW.MutationObserver(schedule).observe(ED.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'disabled', 'class', 'checked', 'selected'] });
        // rocalc sometimes sets field values in code, which no observer sees.
        setInterval(function () { if (!document.hidden) update(); }, 1500);
        return;
      }
      if (++tries > 150) { fail("rocalc didn't finish loading. Reload the page to try again."); return; }
      setTimeout(wait, 100);
    })();
  }

  // A build from the game is ours to apply; rocalc's own share links
  // (#<its code>) go straight to rocalc, which reads them on load.
  var incoming = readBuild();
  frame.addEventListener('load', boot, { once: true });
  frame.src = BASE + 'engine.html' + (incoming ? '' : location.hash);
  document.body.appendChild(frame);
  // A shared character link opened while the page is up.
  window.addEventListener('hashchange', function () { location.reload(); });
})();
