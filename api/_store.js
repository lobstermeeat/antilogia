// Shared helpers for the daily allowance and ad rewards. Files starting with "_" are not routes on Vercel.
// Uses the same Upstash Redis database as the public shelf (KV_REST_API_URL / KV_REST_API_TOKEN).
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const hasStore = () => !!(URL_ && TOKEN);
export async function redis(cmds){
  const r = await fetch(URL_ + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('store ' + r.status);
  return (await r.json()).map(x => x.result);
}

const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
export const LIMITS = {
  daily: num(process.env.DAILY_MOVES, 40),        // free Claude moves per visitor per day
  perIp: num(process.env.DAILY_IP_MOVES, 400),    // ceiling for everyone behind one network (a campus, say)
  adMoves: num(process.env.AD_MOVES, 10),         // moves added by one ad
  adsPerDay: num(process.env.ADS_PER_DAY, 6),     // rewarded ads a visitor can watch per day
  minAdMs: num(process.env.AD_MIN_SECONDS, 5) * 1000
};

// The day rolls over at midnight UTC.
export function day(){ return new Date().toISOString().slice(0, 10); }
export function resetAt(){ const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); }
export const clean = (v, max) => typeof v === 'string' ? v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, max) : '';
export const ipOf = req => (req.headers.get('x-forwarded-for') || 'anon').split(',')[0].trim();
export const keys = (sid, ip) => {
  const d = day();
  return { used: 'q:' + d + ':u:' + sid, ip: 'q:' + d + ':ip:' + ip, bonus: 'q:' + d + ':b:' + sid, ads: 'q:' + d + ':a:' + sid, adsIp: 'q:' + d + ':aip:' + ip, strikes: 'strk:' + sid };
}
export async function quota(sid, ip){
  const k = keys(sid, ip);
  const [used, bonus, ads, strikes, adsIp] = await redis([['GET', k.used], ['GET', k.bonus], ['GET', k.ads], ['GET', k.strikes], ['GET', k.adsIp]]);
  const limit = LIMITS.daily + num(bonus, 0);
  return { used: num(used, 0), limit: limit, left: Math.max(0, limit - num(used, 0)), adsLeft: Math.max(0, Math.min(LIMITS.adsPerDay - num(ads, 0), LIMITS.adsPerDay * 10 - num(adsIp, 0))), adMoves: LIMITS.adMoves, strikes: num(strikes, 0), resetAt: resetAt() };
}
