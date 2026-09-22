# Architecture & Product Decisions

## 1. Auth pattern (spec Section 2 requires this be stated explicitly)

**Decision: deferred sign-up, via a silent guest account.**

On first launch the app calls `POST /auth/guest` with a locally-generated
`deviceId`. The server creates a real `User` row with `isGuest: true` and
returns a normal JWT. The guest can complete onboarding, chat with Grandma,
generate recipes, and see everything render — all backed by real,
persisted data — with no signup screen in the way, satisfying "don't force
sign-up before the user has seen any value" and the Section 17 FTUE
requirement that every quick-start button drops into a *working* flow
immediately.

Tasks, grocery lists, generated recipes, and chat all persist for a guest
immediately (real DB rows against the guest's `userId`, kept across app
restarts via the stored JWT) — this is what makes the Section 17 FTUE
buttons produce a real result with zero signup friction. The guest is
prompted to create a real account (email/password or a social provider)
only the first time they try to do one of:
- save/favorite a recipe to "My Recipes" for long-term, cross-device access,
- create anything in the Family Cookbook (durable, emotionally-weighted
  family data),
- turn on push notifications (needs an identity that survives a reinstall), or
- start a Grandma+ purchase.

`POST /auth/upgrade` converts the guest row in place (adds email + password
hash, or links a social identity) — same `userId`, same data, no migration
step. This means guest usage caps (Section 15) apply from message one, and
nothing the user did as a guest is lost when they sign up.

This decision affects the API: almost every route accepts a guest JWT the
same as a full-account JWT; only the "durable ownership" actions above are
gated behind `requireFullAccount` middleware (`server/src/middleware/auth.ts`).

## 2. Tool-calling architecture (Section 4)

`server/src/services/ai/tools.ts` defines a provider-agnostic tool schema
(`AiTool[]`); `server/src/services/ai/toolHandlers.ts` executes each tool
against Prisma and returns a structured result. The chat loop
(`chatService.ts`) is: stream the model's response → if it emits a tool
call, run the handler, persist the result, feed the tool result back to the
model → stream the model's natural-language confirmation. The API response
includes both the streamed text *and* a `toolInvocations[]` array so the
client can render an inline card (task/grocery/recipe) instead of only
showing text. No keyword/regex matching is used to trigger actions.

This loop runs against whichever `AiProvider` is configured
(`server/src/services/ai/provider.ts`) — see §4 below. Both the hosted
Anthropic backend and the local Ollama backend implement the exact same
tool-calling contract, so the chat/recipe/greeting/OCR code never branches
on which one is active.

Tools implemented: `create_task`, `update_task`, `create_reminder`,
`create_grocery_list`, `add_grocery_item`, `create_recipe`, `update_schedule`,
`save_memory_fact`, `generate_chore_batch` (caps at 3-5 items per Section 7),
`plan_day`.

## 3. Safety system prompt (Section 14)

`server/src/services/ai/systemPrompt.ts` builds the system prompt from the
user's `personality_style` (tone only) plus a **non-negotiable safety block**
that is concatenated identically regardless of personality: no medical/
legal/financial/professional advice beyond "see a professional," no
claiming to be human or the user's literal grandmother, no instructions for
self-harm/illegal activity/dangerous DIY, and a crisis-response instruction
to warmly point to a real person, professional, or crisis line. Personality
style only ever adjusts word choice via a separate prompt section.

## 4. Swappable providers (Section 16)

Every provider is selected by an env var and implemented behind a small
interface, so swapping is a config change, not a rewrite:

