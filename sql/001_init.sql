CREATE TABLE IF NOT EXISTS customers (
  customer_id text PRIMARY KEY,
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  state text NOT NULL,
  home_airport text NOT NULL,
  loyalty_tier text NOT NULL CHECK (loyalty_tier IN ('GOLD', 'PLATINUM', 'SILVER')),
  marketing_consent boolean NOT NULL,
  travel_intent_score numeric(4, 3) NOT NULL CHECK (travel_intent_score BETWEEN 0 AND 1),
  price_sensitivity_score numeric(4, 3) NOT NULL CHECK (price_sensitivity_score BETWEEN 0 AND 1),
  travel_intent_segment text NOT NULL,
  intent_updated_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journey_events (
  event_id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  destination text NOT NULL,
  session_id text,
  occurred_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('web', 'mobile', 'booking'))
);

CREATE INDEX IF NOT EXISTS journey_events_customer_time_idx
  ON journey_events (customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS journey_events_type_time_idx
  ON journey_events (event_type, occurred_at DESC);

CREATE TABLE IF NOT EXISTS demo_sources (
  source_id text PRIMARY KEY,
  file_name text NOT NULL,
  display_name text NOT NULL,
  record_type text NOT NULL,
  xdm_class text NOT NULL,
  record_count integer NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  loaded_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO demo_sources (source_id, file_name, display_name, record_type, xdm_class)
VALUES
  ('crm', '01_crm_customers.csv', 'CRM customers', 'Profile', 'XDM Individual Profile'),
  ('web', '02_web_events.csv', 'Web events', 'ExperienceEvent', 'XDM ExperienceEvent'),
  ('mobile', '03_mobile_events.csv', 'Mobile events', 'ExperienceEvent', 'XDM ExperienceEvent'),
  ('intent', '04_third_party_travel_intent.csv', 'Travel intent enrichment', 'Profile enrichment', 'XDM Individual Profile'),
  ('bookings', '05_completed_bookings.csv', 'Completed bookings', 'ExperienceEvent', 'XDM ExperienceEvent')
ON CONFLICT (source_id) DO NOTHING;
