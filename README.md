# aep_journey_rescue_demo-backend — Journey Rescue API

Node.js 20+, Express, TypeScript, PostgreSQL. This is the backend repository for
the synthetic AEP Journey Rescue demo.

## Local setup

1. Start the local PostgreSQL service from the project root with
   `docker compose up -d postgres`, or provide your own PostgreSQL database.
2. From this directory:

   ```sh
   cp .env.example .env
   npm install
   npm run db:migrate
   npm run seed
   npm run dev
   ```

The API listens on port 4000. The included credentials are for the local demo
only. Use a dedicated, disposable database; do not use production credentials.
`npm run seed` reads `data/*.csv` and commits the refresh atomically.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API and database readiness |
| GET | `/api/dashboard` | Profile, event, and source counts |
| GET | `/api/audience?asOf=2026-09-30&searchDays=14&abandonDays=14&bookingDays=7` | Evaluate audience and explain each profile |
| GET | `/api/profiles?q=C003&limit=100&offset=0` | Search and paginate profile records |
| GET | `/api/profiles/:customerId` | One unified profile and its journey events |
| GET | `/api/events?q=Hawaii&limit=100&offset=0` | Search and paginate event records |
| GET | `/api/sources` | Loaded source metadata and row counts |
| POST | `/api/assistant/suggest` | Offline, deterministic demo draft from a supported travel prompt |
| GET | `/api/destinations` | Simulation-only destination catalogue |
| POST | `/api/activations` | Re-evaluate audience and record a count-only simulation |
| GET | `/api/activations` | Paginated activation simulation history |

Lookback values are bounded to 1–365 days. The evaluator uses UTC day-end for
the selected anchor date. Responses include explicit eligibility checks and
exclusion reasons.

## Data model

- `customers`: CRM profile plus third-party travel-intent enrichment on
  `customer_id`.
- `journey_events`: web, mobile, and booking events; indexed by customer/time
  and event type/time.
- `demo_sources`: source-to-XDM mapping and import counts.

See the [database guide](./DATABASE_GUIDE.md) for storage boundaries,
what to retain, and production safeguards.

The PostgreSQL schema is a local demo model, not an AEP XDM schema. See the
project-root README for AEP sandbox guidance and the suggested XDM mapping.

## Tests and build

```sh
npm test
npm run build
```

The tests cover consent, intent/loyalty, event lookbacks, recent-booking
suppression, the expected four synthetic audience members, and offline
assistant-rule suggestions.

Audience preview and activation use parameterized PostgreSQL `EXISTS`
predicates rather than transferring every event row into the Node.js process.
The customer/event composite index supports those predicates; validate the
query plan against representative data volumes before choosing production
indexes or partitioning.

## Postman

Import `postman/Journey-Rescue-API.postman_collection.json`. Set up and seed
the API first, select the collection's local `baseUrl`, and run requests. It
covers health, dashboard, audience evaluation, profile search/detail, event
search, source mapping, rule suggestions, destinations, activation and the
activation audit log. The audience request asserts the expected synthetic IDs.
Activation only persists a simulation record and count; it does not send a
profile, identifier, or network request to a destination.

The rule assistant is a clearly labeled deterministic heuristic. It is not an
LLM integration. Replace it with a server-side model provider only after
defining data minimization, consent, prompt-injection controls, model policy,
human approval, and audit requirements.

API parameters are validated and bounded; activation requires explicit
simulation confirmation. The run audit is count-only and has a database check
that prevents marking PII as transferred. These controls make the demo
workflow inspectable; they do not replace a production privacy review.

Activation requests must include a unique `Idempotency-Key` header containing
8–128 letters, digits, periods, underscores, colons, or hyphens. Retrying the
same key and same request replays the existing run; reusing the key with a
different request returns `409`. The database enforces key uniqueness to cover
concurrent retries. The key and request hash are operational metadata, not
customer identifiers.

### Test strategy and limitations

`npm test` includes pure rule/validation tests and HTTP integration tests that
start the Express app on an ephemeral local port. Those route tests use the
actual synthetic CSV fixtures and a test-only in-memory `Queryable` adapter,
so they can run without PostgreSQL. They verify request parsing, security and
request-ID headers, audience output, assistant behavior, profile not-found
handling, and activation idempotency/privacy response behavior.

The test adapter is not PostgreSQL and cannot verify SQL dialect, migrations,
transactions, locking, or query plans. For a database-backed check, use a
disposable local PostgreSQL 16 database: start the Compose service, apply both
migrations, seed the CSVs, then run the API and Postman collection. `npm run test:postgres` additionally exercises the audience SQL, migrations'
resulting schema, and concurrent activation idempotency against a real
PostgreSQL database. It is skipped unless `TEST_DATABASE_URL` points to a
disposable database that has been migrated and seeded. CI provisions PostgreSQL,
applies migrations and seed data, and runs both suites. Neither the in-memory
route adapter nor the small CI database substitutes for production-scale load,
security, privacy, or recovery testing.

### Production-readiness boundary

This educational sample has no authentication, authorization, tenant
isolation, real destination connector, production consent framework, PII
retention/deletion workflow, key management, backups, disaster recovery, or
formal compliance review. It must not be deployed as-is with real customer
data. Before a real release, threat-model and test those controls with the
security, privacy, data-governance, and platform teams.
