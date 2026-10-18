# Antilogia

Pick a philosopher in a sunlit 3D agora; an AI Refuter knocks their argument down one point at a time. Or bring a fight from home.

- `index.html`: the whole site (3D scene, portraits, debate UI)
- `api/refute.js`: Vercel Edge Function that relays each move to Claude with your API key
- `api/ads.js`: each visitor's daily allowance and rewarded-ad rewards (shared helpers in `api/_store.js`)
- `api/papers.js`: the public shelf of shared papers (stores only the reconstructed argument, never the uploaded file)

When an argument breaks, the temple crumbles, the claims shatter and a verdict stamp slams down; sound effects are synthesized in the browser, so there are no audio files to host. Attackers can aim, pick a line of attack and scout weak spots; defenders can repair a fallen claim, add a missing link or scale back the conclusion, and the Refuter judges the repair.

## Deploy (Vercel)
1. vercel.com → Add New → Project → import this repo. Framework preset: **Other**. No build command.
2. Settings → Environment Variables: `ANTHROPIC_API_KEY` = your key from console.anthropic.com. Optional: `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `ALLOWED_ORIGIN` (e.g. `https://antilogia.com` once you add a custom domain).
3. Redeploy. Set a monthly spend limit in the Anthropic console.

The function caps prompt size and answer length and soft-limits each visitor to 8 moves a minute.

## Papers and the public shelf
Anyone can upload a paper (PDF, Word or text). It is read in the browser, Claude reconstructs its main argument, the uploader checks it, and the debate starts. Sharing on the public shelf is optional; shared papers record which premise falls most often, so authors get feedback.

The shelf needs a small database, added once:
1. In the Vercel project, open **Storage → Create Database**, pick **Upstash for Redis** (free plan), and connect it to this project. It adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.
2. Redeploy.

Without it, uploading and private debates still work; the shelf just says it is not switched on. Each paper submitted to the shelf is screened by a short Claude check first (`MODERATION_MODEL`, default `claude-haiku-5-5`). Papers reported by three different visitors are hidden. Reading a paper uses a longer prompt, so it has its own limit of 4 papers per visitor every 10 minutes.

## Daily allowance and rewarded ads
There is no login and no paid tier. Each visitor gets a number of free moves a day (every Claude call counts as one). When they run out, an "Intermission" page offers a short ad for more moves. In attack mode, a **Free hit** button lets them watch an ad and have the Refuter land one blow for them: a standing part is weakened, a wobbly one falls. Free hits are marked as assisted moves and left out of a paper's community record.

This uses the same Upstash database as the shelf; without it there is no daily limit. Settings (Vercel → Settings → Environment Variables):
- `DAILY_MOVES` (default 40), `AD_MOVES` moves per ad (default 10), `ADS_PER_DAY` per visitor (default 6), `DAILY_IP_MOVES` ceiling per network (default 400).
- `AD_UNIT_PATH`: your Google Ad Manager rewarded ad unit, e.g. `/1234567/antilogia_rewarded`. Set `ADS_TEST=1` to try Google's test ad unit first.
- Until an ad unit is set (or when no ad fills), the page shows a 15-second house ad instead. Change it with `HOUSE_AD`, JSON like `{"label":"Sponsored","title":"…","text":"…","cta":"Visit","url":"https://…"}`.

Web rewarded ads have no server-side verification, so the reward is granted after a few seconds on trust; `ADS_PER_DAY` caps what anyone can gain by faking it. If you have visitors in the EU/UK, Ad Manager needs a consent banner (CMP) before it will serve personalised ads.

