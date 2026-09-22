import jwt from "jsonwebtoken";
import { env } from "../../config/env";

export interface AuthTokenPayload {
  userId: string;
  isGuest: boolean;
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
}
