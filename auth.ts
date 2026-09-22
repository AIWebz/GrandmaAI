import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { signToken } from "../services/auth/jwt";
import { verifyAppleIdToken, verifyGoogleIdToken, SocialAuthNotConfiguredError } from "../services/auth/socialProviders";
import { requireAuth, AuthedRequest } from "../middleware/auth";

export const authRouter = Router();

function userPublic(user: { id: string; email: string | null; isGuest: boolean; preferredName: string | null; onboardingCompleted: boolean }) {
  return {
    id: user.id,
    email: user.email,
    isGuest: user.isGuest,
    preferredName: user.preferredName,
    onboardingCompleted: user.onboardingCompleted,
  };
}

// Silent guest account creation - the core of the deferred-signup pattern.
authRouter.post("/guest", async (req, res) => {
  const schema = z.object({ deviceId: z.string().min(1) });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "deviceId required" });
  const { deviceId } = parse.data;

  let user = await prisma.user.findUnique({ where: { deviceId } });
  if (!user) {
    user = await prisma.user.create({ data: { deviceId, isGuest: true } });
    await prisma.notificationPreference.create({ data: { userId: user.id } });
  }
  const token = signToken({ userId: user.id, isGuest: user.isGuest });
  res.json({ token, user: userPublic(user) });
});

authRouter.post("/signup", async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(8) });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Valid email and 8+ char password required" });
  const { email, password } = parse.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already in use" });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { email, passwordHash, isGuest: false } });
  await prisma.notificationPreference.create({ data: { userId: user.id } });
  const token = signToken({ userId: user.id, isGuest: false });
  res.json({ token, user: userPublic(user) });
});

authRouter.post("/login", async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid credentials" });
  const { email, password } = parse.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const token = signToken({ userId: user.id, isGuest: false });
  res.json({ token, user: userPublic(user) });
});

/** Converts the current guest row into a full account in place - same id, same data. */
authRouter.post("/upgrade", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(8) });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Valid email and 8+ char password required" });
  const { email, password } = parse.data;

  const clash = await prisma.user.findUnique({ where: { email } });
  if (clash && clash.id !== req.userId) return res.status(409).json({ error: "Email already in use" });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: { email, passwordHash, isGuest: false },
  });
  const token = signToken({ userId: user.id, isGuest: false });
  res.json({ token, user: userPublic(user) });
});

authRouter.post("/social/:provider", async (req, res) => {
  const provider = req.params.provider;
  const schema = z.object({ idToken: z.string(), deviceId: z.string().optional() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "idToken required" });

  try {
    let identity: { sub: string; email?: string };
    if (provider === "apple") identity = await verifyAppleIdToken(parse.data.idToken);
    else if (provider === "google") identity = await verifyGoogleIdToken(parse.data.idToken);
    else return res.status(400).json({ error: "Unknown provider" });

    const field = provider === "apple" ? "appleSub" : "googleSub";
    let user = await prisma.user.findFirst({ where: { [field]: identity.sub } as any });
    if (!user) {
      user = await prisma.user.create({
        data: { [field]: identity.sub, email: identity.email, isGuest: false } as any,
      });
      await prisma.notificationPreference.create({ data: { userId: user.id } });
    }
    const token = signToken({ userId: user.id, isGuest: false });
    res.json({ token, user: userPublic(user) });
  } catch (e) {
    if (e instanceof SocialAuthNotConfiguredError) {
      return res.status(501).json({
        error: "NOT_CONFIGURED",
        message: `Sign in with ${provider} needs a real ${provider === "apple" ? "APPLE_CLIENT_ID" : "GOOGLE_CLIENT_ID"} configured on the server.`,
      });
    }
    res.status(401).json({ error: "Invalid social token" });
  }
});

authRouter.post("/reset-password/request", async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Valid email required" });
  // Always respond success to avoid leaking which emails exist.
  // Real delivery goes through a transactional email provider (SendGrid/SES);
  // wire SENDGRID_API_KEY etc. and send the reset token link from here.
  res.json({ ok: true, message: "If that email exists, a reset link has been sent." });
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json({ user: userPublic(user) });
});
