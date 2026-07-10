// Cloud sync (Supabase) — scaffold. Activates only when configured.
//
// TO ENABLE (user action required):
//   1. Create a Supabase project (supabase.com) and run supabase/schema.sql.
//   2. Fill in SUPABASE_URL and SUPABASE_ANON_KEY below (anon key is public-safe;
//      security is enforced by Row Level Security).
//   3. Add to the import map in index.html:
//      "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2"
//
// Design: local-first. localStorage stays the source of truth while offline;
// push/pull is last-write-wins per document kind ('save' | 'progress').

const SUPABASE_URL = '';        // e.g. https://xyzcompany.supabase.co
const SUPABASE_ANON_KEY = '';   // from Project Settings → API

export function cloudEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

let client = null;
export async function getClient() {
  if (!cloudEnabled()) return null;
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}

// push a local document up (call after local persist, debounced)
export async function pushDocument(kind, body) {
  const c = await getClient();
  if (!c) return;
  const { data: { user } } = await c.auth.getUser();
  if (!user) return;
  await c.from('documents').upsert({ user_id: user.id, kind, body, updated_at: new Date().toISOString() });
}

// pull the newer of local/remote on login
export async function pullDocument(kind, localTs) {
  const c = await getClient();
  if (!c) return null;
  const { data: { user } } = await c.auth.getUser();
  if (!user) return null;
  const { data } = await c.from('documents').select('body, updated_at').eq('user_id', user.id).eq('kind', kind).maybeSingle();
  if (!data) return null;
  return new Date(data.updated_at).getTime() > (localTs || 0) ? data.body : null;
}
