/* Boot, routing and the rules/settings drawer. */
(function (root) {
  'use strict';
  const BJ = (root.BJ = root.BJ || {});
  const { h, Store } = BJ;
  const S = () => Store.settings;
  const VIEWS = ['table', 'drills', 'chart', 'scout', 'progress', 'playbook'];

  function show(name) {
    if (!VIEWS.includes(name)) name = 'table';
    VIEWS.forEach((v) => (document.getElementById('view-' + v).hidden = v !== name));
    document.querySelectorAll('.tabs a').forEach((a) => (a.dataset.view === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    if (name !== 'drills') BJ.Drills.stop();
    const el = document.getElementById('view-' + name);
    if (name === 'chart') BJ.Views.renderChart(el);
    else if (name === 'scout') BJ.Views.renderScout(el);
    else if (name === 'progress') BJ.Views.renderProgress(el);
    else if (name === 'playbook') BJ.Views.renderPlaybook(el);
    else if (name === 'drills') BJ.Drills.list();
    else if (name === 'table') BJ.Table.render();
  }
  function route() { show((location.hash || '#table').slice(1)); }

  function summary() {
    const R = S().rules;
    document.getElementById('rules-summary').textContent = `8D · ${R.s17 ? 'S17' : 'H17'}${R.das ? ' · DAS' : ''}${R.ls ? ' · LS' : ''}${R.rsa ? ' · RSA' : ''} · ${R.pen}/8`;
    document.getElementById('system-summary').textContent = { none: 'Basic', reko: 'REKO', hilo: 'Hi-Lo' }[S().system];
  }

  // ------------------------------------------------------------ settings drawer
  function openSettings() {
    const d = document.getElementById('settings');
    renderSettings(d);
    d.hidden = false;
    document.getElementById('settings-scrim').hidden = false;
    setTimeout(() => { const f = d.querySelector('button, input, select'); if (f) f.focus(); }, 20);
  }
  function closeSettings() {
    document.getElementById('settings').hidden = true;
    document.getElementById('settings-scrim').hidden = true;
    document.getElementById('open-settings').focus();
  }

  function renderSettings(d) {
    const st = S();
    const R = st.rules;
    d.innerHTML = '';
    const seg = (id, opts, val, onPick) => h(`div.seg#${id}`, { role: 'group' }, opts.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(v === val), on: { click: () => { onPick(v); renderSettings(d); } } }, l)));
    const check = (id, label, val, note, onChange) => h('label.check', { for: id }, h(`input#${id}`, { type: 'checkbox', checked: val ? true : null, on: { change: (e) => onChange(e.target.checked) } }), h('span', label, note ? h('small', note) : null));
    const select = (id, label, opts, val, onChange) => h('div.field', h('label', { for: id }, label), h(`select.input#${id}`, { on: { change: (e) => onChange(e.target.value) } }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) ? true : null }, l))));
    const rulesChange = (fn) => { fn(); Store.saveSettings(); applySettings(true); };
    const change = (fn, seats) => { fn(); Store.saveSettings(); applySettings(false, seats); };

    d.append(h('div.drawer-head', h('h2#settings-title', 'Table rules'), h('button.btn.small', { type: 'button', on: { click: closeSettings } }, 'Done')));
    d.append(h('fieldset', h('legend', 'House rules · eight decks'),
      h('div.field', h('span.label', 'Soft 17'), seg('set-s17', [[true, 'Dealer stands (S17)'], [false, 'Dealer hits (H17)']], R.s17, (v) => rulesChange(() => (R.s17 = v)))),
      check('set-das', 'Double after split (DAS)', R.das, null, (v) => rulesChange(() => (R.das = v))),
      check('set-ls', 'Late surrender (LS)', R.ls, null, (v) => rulesChange(() => (R.ls = v))),
      check('set-rsa', 'Resplit aces (RSA)', R.rsa, null, (v) => rulesChange(() => (R.rsa = v))),
      select('set-pen', 'Penetration (cut card)', [5.5, 5.75, 6, 6.25, 6.5, 6.75, 7].map((p) => [p, `${p.toFixed(2)} of 8 decks (${Math.round((p / 8) * 100)}%)`]), R.pen, (v) => rulesChange(() => (R.pen = Number(v)))),
      h('p.cite', 'Changing house rules shuffles a new shoe.')));

    d.append(h('fieldset', h('legend', 'Strategy and count'),
      seg('set-sys', [['none', 'Basic only'], ['reko', 'REKO'], ['hilo', 'Hi-Lo']], st.system, (v) => change(() => (st.system = v))),
      h('p.muted', { style: { fontSize: '13px' } }, st.system === 'reko' ? 'The book\'s count: start at −27, every variation at +2.' : st.system === 'hilo' ? 'True-counted, Sweet 16 + Fab 4 indexes.' : 'Graded on basic strategy alone. No count, flat bets.'),
      st.system === 'hilo' ? check('set-ten', 'Include the ten-split indexes', st.tenSplits, 'Full Illustrious 18. The book leaves them out: splitting tens draws attention.', (v) => change(() => (st.tenSplits = v))) : null,
      st.system === 'hilo' ? h('div.field', h('span.label', 'Hi-Lo ramp: units at true count or higher'),
        h('div.ramp-edit', st.hiloRamp.counts.map((c, i) => h('div', h('div.muted', `TC ${BJ.signed(c)}`), h(`input.input#ramp-${i}`, { inputmode: 'numeric', value: st.hiloRamp.units[i], 'aria-label': `Units at true count ${c}`, on: { change: (e) => change(() => (st.hiloRamp.units[i] = Math.max(1, Math.min(40, Number(e.target.value) || 1)))) } })))),
        h('p.cite', 'Starter ramp, not from the book: its Hi-Lo numbers use optimal ramps from simulation. Below TC +1: 1 unit.')) : null,
      st.system !== 'none' ? check('set-bets', 'Grade my bets against the ramp', st.gradeBets, null, (v) => change(() => (st.gradeBets = v))) : null));

    d.append(h('fieldset', h('legend', 'Table'),
      select('set-bots', 'Other players', [[0, 'Heads-up'], [1, '1'], [2, '2'], [3, '3'], [4, '4']], st.bots, (v) => change(() => (st.bots = Number(v)), true)),
      select('set-speed', 'Deal speed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']], st.speed, (v) => change(() => (st.speed = v))),
      select('set-unit', 'Unit (minimum bet)', [[5, '$5'], [10, '$10'], [25, '$25'], [100, '$100']], st.unit, (v) => change(() => (st.unit = Number(v)))),
      select('set-mistakes', 'When I make a mistake', [['takeback', 'Stop me and let me fix it'], ['ride', 'Show the error, play my move']], st.mistakes, (v) => change(() => (st.mistakes = v))),
      st.system !== 'none' ? select('set-checks', 'Ask me the count', [['off', 'Never'], ['shoe', 'At the end of every shoe'], ['often', 'Every shoe and at random']], st.countChecks, (v) => change(() => (st.countChecks = v))) : null,
      st.system !== 'none' ? check('set-show', 'Show the count on the table', st.showCount, 'Training wheels. You can also peek with C.', (v) => change(() => (st.showCount = v))) : null,
      check('set-errors', 'Dealer makes payout errors', st.dealerErrors, 'Catch them with the Dealer error button (p.65).', (v) => change(() => (st.dealerErrors = v)))));
  }

  /** Re-render whatever is visible after a settings change. */
  function applySettings(rulesChanged, seatsChanged) {
    summary();
    BJ.Table.onSettings({ rules: rulesChanged, seats: seatsChanged });
    const vis = VIEWS.find((v) => !document.getElementById('view-' + v).hidden);
    if (vis && vis !== 'table' && vis !== 'drills') show(vis);
  }

  function boot() {
    BJ.Table.init(document.getElementById('view-table'));
    BJ.Drills.init(document.getElementById('view-drills'));
    summary();
    document.getElementById('open-settings').addEventListener('click', openSettings);
    document.getElementById('settings-scrim').addEventListener('click', closeSettings);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.getElementById('settings').hidden) closeSettings(); });
    window.addEventListener('hashchange', route);
    // Clicking the tab you are already on (e.g. Drills while inside a drill) goes back to that view's start.
    document.querySelectorAll('.tabs a, .brand').forEach((a) => a.addEventListener('click', () => {
      if (location.hash === a.getAttribute('href')) show(a.getAttribute('href').slice(1));
    }));
    route();
  }

  BJ.App = { show, applySettings, openSettings };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
