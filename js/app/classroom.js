// Classroom layer: a teacher creates a class (gets a join code), students join
// by code, and the teacher sees a roster + each student's lesson progress with a
// CSV export. Built on cloud.js (Supabase) — all reads are RLS-scoped; joins go
// through the SECURITY DEFINER join_class/create_class RPCs (see
// supabase/migrations/0002_classroom.sql). Inert until signed in.
import { cloudEnabled, getClient, currentUser } from './cloud.js';

// ── data ─────────────────────────────────────────────────────────
async function rpc(name, args) {
  const c = await getClient(); if (!c) return { error: 'offline' };
  const { data, error } = await c.rpc(name, args);
  return { data, error: error ? (error.message || String(error)) : null };
}
export const createClass = (name) => rpc('create_class', { p_name: name });
export const joinClass = (code) => rpc('join_class', { p_code: code });

export async function setDisplayName(name) {
  const c = await getClient(); const u = await currentUser();
  if (!c || !u || !name) return;
  try { await c.from('profiles').update({ display_name: name }).eq('id', u.id); } catch { /* best-effort */ }
}

async function myClasses() {
  const c = await getClient(); const u = await currentUser();
  if (!c || !u) return { taught: [], enrolled: [] };
  const [taughtRes, enrolledRes] = await Promise.all([
    c.from('classes').select('*').eq('teacher_id', u.id).order('created_at'),
    c.from('class_members').select('classes(*)').eq('student_id', u.id),
  ]);
  const taught = taughtRes.data || [];
  const enrolled = (enrolledRes.data || []).map(r => r.classes).filter(Boolean).filter(cl => cl.teacher_id !== u.id);
  return { taught, enrolled };
}

async function rosterWithProgress(classId) {
  const c = await getClient(); if (!c) return [];
  const { data: members } = await c.from('class_members')
    .select('student_id, joined_at, profiles(display_name)').eq('class_id', classId);
  const ids = (members || []).map(m => m.student_id);
  let docs = [];
  if (ids.length) {
    const { data } = await c.from('documents').select('user_id, body').eq('kind', 'progress').in('user_id', ids);
    docs = data || [];
  }
  const byUser = Object.fromEntries(docs.map(d => [d.user_id, d.body || {}]));
  return (members || []).map(m => ({
    id: m.student_id,
    name: (m.profiles && m.profiles.display_name) || 'Builder',
    progress: byUser[m.student_id] || {},
  }));
}

function summarize(progress) {
  const vals = Object.values(progress);
  return { completed: vals.filter(s => s > 0).length, stars: vals.reduce((a, s) => a + s, 0) };
}

// ── UI ───────────────────────────────────────────────────────────
export function initClassroom() {
  if (!cloudEnabled()) return { open: () => {} };

  const panel = document.createElement('div');
  panel.id = 'classroom-panel';
  panel.className = 'hidden';
  document.body.appendChild(panel);

  function close() { panel.classList.add('hidden'); panel.innerHTML = ''; }

  async function open() {
    panel.classList.remove('hidden');
    panel.innerHTML = `<div class="cr-card"><div class="cr-head"><h2>Classroom</h2><button class="cr-close" aria-label="Close">✕</button></div><div class="cr-body">Loading…</div></div>`;
    panel.querySelector('.cr-close').addEventListener('click', close);
    const u = await currentUser();
    const body = panel.querySelector('.cr-body');
    if (!u) { body.innerHTML = `<p class="cr-empty">Sign in to create or join a class.</p>`; return; }
    await renderHome(body);
  }

  async function renderHome(body) {
    const { taught, enrolled } = await myClasses();
    body.innerHTML = `
      <section class="cr-sec">
        <div class="cr-sec-head"><h3>Teaching</h3><button class="cr-btn" id="cr-create">+ Create a class</button></div>
        <div id="cr-taught">${taught.length ? taught.map(cl => `
          <button class="cr-class" data-class="${cl.id}" data-name="${escapeHtml(cl.name)}">
            <span class="cr-class-name">${escapeHtml(cl.name)}</span>
            <span class="cr-code">code <b>${cl.join_code}</b></span>
          </button>`).join('') : '<p class="cr-empty">No classes yet. Create one and share the code.</p>'}</div>
      </section>
      <section class="cr-sec">
        <div class="cr-sec-head"><h3>Enrolled</h3><button class="cr-btn" id="cr-join">+ Join a class</button></div>
        <div id="cr-enrolled">${enrolled.length ? enrolled.map(cl => `
          <div class="cr-class static"><span class="cr-class-name">${escapeHtml(cl.name)}</span></div>`).join('') : '<p class="cr-empty">Enter a class code from your teacher.</p>'}</div>
      </section>`;
    body.querySelector('#cr-create').addEventListener('click', () => promptCreate(body));
    body.querySelector('#cr-join').addEventListener('click', () => promptJoin(body));
    for (const btn of body.querySelectorAll('[data-class]')) {
      btn.addEventListener('click', () => renderRoster(body, btn.dataset.class, btn.dataset.name));
    }
  }

  function promptCreate(body) {
    const name = window.prompt('Class name (e.g. "Period 3 Robotics"):', '');
    if (name === null) return;
    createClass(name).then(({ error }) => { if (error) window.alert('Could not create class: ' + error); renderHome(body); });
  }
  function promptJoin(body) {
    const code = window.prompt('Class code from your teacher:', '');
    if (!code) return;
    const name = window.prompt('Your name (so your teacher can find you):', '');
    joinClass(code).then(async ({ error }) => {
      if (error) { window.alert('Could not join: ' + error); return; }
      if (name) await setDisplayName(name);
      renderHome(body);
    });
  }

  async function renderRoster(body, classId, className) {
    body.innerHTML = `<button class="cr-back" id="cr-back">‹ All classes</button>
      <div class="cr-roster-head"><h3>${escapeHtml(className)}</h3><button class="cr-btn" id="cr-csv">Export CSV</button></div>
      <div id="cr-roster">Loading roster…</div>`;
    body.querySelector('#cr-back').addEventListener('click', () => renderHome(body));
    const rows = await rosterWithProgress(classId);
    const host = body.querySelector('#cr-roster');
    if (!rows.length) { host.innerHTML = '<p class="cr-empty">No students have joined yet. Share the class code.</p>'; }
    else {
      host.innerHTML = `<table class="cr-table"><thead><tr><th>Student</th><th>Lessons done</th><th>Stars</th></tr></thead>
        <tbody>${rows.map(r => { const s = summarize(r.progress); return `<tr><td>${escapeHtml(r.name)}</td><td>${s.completed}</td><td>★ ${s.stars}</td></tr>`; }).join('')}</tbody></table>`;
    }
    body.querySelector('#cr-csv').addEventListener('click', () => exportCsv(className, rows));
  }

  function exportCsv(className, rows) {
    const lessonIds = [...new Set(rows.flatMap(r => Object.keys(r.progress)))].sort();
    const header = ['Student', 'Lessons done', 'Total stars', ...lessonIds];
    const lines = [header.join(',')];
    for (const r of rows) {
      const s = summarize(r.progress);
      lines.push([csv(r.name), s.completed, s.stars, ...lessonIds.map(id => r.progress[id] || 0)].join(','));
    }
    const blob = new window.Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${className.replace(/[^\w]+/g, '_')}_progress.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return { open };
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function csv(s) { return /[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s; }
