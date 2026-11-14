# Da RoastBox! 🔥

**AI comedy roast generator.** Pick up to five roaster personas, upload a photo, choose your intensity, and get a full roast show — script, voices and all.

> 18+ entertainment. Roasts are generated comedy; play nice with real people.

---

## What it is

| Layer | Tech |
|---|---|
| Frontend | React 19 + TypeScript + Vite 7 + Tailwind 4 |
| API | Vercel serverless functions (`/api`) |
| Auth + DB | Supabase (Postgres, RLS, email/password) |
| AI script | OpenAI `gpt-4o-mini` (standard) / `gpt-4o` (premium) |
| Vision | OpenAI vision for photo-based roast material |
| Voices | OpenAI TTS, or ElevenLabs for premium voices |
| Payments | Stripe Checkout + webhook reconciliation |
| Credits | Server-authoritative ledger with atomic RPCs |

### Features

- **30 roaster personas** — each with its own voice, comedy style and speech profile
- **Photo analysis** — visible features only (expression, style, outfit), never invented facts
- **5 intensity levels**, explicit toggle, 3–10 minute shows
- **Full show structure** — AI intro, body, outro, with crowd reactions between lines
- **Voices** — browser speech synthesis by default, server-side OpenAI/ElevenLabs TTS optional
- **Highlight reel** — shareable summary of the best punchline
- **Credit system** — 10 free credits on signup, Stripe packs, subscription tiers
- **Bring your own keys** — optional per-user OpenAI / ElevenLabs keys
- **Roast history** — every session saved and replayable
- **Graceful fallback** — with no API keys at all, a built-in local engine still produces roasts

---

## Quick start

```bash
git clone https://github.com/Deserius/Michael-welch.git
cd Michael-welch
npm install

cp .env.example .env      # then fill in the values
npm run dev               # vite + the local API shim, same-origin
```

Open <http://localhost:5173>.

`npm run dev` starts two processes: Vite on `5173` and a small shim
(`scripts/dev-api.mjs`) on `8787` that runs the `/api` functions the way Vercel
does. Vite proxies `/api` to it, so the app is same-origin in dev exactly as it
is in production. No `vercel login` required.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | Supabase project URL (browser) |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase anon key (browser, safe to expose) |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Same URL, read by the serverless API |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server only — bypasses RLS. **Never** expose |
| `OPENAI_API_KEY` | optional | Real AI roasts + image analysis + TTS |
| `ELEVENLABS_API_KEY` | optional | Premium voices |
| `STRIPE_API_KEY` | optional | Payments. Without it, purchases run in demo mode |
| `STRIPE_WEBHOOK_SECRET` | optional | Required to verify webhook signatures |
| `ADMIN_USER_IDS` | optional | Comma-separated user ids/emails allowed to set global keys |

Only `VITE_*` / `NEXT_PUBLIC_*` values are inlined into the browser bundle.
Server-only keys stay on the server; see `.env.example`.

---

## Database

Migrations live in [`supabase/migrations`](supabase/migrations) and are applied
with the Supabase CLI:

```bash
supabase link --project-ref <your-ref>
supabase db push
```

See [`supabase/README.md`](supabase/README.md) for the schema and the security
model.

**Credits are server-authoritative.** The browser can read its own rows but
cannot write credits, payments, roasts or keys — every mutation goes through
the API with the service-role key. Balance changes go through
`spend_credits()` / `grant_credits()`, which are single SQL statements, so
concurrent requests cannot double-spend or double-grant.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite + local API shim |
| `npm run build` | Typecheck, then production bundle |
| `npm run typecheck` | `tsc -b --force` |
| `npm run lint` | ESLint, zero warnings tolerated |
| `npm test` | Unit + handler tests (no network needed) |
| `npm run preview` | Serve the production build |

## Tests

```bash
npm test
```

40 tests, split into three groups:

