// Cloud sync (Supabase) — magic-link auth + last-write-wins document sync.
//
// Local-first: localStorage stays the source of truth while offline; push/pull
// is last-write-wins per document kind ('save' | 'progress'). Pushes that can't
// reach the server (offline / signed-out) are queued to localStorage and flushed
// on reconnect or next sign-in. The anon key below is PUBLISHABLE — safe in the
// client; access is enforced by Row Level Security (see supabase/schema.sql).

const SUPABASE_URL = 'https://kymbbdoatjhykdxjjujz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DZkH8afBzjJVdNamF5S8SA_CVIDAsWz';

export function cloudEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// Local-first fast path: don't load the (heavy) Supabase SDK at all unless the
// user actually has a session or is returning from a magic-link callback. This
// keeps signed-out boots (the common case) zero-network and fast.
function hasStoredSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^sb-.*-auth-token$/.test(k)) return true;
    }
  } catch { /* storage blocked */ }
  return false;
}
function isAuthCallback() {
  try { return /[#&](access_token|error_description)=/.test(window.location.hash); }
  catch { return false; }
}
function signedOut() { return !hasStoredSession() && !isAuthCallback(); }

let client = null;
export async function getClient() {
  if (!cloudEnabled()) return null;
  if (!client) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      // persistSession (default) stores the session in localStorage, so it
      // survives the full-page reload that switchRobot() triggers.
      client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch {
      return null;   // CDN blocked/offline — stay local-only, no console noise
    }
  }
  return client;
}

async function userOf(c) {
  try { const { data: { user } } = await c.auth.getUser(); return user; }
  catch { return null; }
}

// ── auth ─────────────────────────────────────────────────────────
export async function currentUser() {
  const c = await getClient();
  return c ? userOf(c) : null;
}

/** Send a passwordless magic link to the given email. */
export async function signInWithEmail(email) {
  const c = await getClient();
  if (!c) return { error: 'cloud disabled' };
  const { error } = await c.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  return { error: error ? (error.message || String(error)) : null };
}

export async function signOut() {
  const c = await getClient();
  if (c) { try { await c.auth.signOut(); } catch { /* ignore */ } }
}

/** Subscribe to auth state; fires immediately with the current user (or null). */
export async function onAuth(cb) {
  if (!cloudEnabled() || signedOut()) { cb(null); return; }   // don't load the SDK when signed out
  const c = await getClient();
  if (!c) { cb(null); return; }
  c.auth.onAuthStateChange((_evt, session) => cb(session?.user || null));
  cb(await userOf(c));
}

// ── offline-queued document sync ─────────────────────────────────
const QUEUE_KEY = 'sbl-cloud-queue-v1';
function loadQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '{}'); } catch { return {}; } }
function saveQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* ignore */ } }
function enqueue(kind, body) { const q = loadQueue(); q[kind] = { body, ts: Date.now() }; saveQueue(q); }
function dequeue(kind) { const q = loadQueue(); delete q[kind]; saveQueue(q); }

/** Push a local document up (after local persist). Queues on failure/offline. */
export async function pushDocument(kind, body) {
  if (signedOut()) { enqueue(kind, body); return; }   // stay local: queue, don't load the SDK
  const c = await getClient();
  const user = c && await userOf(c);
  if (!c || !user) { enqueue(kind, body); return; }
  try {
    const { error } = await c.from('documents')
      .upsert({ user_id: user.id, kind, body, updated_at: new Date().toISOString() });
    if (error) throw error;
    dequeue(kind);
  } catch { enqueue(kind, body); }
}

/** Return the remote doc body iff it's newer than localTs, else null. */
export async function pullDocument(kind, localTs) {
  if (signedOut()) return null;   // stay local when signed out
  const c = await getClient();
  const user = c && await userOf(c);
  if (!user) return null;
  try {
    const { data } = await c.from('documents')
      .select('body, updated_at').eq('user_id', user.id).eq('kind', kind).maybeSingle();
    if (!data) return null;
    return new Date(data.updated_at).getTime() > (localTs || 0) ? data.body : null;
  } catch { return null; }
}

/** Flush any queued pushes (call on reconnect / after sign-in). */
export async function flushQueue() {
  const q = loadQueue();
  for (const kind of Object.keys(q)) await pushDocument(kind, q[kind].body);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { flushQueue().catch(() => {}); });
}
