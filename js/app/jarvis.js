// Jarvis — the client agent loop (Milestone 2), on the Gemini API.
//
// Owns the conversation (Gemini `contents`) and the tool-execution loop; the
// model's decisions land on the build ONLY through window.__api (via runTool).
// Flow per user message:
//   1. POST { contents, document } → /api/jarvis  (one model turn)
//   2. if the reply has functionCall parts: run each against the api, append the
//      results as a user turn of functionResponse parts, and go back to 1
//   3. otherwise show the model's text and stop
//
// A free-tier QUOTA gate caps how many messages a signed-out / free user can
// send per day, so the shared Gemini free key can't be burned through. Pro users
// (profiles.tier) are uncapped. The gate is client-side (localStorage) — good
// enough to protect the free key; server-side enforcement lands with real auth.
import { runTool } from '../api/tools.js';

const ENDPOINT = '/api/jarvis';
const MAX_STEPS = 8;          // model turns per user message (tool loops)
const FREE_DAILY = 25;        // free/anon messages per day per browser
const USAGE_KEY = 'gyro-jarvis-usage';

export function initJarvis({ api, onFlash, getTier, onUpgrade } = {}) {
  const form = document.getElementById('jarvis-form');
  const input = document.getElementById('jarvis-input');
  const log = document.getElementById('jarvis-log');
  if (!form || !input || !log) return { send: async () => {} };

  const contents = [];   // Gemini message history (user/model turns)
  let busy = false;

  function bubble(who, text) {
    const el = document.createElement('div');
    el.className = `jv-msg jv-${who}`;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function toolNote(name, args) {
    const el = document.createElement('div');
    el.className = 'jv-tool';
    const a = Object.entries(args || {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
    el.textContent = `⚙ ${name}(${a})`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  // ── free-tier quota ───────────────────────────────────────────
  function today() { return new Date().toISOString().slice(0, 10); }
  function usage() {
    try {
      const u = JSON.parse(localStorage.getItem(USAGE_KEY) || 'null');
      if (u && u.date === today()) return u;
    } catch {}
    return { date: today(), count: 0 };
  }
  function bumpUsage() {
    const u = usage(); u.count += 1;
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch {}
  }
  function overQuota() {
    const tier = (getTier && getTier()) || 'free';
    if (tier !== 'free') return false;      // pro/paid: uncapped
    return usage().count >= FREE_DAILY;
  }

  async function turn() {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents, document: api.get_document() }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      if (res.status === 429) throw new Error('Jarvis is rate-limited right now — try again in a moment.');
      throw new Error(e.error || `Jarvis request failed (${res.status})`);
    }
    return res.json();   // { content:{role,parts}, finishReason }
  }

  async function send(text) {
    if (busy || !text.trim()) return;
    if (overQuota()) {
      bubble('err', `Daily free limit reached (${FREE_DAILY} messages). Sign in / upgrade for more.`);
      onUpgrade?.();
      return;
    }
    busy = true;
    input.disabled = true;
    bubble('user', text);
    contents.push({ role: 'user', parts: [{ text }] });
    bumpUsage();   // one user message = one unit, regardless of tool round-trips

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const reply = await turn();
        const parts = (reply.content && reply.content.parts) || [];
        contents.push(reply.content || { role: 'model', parts: [] });

        for (const p of parts) {
          if (p.text && p.text.trim()) bubble('bot', p.text.trim());
        }

        const calls = parts.filter(p => p.functionCall);
        if (calls.length === 0) break;   // model is done

        const responseParts = [];
        for (const p of calls) {
          const { name, args } = p.functionCall;
          toolNote(name, args);
          const result = runTool(api, name, args || {});
          responseParts.push({ functionResponse: { name, response: wrap(result) } });
        }
        contents.push({ role: 'user', parts: responseParts });
      }
    } catch (e) {
      bubble('err', e.message || 'Jarvis failed');
      onFlash?.(e.message || 'Jarvis failed', 'bad');
    } finally {
      busy = false;
      input.disabled = false;
      input.focus();
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    send(text);
  });

  return { send };
}

// Gemini requires functionResponse.response to be a JSON object (not an array or
// scalar) — wrap anything else so the loop never sends a malformed part.
function wrap(result) {
  return (result && typeof result === 'object' && !Array.isArray(result)) ? result : { result };
}