- `tests/pricing.test.mjs` — credit pricing, duration/intensity clamping
- `tests/auth-guard.test.mjs` — source-level guards for the security fixes
- `tests/handlers.test.mjs` — the real `/api` handlers driven against an
  in-memory Supabase double (`tests/helpers/fake-supabase.mjs`), covering credit
  spending, insufficient balance, **concurrent double-spend**, subscriber
  bypass, admin gating, BYOK isolation and payment idempotency

## Deployment

1. Push the repo and import it into Vercel.
2. Set the environment variables above (Production **and** Preview).
3. Add `https://<your-domain>/**` to Supabase → Authentication → URL
   Configuration (both Site URL and Redirect URLs).
4. Point a Stripe webhook at `https://<your-domain>/api/stripe-webhook`,
   subscribing to `checkout.session.completed`.

`vercel.json` rewrites all non-`/api` routes to `index.html` so client-side
routing works on refresh.

### Notes from deploying this repo to Vercel

- **Framework preset must be `vite`** with build `npm run build`, install
  `npm ci` and output `dist`. Left on "Other", Vercel serves the unbuilt source.
- **The Hobby plan caps a deployment at 12 serverless functions.** Shared
  modules in `api/` are therefore underscore-prefixed (`_auth.js`,
  `_pricing.js`, …) so Vercel bundles them as dependencies instead of routing
  them. Adding a 13th non-underscore file fails the build with
  `exceeded_serverless_functions_per_deployment`.
- **Deployment Protection (Vercel Authentication) intercepts every URL**,
  including `/api/*`, when the project has `ssoProtection` set. Public API
  clients get Vercel's login page instead of JSON. Turn it off under
  *Settings → Deployment Protection* before handing the URL to anyone.
- A `git`-sourced deploy needs the **numeric** repo id (`1448765318` for
  `Deserius/Michael-welch`), not `owner/name`.

> If you deploy the Supabase project for the first time, `mailer_autoconfirm`
> must be on — or SMTP configured — otherwise nobody can finish signing up.
> Supabase's shared SMTP is rate-limited and unsuitable for production.

## Project layout

```
api/                 Vercel serverless functions (10 routes — Hobby plan cap is 12)
  _auth.js           requireUser / requireAdmin / resolveProviderKeys
  _pricing.js        single source of truth for credit pricing
  _db-client.js      service-role Supabase client
  _db-wake.js        restore helper for paused projects
  _personas-data.js  the 30 persona definitions
  (files prefixed with _ are shared modules, not routes)
  roast.js           generate + list roasts (atomic credit spend)
  credits.js         packs, subscriptions, ledger
  payment-status.js  Stripe polling (idempotent grant)
  stripe-webhook.js  Stripe webhook (idempotent grant)
  tts.js             OpenAI / ElevenLabs speech
  analyze-image.js   vision analysis
  personas.js        static persona catalogue
  profile.js         profile bootstrap
  voice-settings.js  per-user BYOK keys
  global-keys.js     app-wide keys (admin only)
src/                 React app
  pages/             Splash, Login, RoastStudio, Credits, History, Settings
  components/        TopBar, HighlightReel, modals
  contexts/          auth + toast providers and hooks
  hooks/             useVoicePlayer
  lib/               api client, supabase client, reactions, image analysis
supabase/migrations/ schema, RLS, atomic credit RPCs
scripts/dev-api.mjs  local stand-in for the Vercel function runtime
tests/               unit + handler tests
```

## Security notes

- Service-role key is used **only** in `/api`; the browser gets the anon key.
- RLS on every table; clients can read their own rows and write nothing.
- App-wide provider keys are admin-gated (`ADMIN_USER_IDS`, or the oldest
  account when unset).
- Per-user BYOK keys are never returned to the browser — only `has_byok_*`
  booleans.
- Stripe sessions are claimed atomically before credits are granted, so webhook
  retries and the client poll cannot both pay out.

---

© Hustler Anomalies / Deserius Arte — 18+ entertainment only.
