// Dynamic config (vs. a plain app.json) so the AdMob app ids are a pure
// env var swap, per spec Section 16 ("ad provider must be swappable via
// environment variables"). Defaults to Google's public test app ids, same
// ones the server falls back to in src/routes/config.ts, so ads work in
// test mode with zero AdMob account setup.
const ADMOB_APP_ID_IOS = process.env.ADMOB_APP_ID_IOS || "ca-app-pub-3940256099942544~1458002511";
const ADMOB_APP_ID_ANDROID = process.env.ADMOB_APP_ID_ANDROID || "ca-app-pub-3940256099942544~3347511713";

module.exports = {
  expo: {
    name: "Grandma AI",
    slug: "grandma-ai",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./src/assets/icon.png",
    userInterfaceStyle: "automatic",
    splash: {
      backgroundColor: "#FAF3EC",
    },
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.grandmaai.app",
      infoPlist: {
        NSMicrophoneUsageDescription: "Grandma AI uses your microphone so you can talk to Grandma instead of typing.",
        NSPhotoLibraryUsageDescription: "Grandma AI uses your photos so you can add pictures of family recipes and finished dishes.",
        NSCameraUsageDescription: "Grandma AI uses your camera to photograph handwritten recipe cards and finished dishes.",
        NSUserTrackingUsageDescription: "This identifier is used to show you more relevant ads and support the free tier of Grandma AI.",
      },
    },
    android: {
      package: "com.grandmaai.app",
      adaptiveIcon: {
        backgroundColor: "#FAF3EC",
      },
      permissions: ["RECORD_AUDIO", "READ_MEDIA_IMAGES", "CAMERA", "POST_NOTIFICATIONS"],
    },
    plugins: [
      [
        "expo-image-picker",
        {
          photosPermission: "Grandma AI uses your photos so you can add pictures of family recipes and finished dishes.",
          cameraPermission: "Grandma AI uses your camera to photograph handwritten recipe cards and finished dishes.",
        },
      ],
      [
        "expo-speech-recognition",
        {
          microphonePermission: "Grandma AI uses your microphone so you can talk to Grandma instead of typing.",
          speechRecognitionPermission: "Grandma AI uses speech recognition to turn what you say into text.",
        },
      ],
      [
        "react-native-google-mobile-ads",
        {
          iosAppId: ADMOB_APP_ID_IOS,
          androidAppId: ADMOB_APP_ID_ANDROID,
          userTrackingUsageDescription: "This identifier is used to show you more relevant ads and support the free tier of Grandma AI.",
        },
      ],
    ],
    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000",
    },
  },
};
