// Vercel Edge Function: relays one Refuter move to Claude and streams the text back.
// Set ANTHROPIC_API_KEY in the Vercel project settings. Optional: ANTHROPIC_MODEL, ALLOWED_ORIGIN.
import { hasStore, redis, LIMITS, quota, keys, clean, resetAt } from './_store.js';
export const config = { runtime: 'edge' };

const MAX_PROMPT = 40000;          // characters per move
const MAX_TOKENS = 1500;           // per answer
const PER_MINUTE = 8;              // moves per visitor per minute (per edge instance; a soft guard)
// Reading an uploaded paper needs a much longer prompt, so it gets its own, tighter allowance.
const MAX_PAPER = 130000, PAPER_TOKENS = 3000, PAPERS_PER_10MIN = 4;
const hits = new Map(), paperHits = new Map();

function limited(map, ip, max, ms){
  const now = Date.now(), win = map.get(ip) || [];
  const recent = win.filter(t => now - t < ms);
  recent.push(now); map.set(ip, recent);
  if (map.size > 5000) map.clear();
  return recent.length > max;
}
const fail = (status, code) => new Response(JSON.stringify({ code }), { status, headers: { 'content-type': 'application/json' } });

export default async function handler(req){
  if (req.method !== 'POST') return fail(405, 'invalid_request');
  const origin = req.headers.get('origin') || '';
  const allowed = process.env.ALLOWED_ORIGIN || ('https://' + (req.headers.get('host') || ''));
  if (origin && origin !== allowed && origin !== 'https://' + (req.headers.get('host') || '')) return fail(403, 'not_granted');
  if (!process.env.ANTHROPIC_API_KEY) return fail(500, 'sampling_disabled');
  const ip = (req.headers.get('x-forwarded-for') || 'anon').split(',')[0].trim();
  let body;
  try { body = await req.json(); } catch (e) { return fail(400, 'invalid_request'); }
  const paper = body.kind === 'paper';
  if (paper ? limited(paperHits, ip, PAPERS_PER_10MIN, 600000) : limited(hits, ip, PER_MINUTE, 60000)) return fail(429, 'rate_limited');
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt) return fail(400, 'invalid_request');
  if (prompt.length > (paper ? MAX_PAPER : MAX_PROMPT)) return fail(413, 'prompt_too_large');

  // Daily allowance (only when the database is connected). A "strike" is paid for by a watched ad,
  // so it spends a strike credit instead of a move. Reading a paper has its own limit above.
  const sid = clean(body.sid, 40) || ('ip-' + ip);
  if (hasStore() && !paper) {
    const k = keys(sid, ip);
    try {
      if (body.kind === 'strike') {
        const [left] = await redis([['DECR', k.strikes]]);
        if (left < 0) { await redis([['INCR', k.strikes]]); return fail(402, 'no_strike'); }
      } else {
        const ttl = Math.ceil((resetAt() - Date.now()) / 1000) + 3600;
        const [used, ipUsed, bonus] = await redis([['INCR', k.used], ['INCR', k.ip], ['GET', k.bonus], ['EXPIRE', k.used, ttl], ['EXPIRE', k.ip, ttl]]);
        if (used > LIMITS.daily + (parseInt(bonus, 10) || 0) || ipUsed > LIMITS.perIp) {
          await redis([['DECR', k.used], ['DECR', k.ip]]);
          const q = await quota(sid, ip);
          return new Response(JSON.stringify({ code: 'daily_limit', quota: q }), { status: 429, headers: { 'content-type': 'application/json' } });
        }
      }
    } catch (e) { /* if the store is down, let the move through rather than block everyone */ }
  }

  const up = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: paper ? PAPER_TOKENS : MAX_TOKENS, stream: true, messages: [{ role: 'user', content: prompt }] }),
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
