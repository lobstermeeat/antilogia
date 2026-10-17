// Vercel Edge Function: relays one Refuter move to Claude and streams the text back.
// Set ANTHROPIC_API_KEY in the Vercel project settings. Optional: ANTHROPIC_MODEL, ALLOWED_ORIGIN.
export const config = { runtime: 'edge' };

const MAX_PROMPT = 40000;          // characters per move
const MAX_TOKENS = 1500;           // per answer
const PER_MINUTE = 8;              // moves per visitor per minute (per edge instance; a soft guard)
const hits = new Map();

function limited(ip){
  const now = Date.now(), win = hits.get(ip) || [];
  const recent = win.filter(t => now - t < 60000);
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > PER_MINUTE;
}
const fail = (status, code) => new Response(JSON.stringify({ code }), { status, headers: { 'content-type': 'application/json' } });

export default async function handler(req){
  if (req.method !== 'POST') return fail(405, 'invalid_request');
  const origin = req.headers.get('origin') || '';
  const allowed = process.env.ALLOWED_ORIGIN || ('https://' + (req.headers.get('host') || ''));
  if (origin && origin !== allowed && origin !== 'https://' + (req.headers.get('host') || '')) return fail(403, 'not_granted');
  if (!process.env.ANTHROPIC_API_KEY) return fail(500, 'sampling_disabled');
  const ip = (req.headers.get('x-forwarded-for') || 'anon').split(',')[0].trim();
  if (limited(ip)) return fail(429, 'rate_limited');

  let body;
  try { body = await req.json(); } catch (e) { return fail(400, 'invalid_request'); }
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt) return fail(400, 'invalid_request');
  if (prompt.length > MAX_PROMPT) return fail(413, 'prompt_too_large');

  const up = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: MAX_TOKENS, stream: true, messages: [{ role: 'user', content: prompt }] }),
    signal: req.signal
  }).catch(() => null);
  if (!up) return fail(502, 'upstream_error');
  if (!up.ok) return fail(up.status === 429 ? 429 : 502, up.status === 429 ? 'rate_limited' : up.status === 400 ? 'invalid_request' : 'upstream_error');

  // Turn Anthropic's event stream into plain text chunks.
  const dec = new TextDecoder(), enc = new TextEncoder();
  let buf = '';
  const out = up.body.pipeThrough(new TransformStream({
    transform(chunk, ctl){
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        try {
          const ev = JSON.parse(line.slice(5));
          if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') ctl.enqueue(enc.encode(ev.delta.text));
          if (ev.type === 'error') ctl.enqueue(enc.encode('\u0000ERR'));
        } catch (e) {}
      }
    }
  }));
  return new Response(out, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
