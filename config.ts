import { Router } from "express";
import { env } from "../config/env";

export const configRouter = Router();

// Google's public AdMob test ids - always safe to serve, never earn real
// revenue, and don't require an AdMob account to be provisioned. Set the
// ADMOB_*_AD_UNIT_ID_* / ADMOB_APP_ID_* env vars to switch to real,
// revenue-earning units without a client build.
const TEST_APP_ID_IOS = "ca-app-pub-3940256099942544~1458002511";
const TEST_APP_ID_ANDROID = "ca-app-pub-3940256099942544~3347511713";
const TEST_BANNER_IOS = "ca-app-pub-3940256099942544/2934735716";
const TEST_BANNER_ANDROID = "ca-app-pub-3940256099942544/6300978111";
const TEST_INTERSTITIAL_IOS = "ca-app-pub-3940256099942544/4411468910";
const TEST_INTERSTITIAL_ANDROID = "ca-app-pub-3940256099942544/1033173712";
const TEST_REWARDED_IOS = "ca-app-pub-3940256099942544/1712485313";
const TEST_REWARDED_ANDROID = "ca-app-pub-3940256099942544/5224354917";

/**
 * Client-safe config: ad unit ids and placement rules (Section 15). No
 * secrets here - this is what makes the ad provider swappable from the
 * client side without a build. Defaults to Google's public test ids so
 * ads render in test mode with zero AdMob account setup; production ids
 * are a pure env var swap (see server/.env.example).
 */
configRouter.get("/ads", (_req, res) => {
  const testMode = !env.admobAppIdIos && !env.admobAppIdAndroid;
  res.json({
    provider: env.adsProvider,
    testMode,
    appId: { ios: env.admobAppIdIos || TEST_APP_ID_IOS, android: env.admobAppIdAndroid || TEST_APP_ID_ANDROID },
    adUnits: {
      banner: { ios: env.admobBannerAdUnitIdIos || TEST_BANNER_IOS, android: env.admobBannerAdUnitIdAndroid || TEST_BANNER_ANDROID },
      interstitial: {
        ios: env.admobInterstitialAdUnitIdIos || TEST_INTERSTITIAL_IOS,
        android: env.admobInterstitialAdUnitIdAndroid || TEST_INTERSTITIAL_ANDROID,
      },
      rewarded: { ios: env.admobRewardedAdUnitIdIos || TEST_REWARDED_IOS, android: env.admobRewardedAdUnitIdAndroid || TEST_REWARDED_ANDROID },
    },
    placements: {
      bannerScreens: ["recipes_list", "tasks_list", "grocery_list"],
      interstitialAfter: ["chat_to_home_transition", "recipe_saved"],
      neverDuring: ["active_chat_exchange"],
      rewardedUnlocks: ["extra_recipe_generation", "extra_chat_message"],
    },
  });
});
