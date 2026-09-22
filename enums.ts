// String-literal unions mirroring the enum-like string fields in
// prisma/schema.prisma (SQLite has no native enum type).
export type PersonalityStyle = "WARM" | "FUNNY" | "CALM" | "PRACTICAL";
export type Interest = "COOKING" | "CHORES" | "PLANNING" | "GROCERIES" | "REMINDERS" | "ENCOURAGEMENT" | "EVERYTHING";
export type SubscriptionTier = "FREE" | "PLUS";
export type TaskCategory = "CLEANING" | "LAUNDRY" | "KITCHEN" | "YARD" | "SHOPPING" | "PETS" | "HOUSEHOLD" | "OTHER";
export type RecurrenceRule = "NONE" | "DAILY" | "WEEKLY";
export type ChatRole = "USER" | "ASSISTANT";
export type NotificationFrequency = "OFF" | "LOW" | "NORMAL";
