// Vercel Edge Function — the Jarvis backend (Milestone 2), on the Gemini API.
//
// The browser never holds the key. This endpoint takes the running conversation
// (Gemini `contents`) + a snapshot of the current build, calls generateContent
// with the shared tool contract, and returns the model's turn (text + any
// functionCall parts). The CLIENT executes tool calls against window.__api and
// loops back with functionResponse parts — so this function is stateless.
//
// Runtime: Edge. No SDK — a single fetch. Set GEMINI_API_KEY in the Vercel
// project (a free-tier AI Studio key, format "AIza…"). GEMINI_MODEL optionally
// overrides the model (default: gemini-2.5-flash-lite — the roomiest free tier:
// 15 RPM / 1,000 requests-per-day).
import { geminiFunctionDeclarations, SYSTEM_PROMPT } from '../js/api/tools.js';

export const config = { runtime: 'edge' };

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const key = process.env.GEMINI_API_KEY;
  if (!key) return json({ error: 'Jarvis is not configured (no API key on the server).' }, 503);
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }

  const { contents, document } = body || {};
  if (!Array.isArray(contents) || contents.length === 0) {
    return json({ error: '`contents` array required' }, 400);
  }
  // Guardrail: cap conversation size so a runaway client can't rack up tokens.
  if (contents.length > 40) return json({ error: 'Conversation too long' }, 413);

  const system = document
    ? `${SYSTEM_PROMPT}\n\nCurrent build (RobotDoc):\n${JSON.stringify(summarize(document))}`
    : SYSTEM_PROMPT;

  let upstream;
  try {
    upstream = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        tools: [{ functionDeclarations: geminiFunctionDeclarations() }],
        // keep the model terse + cheap; it should call tools, not monologue
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        contents,
      }),
    });
  } catch (e) {
    return json({ error: 'Upstream request failed', detail: String(e && e.message || e) }, 502);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    // surface Gemini's 429 (rate/quota) distinctly so the client can back off
    return json({ error: 'Gemini API error', status: upstream.status, detail }, upstream.status === 429 ? 429 : 502);
  }

  const data = await upstream.json();
  const cand = data.candidates && data.candidates[0];
  if (!cand || !cand.content) {
    const reason = (data.promptFeedback && data.promptFeedback.blockReason) || cand?.finishReason || 'no candidate';
    return json({ error: `Jarvis produced no reply (${reason})` }, 502);
  }
  // Return only the client-relevant slice: the model turn.
  return json({
    content: cand.content,          // { role:'model', parts:[ {text} | {functionCall} ] }
    finishReason: cand.finishReason,
    usage: data.usageMetadata,
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
