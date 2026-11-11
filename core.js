/* Core: helpers, modal/toast, router, navigation, session. */
window.App = (() => {
  'use strict';
  const RANK = { user: 1, moderator: 2, admin: 3, owner: 4 };
  const S = { user: null, profile: null, disciplines: [], cleanup: null, routes: [], navBadge: 0 };
  const $ = (sel) => document.querySelector(sel);

  /* ---------- DOM helper ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    let value;
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') value = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (['checked', 'disabled', 'selected', 'hidden', 'multiple', 'required', 'readOnly'].includes(k)) el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    if (value !== undefined) el.value = value;
    return el;
  }
  function put(el, ...kids) {
    el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false).map((k) => (k instanceof Node ? k : String(k))));
    return el;
  }
  const field = (label, input, hint) => h('label', { class: 'f' }, h('span', null, label), input, hint ? h('small', null, hint) : null);
  const options = (list, current, placeholder) => [
    placeholder !== undefined ? h('option', { value: '' }, placeholder) : null,
    ...list.map(([v, t]) => h('option', { value: v, selected: v === current }, t))
  ];

  /* ---------- formatting ---------- */
  const fmtDate = (s) => s ? new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const fmtDateTime = (s) => s ? new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const fmtClock = (ms) => {
    const t = Math.max(0, Math.floor(ms / 1000)), hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
    return (hh ? hh + ':' + String(mm).padStart(2, '0') : String(mm).padStart(2, '0')) + ':' + String(ss).padStart(2, '0');
  };
  const fmtSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const STATUS = {
    in_progress: ['In progress', 'blue'], submitted: ['Submitted', ''], auto_submitted: ['Auto-submitted (left page)', 'warn'],
    timed_out: ['Time ran out', 'warn'], ended_by_admin: ['Ended by admin', 'warn']
  };
  const statusBadge = (s) => h('span', { class: 'badge ' + (STATUS[s] || ['', ''])[1] }, (STATUS[s] || [s])[0]);
  const passBadge = (a) => a.status === 'in_progress' ? statusBadge(a.status)
    : h('span', { class: 'badge ' + (a.passed ? 'ok' : 'bad') }, a.passed ? 'PASS' : 'FAIL');
  const levelName = (l) => l === 'advanced' ? 'Advanced' : 'Basic';
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2));

  /* ---------- toast / modal ---------- */
  let toastTimer;
  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast' + (kind ? ' ' + kind : ''); t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'bad' ? 6000 : 3000);
  }
  const err = (e) => toast((e && e.message) || String(e), 'bad');

  function modal({ title, body, actions = [], wide = false, dismissable = true }) {
    const root = $('#modalRoot');
    let closed = false;
    const close = () => { if (closed) return; closed = true; ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(); };
    const btns = actions.map((a) => {
      const b = h('button', { class: 'btn ' + (a.kind || ''), type: 'button' }, a.label);
      b.addEventListener('click', async () => {
        if (!a.onClick) return close();
        b.disabled = true;
        try { const keep = await a.onClick(close); if (keep !== false) close(); }
        catch (e) { err(e); }
        finally { b.disabled = false; }
      });
      return b;
    });
    const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal-head' }, h('h2', { style: { margin: 0 } }, title),
        dismissable ? h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, '✕') : null),
      h('div', { class: 'modal-body' }, body),
      btns.length ? h('div', { class: 'modal-foot' }, btns) : null);
    const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov && dismissable) close(); } }, box);
    root.append(ov);
    document.addEventListener('keydown', onKey);
    const first = box.querySelector('input, select, textarea');
    if (first) requestAnimationFrame(() => { if (!box.contains(document.activeElement)) first.focus(); });
    return { close, el: box };
  }

  function confirmBox(title, text, okLabel = 'OK', danger = false) {
    return new Promise((resolve) => {
      let answered = false;
      const m = modal({
        title, body: h('p', { class: 'auto' }, text),
        actions: [
          { label: 'Cancel', onClick: () => { answered = true; resolve(false); } },
          { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { answered = true; resolve(true); } }
        ]
      });
      const obs = new MutationObserver(() => { if (!m.el.isConnected) { obs.disconnect(); if (!answered) resolve(false); } });
      obs.observe($('#modalRoot'), { childList: true });
    });
  }

  const spinner = () => h('div', { class: 'loading' }, h('div', { class: 'spinner' }));
  const empty = (text) => h('div', { class: 'empty' }, text);

  /* ---------- signed file URLs (cached) ---------- */
  const urlCache = new Map();
  async function fileUrl(bucket, path) {
    const key = bucket + '/' + path, hit = urlCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.url;
    const url = await API.signedUrl(bucket, path, 3600);
    urlCache.set(key, { url, exp: Date.now() + 50 * 60 * 1000 });
    return url;
  }
  function imageEl(path, cls = 'qimg') {
    const img = h('img', { class: cls, alt: 'Question picture', loading: 'lazy' });
    fileUrl('question-images', path).then((u) => { img.src = u; }).catch(() => { img.alt = 'Picture unavailable'; });
    img.addEventListener('click', () => { if (img.src) window.open(img.src, '_blank', 'noopener'); });
    return img;
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim() !== ''));
  }
  function toCSV(rows) {
    return '﻿' + rows.map((r) => r.map((v) => {
      const s = v == null ? '' : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
  }
  function download(name, text, type = 'text/csv;charset=utf-8') {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- session / profile ---------- */
  const can = (role) => !!S.profile && RANK[S.profile.role] >= RANK[role];
  async function loadProfile() {
    const rows = await API.select('profiles', { eq: { id: S.user.id } });
    S.profile = rows[0] || null;
    S.disciplines = await API.select('disciplines', { order: 'name' });
    return S.profile;
  }
  const disciplineName = (id) => (S.disciplines.find((d) => d.id === id) || {}).name || '—';

  /* ---------- navigation ---------- */
  const NAV = [
    { group: 'Learn' },
    { href: '#/home', label: 'My tests', role: 'user' },
    { href: '#/library', label: 'Library', role: 'user' },
    { href: '#/my-reports', label: 'My reports', role: 'user' },
    { href: '#/settings', label: 'Settings', role: 'user' },
    { group: 'Questions', role: 'moderator' },
    { href: '#/banks', label: 'Question banks', role: 'moderator' },
    { href: '#/reports', label: 'Question reports', role: 'moderator', badge: true },
    { group: 'Admin', role: 'admin' },
    { href: '#/admin/results', label: 'Results', role: 'admin' },
    { href: '#/admin/users', label: 'Users', role: 'admin' },
    { href: '#/admin/disciplines', label: 'Disciplines & tests', role: 'admin' },
    { href: '#/admin/library', label: 'Library files', role: 'admin' },
    { group: 'Owner', role: 'owner' },
    { href: '#/admin/audit', label: 'Change log', role: 'owner' }
  ];

  function renderNav() {
    const nav = $('#sidenav');
    put(nav, ...NAV.filter((n) => can(n.role || 'user')).map((n) => n.group
      ? h('div', { class: 'group' }, n.group)
      : h('a', { href: n.href, 'data-href': n.href },
          h('span', null, n.label), n.badge && S.navBadge ? h('span', { class: 'count-pill' }, S.navBadge) : null)),
      h('a', { href: '#', class: 'signout', onclick: async (e) => { e.preventDefault(); await API.signOut(); } }, 'Sign out'));
    markNav();
    $('#whoami').textContent = (S.profile.full_name || S.profile.email) + ' · ' + S.profile.role;
  }
  function markNav() {
    const cur = location.hash.split('?')[0];
    document.querySelectorAll('#sidenav a[data-href]').forEach((a) => {
      const href = a.dataset.href;
      a.classList.toggle('active', cur === href || (href !== '#/home' && cur.startsWith(href + '/')) ||
        (href === '#/banks' && cur.startsWith('#/bank/')) || (href === '#/admin/disciplines' && cur.startsWith('#/admin/discipline/')));
    });
  }
  async function refreshBadge() {
    if (!can('moderator')) return;
    try {
      const banks = await API.rpc('bank_summary');
      S.navBadge = (banks || []).reduce((s, b) => s + (b.open_reports || 0), 0);
      renderNav();
    } catch { /* ignore */ }
  }
  function setChrome(on) {
    $('#topbar').hidden = !on;
    $('#sidenav').hidden = !on;
    $('#view').style.maxWidth = on ? '' : 'none';
    $('#view').style.padding = on ? '' : '0';
    closeNav();
  }
  const closeNav = () => { $('#sidenav').classList.remove('open'); $('#scrim').hidden = true; $('#navToggle').setAttribute('aria-expanded', 'false'); };

  /* ---------- router ---------- */
  function route(pattern, role, render) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    S.routes.push({ re, keys, role, render });
  }
  const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

  let renderSeq = 0;
  async function render() {
    if (!S.user || !S.profile) return;
    const seq = ++renderSeq;
    if (S.cleanup) { try { S.cleanup(); } catch { /* ignore */ } S.cleanup = null; }
    const path = (location.hash.replace(/^#/, '') || '/home').split('?')[0];
    const r = S.routes.find((x) => x.re.test(path));
    const view = $('#view');
    setChrome(true);
    closeNav();
    markNav();
    if (!r) { go('#/home'); return; }
    if (!can(r.role)) { put(view, empty('You do not have access to this page.')); return; }
    const params = {};
    const m = path.match(r.re); r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    params.query = new URLSearchParams(location.hash.split('?')[1] || '');
    put(view, spinner());
    window.scrollTo(0, 0);
    const page = h('div');                       // each render gets its own container, shown only if still current
    try {
      const cleanup = await r.render(params, page, () => seq === renderSeq);
      if (seq !== renderSeq) { if (typeof cleanup === 'function') cleanup(); return; }
      if (page.childNodes.length) put(view, page);
      if (typeof cleanup === 'function') S.cleanup = cleanup;
    } catch (e) {
      if (seq === renderSeq) put(view, h('div', { class: 'alert bad' }, (e && e.message) || String(e)));
    }
  }

  /* ---------- auth screens ---------- */
  function showAuth(node) {
    setChrome(false);
    $('#topbar').hidden = true;
    put($('#view'), h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' }, node)));
  }

  function loginScreen(message) {
    const email = h('input', { type: 'email', autocomplete: 'username', required: true });
    const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn primary big', type: 'submit' }, 'Sign in');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); btn.disabled = true;
        try { await API.signIn(email.value.trim(), pw.value); await afterSignIn(); }
        catch (x) { err(/invalid/i.test(x.message) ? new Error('Wrong email or password') : x); }
        finally { btn.disabled = false; }
      }
    },
      h('div', { class: 'logo' }, '✓'),
      h('h1', null, APP_CONFIG.APP_NAME || 'Competency Test'),
      h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Sign in with the account you were invited with.'),
      message ? h('div', { class: 'alert warn' }, message) : null,
      field('Email', email), field('Password', pw), btn,
      h('p', { class: 'small', style: { textAlign: 'center', marginBottom: 0 } },
        h('button', {
          class: 'link-btn', type: 'button', onclick: async () => {
            const addr = email.value.trim();
            if (!addr) { toast('Type your email first', 'bad'); email.focus(); return; }
            try { await API.sendReset(addr, location.origin + location.pathname); toast('Check your email for a reset link', 'ok'); }
            catch (x) { err(x); }
          }
        }, 'Forgot password?')));
    showAuth(form);
  }

  function setPasswordScreen(isInvite) {
    const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
    const pw2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const btn = h('button', { class: 'btn primary big', type: 'submit' }, isInvite ? 'Create my account' : 'Save new password');
    showAuth(h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (pw.value.length < 8) { toast('Use at least 8 characters', 'bad'); return; }
        if (pw.value !== pw2.value) { toast('The passwords do not match', 'bad'); return; }
        btn.disabled = true;
        try { await API.setPassword(pw.value); toast('Password saved', 'ok'); API.linkType = null; await afterSignIn(); }
        catch (x) { err(x); } finally { btn.disabled = false; }
      }
    },
      h('div', { class: 'logo' }, '✓'),
      h('h1', null, isInvite ? 'Welcome!' : 'Choose a new password'),
      h('p', { class: 'muted small', style: { marginTop: 0 } }, isInvite ? 'Choose a password to finish setting up your account.' : 'Enter a new password for your account.'),
      field('New password', pw, 'At least 8 characters'), field('Repeat password', pw2), btn));
  }

  async function afterSignIn() {
    S.user = await API.ready();
    if (!S.user) { loginScreen(); return; }
    if (API.linkType === 'invite' || API.linkType === 'recovery') { setPasswordScreen(API.linkType === 'invite'); return; }
    await loadProfile();
    if (!S.profile || !S.profile.active) {
      await API.signOut();
      loginScreen('Your account is disabled. Contact the administrator.');
      return;
    }
    if (!location.hash || location.hash === '#' || /access_token|error=|type=/.test(location.hash)) {
      history.replaceState(null, '', location.pathname + '#/home');
    }
    renderNav();
    render();
    refreshBadge();
  }

  async function start() {
    document.title = APP_CONFIG.APP_NAME || 'Competency Test';
    $('#brandName').textContent = APP_CONFIG.APP_NAME || 'Competency Test';
    $('#navToggle').addEventListener('click', () => {
      const open = !$('#sidenav').classList.contains('open');
      $('#sidenav').classList.toggle('open', open); $('#scrim').hidden = !open;
      $('#navToggle').setAttribute('aria-expanded', String(open));
    });
    $('#scrim').addEventListener('click', closeNav);
    window.addEventListener('hashchange', () => { if (S.user && S.profile) render(); });

    if (!window.API) { put($('#view'), h('div', { class: 'alert bad' }, 'Could not load the app. Check your connection and reload.')); return; }
    API.onAuth((event, user) => {
      if (event === 'SIGNED_OUT') { S.user = null; S.profile = null; if (S.cleanup) { try { S.cleanup(); } catch { /* */ } S.cleanup = null; } loginScreen(); }
      if (event === 'PASSWORD_RECOVERY') { API.linkType = 'recovery'; setPasswordScreen(false); }
    });
    if (API.linkError) {
      history.replaceState(null, '', location.pathname);
      loginScreen('That link is invalid or has expired. Ask the administrator for a new invite, or use "Forgot password?".');
      return;
    }
    try { await afterSignIn(); } catch (e) { loginScreen((e && e.message) || String(e)); }
  }

  return {
    S, h, put, field, options, fmtDate, fmtDateTime, fmtClock, fmtSize, statusBadge, passBadge, levelName, uuid,
    toast, err, modal, confirmBox, spinner, empty, fileUrl, imageEl, parseCSV, toCSV, download,
    can, loadProfile, disciplineName, renderNav, refreshBadge, setChrome, route, go, render, start
  };
})();
