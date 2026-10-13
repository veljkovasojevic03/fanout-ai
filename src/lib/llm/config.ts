import "server-only";

import type { Plan } from "@/lib/auth/session";

/*
 * LLM configuration from the environment. Model ids are defaults that can be
 * overridden per deployment (LLM_MODEL_FREE / LLM_MODEL_PRO).
 */

const DEFAULT_MODEL_FREE = "claude-haiku-4-5";
const DEFAULT_MODEL_PRO = "claude-sonnet-5-5";
const DEFAULT_DAILY_CAP = 30;

export type LlmConfig = {
  /** True when a real model call is possible and allowed. */
  liveEnabled: boolean;
  modelFree: string;
  modelPro: string;
  /** Global cap on live generations per UTC day, across all users. */
  dailyCap: number;
  /** The same for live refinements, which are smaller calls but far more frequent. */
  dailyRefineCap: number;
};

/** Without its own setting, the refine cap follows the generation cap. */
const REFINES_PER_GENERATION = 5;

function parseCap(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getLlmConfig(): LlmConfig {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const forceSample = process.env.DEMO_FORCE_SAMPLE?.trim().toLowerCase() === "true";
  const dailyCap = parseCap(process.env.DAILY_REAL_GENERATION_CAP, DEFAULT_DAILY_CAP);

  return {
    liveEnabled: hasKey && !forceSample,
    modelFree: process.env.LLM_MODEL_FREE?.trim() || DEFAULT_MODEL_FREE,
    modelPro: process.env.LLM_MODEL_PRO?.trim() || DEFAULT_MODEL_PRO,
    dailyCap,
    dailyRefineCap: parseCap(process.env.DAILY_REAL_REFINE_CAP, dailyCap * REFINES_PER_GENERATION),
  };
}

export function modelForPlan(plan: Plan, config: LlmConfig = getLlmConfig()): string {
  return plan === "pro" ? config.modelPro : config.modelFree;
}
