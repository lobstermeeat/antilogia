// Vercel Edge Function: the visitor's daily allowance and rewarded ads.
// GET  ?sid=…                         -> { quota, ads }   (how many moves are left today, ad settings)
// POST { action:'start', sid, reward } -> { ticket }       (an ad is about to play; reward is 'moves' or 'strike')
// POST { action:'claim', sid, ticket } -> { quota }        (the ad finished; grant the reward)
// Web rewarded ads have no server-side verification, so a ticket only proves a few seconds passed.
// ADS_PER_DAY keeps the most anyone can gain that way small.
import { hasStore, redis, LIMITS, quota, keys, clean, ipOf, resetAt } from './_store.js';
export const config = { runtime: 'edge' };

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (status, code) => json(status, { code });
function ads(){
  let house = null;
  try { house = process.env.HOUSE_AD ? JSON.parse(process.env.HOUSE_AD) : null; } catch (e) {}
  return {
    unit: process.env.ADS_TEST === '1' ? '/22639388115/rewarded_web_example' : (process.env.AD_UNIT_PATH || ''),
    test: process.env.ADS_TEST === '1',
    house: house,
    moves: LIMITS.adMoves
  };
}
function rid(){ const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); }

export default async function handler(req){
  const origin = req.headers.get('origin') || '', host = req.headers.get('host') || '';
  const allowed = process.env.ALLOWED_ORIGIN || ('https://' + host);
  if (origin && origin !== allowed && origin !== 'https://' + host) return fail(403, 'not_granted');
  const ip = ipOf(req), url = new URL(req.url);

  if (req.method === 'GET') {
    const sid = clean(url.searchParams.get('sid'), 40);
    if (!hasStore() || !sid) return json(200, { quota: null, ads: ads() });
    try { return json(200, { quota: await quota(sid, ip), ads: ads() }); }
    catch (e) { return json(200, { quota: null, ads: ads() }); }
  }
  if (req.method !== 'POST') return fail(405, 'invalid_request');
  let body; try { body = await req.json(); } catch (e) { return fail(400, 'invalid_request'); }
  const sid = clean(body && body.sid, 40);
  if (!sid) return fail(400, 'invalid_request');
  // Without the database there is nothing to enforce: the page grants rewards locally.
  if (!hasStore()) return json(200, { ticket: 'local', quota: null });

  try {
    const k = keys(sid, ip);
    if (body.action === 'start') {
      const reward = body.reward === 'strike' ? 'strike' : 'moves';
      const q = await quota(sid, ip);
      if (q.adsLeft <= 0) return json(429, { code: 'ads_exhausted', quota: q });
      const t = rid();
      await redis([['SET', 'adt:' + t, JSON.stringify({ sid: sid, reward: reward, at: Date.now() }), 'EX', 3600]]);
      return json(200, { ticket: t, quota: q });
    }
    if (body.action === 'claim') {
      const t = clean(body.ticket, 40);
      const [raw] = await redis([['GETDEL', 'adt:' + t]]);
      if (!raw) return fail(404, 'no_ticket');
      const tk = JSON.parse(raw);
      if (tk.sid !== sid) return fail(403, 'no_ticket');
      if (Date.now() - tk.at < LIMITS.minAdMs) return fail(425, 'too_soon');
      const q0 = await quota(sid, ip);
      if (q0.adsLeft <= 0) return json(429, { code: 'ads_exhausted', quota: q0 });
      const ttl = Math.ceil((resetAt() - Date.now()) / 1000) + 3600;
      const cmds = [['INCR', k.ads], ['EXPIRE', k.ads, ttl], ['INCR', k.adsIp], ['EXPIRE', k.adsIp, ttl]];
      if (tk.reward === 'strike') cmds.push(['INCR', k.strikes], ['EXPIRE', k.strikes, 7 * 86400]);
      else cmds.push(['INCRBY', k.bonus, LIMITS.adMoves], ['EXPIRE', k.bonus, ttl]);
      await redis(cmds);
      return json(200, { reward: tk.reward, quota: await quota(sid, ip) });
    }
    return fail(400, 'invalid_request');
  } catch (e) { return fail(502, 'store_error'); }
}
