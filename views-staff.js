/* Question banks, question editor, CSV import/export, question reports (moderators + admins). */
(() => {
  'use strict';
  const { S, h, put, field, options, fmtDate, fmtDateTime, toast, err, modal, confirmBox, empty, imageEl,
          parseCSV, toCSV, download, route, go, uuid } = App;
  const LETTERS = ['A', 'B', 'C', 'D'];
  const CSV_COLS = ['question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct', 'explanation'];

  /* ---------- question editor (also used from Reports) ---------- */
  function questionEditor(q, bankId, onSaved) {
    q = q || { body: '', option_a: '', option_b: '', option_c: '', option_d: '', correct: 'A', explanation: '', active: true, image_path: null };
    let imagePath = q.image_path, newFile = null;
    const body = h('textarea', { dir: 'auto', value: q.body, rows: '4', placeholder: 'Type the question…' });
    const opts = {};
    const radios = {};
    const optRows = LETTERS.map((L) => {
      opts[L] = h('input', { type: 'text', dir: 'auto', value: q['option_' + L.toLowerCase()] || '', placeholder: L <= 'B' ? 'Required' : 'Optional' });
      radios[L] = h('input', { type: 'radio', name: 'correct', value: L, checked: q.correct === L, title: 'Correct answer' });
      return h('div', { class: 'opt-row' }, h('label', { class: 'check', style: { justifyContent: 'center' } }, radios[L]),
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('b', { style: { width: '18px' } }, L), opts[L]));
    });
    const expl = h('textarea', { dir: 'auto', value: q.explanation || '', rows: '2', placeholder: 'Shown to users in the review (optional)' });
    const active = h('input', { type: 'checkbox', checked: q.active !== false });
    const imgBox = h('div');
    const fileIn = h('input', { type: 'file', accept: 'image/*' });
    fileIn.addEventListener('change', () => {
      const f = fileIn.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { toast('Picture must be under 5 MB', 'bad'); fileIn.value = ''; return; }
      newFile = f; paintImg();
    });
    function paintImg() {
      put(imgBox, );
      if (newFile) imgBox.append(h('img', { class: 'img-prev', src: URL.createObjectURL(newFile), alt: '' }));
      else if (imagePath) imgBox.append(imageEl(imagePath, 'img-prev'));
      if (newFile || imagePath) imgBox.append(h('button', { class: 'btn sm ghost-danger', type: 'button', onclick: () => { newFile = null; imagePath = null; fileIn.value = ''; paintImg(); } }, 'Remove picture'));
    }
    paintImg();

    const actions = [];
    if (q.id) actions.push({
      label: 'Delete', kind: 'ghost-danger', onClick: async () => {
        if (!(await confirmBox('Delete this question?', 'It will be removed from the bank. Past test results keep their copy. To hide it from new tests without deleting, untick "Active" instead.', 'Delete', true))) return false;
        await API.remove('questions', { id: q.id });
        toast('Question deleted', 'ok'); onSaved && onSaved();
      }
    });
    actions.push({ label: 'Cancel' }, {
      label: 'Save question', kind: 'primary', onClick: async () => {
        const correct = LETTERS.find((L) => radios[L].checked);
        const row = {
          body: body.value.trim(), explanation: expl.value.trim(), active: active.checked, correct,
          option_a: opts.A.value.trim(), option_b: opts.B.value.trim(),
          option_c: opts.C.value.trim() || null, option_d: opts.D.value.trim() || null
        };
        if (!row.body) { toast('The question text is empty', 'bad'); return false; }
        if (!row.option_a || !row.option_b) { toast('Options A and B are required', 'bad'); return false; }
        if (!correct || !row['option_' + correct.toLowerCase()]) { toast('Mark which option is correct (it must have text)', 'bad'); return false; }
        if (newFile) {
          const ext = (newFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
          imagePath = await API.upload('question-images', `${bankId}/${uuid()}.${ext}`, newFile);
        }
        row.image_path = imagePath || null;
        if (q.id) await API.update('questions', row, { id: q.id });
        else await API.insert('questions', [{ ...row, bank_id: bankId }]);
        toast(q.id ? 'Question updated' : 'Question added', 'ok');
        onSaved && onSaved();
      }
    });

    modal({
      title: q.id ? 'Edit question' : 'New question', wide: true,
      body: h('div', null,
        field('Question', body),
        h('label', { class: 'f' }, h('span', null, 'Picture (optional)'), imgBox, fileIn),
        h('div', { class: 'f' }, h('span', { style: { display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, 'Answers — select the correct one'), optRows),
        field('Explanation', expl),
        h('label', { class: 'check' }, active, 'Active (used in new tests)')),
      actions
    });
  }
  App.questionEditor = questionEditor;

  /* ===================== Banks list ===================== */
  route('/banks', 'moderator', async (p, view) => {
    const banks = await API.rpc('bank_summary');
    const newBtn = App.can('admin') ? h('button', { class: 'btn primary', onclick: () => bankForm(null) }, '+ New bank') : null;
    put(view, 
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Question banks'),
        h('div', { class: 'muted' }, App.can('admin') ? 'All banks' : 'Banks you are allowed to edit')), newBtn),
      banks.length ? h('div', { class: 'grid three' }, banks.map((b) => h('a', { class: 'card', href: '#/bank/' + b.id, style: { color: 'inherit', display: 'block' } },
        h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, b.name), b.active ? null : h('span', { class: 'badge' }, 'Inactive')),
        b.description ? h('p', { class: 'small muted clamp', style: { margin: '6px 0 0' } }, b.description) : null,
        h('div', { class: 'stats', style: { marginBottom: 0 } },
          h('div', { class: 'stat' }, h('b', null, b.active_count), h('span', null, 'active questions')),
          h('div', { class: 'stat' }, h('b', null, b.total - b.active_count), h('span', null, 'inactive')),
          b.open_reports ? h('div', { class: 'stat' }, h('b', { style: { color: 'var(--bad)' } }, b.open_reports), h('span', null, 'open reports')) : null))))
        : h('div', { class: 'card' }, empty(App.can('admin') ? 'No banks yet. Create your first question bank.' : 'No banks have been assigned to you yet.')));
  });

  function bankForm(bank, afterDelete) {
    const name = h('input', { type: 'text', value: bank ? bank.name : '', maxlength: '80' });
    const desc = h('textarea', { value: bank ? bank.description : '', rows: '2' });
    const active = h('input', { type: 'checkbox', checked: !bank || bank.active });
    const actions = [];
    if (bank) actions.push({
      label: 'Delete bank', kind: 'ghost-danger', onClick: async () => {
        if (!(await confirmBox('Delete bank "' + bank.name + '"?', 'Only empty banks can be deleted. It will also be removed from every test mix.', 'Delete', true))) return false;
        try { await API.remove('banks', { id: bank.id }); }
        catch (e) { if (/foreign key|violates/i.test(e.message)) throw new Error('Delete or move its questions first — or untick Active to retire the bank.'); throw e; }
        toast('Bank deleted', 'ok'); afterDelete ? afterDelete() : App.render();
      }
    });
    actions.push({ label: 'Cancel' }, {
      label: bank ? 'Save' : 'Create bank', kind: 'primary', onClick: async () => {
        const row = { name: name.value.trim(), description: desc.value.trim(), active: active.checked };
        if (!row.name) { toast('Give the bank a name', 'bad'); return false; }
        if (bank) await API.update('banks', row, { id: bank.id });
        else { const [b] = await API.insert('banks', [row]); toast('Bank created', 'ok'); go('#/bank/' + b.id); return; }
        toast('Saved', 'ok'); App.render();
      }
    });
    modal({
      title: bank ? 'Edit bank' : 'New question bank',
      body: h('div', null, field('Name', name, 'e.g. PCST, Safety, Mechanical Advanced'), field('Description', desc),
        h('label', { class: 'check' }, active, 'Active (inactive banks are skipped in tests)')),
      actions
    });
  }

  /* ===================== One bank ===================== */
  route('/bank/:id', 'moderator', async ({ id }, view) => {
    const [bank] = await API.select('banks', { eq: { id } });
    if (!bank) { put(view, h('div', { class: 'card' }, empty('This bank does not exist or you do not have access to it.'))); return; }
    let qs = await API.select('questions', { eq: { bank_id: id }, order: 'created_at' });
    let term = '', show = 'all';
    const tbody = h('tbody');
    const countEl = h('span', { class: 'muted small' });
    const reload = async () => { qs = await API.select('questions', { eq: { bank_id: id }, order: 'created_at' }); paint(); };

    function paint() {
      const t = term.toLowerCase();
      const shown = qs.filter((q) => (show === 'all' || (show === 'active') === q.active) &&
        (!t || [q.body, q.option_a, q.option_b, q.option_c, q.option_d].some((x) => (x || '').toLowerCase().includes(t))));
      countEl.textContent = `${shown.length} of ${qs.length} questions`;
      put(tbody, ...(shown.length ? shown.map((q) => h('tr', { class: 'click', onclick: () => questionEditor(q, id, reload) },
        h('td', { class: 'num muted' }, qs.indexOf(q) + 1),
        h('td', null, h('div', { class: 'clamp auto', dir: 'auto' }, q.body), q.image_path ? h('span', { class: 'badge', style: { marginTop: '4px' } }, '🖼 picture') : null),
        h('td', null, h('span', { class: 'badge ok' }, q.correct)),
        h('td', null, q.active ? h('span', { class: 'badge blue' }, 'Active') : h('span', { class: 'badge' }, 'Inactive')),
        h('td', { class: 'small muted' }, fmtDate(q.updated_at))))
        : [h('tr', null, h('td', { colspan: '5' }, empty(qs.length ? 'No questions match.' : 'No questions yet. Add one or import a CSV file.')))]));
    }

    const search = h('input', { type: 'search', placeholder: 'Search questions…', style: { maxWidth: '280px' } });
    search.addEventListener('input', () => { term = search.value; paint(); });
    const filter = h('select', { style: { width: 'auto' } }, options([['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']], 'all'));
    filter.addEventListener('change', () => { show = filter.value; paint(); });

    put(view, 
      h('div', { class: 'page-head' },
        h('div', null, h('a', { href: '#/banks', class: 'small' }, '← Question banks'),
          h('div', { class: 'row' }, h('h1', null, bank.name), bank.active ? null : h('span', { class: 'badge' }, 'Inactive')),
          bank.description ? h('div', { class: 'muted' }, bank.description) : null),
        h('div', { class: 'row' },
          App.can('admin') ? h('button', { class: 'btn', onclick: () => bankForm(bank, () => go('#/banks')) }, 'Edit bank') : null,
          h('button', { class: 'btn', onclick: () => importCSV(id, reload) }, 'Import CSV'),
          h('button', {
            class: 'btn', onclick: () => download(bank.name.replace(/[^\w-]+/g, '_') + '_questions.csv',
              toCSV([[...CSV_COLS, 'active', 'image_path'], ...qs.map((q) => [q.body, q.option_a, q.option_b, q.option_c, q.option_d, q.correct, q.explanation, q.active ? 'yes' : 'no', q.image_path || ''])]))
          }, 'Export CSV'),
          h('button', { class: 'btn primary', onclick: () => questionEditor(null, id, reload) }, '+ Add question'))),
      h('div', { class: 'card' },
        h('div', { class: 'row', style: { marginBottom: '10px' } }, search, filter, h('span', { class: 'spacer' }), countEl),
        h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Question'), h('th', null, 'Answer'), h('th', null, 'Status'), h('th', null, 'Updated'))),
          tbody))));
    paint();
  });

  /* ---------- CSV import ---------- */
  function importCSV(bankId, done) {
    let rows = [];
    const fileIn = h('input', { type: 'file', accept: '.csv,text/csv' });
    const result = h('div');
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]; if (!f) return;
      const table = parseCSV(await f.text());
      if (table.length && /question/i.test(table[0][0] || '')) table.shift();
      const errors = [];
      rows = [];
      table.forEach((r, i) => {
        const [body, a, b, c, d, correct, explanation] = r.map((x) => (x || '').trim());
        const C = (correct || '').toUpperCase();
        const line = i + 2;
        if (!body) return errors.push(`Row ${line}: question is empty`);
        if (!a || !b) return errors.push(`Row ${line}: options A and B are required`);
        if (!['A', 'B', 'C', 'D'].includes(C)) return errors.push(`Row ${line}: correct must be A, B, C or D`);
        if ((C === 'C' && !c) || (C === 'D' && !d)) return errors.push(`Row ${line}: the correct option ${C} is empty`);
        rows.push({ bank_id: bankId, body, option_a: a, option_b: b, option_c: c || null, option_d: d || null, correct: C, explanation: explanation || '', active: true });
      });
      put(result, 
        h('div', { class: 'alert ' + (rows.length ? 'ok' : 'bad') }, `${rows.length} question${rows.length === 1 ? '' : 's'} ready to import.`),
        errors.length ? h('div', { class: 'alert warn' }, h('b', null, `${errors.length} row${errors.length > 1 ? 's' : ''} skipped:`), h('div', { class: 'small' }, errors.slice(0, 15).map((e) => h('div', null, e))), errors.length > 15 ? h('div', { class: 'small' }, '…') : null) : null);
    });
    modal({
      title: 'Import questions from CSV', wide: true,
      body: h('div', null,
        h('p', { class: 'small muted' }, 'Columns in this order: question, option_a, option_b, option_c, option_d, correct (A–D), explanation. A header row is fine. Save from Excel as "CSV UTF-8" to keep Arabic text. Add pictures afterwards in the editor.'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => download('question_template.csv', toCSV([CSV_COLS, ['What does PPE stand for?', 'Personal Protective Equipment', 'Plant Process Equipment', 'Pressure Pipe Element', '', 'A', 'PPE protects the wearer.']])) }, 'Download template'),
        h('div', { style: { margin: '14px 0' } }, fileIn), result),
      actions: [{ label: 'Cancel' }, {
        label: 'Import', kind: 'primary', onClick: async () => {
          if (!rows.length) { toast('Choose a CSV file with valid rows first', 'bad'); return false; }
          for (let i = 0; i < rows.length; i += 200) await API.insert('questions', rows.slice(i, i + 200));
          toast(`Imported ${rows.length} questions`, 'ok'); done();
        }
      }]
    });
  }

  /* ===================== Reports ===================== */
  route('/reports', 'moderator', async (p, view) => {
    const status = p.query.get('status') || 'open';
    const [reps, banks, people] = await Promise.all([
      API.select('question_reports', { eq: status === 'all' ? {} : { status }, order: 'created_at', asc: false, limit: 300 }),
      API.rpc('bank_summary'),
      App.can('admin') ? API.select('profiles', { cols: 'id,full_name,email' }) : []
    ]);
    const bankName = (id) => (banks.find((b) => b.id === id) || {}).name || 'Deleted bank';
    const who = (id) => { const x = people.find((pp) => pp.id === id); return x ? (x.full_name || x.email) : null; };
    const label = { open: ['Open', 'warn'], resolved: ['Resolved', 'ok'], dismissed: ['Dismissed', ''] };

    const tabs = h('div', { class: 'tabs' }, [['open', 'Open'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed'], ['all', 'All']].map(([k, t]) =>
      h('button', { class: k === status ? 'active' : '', onclick: () => go('#/reports?status=' + k) }, t)));

    const cards = reps.map((r) => {
      const resp = h('textarea', { dir: 'auto', rows: '2', value: r.response, placeholder: 'Reply to the user (optional)' });
      const save = async (newStatus, btn) => {
        btn.disabled = true;
        try {
          await API.update('question_reports', { status: newStatus, response: resp.value.trim(), handled_by: S.profile.id, handled_at: new Date().toISOString() }, { id: r.id });
          toast('Report ' + newStatus, 'ok'); App.refreshBadge(); App.render();
        } catch (e) { err(e); btn.disabled = false; }
      };
      const editBtn = r.question_id ? h('button', {
        class: 'btn sm', onclick: async () => {
          try {
            const [q] = await API.select('questions', { eq: { id: r.question_id } });
            if (!q) { toast('That question was deleted', 'bad'); return; }
            questionEditor(q, q.bank_id, () => toast('Now resolve the report', 'ok'));
          } catch (e) { err(e); }
        }
      }, 'Edit question') : h('span', { class: 'small muted' }, 'Question deleted');
      const b1 = h('button', { class: 'btn sm primary' }, 'Mark resolved');
      const b2 = h('button', { class: 'btn sm' }, 'Dismiss');
      b1.addEventListener('click', () => save('resolved', b1));
      b2.addEventListener('click', () => save('dismissed', b2));
      return h('div', { class: 'card' },
        h('div', { class: 'row', style: { marginBottom: '8px' } },
          h('span', { class: 'badge ' + label[r.status][1] }, label[r.status][0]),
          h('span', { class: 'badge blue' }, bankName(r.bank_id)),
          h('span', { class: 'small muted' }, fmtDateTime(r.created_at)),
          who(r.user_id) ? h('span', { class: 'small muted' }, '· ' + who(r.user_id)) : null),
        h('div', { class: 'diff auto', dir: 'auto' }, r.question_snapshot),
        h('p', { class: 'auto', dir: 'auto' }, h('b', null, 'Report: '), r.comment),
        field('Reply', resp),
        h('div', { class: 'row' }, editBtn, h('span', { class: 'spacer' }), b2, b1));
    });

    put(view, 
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Question reports'),
        h('div', { class: 'muted' }, App.can('admin') ? 'Reports from users on any bank' : 'Reports on the banks you edit'))),
      tabs, cards.length ? cards : h('div', { class: 'card' }, empty(status === 'open' ? 'No open reports. 🎉' : 'Nothing here.')));
  });
})();
