# Da RoastBox! — Architecture

## Overview

Da RoastBox is a full-stack AI comedy roast generator built with:

- **Frontend**: Vite + React 19 + TypeScript + Tailwind CSS v4
- **Backend**: Vercel Serverless Functions (Node.js)
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth (email/password + Google OAuth)
- **AI**: OpenAI GPT-4o (premium) / GPT-4o-mini (standard) with local fallback
- **Voice**: Web Speech API (SpeechSynthesis) + ElevenLabs (BYOK/subscription)
- **Payments**: Stripe Checkout + Webhooks

## Project Structure

```
/
├── api/
│   ├── db-client.js          # Supabase client
│   ├── personas-data.js      # 30 persona definitions (mafia names)
│   ├── personas.js           # GET /api/personas
│   ├── profile.js            # GET /api/profile
│   ├── roast.js              # GET/POST /api/roast
│   ├── credits.js            # GET/POST /api/credits
│   ├── payment-status.js     # GET /api/payment-status
│   ├── stripe-webhook.js     # POST /api/stripe-webhook
│   └── voice-settings.js     # GET/POST/DELETE /api/voice-settings
├── src/
│   ├── contexts/             # Auth + Toast providers
│   ├── components/           # TopBar, ProtectedRoute
│   ├── hooks/                # useVoicePlayer
│   ├── lib/                  # supabase, api, googleAuth
│   ├── pages/                # Splash, Login, Studio, Credits, Settings, History
│   └── index.css             # Full brand theme
├── public/assets/            # 30 persona images, SFX, splash
└── vercel.json               # Vercel config + env vars
```

## Database Schema

### `profiles`
| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto-increment |
| user_id | text | Supabase auth user ID |
| email | text | User email |
| credits | integer | Credit balance (default: 10) |
| subscription_tier | text | null, premium_personas, premium_voices, all_access |
| created_at | timestamptz | Creation timestamp |

### `roasts`
| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto-increment |
| user_id | text | Supabase auth user ID |
| subject_name | text | Roast subject name |
| persona_ids | jsonb | Array of persona IDs |
| transcript | jsonb | Array of {persona_id, line} |
| intro | text | Show intro text |
| outro | text | Show outro text |
| duration_min | integer | Selected duration (3-10) |
| created_at | timestamptz | Creation timestamp |

### `credit_transactions`
| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto-increment |
| user_id | text | Supabase auth user ID |
| amount | integer | Credits (+/-) |
| type | text | starter, roast, purchase, subscription |
| description | text | Human-readable description |
| created_at | timestamptz | Creation timestamp |

### `payment_transactions`
| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto-increment |
| user_id | text | Supabase auth user ID |
| pack_id | text | Credit pack or subscription ID |
| amount_usd | numeric | Payment amount |
| credits | integer | Credits purchased |
| payment_status | text | pending, paid |
| stripe_session_id | text | Stripe Checkout Session ID |
| created_at | timestamptz | Creation timestamp |

### `byok_keys`
| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto-increment |
| user_id | text | Supabase auth user ID |
| openai_key | text | User's OpenAI API key |
| elevenlabs_key | text | User's ElevenLabs API key |
| created_at | timestamptz | Creation timestamp |

## Credit System

### Credit Costs
| Feature | Cost |
|---|---|
| Per minute of duration | 1 credit |
| Per standard persona | 1 credit |
| Per premium persona | 3 credits |
| Per uploaded image | 1 credit |
| Standard AI model (GPT-4o-mini) | 1 credit |
| Premium AI model (GPT-4o) | 3 credits |
| ElevenLabs voices (per persona) | 2 credits |

### Subscriptions (bypass credit charges)
| Tier | Monthly | Annual | Benefits |
|---|---|---|---|
| Premium Personas | $9.99 | $99.99 | All premium personas, no credit charge |
| Premium Voices | $14.99 | $149.99 | ElevenLabs voices, no credit charge |
| All-Access | $24.99 | $249.99 | Everything unlocked, unlimited roasts |

### One-Time Credit Packs
| Pack | Credits | Price |
|---|---|---|
| Starter | 10 | $4.99 |
| Pro | 25 | $9.99 |
| Savage | 60 | $19.99 |
| Kingpin | 200 | $49.99 |
| Boss | 500 | $99.00 |

## Roast Generation Pipeline

1. User selects 1-5 personas, uploads photos, adds subject name + context
2. User selects duration (3-10 min), intensity (1-5), explicit toggle, premium model toggle, ElevenLabs toggle
3. Frontend calculates credit cost and displays it
4. POST /api/roast with all parameters
5. Server verifies auth, calculates credits, checks balance
6. Credits deducted atomically (subscribers skip)
7. If OPENAI_API_KEY set:
   - Standard: GPT-4o-mini
   - Premium: GPT-4o
   - System prompt includes explicit/uncensored instructions, intensity level, image analysis hints
   - Generates intro + roast lines + outro as JSON
8. Fallback: Local comedy engine with 90+ explicit templates
9. Roast saved to DB with intro, transcript, outro, duration
10. Frontend plays intro via SpeechSynthesis, then transcript with per-persona voices, then outro

## Payment Flow

1. User clicks Buy Pack or Subscribe
2. POST /api/credits creates Stripe Checkout Session
3. User redirected to Stripe-hosted payment page
4. On success, redirected to /credits/success?session_id=...
5. Stripe webhook (POST /api/stripe-webhook) grants credits/subscription
6. Frontend polls GET /api/payment-status for confirmation
7. Credits/subscription reflected in profile immediately

## Persona Catalog

30 personas with mafia/mobster names:
- 20 free tier (personas 1-20)
- 10 premium tier (personas 21-30, marked with ★)
- Each persona has: comic inspiration, explicit quirks_prompt, lingo, punchlines, topics
- All content is adult/uncensored/R-rated

## Row-Level Security

All tables have RLS policies: `user_id::text = auth.uid()::text`
Serverless functions use service role key (bypasses RLS) while verifying JWT.
