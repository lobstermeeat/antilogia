# Antilogia

Pick a philosopher in a sunlit 3D agora; an AI Refuter knocks their argument down one point at a time. Or bring a fight from home.

- `index.html`: the whole site (3D scene, portraits, debate UI)
- `api/refute.js`: Vercel Edge Function that relays each move to Claude with your API key

When an argument breaks, the temple crumbles, the claims shatter and a verdict stamp slams down; sound effects are synthesized in the browser, so there are no audio files to host. Attackers can aim, pick a line of attack and scout weak spots; defenders can repair a fallen claim, add a missing link or scale back the conclusion, and the Refuter judges the repair.

## Deploy (Vercel)
1. vercel.com → Add New → Project → import this repo. Framework preset: **Other**. No build command.
2. Settings → Environment Variables: `ANTHROPIC_API_KEY` = your key from console.anthropic.com. Optional: `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `ALLOWED_ORIGIN` (e.g. `https://antilogia.com` once you add a custom domain).
3. Redeploy. Set a monthly spend limit in the Anthropic console.

The function caps prompt size and answer length and soft-limits each visitor to 8 moves a minute.
