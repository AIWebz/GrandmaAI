import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL", "file:./dev.db"),
  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "30d",

  aiProvider: process.env.AI_PROVIDER ?? "ollama",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
  anthropicVisionModel: process.env.ANTHROPIC_VISION_MODEL ?? "claude-sonnet-5",

  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3.1",
  ollamaVisionModel: process.env.OLLAMA_VISION_MODEL ?? "llava",

  freeDailyChatCap: Number(process.env.FREE_DAILY_CHAT_CAP ?? 15),
  freeDailyRecipeCap: Number(process.env.FREE_DAILY_RECIPE_CAP ?? 3),

  appleClientId: process.env.APPLE_CLIENT_ID ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",

  pushProvider: process.env.PUSH_PROVIDER ?? "expo",
  fcmServerKey: process.env.FCM_SERVER_KEY ?? "",
  apnsKeyId: process.env.APNS_KEY_ID ?? "",
  apnsTeamId: process.env.APNS_TEAM_ID ?? "",

  appleSharedSecret: process.env.APPLE_SHARED_SECRET ?? "",
  googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
  grandmaPlusMonthlyProductId: process.env.GRANDMA_PLUS_MONTHLY_PRODUCT_ID ?? "grandma_plus_monthly",
  grandmaPlusAnnualProductId: process.env.GRANDMA_PLUS_ANNUAL_PRODUCT_ID ?? "grandma_plus_annual",
  grandmaPlusPriceUsd: Number(process.env.GRANDMA_PLUS_PRICE_USD ?? 14.99),

  // --- Stripe (primary billing rail - see docs/ARCHITECTURE.md) ---
  appUrl: process.env.APP_URL ?? "http://localhost:4000",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripePriceIdMonthly: process.env.STRIPE_PRICE_ID_MONTHLY ?? "",

  adsProvider: process.env.ADS_PROVIDER ?? "admob",
  admobAppIdIos: process.env.ADMOB_APP_ID_IOS ?? "",
  admobAppIdAndroid: process.env.ADMOB_APP_ID_ANDROID ?? "",
  admobBannerAdUnitIdIos: process.env.ADMOB_BANNER_AD_UNIT_ID_IOS ?? "",
  admobBannerAdUnitIdAndroid: process.env.ADMOB_BANNER_AD_UNIT_ID_ANDROID ?? "",
  admobInterstitialAdUnitIdIos: process.env.ADMOB_INTERSTITIAL_AD_UNIT_ID_IOS ?? "",
  admobInterstitialAdUnitIdAndroid: process.env.ADMOB_INTERSTITIAL_AD_UNIT_ID_ANDROID ?? "",
  admobRewardedAdUnitIdIos: process.env.ADMOB_REWARDED_AD_UNIT_ID_IOS ?? "",
  admobRewardedAdUnitIdAndroid: process.env.ADMOB_REWARDED_AD_UNIT_ID_ANDROID ?? "",

  rewardedUnlockDailyCap: Number(process.env.REWARDED_UNLOCK_DAILY_CAP ?? 3),
};
