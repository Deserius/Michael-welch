# Da RoastBox! — Deployment Guide

## Vercel Deployment

### 1. Push to GitHub
```bash
git add .
git commit -m "v3.0 — major feature update"
git push origin main
```

### 2. Import to Vercel
1. Go to vercel.com → New Project → Import repository
2. Vercel auto-detects Vite

### 3. Environment Variables
| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `NEXT_PUBLIC_SUPABASE_URL` | Same (for serverless) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same (for serverless) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `STRIPE_API_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret (optional) |
| `OPENAI_API_KEY` | OpenAI API key (optional) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth (optional) |
| `VITE_GOOGLE_AUTH_PROXY` | Google OAuth proxy (optional) |

### 4. Deploy

## API Routes

| Route | Methods | Description |
|---|---|---|
| `/api/personas` | GET | List 30 personas |
| `/api/profile` | GET | User profile + credits + subscription |
| `/api/roast` | GET, POST | History / Generate roast |
| `/api/credits` | GET, POST | Packs+subs+txns / Purchase |
| `/api/payment-status` | GET | Poll payment status |
| `/api/stripe-webhook` | POST | Stripe webhook handler |
| `/api/voice-settings` | GET, POST, DELETE | BYOK management |

## Stripe Webhook Setup
1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://your-domain.vercel.app/api/stripe-webhook`
3. Events: `checkout.session.completed`
4. Copy signing secret to `STRIPE_WEBHOOK_SECRET` env var

## Post-Deployment Checklist
- [ ] App loads without errors
- [ ] Sign up / sign in works
- [ ] Personas load (30 total)
- [ ] Dice button picks 5 random
- [ ] Duration/intensity sliders work
- [ ] Toggles work (explicit, premium, ElevenLabs)
- [ ] Credit cost updates in real-time
- [ ] Roast generation works
- [ ] Intro plays, then transcript, then outro
- [ ] Credit deduction works
- [ ] Stripe checkout works (test card)
- [ ] Credits update after purchase
- [ ] Subscription activation works
- [ ] Roast history loads
- [ ] Mobile responsive
