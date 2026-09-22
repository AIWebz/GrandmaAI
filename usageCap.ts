import { prisma } from "../db/prisma";
import { env } from "../config/env";
import { todayKey } from "./dates";
import { isPlusUser } from "./subscriptionTier";

export interface UsageStatus {
  used: number;
  cap: number;
  remaining: number;
  atCap: boolean;
  unlimited: boolean;
  rewardedUnlocksUsed: number;
  rewardedUnlocksRemaining: number;
}

/**
 * Free-tier daily chat cap (Section 15). Grandma+ subscribers are
 * unlimited. Communicated to the client via GET /chat/usage so the app can
 * show "X of Y Grandma chats today" instead of a surprise mid-chat paywall.
 * A rewarded ad can raise the effective cap for the day (Section 15
 * "rewarded ads for extra features"), capped itself so it can't be abused
 * into unlimited use for free.
 */
export async function getUsageStatus(userId: string): Promise<UsageStatus> {
  if (await isPlusUser(userId)) {
    return { used: 0, cap: Infinity, remaining: Infinity, atCap: false, unlimited: true, rewardedUnlocksUsed: 0, rewardedUnlocksRemaining: 0 };
  }

  const day = todayKey();
  const [usage, rewarded] = await Promise.all([
    prisma.aiUsage.findUnique({ where: { userId_day: { userId, day } } }),
    prisma.rewardedUnlock.findUnique({ where: { userId_day: { userId, day } } }),
  ]);
  const used = usage?.count ?? 0;
  const rewardedUnlocksUsed = Math.min(rewarded?.count ?? 0, env.rewardedUnlockDailyCap);
  const cap = env.freeDailyChatCap + rewardedUnlocksUsed;
  return {
    used,
    cap,
    remaining: Math.max(0, cap - used),
    atCap: used >= cap,
    unlimited: false,
    rewardedUnlocksUsed,
    rewardedUnlocksRemaining: Math.max(0, env.rewardedUnlockDailyCap - rewardedUnlocksUsed),
  };
}

export async function incrementUsage(userId: string): Promise<void> {
  const day = todayKey();
  await prisma.aiUsage.upsert({
    where: { userId_day: { userId, day } },
    update: { count: { increment: 1 } },
    create: { userId, day, count: 1 },
  });
}

/**
 * Grants one extra chat for today after a completed rewarded ad. This is
 * client-attested (the SDK's onEarnedReward callback only fires after
 * AdMob confirms completion, but there's no server-side verification
 * callback wired up here - see docs/ARCHITECTURE.md). Capped per day
 * regardless, so the worst case is a bounded number of free extra chats,
 * not unlimited.
 */
export async function grantRewardedUnlock(userId: string): Promise<{ granted: boolean; status: UsageStatus }> {
  const day = todayKey();
  const existing = await prisma.rewardedUnlock.findUnique({ where: { userId_day: { userId, day } } });
  if ((existing?.count ?? 0) >= env.rewardedUnlockDailyCap) {
    return { granted: false, status: await getUsageStatus(userId) };
  }
  await prisma.rewardedUnlock.upsert({
    where: { userId_day: { userId, day } },
    update: { count: { increment: 1 } },
    create: { userId, day, count: 1 },
  });
  return { granted: true, status: await getUsageStatus(userId) };
}

export interface RecipeUsageStatus {
  used: number;
  cap: number;
  remaining: number;
  atCap: boolean;
  unlimited: boolean;
}

/**
 * Free tier gets "traditional recipes" (the built-in catalog) plus a
 * small daily allowance of AI-generated ones; Grandma+ is unlimited
 * recipe generation. Shared by the REST /recipes/generate route and the
 * chat `create_recipe` tool so both count against the same daily total.
 */
export async function getRecipeUsageStatus(userId: string): Promise<RecipeUsageStatus> {
  if (await isPlusUser(userId)) {
    return { used: 0, cap: Infinity, remaining: Infinity, atCap: false, unlimited: true };
  }
  const day = todayKey();
  const usage = await prisma.recipeUsage.findUnique({ where: { userId_day: { userId, day } } });
  const used = usage?.count ?? 0;
  const cap = env.freeDailyRecipeCap;
  return { used, cap, remaining: Math.max(0, cap - used), atCap: used >= cap, unlimited: false };
}

export async function incrementRecipeUsage(userId: string): Promise<void> {
  const day = todayKey();
  await prisma.recipeUsage.upsert({
    where: { userId_day: { userId, day } },
    update: { count: { increment: 1 } },
    create: { userId, day, count: 1 },
  });
}
