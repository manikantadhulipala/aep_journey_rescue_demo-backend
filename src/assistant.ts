import type { AudienceRules } from "./types.js";

export type RuleSuggestion =
  | {
      supported: true;
      mode: "offline-demo-heuristic";
      requiresHumanReview: true;
      confidence: number;
      audienceName: string;
      rules: AudienceRules;
      explanation: string[];
    }
  | {
      supported: false;
      supportedExample: string;
    };

function suggestedDays(prompt: string, expression: RegExp, fallback: number): number {
  const match = prompt.match(expression);
  return match ? Math.max(1, Math.min(365, Number.parseInt(match[1]!, 10))) : fallback;
}

export function suggestTravelAudienceRules(
  promptText: string,
  current: Partial<AudienceRules> = {},
): RuleSuggestion {
  const prompt = promptText.toLowerCase();
  const travelTerms = ["travel", "flight", "booking", "trip", "journey", "abandon"];
  if (!travelTerms.some((term) => prompt.includes(term))) {
    return {
      supported: false,
      supportedExample: "Travelers who searched and abandoned in the last 14 days, excluding anyone who booked in the last 7 days.",
    };
  }

  const rules: AudienceRules = {
    asOf: current.asOf ?? "2026-09-30",
    searchDays: suggestedDays(prompt, /search(?:ed)?\D{0,24}(\d{1,3})\s*days?/i, current.searchDays ?? 14),
    abandonDays: suggestedDays(prompt, /abandon(?:ed)?\D{0,24}(\d{1,3})\s*days?/i, current.abandonDays ?? 14),
    bookingDays: suggestedDays(prompt, /(?:book(?:ed|ing)?|reserv(?:ed|ation)?)\D{0,24}(\d{1,3})\s*days?/i, current.bookingDays ?? 7),
  };
  return {
    supported: true,
    mode: "offline-demo-heuristic",
    requiresHumanReview: true,
    confidence: 0.62,
    audienceName: "Journey Rescue — High-Intent Abandoners",
    rules,
    explanation: [
      "This is a deterministic local demo suggestion, not a call to a generative AI model.",
      "The audience still requires marketing consent and either GOLD/PLATINUM loyalty or travel intent >= 0.80.",
      `Review the ${rules.searchDays}-day search, ${rules.abandonDays}-day abandonment, and ${rules.bookingDays}-day booking suppression windows against the preview.`,
    ],
  };
}
