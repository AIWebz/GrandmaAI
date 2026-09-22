import fetch from "node-fetch";
import { env } from "../../config/env";

export interface ValidationResult {
  valid: boolean;
  tier: "FREE" | "PLUS";
  expiresAt: Date | null;
  originalTransactionId?: string;
  autoRenew?: boolean;
  notConfigured?: boolean;
}

/**
 * Server-side StoreKit 2 receipt validation. Real endpoint + parsing shape
 * is implemented; without a real APPLE_SHARED_SECRET (needs an App Store
 * Connect app) it returns NOT_CONFIGURED rather than pretending to
 * validate (see docs/ARCHITECTURE.md).
 */
export async function validateAppleReceipt(receiptData: string): Promise<ValidationResult> {
  if (!env.appleSharedSecret) {
    return { valid: false, tier: "FREE", expiresAt: null, notConfigured: true };
  }
  const body = { "receipt-data": receiptData, password: env.appleSharedSecret, "exclude-old-transactions": true };
  let response = await fetch("https://buy.itunes.apple.com/verifyReceipt", { method: "POST", body: JSON.stringify(body) });
  let json: any = await response.json();
  if (json.status === 21007) {
    // Sandbox receipt sent to prod endpoint - retry against sandbox per Apple's documented flow.
    response = await fetch("https://sandbox.itunes.apple.com/verifyReceipt", { method: "POST", body: JSON.stringify(body) });
    json = await response.json();
  }
  if (json.status !== 0) return { valid: false, tier: "FREE", expiresAt: null };

  const latest = json.latest_receipt_info?.[json.latest_receipt_info.length - 1];
  if (!latest) return { valid: false, tier: "FREE", expiresAt: null };
  const expiresAt = new Date(Number(latest.expires_date_ms));
  return {
    valid: expiresAt > new Date(),
    tier: expiresAt > new Date() ? "PLUS" : "FREE",
    expiresAt,
    originalTransactionId: latest.original_transaction_id,
    autoRenew: json.pending_renewal_info?.[0]?.auto_renew_status === "1",
  };
}

/**
 * Google Play Billing verification via the Android Publisher API. Needs a
 * real service account JSON from a Play Console app (not provisionable
 * here) - returns NOT_CONFIGURED until GOOGLE_SERVICE_ACCOUNT_JSON is set.
 */
export async function validateGooglePurchase(_packageName: string, _productId: string, _purchaseToken: string): Promise<ValidationResult> {
  if (!env.googleServiceAccountJson) {
    return { valid: false, tier: "FREE", expiresAt: null, notConfigured: true };
  }
  // Real flow: exchange the service account JWT for an OAuth token, then GET
  // androidpublisher/v3/applications/{packageName}/purchases/subscriptions/{productId}/tokens/{purchaseToken}
  // and read expiryTimeMillis/autoRenewing from the response.
  throw new Error("Google Play verification requires wiring a real service account - see docs/ARCHITECTURE.md");
}
