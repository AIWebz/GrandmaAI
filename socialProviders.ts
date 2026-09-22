/**
 * Sign in with Apple / Google.
 *
 * Real implementation shape: verify the id_token's signature against the
 * provider's public JWKS, check `aud` against our client id, and pull the
 * stable subject claim. This needs a real OAuth client id per platform,
 * which isn't provisionable in this sandbox (see docs/ARCHITECTURE.md) —
 * so verification is wired up but returns NOT_CONFIGURED until
 * APPLE_CLIENT_ID / GOOGLE_CLIENT_ID are set.
 */
import jwksClient from "jwks-rsa";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

const appleJwks = jwksClient({ jwksUri: "https://appleid.apple.com/auth/keys" });
const googleJwks = jwksClient({ jwksUri: "https://www.googleapis.com/oauth2/v3/certs" });

function getKey(client: jwksClient.JwksClient) {
  return (header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) => {
    client.getSigningKey(header.kid, (err, key) => {
      if (err || !key) return callback(err ?? new Error("no signing key"));
      callback(null, key.getPublicKey());
    });
  };
}

export class SocialAuthNotConfiguredError extends Error {}

export async function verifyAppleIdToken(idToken: string): Promise<{ sub: string; email?: string }> {
  if (!env.appleClientId) throw new SocialAuthNotConfiguredError("APPLE_CLIENT_ID not set");
  return new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      getKey(appleJwks),
      { audience: env.appleClientId, issuer: "https://appleid.apple.com" },
      (err, decoded: any) => {
        if (err) return reject(err);
        resolve({ sub: decoded.sub, email: decoded.email });
      }
    );
  });
}

export async function verifyGoogleIdToken(idToken: string): Promise<{ sub: string; email?: string }> {
  if (!env.googleClientId) throw new SocialAuthNotConfiguredError("GOOGLE_CLIENT_ID not set");
  return new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      getKey(googleJwks),
      { audience: env.googleClientId, issuer: ["https://accounts.google.com", "accounts.google.com"] },
      (err, decoded: any) => {
        if (err) return reject(err);
        resolve({ sub: decoded.sub, email: decoded.email });
      }
    );
  });
}
