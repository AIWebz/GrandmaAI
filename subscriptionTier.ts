import { prisma } from "../db/prisma";

/** Single source of truth for "is this user currently on Grandma+", used by REST gating, tool handlers, and usage caps alike. */
export async function isPlusUser(userId: string): Promise<boolean> {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  return sub?.tier === "PLUS" && (!sub.expiresAt || sub.expiresAt > new Date());
}
