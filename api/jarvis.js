// Vercel Edge Function — the Jarvis backend (Milestone 2).
//
// The browser never holds the Anthropic key. This endpoint takes the running
// conversation + a snapshot of the current build, calls the Messages API with
// the shared tool contract, and returns Claude's reply (text + any tool_use
// blocks). The CLIENT executes tool calls against window.__api and loops back
// with tool_result — so this function is stateless: one model turn per request.
//
// Runtime: Edge (fast cold starts, streams-capable). No SDK — a single fetch to
// keep the zero-dependency ethos. Set ANTHROPIC_API_KEY in the Vercel project.
import { TOOL_SCHEMAS, SYSTEM_PROMPT } from '../js/api/tools.js';

export const config = { runtime: 'edge' };

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 1024;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: 'Jarvis is not configured (no API key on the server).' }, 503);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }

  const { messages, document } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: '`messages` array required' }, 400);
  }
  // Guardrail: cap conversation size so a runaway client can't rack up tokens.
  if (messages.length > 40) return json({ error: 'Conversation too long' }, 413);

  // Give the model a compact view of the current build as extra system context.
  const system = document
    ? `${SYSTEM_PROMPT}\n\nCurrent build (RobotDoc):\n${JSON.stringify(summarize(document))}`
    : SYSTEM_PROMPT;

  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: TOOL_SCHEMAS,
        messages,
      }),
    });
  } catch (e) {
    return json({ error: 'Upstream request failed', detail: String(e && e.message || e) }, 502);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return json({ error: 'Anthropic API error', status: upstream.status, detail }, 502);
  }

  const data = await upstream.json();
  // Return only what the client agent loop needs: the assistant turn.
  return json({
    role: data.role,
    content: data.content,
    stop_reason: data.stop_reason,
    usage: data.usage,
  });
}

// Trim the doc to the fields the model reasons about (ids, types, params, nets),
// dropping transforms/colors/meta so the context stays small.
function summarize(doc) {
  return {
    components: (doc.components || []).map(c => ({ id: c.id, type: c.type, params: c.params })),
    nets: (doc.nets || []).map(n => ({ endpoints: n.endpoints })),
  };
}
