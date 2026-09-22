import fetch from "node-fetch";
import { env } from "../../config/env";

export interface PushMessage {
  to: string; // Expo push token, FCM device token, or APNs device token depending on provider
  title: string;
  body: string;
  category: "task_reminder" | "meal_time" | "encouragement";
}

interface PushAdapter {
  send(messages: PushMessage[]): Promise<void>;
}

/** Live: works today against a real Expo project without any extra provider account. */
const expoAdapter: PushAdapter = {
  async send(messages) {
    if (messages.length === 0) return;
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages.map((m) => ({ to: m.to, title: m.title, body: m.body, sound: "default", data: { category: m.category } }))),
    });
  },
};

/** Stub: real FCM HTTP v1 send needs a Google Cloud service account (see docs/ARCHITECTURE.md). */
const fcmAdapter: PushAdapter = {
  async send(messages) {
    if (!env.fcmServerKey) {
      console.warn(`[push:fcm] NOT_CONFIGURED - would have sent ${messages.length} notification(s). Set FCM_SERVER_KEY to go live.`);
      return;
    }
    for (const m of messages) {
      await fetch("https://fcm.googleapis.com/fcm/send", {
        method: "POST",
        headers: { Authorization: `key=${env.fcmServerKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: m.to, notification: { title: m.title, body: m.body }, data: { category: m.category } }),
      });
    }
  },
};

/** Stub: real APNs send needs a .p8 signing key + team id (see docs/ARCHITECTURE.md). */
const apnsAdapter: PushAdapter = {
  async send(messages) {
    if (!env.apnsKeyId || !env.apnsTeamId) {
      console.warn(`[push:apns] NOT_CONFIGURED - would have sent ${messages.length} notification(s). Set APNS_KEY_ID/APNS_TEAM_ID to go live.`);
      return;
    }
    // A real implementation signs a JWT with the .p8 key and POSTs HTTP/2 to
    // api.push.apple.com/3/device/<token> per message. Omitted here since it
    // needs an actual Apple Developer key file this sandbox doesn't have.
    console.warn("[push:apns] Adapter present but HTTP/2 client wiring needs the real .p8 key file.");
  },
};

function getAdapter(): PushAdapter {
  if (env.pushProvider === "fcm") return fcmAdapter;
  if (env.pushProvider === "apns") return apnsAdapter;
  return expoAdapter;
}

export async function sendPush(messages: PushMessage[]): Promise<void> {
  await getAdapter().send(messages);
}
