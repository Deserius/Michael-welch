import { useState } from 'react';

type Tab = 'welcome' | 'getting-started' | 'studio' | 'credits' | 'voices' | 'troubleshooting';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'welcome', label: 'Welcome', icon: '👋' },
  { id: 'getting-started', label: 'Getting Started', icon: '🚀' },
  { id: 'studio', label: 'Roast Studio', icon: '🎭' },
  { id: 'credits', label: 'Credits & Payments', icon: '💳' },
  { id: 'voices', label: 'Voices & Audio', icon: '🔊' },
  { id: 'troubleshooting', label: 'Troubleshooting', icon: '🔧' },
];

export default function HelpModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('welcome');

  return (
    <div className="modal-overlay" onClick={onClose} data-testid="help-modal">
      <div className="modal help-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>

        <div className="help-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`help-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="help-tab-icon">{t.icon}</span>
              <span className="help-tab-label">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="help-content">
          {tab === 'welcome' && (
            <div className="help-section">
              <h2 className="help-title">👋 Welcome to Da RoastBox!</h2>
              <p className="help-text">
                Hey there! Welcome to <strong>Da RoastBox</strong> — the wildest comedy roast show on the internet! 🔥
              </p>
              <p className="help-text">
                Here's how it works: you pick a bunch of funny characters (we call them "roasters"),
                upload a photo of the person you want roasted, and our AI writes a hilarious,
                personalized comedy roast — complete with different voices for each character!
              </p>
              <p className="help-text">
                It's like a Comedy Central roast, but YOU choose who gets roasted and who does the roasting.
                Think of it as a virtual comedy club where your friends (or enemies 😈) get absolutely destroyed.
              </p>
              <p className="help-text">
                <strong>Ready to start?</strong> Head over to the "Getting Started" tab for step-by-step instructions!
              </p>
            </div>
          )}

          {tab === 'getting-started' && (
            <div className="help-section">
              <h2 className="help-title">🚀 Getting Started — Easy Steps!</h2>
              <div className="help-step">
                <span className="step-num">1</span>
                <p><strong>Create an account or sign in.</strong> Click "Continue" on the splash screen, then sign up with your email and a password (at least 6 letters). You can also sign in with Google!</p>
              </div>
              <div className="help-step">
                <span className="step-num">2</span>
                <p><strong>Go to the Roast Studio.</strong> After signing in, you'll land on the Studio page. This is where the magic happens!</p>
              </div>
              <div className="help-step">
                <span className="step-num">3</span>
                <p><strong>Pick your roasters.</strong> Click on the character cards to select up to 5 roasters. Each one has a different comedy style! You can also click the 🎲 dice button to pick 5 random roasters automatically.</p>
              </div>
              <div className="help-step">
                <span className="step-num">4</span>
                <p><strong>Upload a photo.</strong> Click the upload area and choose a photo of the person you want roasted. Our AI will analyze their face to make the roast extra personal!</p>
              </div>
              <div className="help-step">
                <span className="step-num">5</span>
                <p><strong>Add their name and context.</strong> Type their name and any inside jokes or funny details about them. The more info you give, the better the roast!</p>
              </div>
              <div className="help-step">
                <span className="step-num">6</span>
                <p><strong>Hit "ROAST 'EM!"</strong> Press the big orange button and watch the roast come to life with text and voices!</p>
              </div>
            </div>
          )}

          {tab === 'studio' && (
            <div className="help-section">
              <h2 className="help-title">🎭 Roast Studio Features</h2>
              <p className="help-text"><strong>🎲 Random Dice Button:</strong> Click the dice in the top-right of the roasters panel to automatically pick 5 random roasters. Great for when you can't decide!</p>
              <p className="help-text"><strong>⏱️ Duration Slider:</strong> Choose how long your roast lasts — anywhere from 3 to 10 minutes. Longer roasts mean more jokes per roaster!</p>
              <p className="help-text"><strong>🔥 Intensity Slider:</strong> Control how savage the roast is:
                <br />• <strong>1 (Mild):</strong> Light teasing, PG-13
                <br />• <strong>2 (Moderate):</strong> Some edge, a few below-the-belt jokes
                <br />• <strong>3 (Spicy):</strong> R-rated, adult humor
                <br />• <strong>4 (Savage):</strong> Fully explicit, brutal and unfiltered
                <br />• <strong>5 (NUCLEAR):</strong> Maximum destruction. No mercy.
              </p>
              <p className="help-text"><strong>🔞 Explicit Language Toggle:</strong> Turn this on to allow adult language and NSFW content. Turn it off for a cleaner roast.</p>
              <p className="help-text"><strong>★ Premium Roasters:</strong> Roasters with a gold star are premium characters. They cost extra credits but have unique comedy styles inspired by famous comedians.</p>
              <p className="help-text"><strong>📸 Photo Analysis:</strong> When you upload a photo, our AI studies the person's face, hair, expression, and style to create personalized jokes about their actual appearance!</p>
              <p className="help-text"><strong>▶ Replay & ⏹ Stop:</strong> After a roast is generated, you can replay the whole thing with voices or stop it at any time.</p>
            </div>
          )}

          {tab === 'credits' && (
            <div className="help-section">
              <h2 className="help-title">💳 Credits & Payments</h2>
              <p className="help-text"><strong>What are credits?</strong> Credits are what you use to generate roasts. Every new account gets <strong>10 free credits</strong> to start!</p>
              <p className="help-text"><strong>How much does a roast cost?</strong> The cost depends on your choices:
                <br />• <strong>Duration:</strong> 1 credit per minute (3 min = 3 credits, 10 min = 10 credits)
                <br />• <strong>Premium roasters:</strong> 2 credits per premium roaster
                <br />• <strong>ElevenLabs Premium Voices:</strong> +3 credits
                <br />• <strong>Premium AI Model (GPT-4o):</strong> +5 credits
              </p>
              <p className="help-text"><strong>Buying more credits:</strong> Go to the "Buy Credits" page to purchase credit packs:
                <br />• <strong>Starter:</strong> 10 credits for $4.99
                <br />• <strong>Pro:</strong> 25 credits for $9.99
                <br />• <strong>Savage:</strong> 60 credits for $19.99
                <br />• <strong>Kingpin:</strong> 200 credits for $49.99
              </p>
              <p className="help-text"><strong>Payment processing:</strong> Payments are handled securely by Stripe. When you click "Buy Pack," you'll be taken to a secure Stripe checkout page where you can enter your card details safely.</p>
              <p className="help-text"><strong>Test card:</strong> In test mode, you can use card number <code>4242 4242 4242 4242</code> with any future expiration date and any 3-digit CVC.</p>
              <p className="help-text"><strong>Transaction history:</strong> You can see all your credit purchases and usage on the Buy Credits page.</p>
            </div>
          )}

          {tab === 'voices' && (
            <div className="help-section">
              <h2 className="help-title">🔊 Voices & Audio</h2>
              <p className="help-text"><strong>How do the voices work?</strong> Each roaster has a unique voice created using your device's built-in speech technology. Every character has a different pitch and speaking speed so they all sound different!</p>
              <p className="help-text"><strong>ElevenLabs Premium Voices:</strong> Turn on this toggle for studio-quality AI voices. This costs extra credits but gives you incredibly realistic, professional voice acting for each character.</p>
              <p className="help-text"><strong>Sound effects:</strong> The roast includes sound effects — an intro when the show starts, crowd laughter between jokes, and applause at the end!</p>
              <p className="help-text"><strong>Auto-playback:</strong> When a roast is generated, it automatically starts playing with voices. The current speaker is highlighted with an animated waveform.</p>
              <p className="help-text"><strong>Replay:</strong> Click the "▶ Replay" button to hear the whole roast again from the beginning.</p>
              <p className="help-text"><strong>Stop:</strong> Click "⏹ Stop" at any time to pause the playback.</p>
              <p className="help-text"><strong>BYOK (Bring Your Own Keys):</strong> In Settings, you can add your own OpenAI and ElevenLabs API keys to use your own accounts for AI generation and voice synthesis.</p>
            </div>
          )}

          {tab === 'troubleshooting' && (
            <div className="help-section">
              <h2 className="help-title">🔧 Troubleshooting — Common Fixes</h2>

              <div className="trouble-item">
                <h3>🔊 No sound / voices don't play</h3>
                <p><strong>Fix:</strong> Make sure your device isn't muted. Some browsers need you to click somewhere on the page first before they'll play sound. Try clicking the "▶ Replay" button. If you're on mobile, make sure your ringer isn't on silent.</p>
              </div>

              <div className="trouble-item">
                <h3>💳 Payment didn't go through</h3>
                <p><strong>Fix:</strong> Double-check your card number, expiration date, and CVC. In test mode, use <code>4242 4242 4242 4242</code> with any future date and any 3-digit code. If it still fails, try a different browser or clear your cookies.</p>
              </div>

              <div className="trouble-item">
                <h3>🔥 "Not enough credits" error</h3>
                <p><strong>Fix:</strong> Each roast costs credits based on duration and premium features. Go to "Buy Credits" to purchase more, or reduce the duration and turn off premium options to lower the cost.</p>
              </div>

              <div className="trouble-item">
                <h3>📸 Photo analysis isn't working</h3>
                <p><strong>Fix:</strong> Make sure your photo is a clear, well-lit image of a person's face. JPG and PNG formats work best. The AI works best with front-facing photos. If it still doesn't analyze, the roast will still work — it just won't have appearance-based jokes.</p>
              </div>

              <div className="trouble-item">
                <h3>🎭 Roasters won't load</h3>
                <p><strong>Fix:</strong> Refresh the page. If that doesn't work, sign out and sign back in. Check your internet connection.</p>
              </div>

              <div className="trouble-item">
                <h3>📱 App looks weird on my phone</h3>
                <p><strong>Fix:</strong> Try rotating your phone to landscape mode, then back. Make sure you're using the latest version of your browser (Chrome, Safari, or Firefox). Clear your browser cache if things still look off.</p>
              </div>

              <div className="trouble-item">
                <h3>🔑 Can't sign in / forgot password</h3>
                <p><strong>Fix:</strong> On the login page, click "Forgot password?" and enter your email. You'll get a reset link in your inbox. Check your spam folder if you don't see it within a few minutes.</p>
              </div>

              <div className="trouble-item">
                <h3>⏳ Roast is taking forever to generate</h3>
                <p><strong>Fix:</strong> Longer roasts (8-10 minutes) with premium AI take more time. Be patient — the AI is writing custom jokes! If it takes more than 2 minutes, try refreshing and using a shorter duration.</p>
              </div>

              <div className="trouble-item">
                <h3>🔄 Page is stuck loading</h3>
                <p><strong>Fix:</strong> Refresh the page (press F5 or pull down on mobile). If it's still stuck, clear your browser cookies and cache, then try again.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
