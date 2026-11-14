# Da RoastBox! — Changelog

## v3.0.0 — Major Feature Update

### New Features
- **Random Dice Button**: Pick 5 random roasters with one click
- **Intensity Slider**: 5 levels from Mild to Nuclear
- **Explicit Language Toggle**: Stylized on/off switch for uncensored content
- **Premium AI Model Toggle**: Switch between GPT-4o-mini (standard, 1cr) and GPT-4o (premium, 3cr)
- **ElevenLabs Voices Toggle**: Premium voice synthesis option (2cr per persona)
- **Roast Intro & Outro**: AI-generated show intro (welcomes audience, introduces roasters and subject) and outro (thanks audience)
- **Duration-Based Generation**: Roast length scales with selected duration (3-10 min)
- **Credit Cost Calculator**: Real-time cost preview before generating

### Credit System Overhaul
- 1 credit per minute of duration
- 1 credit per standard persona, 3 credits per premium persona
- 1 credit per uploaded image
- 1 credit for standard AI, 3 credits for premium AI
- 2 credits per persona for ElevenLabs voices
- Subscribers bypass all credit charges

### Payment System
- Full Stripe Checkout integration with test key
- Stripe webhook handler for credit/subscription grants
- Payment status polling endpoint
- New $99 Boss Pack (500 credits)
- Subscription tiers: Premium Personas ($9.99/mo), Premium Voices ($14.99/mo), All-Access ($24.99/mo)
- Annual billing option (2 months free)
- Credits update in profile immediately after purchase

### Persona Updates
- All 30 personas renamed with mafia/mobster names
- All content optimized for adult explicit uncensored roasts
- Each persona has comic_inspiration field (Jamie Foxx, Betty White, Jeff Ross, etc.)
- Premium personas marked with ★ badge and tier label

### Image Analysis Pipeline
- Image hints passed to AI for personalized roasts
- AI instructed to target facial features, expressions, and appearance
- Roast material personalized to subject's visible characteristics

## v2.0.0 — Production Rebuild
- Migrated to Vite + React 19 + TypeScript + Supabase
- Supabase Auth (email/password + Google OAuth)
- 30 personas with AI-generated images
- Web Speech API voice playback
- Credit system with Stripe payments
- BYOK settings
- Roast history
- Mobile-first responsive design

## v1.0.0 — Original
- CRA + Flask + MongoDB + Piper TTS
