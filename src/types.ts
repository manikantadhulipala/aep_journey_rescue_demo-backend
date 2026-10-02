export interface Customer {
  customer_id: string;
  email: string;
  first_name: string;
  last_name: string;
  state: string;
  home_airport: string;
  loyalty_tier: "GOLD" | "PLATINUM" | "SILVER";
  marketing_consent: boolean;
  travel_intent_score: number;
  price_sensitivity_score: number;
  travel_intent_segment: string;
  intent_updated_at: string;
}

export interface JourneyEvent {
  event_id: string;
  customer_id: string;
  event_type: string;
  destination: string;
  session_id: string | null;
  occurred_at: string;
  source: "web" | "mobile" | "booking";
}

export interface AudienceRules {
  asOf: string;
  searchDays: number;
  abandonDays: number;
  bookingDays: number;
}

export interface Evaluation {
  qualifies: boolean;
  checks: {
    consent: boolean;
    intent: boolean;
    search: boolean;
    abandoned: boolean;
    completed: boolean;
  };
  reasons: string[];
}

export interface EvaluatedProfile extends Customer {
  audience: Evaluation;
}
