# Credentials checklist

Everything in this app is optional. This file lists every credential, where to
create it, and exactly what breaks without it.

**Never commit real keys.** Add them to Vercel (Project → Settings →
Environment Variables) for the deployed site, and to a local `.env` for
development. `.env` is gitignored; `.env.example` documents the names.

> Security note: do not paste live secrets into a chat window. Add them to
> Vercel yourself, then ask for the keys to be verified — the agent can read
> Vercel environment variables and test the live deployment without ever
> seeing the values in plain text.

---

## 1. Supabase — required

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` (secret) |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | same page, `anon` key |

Without it: nothing works. Auth, credits and history all live in Postgres.

Already configured for this project (ref `yovsvtjmrsiwnecyyaix`). Run
`supabase/migrations/*.sql` in order for a fresh install.

**Email sign-up:** Supabase → Authentication → Providers → Email must be on.
`mailer_autoconfirm` should be **on** until you configure SMTP, otherwise
nobody can finish signing up (the confirm email never arrives).

---

## 2. OpenRouter — recommended for roast text

Create at <https://openrouter.ai/keys>. Format: `sk-or-v1-…`

```
OPENROUTER_API_KEY=
```

Used for all roast and battle text. **Preferred over OpenAI** — one key
reaches many models, and free models exist.

Without it: falls back to OpenAI, then to the local engine.

---

## 3. OpenAI — text fallback + standard speech

Create at <https://platform.openai.com/api-keys>. Format: `sk-…`

```
OPENAI_API_KEY=
```

Used for roast text when OpenRouter is absent, and for non-premium TTS.

---

## 4. ElevenLabs — premium voices

Create at <https://elevenlabs.io/app/settings/api-keys>.

```
ELEVENLABS_API_KEY=
```

Only used when the user has a subscription granting
`premium_voices_unlocked`. A failure here never fails the roast: the line is
returned without audio and reported as `premium_voice_fallback`, so the
add-on is not charged.

---

## 5. Google sign-in — optional

1. <https://console.cloud.google.com/apis/credentials> → Create credentials →
   OAuth client ID → **Web application**.
2. Authorised redirect URI — this exact path:
   ```
   https://<your-domain>/auth-complete.html
   ```
3. Copy the client ID and secret:
   ```
   GOOGLE_OAUTH_CLIENT_ID=
   GOOGLE_OAUTH_CLIENT_SECRET=
   PUBLIC_SITE_URL=https://<your-domain>
   ```
4. Supabase → Authentication → Providers → **Google** → enable, paste the same
   client ID and secret.

Without it: `configuration/status` reports `google.configured: false` and
`/api/auth/google/start` returns 503. Email sign-in is unaffected.

---

## 6. Stripe — credit packs, optional

Use **test keys** until you have run a real payment end to end.
Format: `sk_test_…` (the app detects test mode and reports `test_key_format`).

```
STRIPE_API_KEY=
STRIPE_WEBHOOK_SECRET=
```

Webhook endpoint: `https://<your-domain>/api/stripe-webhook`, subscribed to
`checkout.session.completed` and `checkout.session.expired`.

Without it: buying credits is disabled; earned/starter credits still work.

---

## 7. Admin

```
ADMIN_USER_IDS=
```

Comma-separated Supabase user IDs or emails allowed to set app-wide provider
keys via `POST /api/global-keys`. **If unset, the oldest account is treated as
admin** — fine for a fresh install, but set this before real users sign up, or
the first user to register inherits key-management rights.

---

## Local / offline mode

The Arena sandbox has **no network egress** — it cannot reach Supabase,
OpenRouter, OpenAI, ElevenLabs or Stripe. To keep the preview usable, the API
falls back to a local file store automatically when Supabase is unreachable,
and to a local transcript engine when no provider key can be used.

Force it explicitly:

```
LOCAL_MODE=1
```

Data lands in `.local-data/db.json` (gitignored). Passwords are scrypt-hashed
and sessions are HMAC-signed, but **this is a development facility, not a
production store** — it is single-file and not access-controlled.

When Supabase *is* reachable, local mode switches itself off and the real
database is used. Behaviour is otherwise identical.
