// Data lives in Neon via the local server (server.js) — no keys in the browser.
const API = "/api/episodes";
const POLL_MS = 3000;

const STAGES = [
  { key: 'raw', label: 'Raw Files', optional: false },
  { key: 'stitch', label: 'Stitch', optional: false },
  { key: 'edit1', label: 'Edit 1', optional: false },
  { key: 'edit2', label: 'Edit 2', optional: true },
  { key: 'edit3', label: 'Edit 3', optional: true },
  { key: 'edit4', label: 'Edit 4', optional: true },
  { key: 'final', label: 'Final', optional: false },
];
const STAGE_COLORS = { raw: '#6d6d66', stitch: '#a8443a', edit1: '#c53a2e', edit2: '#d8452f', edit3: '#e0503a', edit4: '#ee6a52', final: '#ff5a45', done: '#ff5a45', tostart: '#3a3a3e' };
const KEY = 'mdtracker.v1';
const iso = (d) => d.toISOString().slice(0, 10);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── App state ────────────────────────────────────────────────────
const S = { episodes: [], view: 'table', period: 'week', detailId: null, showAdd: false, showBulk: false, af: null, bf: null, sync: 'local' };
let online = false, saving = 0, lastJson = '[]';

// ── Persistence ──────────────────────────────────────────────────
function save(eps) {
  S.episodes = eps;
  lastJson = JSON.stringify(eps);
  if (online) {
    saving++;
    fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: lastJson })
      .then(r => { if (!r.ok) throw 0; S.sync = 'live'; })
      .catch(() => { S.sync = 'error'; render(); })
      .finally(() => { saving--; });
  } else {
    try { localStorage.setItem(KEY, lastJson); } catch (e) {}
  }
  render();
}

async function pull() {
  let r;
  try { r = await fetch(API, { cache: 'no-store' }); } catch (e) { throw new Error('server not reachable'); }
  const text = await r.text();
  if (r.status === 404) throw new Error('/api/episodes not found (404) — function not deployed');
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`/api/episodes returned HTML, not data (status ${r.status}) — function not deployed`); }
  if (!r.ok) throw new Error((data && data.error) || `status ${r.status}`);
  return Array.isArray(data) ? data : [];
}

async function poll() {
  if (saving) return;
  try {
    const eps = await pull();
    const json = JSON.stringify(eps);
    const wasError = S.sync !== 'live';
    S.sync = 'live';
    if (json === lastJson && !wasError) return;
    lastJson = json; S.episodes = eps;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return; // don't wipe what someone is typing
    render();
  } catch (e) { if (S.sync !== 'error') { S.sync = 'error'; render(); } }
}

async function init() {
  S.sync = 'connecting'; render();
  try {
    S.episodes = await pull();
    lastJson = JSON.stringify(S.episodes);
    online = true; S.sync = 'live'; render();
    setInterval(poll, POLL_MS);
    return;
  } catch (e) { S.err = e.message; console.error('Tracker sync:', e.message); }
  setTimeout(init, 10000); // keep retrying
  let eps = [];
  try { const raw = localStorage.getItem(KEY); if (raw) eps = JSON.parse(raw); } catch (e) {}
  S.episodes = Array.isArray(eps) ? eps : [];
  lastJson = JSON.stringify(S.episodes);
  S.sync = 'local';
  render();
}

