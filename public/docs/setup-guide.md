# Da RoastBox! — Setup Guide

## Prerequisites

- Node.js 18+
- npm or yarn
- A Supabase project (free tier works)
- Stripe account (for payments)

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   Copy `.env.example` to `.env` and fill in:
   - `VITE_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` — Supabase URL
   - `VITE_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key
   - `STRIPE_API_KEY` — Stripe secret key (sk_test_...)
   - `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret (optional)
   - `OPENAI_API_KEY` — OpenAI API key (optional, enables AI roasts)
   - `VITE_GOOGLE_CLIENT_ID` / `VITE_GOOGLE_AUTH_PROXY` — Google OAuth (optional)

3. **Database setup**
   Run in Supabase SQL Editor:
   ```sql
   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_tier text;
   ALTER TABLE roasts ADD COLUMN IF NOT EXISTS duration_min integer DEFAULT 5;
   ALTER TABLE roasts ADD COLUMN IF NOT EXISTS intro text;
   ALTER TABLE roasts ADD COLUMN IF NOT EXISTS outro text;
   ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS stripe_session_id text;
   ```

4. **Run dev server**
   ```bash
   npm run dev
   ```

5. **Build for production**
   ```bash
   npm run build
   ```

## Demo Account
- Email: `demo@roastbox.app`
- Password: `roastbox123`

## Stripe Test Card
- Card: `4242 4242 4242 4242`
- Any future expiry & CVC

## Features
- 30 roaster personas (20 free + 10 premium) with mafia names
- AI-powered roast generation (GPT-4o / GPT-4o-mini)
- Duration slider (3-10 min), intensity slider (1-5)
- Explicit language toggle
- Premium AI model toggle
- ElevenLabs premium voices toggle
- Credit system with detailed cost calculation
- Credit packs ($4.99-$99) + subscriptions ($9.99-$24.99/mo)
- Stripe Checkout payments
- BYOK settings
- Roast history with intro/outro
- Mobile-first responsive design
