// Jarvis — the client agent loop (Milestone 2).
//
// Owns the conversation and the tool-execution loop; the model's decisions land
// on the build ONLY through window.__api (via TOOL_EXECUTORS). Flow per user
// message:
//   1. POST { messages, document } → /api/jarvis  (one model turn)
//   2. if the reply has tool_use blocks: run each against the api, append the
//      results as a user turn, and go back to 1
//   3. otherwise show the assistant's text and stop
//
// The endpoint is stateless; this loop carries the history. A hard step cap
// stops any runaway tool loop.
import { runTool } from '../api/tools.js';

const ENDPOINT = '/api/jarvis';
const MAX_STEPS = 8;   // model turns per user message (tool loops)

export function initJarvis({ api, onFlash } = {}) {
  const form = document.getElementById('jarvis-form');
  const input = document.getElementById('jarvis-input');
  const log = document.getElementById('jarvis-log');
  if (!form || !input || !log) return { send: async () => {} };

  const messages = [];   // Anthropic message history (user/assistant turns)
  let busy = false;

  function bubble(who, text) {
    const el = document.createElement('div');
    el.className = `jv-msg jv-${who}`;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function toolNote(name, input) {
    const el = document.createElement('div');
    el.className = 'jv-tool';
    const args = Object.entries(input || {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
    el.textContent = `⚙ ${name}(${args})`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  async function turn() {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, document: api.get_document() }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `Jarvis request failed (${res.status})`);
    }
    return res.json();   // { role, content, stop_reason }
  }

  async function send(text) {
    if (busy || !text.trim()) return;
    busy = true;
    input.disabled = true;
    bubble('user', text);
    messages.push({ role: 'user', content: text });

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const reply = await turn();
        const content = reply.content || [];
        messages.push({ role: 'assistant', content });

        // surface any assistant prose
        for (const block of content) {
          if (block.type === 'text' && block.text.trim()) bubble('bot', block.text.trim());
        }

        const toolUses = content.filter(b => b.type === 'tool_use');
        if (toolUses.length === 0) break;   // model is done

        // execute each tool against the live api, collect results
        const results = [];
        for (const tu of toolUses) {
          toolNote(tu.name, tu.input);
          const result = runTool(api, tu.name, tu.input);
          results.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(result),
            ...(result && result.ok === false ? { is_error: true } : {}),
          });
        }
        messages.push({ role: 'user', content: results });
        // loop: let the model see the results and decide the next move
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