// ── Domain logic ─────────────────────────────────────────────────
const activeStages = (ep) => STAGES.filter(s => !s.optional || (ep.optional && ep.optional[s.key]));
function currentStageKey(ep) {
  if (ep.links && ep.links.final) return 'done';
  let cur = 'tostart';
  activeStages(ep).forEach(s => { if (ep.links && ep.links[s.key]) cur = s.key; });
  return cur;
}
function status(ep) {
  if (ep.links && ep.links.final) return 'done';
  return activeStages(ep).some(s => ep.links && ep.links[s.key]) ? 'working' : 'tostart';
}
function health(ep) {
  if (ep.links && ep.links.final) return 'done';
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const due = new Date(ep.dueDate), start = new Date(ep.startDate);
  if (now > due) return 'overdue';
  const act = activeStages(ep);
  const completed = act.filter(s => ep.links && ep.links[s.key]).length / act.length;
  const span = (due - start) || 1;
  const elapsed = Math.min(1, Math.max(0, (now - start) / span));
  return (elapsed - completed > 0.2) ? 'atrisk' : 'ontrack';
}
function periodRange() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  if (S.period === 'day') return [now, now];
  if (S.period === 'week') { const s = new Date(now); s.setDate(now.getDate() - ((now.getDay() + 6) % 7)); const e = new Date(s); e.setDate(s.getDate() + 6); return [s, e]; }
  if (S.period === 'month') { const s = new Date(now.getFullYear(), now.getMonth(), 1); const e = new Date(now.getFullYear(), now.getMonth() + 1, 0); return [s, e]; }
  return [new Date(1970, 0, 1), new Date(3000, 0, 1)];
}
function inRange(dateStr, r) { if (!dateStr) return false; const d = new Date(dateStr); d.setHours(0, 0, 0, 0); return d >= r[0] && d <= r[1]; }
const fmt = (dateStr) => { if (!dateStr) return '\u2014'; const d = new Date(dateStr); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const statusMeta = (s) => ({ tostart: ['To start', '#b6b5af', '#201f22'], working: ['Working', '#ff7a68', '#2a1013'], done: ['Delivered', '#35c07a', '#0e2419'] }[s]);
const healthMeta = (h) => ({ done: ['Done', '#5ab6ff', '#0e2233'], ontrack: ['On track', '#35c07a', '#0e2419'], atrisk: ['At risk', '#ffd23f', '#262008'], overdue: ['Overdue', '#ff5a45', '#2a1013'] }[h]);
const chip = (c) => `display:inline-block;font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;color:${c[1]};background:${c[2]};`;
const code = (ep) => `${ep.series} \u00b7 S${ep.season}E${String(ep.ep).padStart(2, '0')}`;

function updateEp(id, fn) { save(S.episodes.map(e => e.id === id ? fn({ ...e, links: { ...e.links }, optional: { ...e.optional } }) : e)); }
function setLink(id, key, val) {
  updateEp(id, (e) => { e.links[key] = val; if (key === 'final') { if (val && !e.deliveredDate) e.deliveredDate = iso(new Date()); if (!val) e.deliveredDate = null; } return e; });
}
const blankLinks = () => { const l = {}; STAGES.forEach(s => l[s.key] = ''); return l; };

// ── Style constants ──────────────────────────────────────────────
const INPUT = 'display:block;width:100%;margin-top:5px;padding:9px 11px;border:1px solid #2a2a2e;border-radius:8px;background:#1d1d20;color:#f2f1ef;font-size:13px;';
const BTN_GHOST = 'border:1px solid #2a2a2e;background:#1d1d20;color:#c9c8c2;font-size:13px;font-weight:500;padding:9px 16px;border-radius:9px;cursor:pointer;';
const BTN_PRIMARY = 'border:none;background:#e11d2a;color:#fff;font-size:13px;font-weight:600;padding:9px 18px;border-radius:9px;cursor:pointer;';
const tab = (active) => `border:none;background:${active ? '#e11d2a' : 'transparent'};color:${active ? '#fff' : '#9a9a95'};font-size:13px;font-weight:${active ? 600 : 500};padding:7px 15px;border-radius:7px;cursor:pointer;`;
const CARD = 'background:#131315;border:1px solid #232327;border-radius:14px;';

// ── Render ───────────────────────────────────────────────────────
function render() {
  const eps = S.episodes;
  const r = periodRange();
  let cToStart = 0, cWorking = 0;
  eps.forEach(e => { const s = status(e); if (s === 'tostart') cToStart++; else if (s === 'working') cWorking++; });
  const cDelivered = eps.filter(e => inRange(e.deliveredDate, r)).length;
  const cDue = eps.filter(e => inRange(e.dueDate, r)).length;
  const scope = S.period === 'lifetime' ? eps.filter(e => status(e) !== 'done') : eps.filter(e => inRange(e.dueDate, r) && status(e) !== 'done');
  let hOnTrack = 0, hAtRisk = 0, hOverdue = 0;
  scope.forEach(e => { const h = health(e); if (h === 'atrisk') hAtRisk++; else if (h === 'overdue') hOverdue++; else hOnTrack++; });
  const pWord = { day: 'today', week: 'this week', month: 'this month', lifetime: '(lifetime)' }[S.period];

  const buckets = [{ key: 'tostart', label: 'To start' }, ...STAGES.map(s => ({ key: s.key, label: s.label }))]
    .filter(b => b.key !== 'final').concat([{ key: 'done', label: 'Delivered' }])
    .map(b => ({ label: b.label, color: STAGE_COLORS[b.key], count: eps.filter(e => currentStageKey(e) === b.key).length }));

  const syncMeta = { local: ['Local only', '#86857f', '#201f22'], connecting: ['Connecting…', '#ffd23f', '#262008'], live: ['Live · shared', '#35c07a', '#0e2419'], error: ['Sync error', '#ff5a45', '#2a1013'] }[S.sync];

  let html = `
  <div style="min-height:100vh;">
    <header style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding:20px 32px;background:#131315;border-bottom:1px solid #232327;position:sticky;top:0;z-index:20;">
      <div style="display:flex;align-items:baseline;gap:14px;">
        <span class="grotesk" style="font-weight:700;font-size:20px;letter-spacing:-0.01em;">Microdrama Pipeline</span>
        <span style="font-size:12px;color:#86857f;letter-spacing:0.04em;text-transform:uppercase;">${eps.length} episodes</span>
        <span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;color:${syncMeta[1]};background:${syncMeta[2]};"><span style="width:7px;height:7px;border-radius:50%;background:${syncMeta[1]};"></span>${syncMeta[0]}</span>
        ${S.sync === 'local' && S.err ? `<span style="font-size:11px;color:#ff7a68;max-width:420px;">${esc(S.err)}</span>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="display:flex;background:#1d1d20;border-radius:9px;padding:3px;">
          <button data-act="view" data-v="table" style="${tab(S.view === 'table')}">Table</button>
          <button data-act="view" data-v="board" style="${tab(S.view === 'board')}">Board</button>
        </div>
        <button data-act="openAdd" style="border:1px solid #2f2f34;background:#1d1d20;color:#f2f1ef;font-size:13px;font-weight:500;padding:9px 15px;border-radius:9px;cursor:pointer;">+ Episode</button>
        <button data-act="openBulk" style="${BTN_PRIMARY}">Bulk add</button>
      </div>
    </header>

    <section style="padding:24px 32px 8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px;">
        <h2 class="grotesk" style="font-size:15px;font-weight:600;margin:0;letter-spacing:0.02em;">Progress tracker</h2>
        <div style="display:flex;background:#1d1d20;border-radius:9px;padding:3px;">
          <button data-act="period" data-p="day" style="${tab(S.period === 'day')}">Daily</button>
          <button data-act="period" data-p="week" style="${tab(S.period === 'week')}">Weekly</button>
          <button data-act="period" data-p="month" style="${tab(S.period === 'month')}">Monthly</button>
          <button data-act="period" data-p="lifetime" style="${tab(S.period === 'lifetime')}">Lifetime</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px;">
        ${statCard('To start', cToStart)}
        ${statCard('Working', cWorking, '#ff5a45')}
        ${statCard('Delivered ' + pWord, cDelivered, '#35c07a')}
        ${statCard('Due ' + pWord, cDue)}
        <div style="${CARD}padding:16px 18px;">
          <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#86857f;margin-bottom:10px;">Health ${pWord}</div>
          <div style="display:flex;gap:14px;">
            ${miniStat(hOnTrack, 'ON TRACK', '#35c07a')}${miniStat(hAtRisk, 'AT RISK', '#ffd23f')}${miniStat(hOverdue, 'OVERDUE', '#ff5a45')}
          </div>
        </div>
      </div>
      <div style="${CARD}padding:16px 20px;margin-bottom:8px;">
        <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#86857f;margin-bottom:14px;">Live pipeline — where episodes sit right now</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          ${buckets.map(b => `<div style="flex:1;min-width:96px;background:#1a1a1d;border:1px solid #26262a;border-radius:11px;padding:12px 12px 13px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;"><span style="width:8px;height:8px;border-radius:50%;background:${b.color};"></span><span style="font-size:11px;font-weight:600;color:#cfcec9;">${b.label}</span></div>
            <div class="grotesk" style="font-size:26px;font-weight:600;line-height:1;">${b.count}</div></div>`).join('')}
        </div>
      </div>
    </section>
    ${S.view === 'table' ? tableView(eps) : boardView(eps)}
  </div>
  ${S.detailId ? detailView(eps) : ''}
  ${S.showAdd ? addModal() : ''}
  ${S.showBulk ? bulkModal() : ''}`;

  document.getElementById('root').innerHTML = html;
  wire();
}

function statCard(label, val, color) {
  return `<div style="${CARD}padding:16px 18px;"><div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#86857f;margin-bottom:8px;">${label}</div><div class="grotesk" style="font-size:34px;font-weight:600;line-height:1;${color ? 'color:' + color + ';' : ''}">${val}</div></div>`;
}
function miniStat(val, label, color) {
  return `<div><div class="grotesk" style="font-size:24px;font-weight:600;color:${color};">${val}</div><div style="font-size:10px;color:#86857f;letter-spacing:0.04em;">${label}</div></div>`;
}

function tableView(eps) {
  const rows = eps.slice().sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const cols = '2.1fr 1.2fr 2.6fr 1fr 1fr 1.1fr 1.1fr';
  let body = rows.map(ep => {
    const sm = statusMeta(status(ep)), hm = healthMeta(health(ep));
    const dots = STAGES.map(s => {
      const isActive = !s.optional || (ep.optional && ep.optional[s.key]);
      const done = ep.links && ep.links[s.key];
      return `<span title="${s.label}" style="width:22px;height:6px;border-radius:3px;background:${!isActive ? '#1f1f22' : (done ? STAGE_COLORS[s.key] : '#38383d')};"></span>`;
    }).join('');
    const overdue = health(ep) === 'overdue';
    return `<div class="tr-row" data-act="open" data-id="${ep.id}" style="display:grid;grid-template-columns:${cols};padding:14px 20px;border-bottom:1px solid #202023;cursor:pointer;align-items:center;">
      <div><div style="font-weight:600;font-size:14px;">${esc(code(ep))}</div><div style="font-size:12px;color:#86857f;margin-top:2px;">${esc(ep.title || activeStages(ep).length + ' stages')}</div></div>
      <div style="font-size:13px;color:#c9c8c2;">${esc(ep.assignee || '\u2014')}</div>
      <div style="display:flex;align-items:center;gap:5px;">${dots}</div>
      <div><span style="${chip(sm)}">${sm[0]}</span></div>
      <div><span style="${chip(hm)}">${hm[0]}</span></div>
      <div style="font-size:13px;color:#c9c8c2;">${fmt(ep.startDate)}</div>
      <div style="font-size:13px;color:${overdue ? '#ff6a58' : '#c9c8c2'};">${fmt(ep.dueDate)}</div>
    </div>`;
  }).join('');
  if (!eps.length) body = `<div style="padding:60px;text-align:center;color:#86857f;font-size:14px;">No episodes yet. Use <b>+ Episode</b> or <b>Bulk add</b> to get started.</div>`;
  return `<section style="padding:12px 32px 40px;"><div style="${CARD}overflow:hidden;">
    <div style="display:grid;grid-template-columns:${cols};padding:12px 20px;background:#1a1a1d;border-bottom:1px solid #232327;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#86857f;font-weight:600;">
      <div>Episode</div><div>Assignee</div><div>Pipeline</div><div>Status</div><div>Health</div><div>Start</div><div>Due</div></div>
    ${body}</div></section>`;
}

function boardView(eps) {
  const colDefs = [{ key: 'tostart', label: 'To start' }, ...STAGES.filter(s => s.key !== 'final').map(s => ({ key: s.key, label: s.label })), { key: 'done', label: 'Delivered' }];
  const cols = colDefs.map(cd => {
    const cards = eps.filter(e => currentStageKey(e) === cd.key).map(ep => {
      const hm = healthMeta(health(ep)), overdue = health(ep) === 'overdue';
      return `<div data-act="open" data-id="${ep.id}" style="background:#17171a;border:1px solid #26262a;border-left:3px solid ${hm[1]};border-radius:10px;padding:11px 13px;cursor:pointer;">
        <div style="font-weight:600;font-size:13px;">${esc(code(ep))}</div>
        <div style="font-size:12px;color:#86857f;margin:2px 0 8px;">${esc(ep.assignee || '\u2014')}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;"><span style="font-size:11px;color:${overdue ? '#ff6a58' : '#86857f'};">Due ${fmt(ep.dueDate)}</span><span style="${chip(hm)}">${hm[0]}</span></div></div>`;
    }).join('');
    return `<div style="width:230px;flex-shrink:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:0 4px 10px;">
        <div style="display:flex;align-items:center;gap:7px;"><span style="width:8px;height:8px;border-radius:50%;background:${STAGE_COLORS[cd.key]};"></span><span style="font-size:12px;font-weight:600;">${cd.label}</span></div>
        <span style="font-size:12px;color:#86857f;font-weight:600;">${eps.filter(e => currentStageKey(e) === cd.key).length}</span></div>
      <div style="display:flex;flex-direction:column;gap:8px;min-height:40px;">${cards}</div></div>`;
  }).join('');
  return `<section style="padding:12px 32px 40px;overflow-x:auto;"><div style="display:flex;gap:12px;min-width:min-content;">${cols}</div></section>`;
}

function detailView(eps) {
  const dep = eps.find(e => e.id === S.detailId);
  if (!dep) return '';
  const sm = statusMeta(status(dep)), hm = healthMeta(health(dep));
  const dateInput = 'display:block;width:100%;margin-top:5px;padding:8px 10px;border:1px solid #2a2a2e;border-radius:8px;background:#1d1d20;color:#f2f1ef;font-size:13px;';
  const stages = STAGES.map(s => {
    const enabled = !s.optional || (dep.optional && dep.optional[s.key]);
    const link = (dep.links && dep.links[s.key]) || '';
    const badge = s.optional && !enabled ? `<span style="font-size:10px;color:#86857f;background:#201f22;padding:2px 7px;border-radius:10px;">skipped</span>` : '';
    const toggleBtn = s.optional ? `<button data-act="toggle" data-id="${dep.id}" data-key="${s.key}" style="font-size:11px;border:1px solid #2a2a2e;background:#1d1d20;border-radius:7px;padding:4px 9px;cursor:pointer;color:#c9c8c2;">${enabled ? 'Skip' : 'Include'}</button>` : '';
    const linkRow = enabled ? `<div style="display:flex;gap:7px;">
        <input data-act="link" data-id="${dep.id}" data-key="${s.key}" placeholder="Paste frame.io / Drive link" value="${esc(link)}" style="flex:1;padding:8px 10px;border:1px solid #2a2a2e;border-radius:8px;font-size:12px;background:#1d1d20;color:#f2f1ef;">
        <a href="${link ? esc(link) : '#'}" target="_blank" style="display:flex;align-items:center;padding:0 14px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;color:#fff;background:${link ? '#e11d2a' : '#2a2a2e'};pointer-events:${link ? 'auto' : 'none'};">Open</a></div>` : '';
    return `<div style="background:#17171a;border:1px solid #26262a;border-radius:11px;padding:12px 14px;opacity:${enabled ? '1' : '0.5'};">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;"><span style="width:9px;height:9px;border-radius:50%;background:${link ? STAGE_COLORS[s.key] : (enabled ? '#38383d' : '#1f1f22')};"></span><span style="font-weight:600;font-size:13px;">${s.label}</span>${badge}</div>${toggleBtn}
      </div>${linkRow}</div>`;
  }).join('');
  return `<div style="position:fixed;inset:0;background:#0c0c0e;z-index:40;display:flex;flex-direction:column;">
    <div style="flex:1;overflow-y:auto;background:#101012;">
      <div style="padding:22px 32px;background:#17171a;position:sticky;top:0;z-index:2;border-bottom:1px solid #232327;">
        <div style="max-width:760px;margin:0 auto;display:flex;justify-content:space-between;align-items:flex-start;">
          <div><div class="grotesk" style="font-size:22px;font-weight:700;">${esc(code(dep))}</div><div style="font-size:13px;color:#86857f;margin-top:3px;">${esc(dep.title || dep.assignee || '')}</div></div>
          <button data-act="closeDetail" style="background:none;border:none;color:#86857f;font-size:24px;cursor:pointer;line-height:1;">×</button>
        </div>
        <div style="max-width:760px;margin:14px auto 0;display:flex;gap:8px;align-items:center;"><span style="${chip(sm)}">${sm[0]}</span><span style="${chip(hm)}">${hm[0]}</span><span style="font-size:12px;color:#86857f;">${esc(dep.assignee || '\u2014')}</span></div>
      </div>
      <div style="max-width:760px;margin:0 auto;padding:26px 32px 60px;">
        <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#86857f;margin-bottom:12px;">Episode details</div>
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px;margin-bottom:12px;">
          <label style="font-size:12px;color:#86857f;">Series<input data-act="f" data-id="${dep.id}" data-field="series" value="${esc(dep.series)}" style="${INPUT}"></label>
          <label style="font-size:12px;color:#86857f;">Season<input type="number" data-act="f" data-id="${dep.id}" data-field="season" value="${esc(dep.season)}" style="${INPUT}"></label>
          <label style="font-size:12px;color:#86857f;">Episode<input type="number" data-act="f" data-id="${dep.id}" data-field="ep" value="${esc(dep.ep)}" style="${INPUT}"></label>
        </div>
        <label style="font-size:12px;color:#86857f;display:block;margin-bottom:12px;">Title<input data-act="f" data-id="${dep.id}" data-field="title" value="${esc(dep.title || '')}" style="${INPUT}"></label>
        <label style="font-size:12px;color:#86857f;display:block;margin-bottom:22px;">Assignee<input data-act="f" data-id="${dep.id}" data-field="assignee" value="${esc(dep.assignee || '')}" style="${INPUT}"></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:22px;">
          <label style="font-size:12px;color:#86857f;">Start date<input type="date" data-act="f" data-id="${dep.id}" data-field="startDate" value="${esc(dep.startDate)}" style="${dateInput}"></label>
          <label style="font-size:12px;color:#86857f;">Due date<input type="date" data-act="f" data-id="${dep.id}" data-field="dueDate" value="${esc(dep.dueDate)}" style="${dateInput}"></label>
        </div>
        <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#86857f;margin-bottom:12px;">Deliverables</div>
        <div style="display:flex;flex-direction:column;gap:10px;">${stages}</div>
        <button data-act="remove" data-id="${dep.id}" style="margin-top:22px;width:100%;padding:11px;border:1px solid #4a1a1e;background:#23090c;color:#ff5a45;border-radius:9px;font-size:13px;font-weight:500;cursor:pointer;">Delete episode</button>
      </div>
    </div>
  </div>`;
}

function modalShell(title, inner, submitLabel, submitAct) {
  return `<div data-act="overlay" data-close="${submitAct === 'submitAdd' ? 'closeAdd' : 'closeBulk'}" style="position:fixed;inset:0;background:#000000aa;z-index:50;display:flex;align-items:center;justify-content:center;padding:20px;">
    <div data-stop="1" style="width:${submitAct === 'submitAdd' ? '440' : '460'}px;max-width:100%;background:#101012;border:1px solid #232327;border-radius:16px;overflow:hidden;">
      <div class="grotesk" style="padding:18px 24px;border-bottom:1px solid #232327;font-weight:600;font-size:16px;">${title}</div>
      <div style="padding:22px 24px;display:flex;flex-direction:column;gap:12px;">${inner}</div>
      <div style="padding:16px 24px;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid #232327;">
        <button data-act="${submitAct === 'submitAdd' ? 'closeAdd' : 'closeBulk'}" style="${BTN_GHOST}">Cancel</button>
        <button data-act="${submitAct}" style="${BTN_PRIMARY}">${submitLabel}</button>
      </div>
    </div></div>`;
}
const fld = (label, field, val, type, group) => `<label style="font-size:12px;color:#86857f;">${label}<input ${type ? `type="${type}"` : ''} data-act="af" data-group="${group}" data-field="${field}" value="${esc(val)}" style="${INPUT}"></label>`;

function addModal() {
  const a = S.af;
  const inner = `
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;">${fld('Series', 'series', a.series, '', 'af')}${fld('Season', 'season', a.season, 'number', 'af')}${fld('Episode', 'ep', a.ep, 'number', 'af')}</div>
    ${fld('Title (optional)', 'title', a.title, '', 'af')}
    ${fld('Assignee', 'assignee', a.assignee, '', 'af')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${fld('Start', 'startDate', a.startDate, 'date', 'af')}${fld('Due', 'dueDate', a.dueDate, 'date', 'af')}</div>`;
  return modalShell('Add episode', inner, 'Add episode', 'submitAdd');
}
function bulkModal() {
  const b = S.bf;
  const n = Math.max(1, +b.count || 1);
  const preview = `Creates ${n} episodes: ${b.series || 'Series'} S${b.season || 1} E${b.startEp || 1}\u2013E${(+b.startEp || 1) + n - 1}, due dates ${b.cadence || 3} days apart.`;
  const inner = `
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;">${fld('Series', 'series', b.series, '', 'bf')}${fld('Season', 'season', b.season, 'number', 'bf')}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${fld('Start at episode #', 'startEp', b.startEp, 'number', 'bf')}${fld('How many', 'count', b.count, 'number', 'bf')}</div>
    ${fld('Assignee', 'assignee', b.assignee, '', 'bf')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${fld('First start date', 'startDate', b.startDate, 'date', 'bf')}${fld('First due date', 'dueDate', b.dueDate, 'date', 'bf')}</div>
    ${fld("Days between each episode's dates", 'cadence', b.cadence, 'number', 'bf')}
    <div style="background:#1d1d20;border-radius:9px;padding:11px 13px;font-size:12px;color:#9a9a95;">${preview}</div>`;
  return modalShell('Bulk add episodes', inner, `Generate ${n} episodes`, 'submitBulk');
}

// ── Event wiring ─────────────────────────────────────────────────
function submitAdd() {
  const a = S.af; if (!a.series) return;
  const ep = { id: 'e' + Math.random().toString(36).slice(2, 9), series: a.series, season: +a.season || 1, ep: +a.ep || 1, title: a.title || '', assignee: a.assignee || '', startDate: a.startDate || iso(new Date()), dueDate: a.dueDate || iso(new Date()), optional: { edit2: false, edit3: false, edit4: false }, links: blankLinks(), deliveredDate: null };
  S.showAdd = false; save([...S.episodes, ep]);
}
function submitBulk() {
  const b = S.bf; if (!b.series) return;
  const n = Math.max(1, +b.count || 1), startEp = +b.startEp || 1, cad = +b.cadence || 3;
  const s0 = b.startDate ? new Date(b.startDate) : new Date(), d0 = b.dueDate ? new Date(b.dueDate) : new Date();
  const add = [];
  for (let i = 0; i < n; i++) {
    const s = new Date(s0); s.setDate(s0.getDate() + i * cad); const d = new Date(d0); d.setDate(d0.getDate() + i * cad);
    add.push({ id: 'e' + Math.random().toString(36).slice(2, 9) + i, series: b.series, season: +b.season || 1, ep: startEp + i, title: '', assignee: b.assignee || '', startDate: iso(s), dueDate: iso(d), optional: { edit2: false, edit3: false, edit4: false }, links: blankLinks(), deliveredDate: null });
  }
  S.showBulk = false; save([...S.episodes, ...add]);
}

function wire() {
  document.querySelectorAll('[data-act]').forEach(el => {
    const act = el.dataset.act;
    if (act === 'link' || act === 'f' || act === 'af') {
      el.addEventListener('change', (e) => handleInput(act, el, e));
      return;
    }
    el.addEventListener('click', (e) => handleClick(act, el, e));
  });
}

function handleInput(act, el, e) {
  const v = el.value;
  if (act === 'link') { setLink(el.dataset.id, el.dataset.key, v); return; }
  if (act === 'f') {
    const field = el.dataset.field;
    updateEp(el.dataset.id, (ep) => { ep[field] = (field === 'season' || field === 'ep') ? (+v || 1) : v; return ep; });
    return;
  }
  if (act === 'af') {
    const store = el.dataset.group === 'af' ? S.af : S.bf;
    store[el.dataset.field] = v;
    // no re-render on every keystroke; bulk preview updates on submit modal reopen — but refresh preview live:
    if (el.dataset.group === 'bf') render();
  }
}

function handleClick(act, el, e) {
  switch (act) {
    case 'view': S.view = el.dataset.v; render(); break;
    case 'period': S.period = el.dataset.p; render(); break;
    case 'open': S.detailId = el.dataset.id; render(); break;
    case 'closeDetail': S.detailId = null; render(); break;
    case 'remove': save(S.episodes.filter(x => x.id !== el.dataset.id)); S.detailId = null; render(); break;
    case 'toggle': updateEp(el.dataset.id, (ep) => { const k = el.dataset.key; ep.optional[k] = !ep.optional[k]; if (!ep.optional[k]) ep.links[k] = ''; return ep; }); break;
    case 'openAdd': S.showAdd = true; S.af = { series: '', season: 1, ep: 1, title: '', assignee: '', startDate: iso(new Date()), dueDate: iso(new Date()) }; render(); break;
    case 'closeAdd': S.showAdd = false; render(); break;
    case 'submitAdd': submitAdd(); break;
    case 'openBulk': S.showBulk = true; S.bf = { series: '', season: 1, startEp: 1, count: 10, assignee: '', startDate: iso(new Date()), dueDate: iso(new Date()), cadence: 3 }; render(); break;
    case 'closeBulk': S.showBulk = false; render(); break;
    case 'submitBulk': submitBulk(); break;
    case 'overlay': if (e.target === el) { S[el.dataset.close === 'closeAdd' ? 'showAdd' : 'showBulk'] = false; render(); } break;
  }
}

init();
