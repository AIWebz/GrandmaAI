import { prisma } from "../../db/prisma";
import { sendPush, PushMessage } from "./pushService";
import { todayKey } from "../../utils/dates";

const DAILY_CAP_BY_FREQUENCY: Record<string, number> = { OFF: 0, LOW: 1, NORMAL: 3 };

function isWithinQuietHours(now: Date, start?: string | null, end?: string | null): boolean {
  if (!start || !end) return false;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const startM = sh * 60 + sm;
  const endM = eh * 60 + em;
  return startM > endM ? minutesNow >= startM || minutesNow < endM : minutesNow >= startM && minutesNow < endM;
}

const TEMPLATES = {
  task_reminder: (title: string) => `Laundry time! Let's get ${title.toLowerCase()} started.`,
  meal_time: () => "Hey sweetheart. It's almost dinner time. Want me to help you figure out what to make?",
  encouragement: (remaining: number) => `You've got ${remaining} thing${remaining === 1 ? "" : "s"} left on today's list. You've got this.`,
} as const;

/**
 * Proactive (non-requested) notification dispatch, respecting per-user
 * frequency/category preferences, quiet hours, and a sensible daily cap
 * (Section 11). Intended to run on a schedule (e.g. every 15 min via cron);
 * `POST /notifications/dispatch-tick` exposes it for that purpose.
 */
export async function runNotificationTick(): Promise<{ sent: number }> {
  const now = new Date();
  const day = todayKey(now);
  const prefs = await prisma.notificationPreference.findMany({ where: { pushToken: { not: null }, frequency: { not: "OFF" } } });
  const messages: PushMessage[] = [];
  const sentUserIds: string[] = [];

  for (const pref of prefs) {
    if (isWithinQuietHours(now, pref.quietHoursStart, pref.quietHoursEnd)) continue;

    const cap = DAILY_CAP_BY_FREQUENCY[pref.frequency] ?? 3;
    const log = await prisma.notificationLog.findUnique({ where: { userId_day: { userId: pref.userId, day } } });
    if ((log?.count ?? 0) >= cap) continue;

    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    let queued = false;
    if (pref.encouragement && now.getHours() === 16) {
      const tasksToday = await prisma.task.findMany({ where: { userId: pref.userId, dueDate: { gte: todayStart } } });
      const remaining = tasksToday.filter((t) => !t.completed).length;
      if (remaining > 0) {
        messages.push({ to: pref.pushToken!, title: "Grandma AI", body: TEMPLATES.encouragement(remaining), category: "encouragement" });
        queued = true;
      }
    }
    if (!queued && pref.mealTimePrompts && now.getHours() === 17) {
      messages.push({ to: pref.pushToken!, title: "Grandma AI", body: TEMPLATES.meal_time(), category: "meal_time" });
      queued = true;
    }
    if (queued) sentUserIds.push(pref.userId);
  }

  await sendPush(messages);
  await Promise.all(
    sentUserIds.map((userId) =>
      prisma.notificationLog.upsert({
        where: { userId_day: { userId, day } },
        update: { count: { increment: 1 } },
        create: { userId, day, count: 1 },
      })
    )
  );
  return { sent: messages.length };
}
