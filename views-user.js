/* Regular-user pages: tests, test runner, review, library, reports, settings. */
(() => {
  'use strict';
  const { S, h, put, field, options, fmtDate, fmtDateTime, fmtClock, fmtSize, statusBadge, passBadge, levelName,
          toast, err, modal, confirmBox, empty, fileUrl, imageEl, route, go, setChrome } = App;
  const LETTERS = ['A', 'B', 'C', 'D'];
  const optText = (it, L) => it['option_' + L.toLowerCase()];

  /* ===================== Home: my tests ===================== */
  route('/home', 'user', async (p, view) => {
    const prof = S.profile;
    const [attempts, cfgs] = await Promise.all([
      API.select('attempts', { eq: { user_id: prof.id }, order: 'started_at', asc: false, limit: 100 }),
      prof.discipline_id ? API.select('test_configs', { eq: { discipline_id: prof.discipline_id, level: prof.level } }) : []
    ]);
    const cfg = cfgs[0];
    const open = attempts.find((a) => a.status === 'in_progress' && new Date(a.deadline).getTime() > Date.now() - 20000);
    const done = attempts.filter((a) => a.status !== 'in_progress');
    const best = done.reduce((m, a) => Math.max(m, Number(a.score_percent) || 0), 0);

    let testCard;
    if (!prof.discipline_id) {
      testCard = h('div', { class: 'card' }, h('h2', null, 'Choose your discipline'),
        h('p', { class: 'muted' }, 'Set your discipline and level in Settings to see your test.'),
        h('a', { class: 'btn primary', href: '#/settings' }, 'Open settings'));
    } else if (!cfg) {
      testCard = h('div', { class: 'card' }, h('h2', null, App.disciplineName(prof.discipline_id) + ' · ' + levelName(prof.level)),
        h('p', { class: 'muted' }, 'No test has been set up for your discipline and level yet. Check back later.'));
    } else {
      const startBtn = h('button', { class: 'btn primary big' }, open ? 'Resume test' : 'Start test');
      startBtn.addEventListener('click', async () => {
        if (open) { go('#/test/' + open.id); return; }
        const rules = [
          `${cfg.question_count} questions, ${cfg.time_limit_min} minutes. The timer starts as soon as you begin and keeps running if you close the page.`,
          `Pass mark: ${cfg.pass_percent}%.`,
          cfg.max_leaves == null ? 'Leaving the test page is recorded in your result.'
            : cfg.max_leaves === 0 ? 'Do not leave the test page: switching apps or tabs submits your test immediately.'
            : `Do not leave the test page. You get a warning each time; after ${cfg.max_leaves} warning${cfg.max_leaves > 1 ? 's' : ''} the test is submitted automatically.`,
          'Your answers are saved as you go.'
        ].join('\n\n');
        if (!(await confirmBox('Ready to start?', rules, 'Start now'))) return;
        startBtn.disabled = true;
        try { const id = await API.rpc('start_attempt'); go('#/test/' + id); }
        catch (e) { err(e); startBtn.disabled = false; }
      });
      testCard = h('div', { class: 'card' },
        h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, App.disciplineName(prof.discipline_id)),
          h('span', { class: 'badge blue' }, levelName(prof.level))),
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('b', null, cfg.question_count), h('span', null, 'questions')),
          h('div', { class: 'stat' }, h('b', null, cfg.time_limit_min + ' min'), h('span', null, 'time limit')),
          h('div', { class: 'stat' }, h('b', null, cfg.pass_percent + '%'), h('span', null, 'pass mark')),
          h('div', { class: 'stat' }, h('b', null, cfg.max_leaves == null ? '—' : cfg.max_leaves), h('span', null, 'page-leave warnings'))),
        open ? h('div', { class: 'alert info' }, 'You have a test in progress — ' + fmtClock(new Date(open.deadline) - Date.now()) + ' left.') : null,
        startBtn);
    }

    put(view, 
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Hello' + (prof.full_name ? ', ' + prof.full_name.split(' ')[0] : '')),
        h('div', { class: 'muted' }, done.length ? `${done.length} test${done.length > 1 ? 's' : ''} taken · best score ${best}%` : 'No tests taken yet'))),
      testCard,
      h('div', { class: 'card' }, h('h2', null, 'History'),
        done.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Test'), h('th', null, 'Score'), h('th', null, 'Result'), h('th', null, 'How it ended'))),
          h('tbody', null, done.map((a) => h('tr', { class: 'click', onclick: () => go('#/review/' + a.id) },
            h('td', null, fmtDateTime(a.started_at)),
            h('td', null, a.discipline_name, h('div', { class: 'small muted' }, levelName(a.level))),
            h('td', { class: 'num' }, h('b', null, Number(a.score_percent) + '%'), h('div', { class: 'small muted' }, `${a.correct_count}/${a.question_count}`)),
            h('td', null, passBadge(a)),
            h('td', null, statusBadge(a.status))))))) : empty('Your finished tests will appear here.')));
  });

  /* ===================== Test runner ===================== */
  route('/test/:id', 'user', async ({ id }, view, alive) => {
    let data = await API.rpc('get_attempt', { p_attempt: id });
    let a = data.attempt;
    if (a.status !== 'in_progress' || a.user_id !== S.profile.id) { go('#/review/' + id); return; }
    if (!alive()) return;
    setChrome(false);

    const items = data.items;
    const offset = new Date(data.server_now).getTime() - Date.now();
    let deadline = new Date(a.deadline).getTime();
    let cur = Math.max(0, items.findIndex((i) => !i.chosen));
    let finished = false, away = false, leavePromise = null;
    const saveChains = new Map();

    const timerEl = h('span', { class: 'timer' }, '--:--');
    const answeredEl = h('span', { class: 'meta' });
    const submitBtn = h('button', { class: 'btn', onclick: () => askSubmit() }, 'Submit test');
    const nav = h('div', { class: 'qnav' });
    const card = h('div', { class: 'qcard' });
    const notice = h('div');

    put(view, 
      h('div', { class: 'test-bar' }, timerEl,
        h('div', null, h('div', { style: { fontWeight: 650 } }, a.discipline_name + ' · ' + levelName(a.level)), answeredEl),
        submitBtn),
      h('div', { class: 'test-shell', style: { padding: '0 12px 40px' } }, notice, nav, card));

    function paintNav() {
      put(nav, ...items.map((it, i) => h('button', {
        class: (it.chosen ? 'answered ' : '') + (i === cur ? 'current' : ''), 'aria-label': 'Question ' + (i + 1),
        onclick: () => { cur = i; paint(); }
      }, i + 1)));
      const n = items.filter((i) => i.chosen).length;
      answeredEl.textContent = `${n} of ${items.length} answered`;
    }

    function paint() {
      const it = items[cur];
      const saved = h('span', { class: 'saved' }, it.chosen ? 'Answer saved' : '');
      put(card, 
        h('div', { class: 'qnum' }, `Question ${cur + 1} of ${items.length}`),
        h('div', { class: 'qbody auto', dir: 'auto' }, it.body),
        it.image_path ? imageEl(it.image_path) : null,
        LETTERS.filter((L) => optText(it, L)).map((L) => h('button', {
          class: 'opt' + (it.chosen === L ? ' selected' : ''), type: 'button',
          onclick: () => choose(it, L, saved)
        }, h('span', { class: 'letter' }, L), h('span', { class: 'auto', dir: 'auto' }, optText(it, L)))),
        h('div', { class: 'qfoot' },
          h('button', { class: 'btn', disabled: cur === 0, onclick: () => { cur--; paint(); } }, '← Previous'),
          saved,
          cur < items.length - 1
            ? h('button', { class: 'btn primary', onclick: () => { cur++; paint(); } }, 'Next →')
            : h('button', { class: 'btn primary', onclick: () => askSubmit() }, 'Finish')));
      paintNav();
    }

    function choose(it, L, savedEl) {
      if (finished) return;
      it.chosen = L;
      paint();
      const s = card.querySelector('.saved'); if (s) s.textContent = 'Saving…';
      const prev = saveChains.get(it.position) || Promise.resolve();
      const p = prev.then(() => API.rpc('save_answer', { p_attempt: id, p_position: it.position, p_choice: L }))
        .then((r) => {
          if (r && r.submitted) { finish('closed'); return; }
          if (items[cur] === it) { const s2 = card.querySelector('.saved'); if (s2) s2.textContent = 'Answer saved'; }
        })
        .catch((e) => { err(new Error('Answer not saved — check your connection. ' + e.message)); });
      saveChains.set(it.position, p);
    }

    async function askSubmit() {
      const left = items.filter((i) => !i.chosen).length;
      const ok = await confirmBox('Submit your test?',
        left ? `You have ${left} unanswered question${left > 1 ? 's' : ''}. Unanswered questions count as wrong.` : 'You answered every question.',
        'Submit', left > 0);
      if (ok) finish('submit');
    }

    async function finish(reason, message) {
      if (finished) return;
      finished = true;
      stop();
      try {
        await Promise.allSettled([...saveChains.values()]);
        if (reason === 'submit' || reason === 'time') await API.rpc('submit_attempt', { p_attempt: id });
      } catch (e) { err(e); }
      if (message) toast(message, 'bad');
      else if (reason === 'time') toast('Time is up — your test was submitted', 'bad');
      go('#/review/' + id);
    }

    // ----- timer + server sync -----
    let syncing = false;
    async function sync() {
      if (syncing || finished) return;
      syncing = true;
      try {
        const rows = await API.select('attempts', { eq: { id } });
        if (rows[0]) {
          deadline = new Date(rows[0].deadline).getTime();
          if (rows[0].status !== 'in_progress') finish('closed', rows[0].status === 'ended_by_admin' ? 'The administrator ended your test' : null);
        }
      } catch { /* offline: keep local clock */ } finally { syncing = false; }
    }
    async function tick() {
      const left = deadline - (Date.now() + offset);
      timerEl.textContent = fmtClock(left);
      timerEl.classList.toggle('low', left < 60000);
      if (left <= 0 && !finished) {
        await sync();
        if (deadline - (Date.now() + offset) <= 0) finish('time');
      }
    }
    const tickT = setInterval(tick, 500);
    const syncT = setInterval(sync, 30000);
    tick();

    // ----- leaving the page -----
    function markAway() {
      if (away || finished) return;
      away = true;
      leavePromise = API.rpc('record_leave', { p_attempt: id }).catch(() => null);
    }
    async function comeBack() {
      if (!away || finished) return;
      away = false;
      const r = await leavePromise;
      if (!r) return;
      if (r.submitted) {
        finished = true; stop();
        modal({
          title: 'Test submitted', dismissable: false,
          body: h('p', null, `You left the test page more than ${r.max_leaves} time${r.max_leaves === 1 ? '' : 's'}, so your test was submitted automatically.`),
          actions: [{ label: 'See result', kind: 'primary', onClick: () => go('#/review/' + id) }]
        });
        return;
      }
      const remaining = r.max_leaves == null ? null : r.max_leaves - r.leave_count;
      modal({
        title: '⚠️ You left the test page',
        body: h('div', null,
          h('p', null, 'Leaving the test page during a test is not allowed and has been recorded.'),
          h('div', { class: 'alert ' + (remaining === 0 ? 'bad' : 'warn') },
            r.max_leaves == null ? `Times left: ${r.leave_count}.`
              : remaining === 0 ? 'This was your last warning. If you leave again, your test will be submitted automatically.'
              : `Warning ${r.leave_count} of ${r.max_leaves}. After ${r.max_leaves} warnings the test is submitted automatically.`)),
        actions: [{ label: 'Back to the test', kind: 'primary' }]
      });
    }
    let blurT = null;
    const onVis = () => { if (document.visibilityState === 'hidden') markAway(); else comeBack(); };
    const onBlur = () => { clearTimeout(blurT); blurT = setTimeout(markAway, 1500); };
    const onFocus = () => { clearTimeout(blurT); comeBack(); };
    const onUnload = (e) => { if (!finished) { e.preventDefault(); e.returnValue = ''; } };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('beforeunload', onUnload);

    function stop() {
      clearInterval(tickT); clearInterval(syncT); clearTimeout(blurT);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('beforeunload', onUnload);
    }

    if (a.leave_count > 0) put(notice, h('div', { class: 'alert warn', style: { marginTop: '12px' } },
      `You have left the test page ${a.leave_count} time${a.leave_count > 1 ? 's' : ''} so far.`));
    paint();
    return () => { stop(); };
  });

  /* ===================== Review ===================== */
  route('/review/:id', 'user', async ({ id }, view) => {
    const data = await API.rpc('get_attempt', { p_attempt: id });
    const a = data.attempt;
    const mine = a.user_id === S.profile.id;
    if (a.status === 'in_progress' && mine) { go('#/test/' + id); return; }
    const items = data.items;
    const pct = Number(a.score_percent) || 0;
    const color = a.passed ? 'var(--ok)' : 'var(--bad)';
    const mins = a.submitted_at ? Math.round((new Date(a.submitted_at) - new Date(a.started_at)) / 60000) : null;
    let filter = 'all';
    const list = h('div');
    const isRight = (it) => it.chosen && it.chosen === it.correct;

    function paint() {
      const shown = items.filter((it) => filter === 'all' || (filter === 'wrong' ? !isRight(it) : isRight(it)));
      put(list, ...(shown.length ? shown.map((it) => {
        const reportSlot = h('span');
        if (mine) {
          if (it.reported) reportSlot.append(h('span', { class: 'badge' }, 'Reported'));
          else reportSlot.append(h('button', { class: 'btn sm', onclick: () => reportQ(it, reportSlot) }, '⚑ Report question'));
        }
        return h('div', { class: 'card review-q ' + (a.status === 'in_progress' ? '' : isRight(it) ? 'is-right' : 'is-wrong') },
          h('div', { class: 'row', style: { marginBottom: '8px' } },
            h('span', { class: 'qnum', style: { margin: 0 } }, 'Question ' + it.position),
            it.bank_name ? h('span', { class: 'badge' }, it.bank_name) : null,
            h('span', { class: 'spacer' }),
            !it.chosen ? h('span', { class: 'badge warn' }, 'Not answered') : isRight(it) ? h('span', { class: 'badge ok' }, '✓ Correct') : h('span', { class: 'badge bad' }, '✗ Wrong')),
          h('div', { class: 'qbody auto', dir: 'auto' }, it.body),
          it.image_path ? imageEl(it.image_path) : null,
          LETTERS.filter((L) => optText(it, L)).map((L) => h('div', {
            class: 'opt' + (L === it.correct ? ' correct' : L === it.chosen ? ' wrong' : ''), disabled: true
          }, h('span', { class: 'letter' }, L), h('span', { class: 'auto', dir: 'auto', style: { flex: 1 } }, optText(it, L)),
            L === it.chosen ? h('span', { class: 'small muted' }, 'Your answer') : null)),
          it.explanation ? h('div', { class: 'explain auto', dir: 'auto' }, h('b', null, 'Explanation: '), it.explanation) : null,
          mine ? h('div', { class: 'row end', style: { marginTop: '10px' } }, reportSlot) : null);
      }) : [empty('Nothing to show here.')]));
    }

    function reportQ(it, slot) {
      const ta = h('textarea', { placeholder: 'What is wrong? e.g. "Option C is also correct because…"', maxlength: '2000' });
      modal({
        title: 'Report question ' + it.position,
        body: h('div', null, h('p', { class: 'muted small' }, 'Your comment goes to the people who maintain this question bank.'), field('Comment', ta)),
        actions: [
          { label: 'Cancel' },
          {
            label: 'Send report', kind: 'primary', onClick: async () => {
              if (!ta.value.trim()) { toast('Please write a comment', 'bad'); return false; }
              await API.rpc('report_question', { p_attempt: id, p_position: it.position, p_comment: ta.value.trim() });
              it.reported = true;
              put(slot, h('span', { class: 'badge' }, 'Reported'));
              toast('Thanks — your report was sent', 'ok');
            }
          }]
      });
    }

    const wrong = items.filter((i) => !isRight(i)).length;
    const tabs = h('div', { class: 'tabs' });
    const mkTab = (key, label) => {
      const b = h('button', { class: filter === key ? 'active' : '' }, label);
      b.addEventListener('click', () => { filter = key; tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); paint(); });
      return b;
    };
    tabs.append(mkTab('all', `All (${items.length})`), mkTab('wrong', `Wrong / unanswered (${wrong})`), mkTab('right', `Correct (${items.length - wrong})`));

    put(view, 
      h('div', { class: 'page-head' }, h('div', null,
        h('a', { href: mine ? '#/home' : '#/admin/results', class: 'small' }, '← Back'),
        h('h1', null, 'Test result'),
        h('div', { class: 'muted' }, a.discipline_name + ' · ' + levelName(a.level) + ' · ' + fmtDateTime(a.started_at)),
        !mine && a.user ? h('div', { style: { marginTop: '4px' } }, h('b', null, a.user.full_name || a.user.email), ' ', h('span', { class: 'muted' }, a.user.email)) : null)),
      a.status === 'in_progress' ? h('div', { class: 'alert info' }, 'This test is still in progress.') : h('div', { class: 'card' },
        h('div', { class: 'row', style: { gap: '22px', alignItems: 'center' } },
          h('div', { class: 'score-ring', style: { background: `conic-gradient(${color} ${pct * 3.6}deg, #e8ecf1 0)` } }, h('span', null, Math.round(pct) + '%')),
          h('div', null,
            h('div', { class: 'row' }, passBadge(a), statusBadge(a.status)),
            h('div', { class: 'stats', style: { marginBottom: 0 } },
              h('div', { class: 'stat' }, h('b', null, `${a.correct_count}/${a.question_count}`), h('span', null, 'correct')),
              h('div', { class: 'stat' }, h('b', null, a.pass_percent + '%'), h('span', null, 'pass mark')),
              mins != null ? h('div', { class: 'stat' }, h('b', null, mins + ' min'), h('span', null, 'time taken')) : null,
              h('div', { class: 'stat' }, h('b', null, a.leave_count), h('span', null, 'times left page')))))),
      tabs, list);
    paint();
  });

  /* ===================== Library ===================== */
  route('/library', 'user', async (p, view) => {
    const prof = S.profile;
    const [items, links] = await Promise.all([
      API.select('library_items', { order: 'title' }),
      API.select('library_links')
    ]);
    const linkMap = new Map();
    links.forEach((l) => { if (!linkMap.has(l.item_id)) linkMap.set(l.item_id, []); linkMap.get(l.item_id).push(l.discipline_id); });
    const mineOnly = items.filter((i) => (linkMap.get(i.id) || []).includes(prof.discipline_id));
    let showAll = false;
    const list = h('div', { class: 'grid two' });

    function paint() {
      const shown = showAll ? items : mineOnly;
      put(list, ...(shown.length ? shown.map((it) => {
        const ext = (it.file_name.split('.').pop() || 'file').slice(0, 4).toUpperCase();
        return h('div', { class: 'card lib-item' },
          h('div', { class: 'file-ic' }, ext),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('h3', { class: 'auto', dir: 'auto' }, it.title),
            it.description ? h('p', { class: 'small muted auto', dir: 'auto', style: { margin: '0 0 8px' } }, it.description) : null,
            showAll ? h('div', { class: 'chips', style: { marginBottom: '8px' } }, (linkMap.get(it.id) || []).map((d) => h('span', { class: 'badge' }, App.disciplineName(d)))) : null,
            h('div', { class: 'row' },
              h('button', {
                class: 'btn primary sm', onclick: async () => {
                  const w = window.open('', '_blank');
                  try { const u = await fileUrl('library', it.file_path); if (w) w.location = u; else location.href = u; }
                  catch (e) { if (w) w.close(); err(e); }
                }
              }, 'Open'),
              h('span', { class: 'small muted' }, it.file_name + ' · ' + App.fmtSize(it.size_bytes)))));
      }) : [h('div', { class: 'card' }, empty(prof.discipline_id ? 'No study material for your discipline yet.' : 'Choose your discipline in Settings to see its library.'))]));
    }

    put(view, 
      h('div', { class: 'page-head' },
        h('div', null, h('h1', null, 'Library'), h('div', { class: 'muted' }, 'Study material for ' + App.disciplineName(prof.discipline_id))),
        App.can('admin') ? h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { showAll = e.target.checked; paint(); } }), 'Show all disciplines') : null),
      list);
    paint();
  });

  /* ===================== My reports ===================== */
  route('/my-reports', 'user', async (p, view) => {
    const reps = await API.select('question_reports', { eq: { user_id: S.profile.id }, order: 'created_at', asc: false });
    const label = { open: ['Waiting for review', 'warn'], resolved: ['Resolved', 'ok'], dismissed: ['Reviewed — no change', ''] };
    put(view, 
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'My reports'), h('div', { class: 'muted' }, 'Questions you reported and the replies you received'))),
      reps.length ? reps.map((r) => h('div', { class: 'card' },
        h('div', { class: 'row', style: { marginBottom: '8px' } }, h('span', { class: 'badge ' + label[r.status][1] }, label[r.status][0]), h('span', { class: 'small muted' }, fmtDateTime(r.created_at))),
        h('div', { class: 'diff auto', dir: 'auto' }, r.question_snapshot),
        h('p', { class: 'auto', dir: 'auto' }, h('b', null, 'You wrote: '), r.comment),
        r.response ? h('div', { class: 'alert ok auto', dir: 'auto', style: { marginBottom: 0 } }, h('b', null, 'Reply: '), r.response) : null))
        : h('div', { class: 'card' }, empty('You haven\'t reported any questions. You can report a question from a test review.')));
  });

  /* ===================== Settings ===================== */
  route('/settings', 'user', async (p, view) => {
    const prof = S.profile;
    const discs = S.disciplines.filter((d) => d.active || d.id === prof.discipline_id);
    const name = h('input', { type: 'text', value: prof.full_name, maxlength: '120' });
    const disc = h('select', null, options(discs.map((d) => [d.id, d.name]), prof.discipline_id, '— Choose —'));
    const lvl = h('select', null, options([['basic', 'Basic'], ['advanced', 'Advanced']], prof.level));
    const pw = h('input', { type: 'password', autocomplete: 'new-password' });
    const pw2 = h('input', { type: 'password', autocomplete: 'new-password' });

    put(view, 
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Settings'), h('div', { class: 'muted' }, prof.email))),
      h('div', { class: 'grid two' },
        h('div', { class: 'card' }, h('h2', null, 'Profile'),
          field('Full name', name),
          field('Discipline', disc, 'Your test and library follow this discipline.'),
          field('Level', lvl, 'Advanced tests include advanced question banks.'),
          h('button', {
            class: 'btn primary', onclick: async (e) => {
              e.target.disabled = true;
              try {
                await API.update('profiles', { full_name: name.value.trim(), discipline_id: disc.value || null, level: lvl.value }, { id: prof.id });
                await App.loadProfile(); App.renderNav(); toast('Saved', 'ok');
              } catch (x) { err(x); } finally { e.target.disabled = false; }
            }
          }, 'Save')),
        h('div', { class: 'card' }, h('h2', null, 'Password'),
          field('New password', pw, 'At least 8 characters'), field('Repeat new password', pw2),
          h('button', {
            class: 'btn', onclick: async (e) => {
              if (pw.value.length < 8) { toast('Use at least 8 characters', 'bad'); return; }
              if (pw.value !== pw2.value) { toast('The passwords do not match', 'bad'); return; }
              e.target.disabled = true;
              try { await API.setPassword(pw.value); pw.value = pw2.value = ''; toast('Password changed', 'ok'); }
              catch (x) { err(x); } finally { e.target.disabled = false; }
            }
          }, 'Change password'))));
  });
})();