| Concern | Env var | Interface | Included implementation |
|---|---|---|---|
| LLM | `AI_PROVIDER` | `services/ai/provider.ts` (`AiProvider` in `services/ai/types.ts`) | `ollama` **(default)** — local, no API key/billing; or `anthropic` — hosted, needs `ANTHROPIC_API_KEY` |
| Database | `DATABASE_URL` | Prisma | SQLite for local dev, Postgres in prod (same schema) |
| Auth | `AUTH_PROVIDER` | `services/auth/socialProviders.ts` | email/password (live); Apple/Google (adapter present, needs real client IDs — see below) |
| Push | `PUSH_PROVIDER` | `services/notifications/pushService.ts` | `expo` (live, using Expo's push service) or `fcm`/`apns` adapters (stubbed — need real project credentials) |
| Subscriptions | `IAP_PROVIDER` | `services/subscriptions/*` | server-side validation call structure is real; needs a real App Store Connect / Play Console app+key to validate live receipts |
| Ads | `ADS_PROVIDER` | `services/ads/adsConfig.ts` + `mobile/src/components/AdSlot.tsx` | config/placement rules are real and enforced; needs a real ad network SDK + app id to serve live ads |

### AI provider: Ollama (default) vs. Anthropic

The app ships defaulting to `AI_PROVIDER=ollama` — a **local model with no
API key, no billing account, and no external network call** — so the chat
engine works without anyone signing up for anything. `services/ai/providers/ollamaProvider.ts`
talks to a local Ollama daemon over HTTP (`OLLAMA_BASE_URL`, default
`http://localhost:11434`):
- the tool-calling chat loop uses Ollama's OpenAI-style `tools` field
  (needs a tool-calling-capable model — default `OLLAMA_MODEL=llama3.1`);
- recipe generation and handwriting OCR use Ollama's structured-output
  mode (`format: <json schema>`) instead of forced tool use;
- handwriting OCR needs a vision-capable local model
  (default `OLLAMA_VISION_MODEL=llava`).

**Setup required on whatever machine runs the server:** install Ollama
from [ollama.com](https://ollama.com), then `ollama pull llama3.1` and
`ollama pull llava`, and make sure the Ollama app/daemon is running. This
sandbox's network policy blocks reaching ollama.com, so Ollama itself
could not be installed or exercised against a live model here — the
integration was verified by: (1) a clean TypeScript build, (2) matching
`ollamaProvider.ts`'s request/response handling exactly against Ollama's
documented `/api/chat` streaming, tool-calling, and structured-output
formats, and (3) every AI call site going through the same `AiProvider`
interface already end-to-end tested against the Anthropic backend. If
Ollama isn't installed/running, requests fail closed into the same
"I'm having a little trouble hearing you right now" fallback used
everywhere else (never a raw error, never a silent hang) rather than
crashing.

Set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` to switch to the
hosted backend instead — noticeably higher quality and more reliable tool
use, at the cost of needing a paid API key.

### What's genuinely live in this build
- Real Postgres/SQLite-backed persistence for every feature (tasks,
  recipes, grocery lists, Family Cookbook, memory, schedule, chat history).
- A real AI backend with tool-calling, streaming, and vision (used for
  handwritten recipe OCR) — Ollama by default, Anthropic as a drop-in swap.
- Real JWT auth, password hashing (bcrypt), guest→full-account upgrade.
- Real push notification *scheduling and preference logic*, dispatched
  through Expo's push service (works today with a real Expo project id).

### What needs the team to provision an external account before it's "real"
These are not fake buttons — the code path, request shape, and server-side
verification logic are implemented — they just need real credentials this
sandboxed environment cannot obtain (no Apple Developer account, Google
Cloud project, or ad network account is available here):
- Sign in with Apple / Google: `services/auth/socialProviders.ts` verifies
  a provider ID token via each provider's public JWKS; needs real OAuth
  client IDs in `.env`.
- APNs/FCM direct push (as opposed to Expo's push relay): adapters are
  stubbed in `pushService.ts` with the exact payload shape each API expects.
- StoreKit 2 / Play Billing signature verification: `subscriptions/`
  validates against Apple's/Google's real verification endpoints when
  `APPLE_SHARED_SECRET` / `GOOGLE_SERVICE_ACCOUNT` are set; without them the
  validator returns a clear `NOT_CONFIGURED` error rather than pretending
  to succeed.

## 5. Ads: real Google AdMob SDK, live on Google's test units by default

`mobile/src/components/AdSlot.tsx`, `useInterstitialAd.ts`, and
`useRewardedAd.ts` are built on the real `react-native-google-mobile-ads`
SDK (`BannerAd`, `InterstitialAd`, `RewardedAd`) — not a placeholder view.
`server/src/routes/config.ts` hands the client an app id and a banner/
interstitial/rewarded ad unit id per platform; every id defaults to
Google's public AdMob **test** ids (the same ones Google's own docs use),
so real ads render, in test mode, with zero AdMob account needed. Setting
`ADMOB_APP_ID_*` / `ADMOB_*_AD_UNIT_ID_*` in `server/.env` switches every
placement to a real, revenue-earning account with no client rebuild — only
`mobile/app.config.js` (which reads `ADMOB_APP_ID_IOS`/`ADMOB_APP_ID_ANDROID`
at build time for the native SDK's required app-id manifest entry) needs
those two set before a real build.

Placement rules from Section 15, enforced in code rather than left as a
guideline:
- **Banner** (`AdSlot`): only on `recipes_list`/`tasks_list`/`grocery_list`
  (server-configured, not hardcoded per-screen), and never at all for
  Grandma+ (`useSubscriptionStatus` gate).
- **Interstitial**: only at two natural transitions — right after leaving
  an active chat for Home, and right after saving a recipe — and capped to
  once per app session (`utils/interstitialSession.ts`) so "occasional"
  actually means occasional. Never triggered from inside `ChatScreen` itself.
- **Rewarded**: surfaced only once the free daily chat cap is hit, as
  "📺 Watch an ad for one more chat" in `ChatScreen`. `POST /chat/usage/reward`
  raises that day's effective cap by one, itself capped at
  `REWARDED_UNLOCK_DAILY_CAP` (default 3/day) so it can't become unlimited
  free usage.
- The native ads module needs a custom dev client / EAS build (Expo Go has
  no third-party native modules); `AdSlot` falls back to a labeled
  placeholder and the ad hooks simply report "not ready" rather than
  crashing when it isn't present — the same defensive pattern used for
  `react-native-iap` and `expo-speech-recognition`.

**Known simplification:** the rewarded-unlock endpoint trusts the client's
report that the SDK's `onEarnedReward` fired, rather than validating via
AdMob's server-side verification (SSV) callback, which needs a stable
public HTTPS URL registered in the AdMob console. The daily cap bounds the
downside to a handful of free extra chats/day even if that trust were
abused — wiring real SSV is a small, well-documented follow-up once the
app has a production URL.

## 6. The Grandma mascot

`mobile/src/components/GrandmaAvatar.tsx` is one consistent hand-drawn SVG
character (round glasses, a soft hair bun, a coral shawl) rather than a
generic icon or a photorealistic face, per Section 13's "warm rather than
cartoonishly old, never photorealistic or uncanny." She's reused everywhere
the spec calls for her: the home greeting, the chat header, every empty
state, and onboarding/FTUE. A small `mood` prop (`neutral` / `happy` /
`thinking` / `celebrating`) swaps her eyebrows and mouth so she reacts to
context — e.g. she celebrates on Home when every task for the day is
checked off — without becoming a distracting animated performance; the
only continuous motion is the existing subtle blink.

## 7. Monetization: Free vs. Grandma+ ($14.99/mo), billed through Stripe

**Decision: Stripe Checkout/Billing Portal is the primary billing rail**,
superseding the spec's original StoreKit/Play Billing-only requirement, per
explicit direction. `server/src/services/billing/stripeClient.ts` +
`server/src/routes/billing.ts` implement it for real: `POST /billing/checkout-session`
creates a Stripe Customer (once) and a subscription Checkout Session;
`POST /billing/portal-session` opens Stripe's hosted subscription-management
portal; `POST /billing/webhook` (mounted with `express.raw()` **before** the
global JSON body parser in `index.ts`, since signature verification needs
the exact raw bytes) verifies and handles `checkout.session.completed`,
`customer.subscription.updated/created/deleted` to keep `Subscription.tier`
in sync. `npm run stripe:setup` (in `server/`) calls the Stripe API to
create the "Grandma+" Product and a $14.99/month Price for you and prints
the `STRIPE_PRICE_ID_MONTHLY` to put in `.env` — no clicking through the
Dashboard required. On the client, `useStripeCheckout.ts` opens the
Checkout/Portal URL in an in-app browser (`expo-web-browser`) — no native
build needed, this works in Expo Go. The original native-IAP path
(`react-native-iap`, `services/subscriptions/validators.ts`) is left in
place as a secondary option (`SubscriptionSettingsScreen` shows it only
when that native module is actually loaded) since it's still what Apple/
Google generally expect for in-app digital subscriptions — see the note
below.

**Compliance note, said plainly:** shipping Stripe as the *only* purchase
path inside an iOS/Android app generally conflicts with App Store/Play
Store policy for digital subscriptions (Apple's Guideline 3.1.1 in
particular), unless the app qualifies for one of their specific exceptions.
This build implements Stripe because that's what was asked for and it's
fully testable without app-store accounts; the native IAP path already
built stays available for an actual store submission. This tradeoff is
worth a conscious decision before shipping to a store, not a silent
default.

**Sandbox limitation:** this environment's network policy also blocks
`api.stripe.com`, so the Stripe integration could not be exercised against
a live test-mode account here (same limitation as Ollama in §4). It's
verified via a clean TypeScript build and a live local smoke test of every
non-Stripe-network code path (webhook route wiring, the `NOT_CONFIGURED`
fallback when no key is set, checkout/portal correctly requiring a full
account). Testing an actual charge needs your own Stripe test-mode keys.

### Free vs. Grandma+ feature matrix

| Feature | Free | Grandma+ |
|---|---|---|
| Chat, daily planner (add/move/remove one item), traditional (catalog) recipes, chores/tasks | ✅ | ✅ |
| Ads | shown | none |
| AI recipe generation | capped (`FREE_DAILY_RECIPE_CAP`, default 3/day) | unlimited |
| Grocery list generation (create/add-to/merge lists, push a recipe's ingredients to a list) | ❌ | ✅ |
| Long-term memory (remembering favorites, dietary needs, routines) | ❌ | ✅ |
| Family Cookbook (create, digitize handwriting, share through Messages) | ❌ | ✅ |
| Advanced planning (the `plan_day` chat tool laying out a whole day at once) | ❌ | ✅ |

Enforcement lives in two places that mirror each other: REST routes use
`requirePlus` middleware (`server/src/middleware/auth.ts`), and the same
chat tools use the `isPlusUser()` helper (`server/src/utils/subscriptionTier.ts`)
directly, since tool calls don't go through Express middleware. Both return
a `PLUS_REQUIRED` result rather than silently failing; the system prompt
(§3) instructs the model to mention Grandma+ warmly when it sees one rather
than just erroring out. On the client, `useApiGate()` catches
`ACCOUNT_REQUIRED`/`PLUS_REQUIRED` centrally and pops the matching sheet
(`AccountRequiredSheet` / `PlusRequiredSheet`) instead of every call site
handling it by hand. Existing data is always grandfathered: reading,
checking off, or deleting a grocery list/Family Cookbook recipe/memory fact
a user already has never requires Plus, even if they've since downgraded —
only *creating new* ones does.

## 8. Navigation: ChatGPT/Claude-style sidebar, superseding Section 12's tab bar

**Decision: a slide-out hamburger drawer + Chat as the app's primary/default
screen, replacing the spec's 5-tab bottom bar**, per explicit direction.
`mobile/src/navigation/MainDrawerNavigator.tsx` (built on
`@react-navigation/drawer`) is the new outer shell; `DrawerContent.tsx` is
the sidebar itself:
- A **"New chat"** button at the top, always visible, that clears the
  current conversation (`GrandmaTab` navigated to with a `resetAt` param
  `ChatScreen` watches) without touching the server-side daily usage cap,
  which is per-day, not per-conversation.
- A flat nav list (Grandma / Home / Recipes / Tasks & Planner) in place of
  the old tab icons, with the current screen highlighted.
- An account row pinned to the bottom (name + Free/Grandma+ badge) linking
  to Profile — the ChatGPT/Claude pattern of keeping account access out of
  the main nav list.

Every screen gets the hamburger button automatically - `@react-navigation/drawer`
adds it to any screen's native header by default, and the nested stacks
(Recipes/Tasks/Profile, which manage their own headers) get it explicitly
via `<DrawerToggleButton />` as their root screen's `headerLeft`. Chat's
header additionally shows the mascot + "Grandma" as its title and a
pencil/new-chat icon on the right, mirroring the hamburger-left,
new-chat-right pattern both reference apps use.

**Scoping note:** this is a navigation/layout change, not a rebuild of
ChatGPT/Claude's multi-conversation history. Grandma AI still keeps one
continuous conversation per user (as it always has) rather than a list of
named, individually-resumable past chats — "New chat" clears the visible
thread client-side, it doesn't create a second stored conversation
server-side. Building real multi-thread history (separate stored
conversations, a switchable list of them in the sidebar) would be a
meaningful backend change (grouping `ChatMessage` rows by a conversation
id) that wasn't part of this request; flagging it here as the natural next
step if that's wanted later.

Needed two new native-ish dependencies for the drawer's slide gesture:
`react-native-gesture-handler` (app root wrapped in
`GestureHandlerRootView` in `App.tsx`) and `react-native-reanimated` (its
Babel plugin added to `babel.config.js`, must stay last in the plugins
list). Both bundle cleanly via Metro for iOS and Android; the actual swipe
gesture and slide animation could not be exercised in this sandbox (no
device/simulator here), so give the drawer a try on a real device/simulator
before considering this final.

## 9. Data model

See `server/prisma/schema.prisma`. One `User` row per person (guest or
full), with `Task`, `Reminder`, `Recipe`, `FamilyCookbookRecipe`,
`GroceryList`/`GroceryItem`, `ScheduleEvent`, `MemoryFact`,
`ChatMessage`, `NotificationPreference`, and `Subscription` (now carrying
both `originalTransactionId` for native IAP and `stripeCustomerId`/
`stripeSubscriptionId` for Stripe, so either rail writes to the same tier).
"Today's Tasks" on Home is a filtered read of `Task`, not a separate model,
per Section 3.
