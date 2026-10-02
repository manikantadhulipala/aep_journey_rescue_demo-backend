# Database and data-platform guide

## Local demo

The demo uses PostgreSQL as its operational store. It is easy to run locally,
supports relational constraints and transactions, and is suitable for profile
lookup, event inspection, audience evaluation, and count-only activation audit
records at this sample's scale.

Start it from the project root:

```sh
docker compose up -d postgres
cd backend
cp .env.example .env
npm install
npm run db:migrate
npm run seed
npm run dev
```

The checked-in CSVs are synthetic demonstration records. Use a disposable local
database; the demo's example credentials are not production credentials. See
[the schema](./sql/001_init.sql) and
[the activation schema](./sql/002_activations.sql).

## What the demo stores

| Data | Demo table | Purpose |
| --- | --- | --- |
| Unified customer attributes, consent flag, loyalty and intent scores | `customers` | Profile lookup and eligibility predicates |
| Search, abandonment, and completed-booking events | `journey_events` | Journey history and time-window audience predicates |
| Synthetic file/source mapping metadata | `demo_sources` | Explain the sample's source-to-XDM mapping |
| Activation request hash, destination, rules and counts | `activation_runs` | Audit simulation retries without storing audience member IDs |

The activation simulation deliberately does not transmit or persist member
identifiers. Real implementations need a separately governed activation
contract, secure destination credentials, delivery tracking, and documented
deletion behavior.

## Suggested production platform boundaries

- **Adobe Experience Platform (AEP):** use an AEP sandbox to learn and
  demonstrate XDM datasets, identity namespaces, Profile enablement, consent
  labels/policies, segment definitions, and destinations. A sandbox is not a
  generic SQL database; avoid treating this local schema as an AEP replacement.
- **Databricks with Delta Lake:** consider for governed historical/event data,
  large-scale transformations, replay, and offline feature computation.
  Define ownership, catalog permissions, retention, and incremental ingestion.
- **Kafka or Azure Event Hubs:** use for durable event transport and decoupling
  producers from profile/audience consumers. Define schemas, partition keys,
  retries, dead-letter handling, ordering expectations, and replay policy.
- **Redis:** add only for a measured low-latency serving or cache requirement.
  Keep consent and profile systems authoritative elsewhere; define TTL,
  invalidation, and outage behavior.
- **ClickHouse:** consider for high-volume, interactive event analytics where
  measured query workloads justify a columnar store. It need not replace a
  transactional profile or activation-audit database.
- **PostgreSQL:** remains suitable for app configuration, workflow metadata,
  activation audit, and small operational datasets. It may also serve the
  audience query at moderate scale with appropriate partitioning/indexes and
  query-plan validation.

Choose the source of truth for each entity explicitly; copying the same
consent/profile state into multiple systems without freshness and conflict
rules can produce unsafe activation decisions.

## Before using real customer data

1. Define data ownership, purpose, lawful basis, consent provenance and
   suppression behavior with privacy/legal teams.
2. Minimize fields. Do not ingest direct identifiers into an audience workflow
   unless necessary and approved; separate identity resolution from analytics.
3. Set retention and deletion schedules for profiles, events, derived audiences,
   exports, caches, logs, backups and dead-letter queues; test deletion end to
   end.
4. Encrypt in transit and at rest, manage keys/secrets outside source control,
   and restrict access with authentication, authorization, tenant boundaries,
   least privilege, and audited operations.
5. Establish schema/version contracts, data quality checks, lineage, consent
   freshness, late-event handling, and deterministic reprocessing.
6. Use transactional/outbox or equivalent delivery patterns for activation,
   with idempotency, retries, rate limits, destination acknowledgements,
   reconciliation, and operator-visible failure states.
7. Validate indexes and `EXPLAIN (ANALYZE, BUFFERS)` against representative
   volume; add partitioning or analytical infrastructure only from measured
   workloads.
8. Prove backup restoration, disaster recovery, observability, incident
   response, load behavior, and security/privacy controls before release.

This repository is an educational synthetic-data demo, not a production-ready
CDP. The controls and tests here are examples to discuss and extend, not a
production guarantee or compliance certification.
