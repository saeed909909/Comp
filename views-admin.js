/* Admin + owner pages: users, disciplines & test setup, library files, results, change log. */
(() => {
  'use strict';
  const { S, h, put, field, options, fmtDate, fmtDateTime, fmtClock, fmtSize, statusBadge, passBadge, levelName,
          toast, err, modal, confirmBox, empty, toCSV, download, route, go, uuid } = App;
  const ROLE_BADGE = { owner: 'bad', admin: 'warn', moderator: 'blue', user: '' };

  /* ===================== Users ===================== */
  route('/admin/users', 'admin', async (p, view) => {
    const [people, editors, banks] = await Promise.all([
      API.select('profiles', { order: 'created_at', asc: false }),
      API.select('bank_editors'),
      API.select('banks', { order: 'name' })
    ]);
    let term = '', roleF = '';
    const tbody = h('tbody');
    const bankNames = (uid) => editors.filter((e) => e.user_id === uid).map((e) => (banks.find((b) => b.id === e.bank_id) || {}).name).filter(Boolean);

    function paint() {
      const t = term.toLowerCase();
      const shown = people.filter((u) => (!roleF || u.role === roleF) && (!t || (u.full_name + ' ' + u.email).toLowerCase().includes(t)));
      put(tbody, ...(shown.length ? shown.map((u) => h('tr', { class: 'click', onclick: () => editUser(u) },
        h('td', null, h('b', null, u.full_name || '—'), h('div', { class: 'small muted' }, u.email)),
        h('td', null, h('span', { class: 'badge ' + ROLE_BADGE[u.role] }, u.role),
          u.role === 'moderator' ? h('div', { class: 'small muted', style: { marginTop: '3px' } }, bankNames(u.id).join(', ') || 'no banks') : null),
        h('td', null, App.disciplineName(u.discipline_id), h('div', { class: 'small muted' }, levelName(u.level))),
        h('td', null, u.active ? h('span', { class: 'badge ok' }, 'Active') : h('span', { class: 'badge bad' }, 'Disabled')),
        h('td', { class: 'small muted' }, fmtDate(u.created_at))))
        : [h('tr', null, h('td', { colspan: '5' }, empty('No users match.')))]));
    }

    function bankChecks(selected) {
      const boxes = banks.map((b) => h('input', { type: 'checkbox', value: b.id, checked: selected.includes(b.id) }));
      const wrap = h('div', { class: 'f' }, h('span', { style: { display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, 'Banks this moderator can edit'),
        banks.length ? h('div', { class: 'grid two', style: { gap: '6px' } }, banks.map((b, i) => h('label', { class: 'check' }, boxes[i], b.name))) : h('div', { class: 'small muted' }, 'Create question banks first.'));
      return { wrap, value: () => boxes.filter((x) => x.checked).map((x) => x.value) };
    }
    const roleOptions = () => [['user', 'User'], ['moderator', 'Moderator (edits chosen banks)'], ...(App.can('owner') ? [['admin', 'Admin']] : [])];
    const discOptions = () => S.disciplines.map((d) => [d.id, d.name + (d.active ? '' : ' (inactive)')]);

    function editUser(u) {
      const self = u.id === S.profile.id;
      const locked = !App.can('owner') && (u.role === 'admin' || u.role === 'owner') && !self;
      const name = h('input', { type: 'text', value: u.full_name });
      const role = h('select', { disabled: self || locked || u.role === 'owner' }, options(u.role === 'owner' ? [['owner', 'Owner']] : u.role === 'admin' && !App.can('owner') ? [['admin', 'Admin']] : roleOptions(), u.role));
      const disc = h('select', null, options(discOptions(), u.discipline_id, '— None —'));
      const lvl = h('select', null, options([['basic', 'Basic'], ['advanced', 'Advanced']], u.level));
      const active = h('input', { type: 'checkbox', checked: u.active, disabled: self || locked });
      const bc = bankChecks(editors.filter((e) => e.user_id === u.id).map((e) => e.bank_id));
      const syncBanks = () => { bc.wrap.hidden = role.value !== 'moderator'; };
      role.addEventListener('change', syncBanks); syncBanks();
      modal({
        title: u.full_name || u.email,
        body: h('div', null,
          h('p', { class: 'muted small', style: { marginTop: 0 } }, u.email),
          locked ? h('div', { class: 'alert warn' }, 'Only the owner can change admins.') : null,
          field('Full name', name), field('Role', role),
          h('div', { class: 'grid two', style: { gap: '10px' } }, field('Discipline', disc), field('Level', lvl)),
          bc.wrap,
          h('label', { class: 'check' }, active, 'Account active (disabled users cannot sign in or take tests)')),
        actions: locked ? [{ label: 'Close' }] : [{ label: 'Cancel' }, {
          label: 'Save', kind: 'primary', onClick: async () => {
            const patch = { full_name: name.value.trim(), discipline_id: disc.value || null, level: lvl.value };
            if (!self && u.role !== 'owner') { patch.role = role.value; patch.active = active.checked; }
            await API.update('profiles', patch, { id: u.id });
            const want = (patch.role || u.role) === 'moderator' ? bc.value() : [];
            const have = editors.filter((e) => e.user_id === u.id).map((e) => e.bank_id);
            for (const b of have.filter((x) => !want.includes(x))) await API.remove('bank_editors', { user_id: u.id, bank_id: b });
            const add = want.filter((x) => !have.includes(x));
            if (add.length) await API.insert('bank_editors', add.map((b) => ({ user_id: u.id, bank_id: b })));
            toast('Saved', 'ok');
            if (self) { await App.loadProfile(); App.renderNav(); }
            App.render();
          }
        }]
      });
    }

    function inviteForm() {
      const email = h('input', { type: 'email', placeholder: 'name@company.com' });
      const name = h('input', { type: 'text' });
      const role = h('select', null, options(roleOptions(), 'user'));
      const disc = h('select', null, options(discOptions().filter((_, i) => S.disciplines[i].active), '', '— Let them choose —'));
      const lvl = h('select', null, options([['basic', 'Basic'], ['advanced', 'Advanced']], 'basic'));
      const bc = bankChecks([]);
      const sync = () => { bc.wrap.hidden = role.value !== 'moderator'; };
      role.addEventListener('change', sync); sync();
      const mEmail = h('input', { type: 'radio', name: 'how', value: 'email', checked: true });
      const mPass = h('input', { type: 'radio', name: 'how', value: 'password' });
      const tmp = h('input', { type: 'text', value: 'Temp-' + Math.random().toString(36).slice(2, 8) + '-' + (100 + Math.floor(Math.random() * 900)), autocomplete: 'off' });
      const tmpWrap = field('Temporary password', tmp, 'Give this to them yourself. They can change it in Settings.');
      const syncHow = () => { tmpWrap.hidden = !mPass.checked; };
      mEmail.addEventListener('change', syncHow); mPass.addEventListener('change', syncHow); syncHow();
      modal({
        title: 'Add someone',
        body: h('div', null,
          field('Email', email), field('Full name', name), field('Role', role),
          h('div', { class: 'grid two', style: { gap: '10px' } }, field('Discipline', disc), field('Level', lvl)), bc.wrap,
          h('div', { class: 'f' }, h('span', { style: { display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, 'How they get access'),
            h('div', { class: 'row' }, h('label', { class: 'check' }, mEmail, 'Email invite link'), h('label', { class: 'check' }, mPass, 'Set a temporary password'))),
          tmpWrap),
        actions: [{ label: 'Cancel' }, {
          label: 'Send invite', kind: 'primary', onClick: async () => {
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())) { toast('Enter a valid email', 'bad'); return false; }
            try {
              await API.invite({
                email: email.value.trim(), full_name: name.value.trim(), role: role.value, level: lvl.value,
                discipline_id: disc.value || null, bank_ids: role.value === 'moderator' ? bc.value() : [],
                redirect_to: location.origin + location.pathname,
                password: mPass.checked ? tmp.value : undefined
              });
            } catch (e) {
              if (/failed to send|fetch|not found|404/i.test(e.message)) throw new Error('Could not reach the invite function. Check that "invite-user" is deployed in Supabase (see the setup guide).');
              throw e;
            }
            if (mPass.checked) {
              const who = email.value.trim(), pw = tmp.value;
              modal({ title: 'Account created', body: h('div', null, h('p', null, 'Send these sign-in details to ' + who + ':'),
                h('div', { class: 'diff' }, 'Site: ' + location.origin + location.pathname + '\nEmail: ' + who + '\nTemporary password: ' + pw),
                h('p', { class: 'small muted' }, 'Ask them to change the password in Settings after signing in.')),
                actions: [{ label: 'Done', kind: 'primary' }] });
            } else toast('Invite sent to ' + email.value.trim(), 'ok');
            App.render();
          }
        }]
      });
    }

    const search = h('input', { type: 'search', placeholder: 'Search name or email…', style: { maxWidth: '280px' } });
    search.addEventListener('input', () => { term = search.value; paint(); });
    const rf = h('select', { style: { width: 'auto' } }, options([['owner', 'Owner'], ['admin', 'Admins'], ['moderator', 'Moderators'], ['user', 'Users']], '', 'All roles'));
    rf.addEventListener('change', () => { roleF = rf.value; paint(); });

    put(view, 
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Users'), h('div', { class: 'muted' }, `${people.length} accounts · invite only`)),
        h('button', { class: 'btn primary', onclick: inviteForm }, '+ Invite')),
      h('div', { class: 'card' },
        h('div', { class: 'row', style: { marginBottom: '10px' } }, search, rf),
        h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Role'), h('th', null, 'Discipline'), h('th', null, 'Status'), h('th', null, 'Joined'))),
          tbody))));
    paint();
  });

  /* ===================== Disciplines ===================== */
  route('/admin/disciplines', 'admin', async (p, view) => {
    const [discs, cfgs, mixes, banks] = await Promise.all([
      API.select('disciplines', { order: 'name' }), API.select('test_configs'), API.select('test_mix'), API.select('banks')
    ]);
    S.disciplines = discs;
    const bn = (id) => (banks.find((b) => b.id === id) || {}).name || '?';
    const summary = (d, lvl) => {
      const c = cfgs.find((x) => x.discipline_id === d.id && x.level === lvl);
      if (!c) return h('div', { class: 'small muted' }, levelName(lvl) + ': not set up');
      const m = mixes.filter((x) => x.discipline_id === d.id && x.level === lvl);
      const total = m.reduce((s, x) => s + x.percent, 0);
      return h('div', { class: 'small', style: { marginBottom: '4px' } }, h('b', null, levelName(lvl) + ': '),
        `${c.question_count} Q · ${c.time_limit_min} min · pass ${c.pass_percent}% · `,
        m.length ? m.map((x) => `${bn(x.bank_id)} ${x.percent}%`).join(', ') : 'no banks',
        total !== 100 ? h('span', { class: 'badge bad', style: { marginInlineStart: '6px' } }, 'mix ' + total + '%') : null);
    };

    function form(d) {
      const name = h('input', { type: 'text', value: d ? d.name : '', maxlength: '80' });
      const desc = h('textarea', { rows: '2', value: d ? d.description : '' });
      const active = h('input', { type: 'checkbox', checked: !d || d.active });
      const actions = [];
      if (d) actions.push({
        label: 'Delete', kind: 'ghost-danger', onClick: async () => {
          if (!(await confirmBox('Delete "' + d.name + '"?', 'Its test settings and library links are removed. Users in this discipline will need to choose another. Past results are kept. To hide it instead, untick Active.', 'Delete', true))) return false;
          await API.remove('disciplines', { id: d.id }); toast('Deleted', 'ok'); await App.loadProfile(); App.render();
        }
      });
      actions.push({ label: 'Cancel' }, {
        label: d ? 'Save' : 'Create', kind: 'primary', onClick: async () => {
          const row = { name: name.value.trim(), description: desc.value.trim(), active: active.checked };
          if (!row.name) { toast('Enter a name', 'bad'); return false; }
          if (d) await API.update('disciplines', row, { id: d.id }); else await API.insert('disciplines', [row]);
          toast('Saved', 'ok'); await App.loadProfile(); App.render();
        }
      });
      modal({ title: d ? 'Edit discipline' : 'New discipline', body: h('div', null, field('Name', name, 'e.g. PCST, Mechanical, Electrical'), field('Description', desc), h('label', { class: 'check' }, active, 'Active (users can choose it)')), actions });
    }

    put(view, 
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Disciplines & tests'), h('div', { class: 'muted' }, 'Each discipline has a Basic and an Advanced test with its own question mix')),
        h('button', { class: 'btn primary', onclick: () => form(null) }, '+ New discipline')),
      discs.length ? h('div', { class: 'grid two' }, discs.map((d) => h('div', { class: 'card' },
        h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, d.name), d.active ? null : h('span', { class: 'badge' }, 'Inactive')),
        d.description ? h('p', { class: 'small muted', style: { margin: '4px 0 0' } }, d.description) : null,
        h('div', { style: { margin: '12px 0' } }, summary(d, 'basic'), summary(d, 'advanced')),
        h('div', { class: 'row' }, h('a', { class: 'btn primary sm', href: '#/admin/discipline/' + d.id }, 'Test setup'), h('button', { class: 'btn sm', onclick: () => form(d) }, 'Edit')))))
        : h('div', { class: 'card' }, empty('No disciplines yet. Create PCST, Mechanical, Electrical…')));
  });

  /* ===================== Test setup for a discipline ===================== */
  route('/admin/discipline/:id', 'admin', async ({ id, query }, view) => {
    const level = query.get('level') === 'advanced' ? 'advanced' : 'basic';
    const [discs, cfgs, mixes, banks] = await Promise.all([
      API.select('disciplines', { eq: { id } }),
      API.select('test_configs', { eq: { discipline_id: id } }),
      API.select('test_mix', { eq: { discipline_id: id } }),
      API.rpc('bank_summary')
    ]);
    const d = discs[0];
    if (!d) { put(view, empty('Discipline not found.')); return; }
    const cfg = cfgs.find((c) => c.level === level) || { question_count: 20, time_limit_min: 30, pass_percent: 70, max_leaves: 3 };
    let mix = mixes.filter((m) => m.level === level).map((m) => ({ bank_id: m.bank_id, percent: m.percent }));
    const other = level === 'basic' ? 'advanced' : 'basic';

    const count = h('input', { type: 'number', min: '1', max: '500', value: cfg.question_count });
    const time = h('input', { type: 'number', min: '1', max: '600', value: cfg.time_limit_min });
    const pass = h('input', { type: 'number', min: '0', max: '100', value: cfg.pass_percent });
    const leaves = h('input', { type: 'number', min: '0', max: '50', value: cfg.max_leaves == null ? 3 : cfg.max_leaves });
    const unlimited = h('input', { type: 'checkbox', checked: cfg.max_leaves == null });
    const syncLeaves = () => { leaves.disabled = unlimited.checked; };
    unlimited.addEventListener('change', syncLeaves); syncLeaves();
    const rowsBox = h('div');
    const totalEl = h('span', { class: 'mix-total' });
    count.addEventListener('input', () => paintMix());

    function paintMix() {
      const n = Number(count.value) || 0;
      const total = mix.reduce((s, m) => s + (Number(m.percent) || 0), 0);
      totalEl.textContent = 'Total: ' + total + '%';
      totalEl.className = 'mix-total ' + (total === 100 ? 'ok' : 'bad');
      put(rowsBox, 
        mix.length ? h('div', { class: 'mix-row small muted' }, h('span', null, 'Bank'), h('span', null, 'Percent'), h('span', null, 'Questions'), h('span')) : null,
        ...mix.map((m, i) => {
          const sel = h('select', null, options(banks.map((b) => [b.id, b.name + (b.active ? '' : ' (inactive)')]), m.bank_id, '— Choose bank —'));
          sel.addEventListener('change', () => { m.bank_id = sel.value; paintMix(); });
          const pc = h('input', { type: 'number', min: '1', max: '100', value: m.percent });
          pc.addEventListener('input', () => { m.percent = Number(pc.value) || 0; paintTotals(); });
          const b = banks.find((x) => x.id === m.bank_id);
          const want = Math.round(n * (Number(m.percent) || 0) / 100);
          const info = h('span', { class: 'small ' + (b && b.active_count < want ? '' : 'muted'), style: b && b.active_count < want ? { color: 'var(--bad)' } : null },
            '≈ ' + want + (b ? ` / ${b.active_count} available` : ''));
          return h('div', { class: 'mix-row' }, sel, pc, info, h('button', { class: 'icon-btn', title: 'Remove', onclick: () => { mix.splice(i, 1); paintMix(); } }, '✕'));
        }),
        h('div', { class: 'row', style: { marginTop: '6px' } },
          h('button', { class: 'btn sm', onclick: () => { mix.push({ bank_id: '', percent: Math.max(0, 100 - mix.reduce((s, m) => s + (Number(m.percent) || 0), 0)) || 10 }); paintMix(); } }, '+ Add bank'),
          h('span', { class: 'spacer' }), totalEl));
    }
    function paintTotals() {
      const total = mix.reduce((s, m) => s + (Number(m.percent) || 0), 0);
      totalEl.textContent = 'Total: ' + total + '%';
      totalEl.className = 'mix-total ' + (total === 100 ? 'ok' : 'bad');
    }

    const saveBtn = h('button', { class: 'btn primary' }, 'Save ' + levelName(level) + ' test');
    saveBtn.addEventListener('click', async () => {
      const clean = mix.filter((m) => m.bank_id);
      if (new Set(clean.map((m) => m.bank_id)).size !== clean.length) { toast('Each bank can only appear once', 'bad'); return; }
      const total = clean.reduce((s, m) => s + (Number(m.percent) || 0), 0);
      if (clean.length && total !== 100) { toast('Percentages must add up to 100% (now ' + total + '%)', 'bad'); return; }
      saveBtn.disabled = true;
      try {
        await API.rpc('save_test_config', {
          p_discipline: id, p_level: level, p_count: Number(count.value), p_time: Number(time.value),
          p_pass: Number(pass.value), p_max_leaves: unlimited.checked ? null : Number(leaves.value),
          p_mix: clean.map((m) => ({ bank_id: m.bank_id, percent: Number(m.percent) }))
        });
        toast(levelName(level) + ' test saved', 'ok');
      } catch (e) { err(e); } finally { saveBtn.disabled = false; }
    });

    const otherCfg = cfgs.find((c) => c.level === other);
    put(view, 
      h('div', { class: 'page-head' }, h('div', null, h('a', { href: '#/admin/disciplines', class: 'small' }, '← Disciplines'), h('h1', null, d.name + ' — test setup'))),
      h('div', { class: 'tabs' }, ['basic', 'advanced'].map((l) => h('button', { class: l === level ? 'active' : '', onclick: () => go(`#/admin/discipline/${id}?level=${l}`) }, levelName(l) + ' test'))),
      h('div', { class: 'grid two' },
        h('div', { class: 'card' }, h('h2', null, 'Test rules'),
          h('div', { class: 'grid two', style: { gap: '10px' } },
            field('Number of questions', count), field('Time limit (minutes)', time),
            field('Pass mark (%)', pass), field('Page-leave warnings', leaves, 'Test auto-submits when exceeded. 0 = submit on first leave.')),
          h('label', { class: 'check' }, unlimited, 'Unlimited (only record leaves, never auto-submit)')),
        h('div', { class: 'card' }, h('h2', null, 'Question mix'),
          h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Which banks the questions come from. If a bank runs short, the rest is filled from the other banks in the mix.'),
          rowsBox)),
      h('div', { class: 'row end' },
        otherCfg ? h('button', {
          class: 'btn', onclick: () => {
            count.value = otherCfg.question_count; time.value = otherCfg.time_limit_min; pass.value = otherCfg.pass_percent;
            unlimited.checked = otherCfg.max_leaves == null; leaves.value = otherCfg.max_leaves == null ? 3 : otherCfg.max_leaves; syncLeaves();
            mix = mixes.filter((m) => m.level === other).map((m) => ({ bank_id: m.bank_id, percent: m.percent })); paintMix();
            toast('Copied — review and save', 'ok');
          }
        }, 'Copy from ' + levelName(other)) : null,
        saveBtn));
    paintMix();
  });

  /* ===================== Library files ===================== */
  route('/admin/library', 'admin', async (p, view) => {
    const [items, links] = await Promise.all([API.select('library_items', { order: 'created_at', asc: false }), API.select('library_links')]);
    const discsOf = (id) => links.filter((l) => l.item_id === id).map((l) => l.discipline_id);

    function discChecks(selected) {
      const boxes = S.disciplines.map((d) => h('input', { type: 'checkbox', value: d.id, checked: selected.includes(d.id) }));
      return {
        wrap: h('div', { class: 'f' }, h('span', { style: { display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, 'Show to these disciplines'),
          h('div', { class: 'grid two', style: { gap: '6px' } }, S.disciplines.map((d, i) => h('label', { class: 'check' }, boxes[i], d.name)))),
        value: () => boxes.filter((b) => b.checked).map((b) => b.value)
      };
    }

    function form(item) {
      const title = h('input', { type: 'text', value: item ? item.title : '', dir: 'auto' });
      const desc = h('textarea', { rows: '2', value: item ? item.description : '', dir: 'auto' });
      const file = h('input', { type: 'file', accept: '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.mp4,.txt' });
      const dc = discChecks(item ? discsOf(item.id) : []);
      file.addEventListener('change', () => { const f = file.files[0]; if (f && !title.value) title.value = f.name.replace(/\.[^.]+$/, ''); });
      modal({
        title: item ? 'Edit library item' : 'Upload study material',
        body: h('div', null, item ? h('p', { class: 'small muted', style: { marginTop: 0 } }, 'File: ' + item.file_name) : field('File', file, 'PDF or other document, up to 50 MB'),
          field('Title', title), field('Description', desc), dc.wrap),
        actions: [{ label: 'Cancel' }, {
          label: item ? 'Save' : 'Upload', kind: 'primary', onClick: async () => {
            const discIds = dc.value();
            if (!title.value.trim()) { toast('Enter a title', 'bad'); return false; }
            if (!discIds.length) { toast('Choose at least one discipline', 'bad'); return false; }
            let it = item;
            if (!item) {
              const f = file.files[0];
              if (!f) { toast('Choose a file', 'bad'); return false; }
              if (f.size > 50 * 1024 * 1024) { toast('File must be under 50 MB', 'bad'); return false; }
              const safe = f.name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';
              const path = `${uuid()}/${safe}`;
              await API.upload('library', path, f);
              [it] = await API.insert('library_items', [{ title: title.value.trim(), description: desc.value.trim(), file_path: path, file_name: f.name, mime_type: f.type || '', size_bytes: f.size }]);
            } else {
              await API.update('library_items', { title: title.value.trim(), description: desc.value.trim() }, { id: item.id });
            }
            const have = item ? discsOf(item.id) : [];
            for (const d of have.filter((x) => !discIds.includes(x))) await API.remove('library_links', { item_id: it.id, discipline_id: d });
            const add = discIds.filter((x) => !have.includes(x));
            if (add.length) await API.insert('library_links', add.map((d) => ({ item_id: it.id, discipline_id: d })));
            toast('Saved', 'ok'); App.render();
          }
        }]
      });
    }

    put(view, 
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Library files'), h('div', { class: 'muted' }, 'Users only see files linked to their discipline')),
        h('button', { class: 'btn primary', onclick: () => form(null) }, '+ Upload')),
      h('div', { class: 'card' }, items.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, 'Title'), h('th', null, 'Disciplines'), h('th', null, 'File'), h('th', null, ''))),
        h('tbody', null, items.map((it) => h('tr', null,
          h('td', null, h('b', { class: 'auto', dir: 'auto' }, it.title), it.description ? h('div', { class: 'small muted clamp' }, it.description) : null),
          h('td', null, h('div', { class: 'chips' }, discsOf(it.id).map((d) => h('span', { class: 'badge' }, App.disciplineName(d))))),
          h('td', { class: 'small muted' }, it.file_name, h('div', null, fmtSize(it.size_bytes) + ' · ' + fmtDate(it.created_at))),
          h('td', null, h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
            h('button', { class: 'btn sm', onclick: () => form(it) }, 'Edit'),
            h('button', {
              class: 'btn sm ghost-danger', onclick: async () => {
                if (!(await confirmBox('Delete "' + it.title + '"?', 'The file is removed for everyone.', 'Delete', true))) return;
                try { await API.removeFiles('library', [it.file_path]).catch(() => {}); await API.remove('library_items', { id: it.id }); toast('Deleted', 'ok'); App.render(); }
                catch (e) { err(e); }
              }
            }, 'Delete')))))))) : empty('No files yet. Upload PDFs and other study material.')));
  });

  /* ===================== Results ===================== */
  route('/admin/results', 'admin', async ({ query }, view) => {
    const tab = query.get('tab') === 'done' ? 'done' : 'live';
    const discF = query.get('d') || '';
    const data = await API.rpc('admin_attempts', { p_status: tab, p_discipline: discF || null, p_limit: 500 });
    const tabs = h('div', { class: 'tabs' },
      h('button', { class: tab === 'live' ? 'active' : '', onclick: () => go('#/admin/results?tab=live') }, 'Live now'),
      h('button', { class: tab === 'done' ? 'active' : '', onclick: () => go('#/admin/results?tab=done' + (discF ? '&d=' + discF : '')) }, 'Finished'));
    let timer = null;

    if (tab === 'live') {
      const timeCells = [];
      const body = data.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, 'User'), h('th', null, 'Test'), h('th', null, 'Started'), h('th', null, 'Time left'), h('th', null, 'Left page'), h('th', null, ''))),
        h('tbody', null, data.map((a) => {
          const tc = h('td', { class: 'num' });
          timeCells.push([tc, new Date(a.deadline).getTime()]);
          const act = (label, fn) => h('button', {
            class: 'btn sm', onclick: async (e) => { e.target.disabled = true; try { await fn(); App.render(); } catch (x) { err(x); e.target.disabled = false; } }
          }, label);
          return h('tr', null,
            h('td', null, h('b', null, a.full_name || '—'), h('div', { class: 'small muted' }, a.email)),
            h('td', null, a.discipline_name, h('div', { class: 'small muted' }, levelName(a.level) + ' · ' + a.question_count + ' Q')),
            h('td', { class: 'small' }, fmtDateTime(a.started_at)),
            tc,
            h('td', { class: 'num' }, a.leave_count + (a.max_leaves == null ? '' : ' / ' + a.max_leaves)),
            h('td', null, h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
              act('+5 min', () => API.rpc('admin_extend_attempt', { p_attempt: a.id, p_minutes: 5 })),
              act('+15 min', () => API.rpc('admin_extend_attempt', { p_attempt: a.id, p_minutes: 15 })),
              h('button', {
                class: 'btn sm ghost-danger', onclick: async () => {
                  if (!(await confirmBox('End this test now?', `${a.full_name || a.email}'s test is submitted with the answers given so far.`, 'End test', true))) return;
                  try { await API.rpc('admin_end_attempt', { p_attempt: a.id }); toast('Test ended', 'ok'); App.render(); } catch (x) { err(x); }
                }
              }, 'End'))));
        })))) : empty('Nobody is taking a test right now.');
      const tick = () => timeCells.forEach(([td, dl]) => { const left = dl - Date.now(); td.textContent = fmtClock(left); td.style.color = left < 60000 ? 'var(--bad)' : ''; });
      tick();
      const tickT = setInterval(tick, 1000);
      const refreshT = setInterval(() => App.render(), 20000);
      timer = () => { clearInterval(tickT); clearInterval(refreshT); };
      put(view, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Results'), h('div', { class: 'muted' }, 'Refreshes every 20 seconds'))), tabs, h('div', { class: 'card' }, body));
      return timer;
    }

    const df = h('select', { style: { width: 'auto' } }, options(S.disciplines.map((d) => [d.id, d.name]), discF, 'All disciplines'));
    df.addEventListener('change', () => go('#/admin/results?tab=done' + (df.value ? '&d=' + df.value : '')));
    const n = data.length, passed = data.filter((a) => a.passed).length;
    const avg = n ? Math.round(data.reduce((s, a) => s + Number(a.score_percent || 0), 0) / n) : 0;
    put(view, 
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Results')),
        h('div', { class: 'row' }, df, h('button', {
          class: 'btn', onclick: () => download('results.csv', toCSV([
            ['date', 'name', 'email', 'discipline', 'level', 'score_percent', 'correct', 'questions', 'passed', 'how_ended', 'times_left_page'],
            ...data.map((a) => [a.started_at, a.full_name, a.email, a.discipline_name, a.level, a.score_percent, a.correct_count, a.question_count, a.passed ? 'yes' : 'no', a.status, a.leave_count])]))
        }, 'Export CSV'))),
      tabs,
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', null, n), h('span', null, 'tests')),
        h('div', { class: 'stat' }, h('b', null, n ? Math.round(100 * passed / n) + '%' : '—'), h('span', null, 'pass rate')),
        h('div', { class: 'stat' }, h('b', null, n ? avg + '%' : '—'), h('span', null, 'average score'))),
      h('div', { class: 'card' }, n ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'User'), h('th', null, 'Test'), h('th', null, 'Score'), h('th', null, 'Result'), h('th', null, 'How it ended'), h('th', null, 'Left page'))),
        h('tbody', null, data.map((a) => h('tr', { class: 'click', onclick: () => go('#/review/' + a.id) },
          h('td', { class: 'small' }, fmtDateTime(a.started_at)),
          h('td', null, h('b', null, a.full_name || '—'), h('div', { class: 'small muted' }, a.email)),
          h('td', null, a.discipline_name, h('div', { class: 'small muted' }, levelName(a.level))),
          h('td', { class: 'num' }, h('b', null, Number(a.score_percent) + '%'), h('div', { class: 'small muted' }, `${a.correct_count}/${a.question_count}`)),
          h('td', null, passBadge(a)), h('td', null, statusBadge(a.status)),
          h('td', { class: 'num' }, a.leave_count)))))) : empty('No finished tests yet.')));
  });

  /* ===================== Change log (owner only) ===================== */
  const TABLES = {
    questions: 'Question', banks: 'Bank', bank_editors: 'Bank access', disciplines: 'Discipline', profiles: 'User',
    test_configs: 'Test rules', test_mix: 'Question mix', library_items: 'Library file', library_links: 'Library access',
    question_reports: 'Question report', attempts: 'Live test', invites: 'Invite'
  };
  const SKIP = new Set(['created_at', 'updated_at', 'updated_by', 'created_by', 'id']);
  const show = (v) => v == null ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v);

  route('/admin/audit', 'owner', async (p, view) => {
    const tableF = p.query.get('t') || '';
    const [people, banks, discs] = await Promise.all([
      API.select('profiles', { cols: 'id,full_name,email' }), API.select('banks', { cols: 'id,name' }), API.select('disciplines', { cols: 'id,name' })
    ]);
    const nameOf = (id) => {
      const x = people.find((u) => u.id === id) || banks.find((b) => b.id === id) || discs.find((d) => d.id === id);
      return x ? (x.full_name || x.name || x.email) : id;
    };
    const list = h('div');
    const more = h('button', { class: 'btn', hidden: true }, 'Load older');
    let lastId = null;

    const describe = (e) => {
      const r = e.new_data || e.old_data || {};
      if (e.table_name === 'questions') return (r.body || '').slice(0, 90);
      if (e.table_name === 'profiles') return r.email || nameOf(r.id);
      if (e.table_name === 'invites') return r.email + ' as ' + r.role;
      if (e.table_name === 'attempts') return nameOf(r.user_id) + (r.minutes ? ` +${r.minutes} min` : '');
      if (e.table_name === 'test_configs' || e.table_name === 'test_mix') return nameOf(r.discipline_id) + ' · ' + levelName(r.level) + (r.bank_id ? ' · ' + nameOf(r.bank_id) + ' ' + r.percent + '%' : '');
      if (e.table_name === 'bank_editors') return nameOf(r.user_id) + ' → ' + nameOf(r.bank_id);
      if (e.table_name === 'library_links') return nameOf(r.discipline_id);
      return r.name || r.title || r.comment || '';
    };
    function diff(e) {
      const o = e.old_data || {}, n = e.new_data || {};
      const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter((k) => !SKIP.has(k));
      const lines = keys.filter((k) => e.action !== 'update' || JSON.stringify(o[k]) !== JSON.stringify(n[k])).map((k) => {
        if (e.action === 'update') return h('div', null, h('b', null, k + ': '), h('span', { class: 'old' }, show(o[k])), ' → ', h('span', { class: 'new' }, show(n[k])));
        return h('div', null, h('b', null, k + ': '), h('span', { class: e.action === 'delete' ? 'old' : 'new' }, show(e.action === 'delete' ? o[k] : n[k])));
      });
      return h('div', { class: 'diff auto', dir: 'auto' }, lines.length ? lines : 'No field changes');
    }
    const actBadge = { insert: ['added', 'ok'], update: ['changed', 'blue'], delete: ['deleted', 'bad'], invite: ['invited', 'ok'], extend: ['extended', 'warn'], end: ['ended', 'warn'] };

    async function load() {
      more.disabled = true;
      try {
        const rows = await API.select('audit_log', { eq: tableF ? { table_name: tableF } : {}, lt: lastId ? { id: lastId } : {}, order: 'id', asc: false, limit: 100 });
        rows.forEach((e) => {
          const details = h('div', { hidden: true }, diff(e));
          const [al, ac] = actBadge[e.action] || [e.action, ''];
          list.append(h('div', { class: 'card', style: { padding: '12px 14px', marginBottom: '8px', cursor: 'pointer' }, onclick: () => { details.hidden = !details.hidden; } },
            h('div', { class: 'row' },
              h('span', { class: 'badge ' + ac }, al),
              h('b', null, TABLES[e.table_name] || e.table_name),
              h('span', { class: 'auto', dir: 'auto', style: { flex: 1, minWidth: '120px' } }, describe(e)),
              h('span', { class: 'small muted' }, (e.actor_email || 'system') + ' · ' + fmtDateTime(e.at))),
            details));
        });
        if (rows.length) lastId = rows[rows.length - 1].id;
        more.hidden = rows.length < 100;
        if (!list.children.length) list.append(h('div', { class: 'card' }, empty('No changes recorded yet.')));
      } catch (e) { err(e); } finally { more.disabled = false; }
    }
    more.addEventListener('click', load);

    const tf = h('select', { style: { width: 'auto' } }, options(Object.entries(TABLES), tableF, 'Everything'));
    tf.addEventListener('change', () => go('#/admin/audit' + (tf.value ? '?t=' + tf.value : '')));
    put(view, 
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Change log'), h('div', { class: 'muted' }, 'Every change to questions, banks, users and settings. Only you can see this. Tap an entry for details.')), tf),
      list, h('div', { class: 'row', style: { justifyContent: 'center' } }, more));
    await load();
  });
})();
