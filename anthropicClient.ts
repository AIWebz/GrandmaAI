import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../config/env";

/**
 * Swap point for AI_PROVIDER (docs/ARCHITECTURE.md). Anthropic is the only
 * live implementation in this build; adding another provider means adding
 * a client here with the same call shape used by chatService/visionService.
 */
export const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });
