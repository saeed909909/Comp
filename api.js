/* Data layer: everything the app needs from Supabase goes through window.API. */
(() => {
  'use strict';
  const CFG = window.APP_CONFIG;

  // Capture invite / password-reset links before the Supabase client consumes the URL hash.
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const linkType = hash.get('type');                       // 'invite' | 'recovery' | 'signup' | 'magiclink'
  const linkError = hash.get('error_description');

  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
  });

  const fail = (error) => { if (error) throw new Error(error.message || String(error)); };

  function applyFilters(q, o) {
    for (const [k, v] of Object.entries(o.eq || {})) q = v === null ? q.is(k, null) : q.eq(k, v);
    for (const [k, v] of Object.entries(o.in || {})) q = q.in(k, v);
    for (const [k, v] of Object.entries(o.lt || {})) q = q.lt(k, v);
    for (const [k, v] of Object.entries(o.ilike || {})) q = q.ilike(k, v);
    return q;
  }

  window.API = {
    linkType: linkError ? null : linkType,
    linkError,

    async ready() {
      const { data } = await sb.auth.getSession();
      return data.session ? data.session.user : null;
    },
    onAuth(cb) { sb.auth.onAuthStateChange((event, session) => cb(event, session ? session.user : null)); },
    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password }); fail(error); return data.user;
    },
    async signOut() { await sb.auth.signOut(); },
    async sendReset(email, redirectTo) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo }); fail(error);
    },
    async setPassword(password) { const { error } = await sb.auth.updateUser({ password }); fail(error); },

    async select(table, o = {}) {
      let q = sb.from(table).select(o.cols || '*');
      q = applyFilters(q, o);
      if (o.order) q = q.order(o.order, { ascending: o.asc !== false });
      if (o.limit) q = q.limit(o.limit);
      const { data, error } = await q; fail(error); return data || [];
    },
    async insert(table, rows) {
      const { data, error } = await sb.from(table).insert(rows).select(); fail(error); return data || [];
    },
    async update(table, patch, eq) {
      const { data, error } = await applyFilters(sb.from(table).update(patch), { eq }).select(); fail(error); return data || [];
    },
    async remove(table, eq) {
      const { error } = await applyFilters(sb.from(table).delete(), { eq }); fail(error);
    },
    async rpc(fn, args = {}) {
      const { data, error } = await sb.rpc(fn, args); fail(error); return data;
    },

    async upload(bucket, path, file) {
      const { error } = await sb.storage.from(bucket).upload(path, file, { contentType: file.type || undefined, upsert: false });
      fail(error); return path;
    },
    async signedUrl(bucket, path, seconds = 3600) {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, seconds); fail(error); return data.signedUrl;
    },
    async removeFiles(bucket, paths) { const { error } = await sb.storage.from(bucket).remove(paths); fail(error); },

    async invite(payload) {
      const { data, error } = await sb.functions.invoke('invite-user', { body: payload });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch { /* keep generic */ }
        throw new Error(msg);
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    }
  };
})();
