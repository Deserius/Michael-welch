# Da RoastBox! — Run Locally

## Prerequisites
- Node.js 18+
- Modern browser (Chrome recommended for best voice support)

## Steps

### 1. Install
```bash
npm install
```

### 2. Environment
Create `.env`:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
STRIPE_API_KEY=sk_test_your_stripe_key
OPENAI_API_KEY=sk-your-openai-key
VITE_GOOGLE_CLIENT_ID=your-google-client-id
VITE_GOOGLE_AUTH_PROXY=https://your-proxy/auth/google/callback
```

### 3. Database
Run in Supabase SQL Editor:
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_tier text;
ALTER TABLE roasts ADD COLUMN IF NOT EXISTS duration_min integer DEFAULT 5;
ALTER TABLE roasts ADD COLUMN IF NOT EXISTS intro text;
ALTER TABLE roasts ADD COLUMN IF NOT EXISTS outro text;
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS stripe_session_id text;
```

### 4. Run
```bash
npm run dev    # Dev server at localhost:5173
npm run build  # Production build
```

## Demo Account
- Email: `demo@roastbox.app`
- Password: `roastbox123`

## Notes
- Voice playback uses Web Speech API (no key needed)
- OpenAI key enables AI-powered roasts; without it, local comedy engine runs
- Stripe test key enables real checkout; without it, demo-mode instant grant
- Google OAuth requires client ID + proxy; email/password works without them
