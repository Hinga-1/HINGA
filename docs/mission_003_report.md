# MISSION 003 — Mfumo wa Kujifunza na Kufanya Kazi kwa Kujitegemea

**Tarehe:** 2026-10-30  
**Repository:** `Hinga-1/HINGA`  
**Branch ya ndani:** `mission-002-audit`  
**Neon:** project `falling-moon-75342440`, branch pekee iliyopo live: `production`

## Hali ya Git/GitHub iliyothibitishwa

Nilithibitisha kwamba working tree ni clean mwanzoni mwa Mission 003. Branch ya ndani `mission-002-audit` iko mbele ya `origin/main` kwa commits zilizofanyika ndani ya sandbox; `origin/main` bado iko kwenye `84b87bb`. Hakuna commit za Mission 002 au 003 iliyothibitishwa kuwa imefika GitHub, na hakuna push iliyofanywa katika kazi hii.

Neon ina branch ya `production` pekee katika mazingira yaliyopatikana. Kwa sababu hakuna branch salama ya majaribio iliyotolewa, hakuna migration, role, grant, table, snapshot, backup, restore, au data mutation iliyofanywa dhidi ya Neon.

## Utafiti uliothibitisha mwelekeo

Utafiti wa MISSION 003 ulilinganisha mabadiliko yaliyopendekezwa na mwongozo wa Google Gemini/structured output, OpenAI evaluation guidance, NIST AI RMF, W3C PROV, pgvector/PostgreSQL, Neon/PostgreSQL migrations and backup guidance, pamoja na AWS retry/idempotency guidance.

Mwelekeo uliothibitishwa ni huu: candidate knowledge itenganishwe na approved knowledge; model output ipitie schema na semantic validation; kila provider attempt ibebe usage, latency, model na fallback metadata; jobs ziwe na idempotency, bounded retries na deadline; migrations ziwe versioned na zifanye kazi kwa direct non-pooled connection; na embeddings zisianze kabla ya kuwa na model, dimension, provenance na labeled retrieval benchmark.

## Kilichotekelezwa na kupimwa

### 1. Background execution foundation

`AutomationEngine` sasa ina:

- `JobRunRecord` yenye `runId`, `jobId`, `idempotencyKey`, status, attempt count, max attempts na timestamps.
- Bounded retries na backoff ndogo inayoweza kusanidiwa.
- `AbortController` kwa deadline ya execution na timeout status.
- Overlap protection kwa job ileile.
- Idempotency: run iliyofanikiwa yenye key ileile hairudiwi.
- `InMemoryJobRunStore` kwa tests na `FileJobRunStore` kwa persistence ya local/restart tests.
- `stop()` inayosafisha timers na ku-abort controllers.

Hii ni foundation iliyotekelezwa na kuthibitishwa. Haijawa bado durable distributed queue ya production: job definitions, leases, worker ownership, database-backed run store, restart reconciliation na exactly-once side-effect semantics bado havijaunganishwa na Neon.

### 2. Learning loop salama zaidi

`LearningEngine` sasa inatenganisha hatua mbili:

1. `ingestLesson()` huweka lesson kama **candidate** baada ya validation ya fields na kuhakikisha expected answer ipo kwenye content.
2. `approveLesson()` pekee ndiyo huipandisha semantic memory na kutatua matching knowledge gaps.

Lesson isiyothibitisha expected answer inakataliwa. Candidate hawezi tena kutatua gap au kuingia semantic memory moja kwa moja. Hii bado si factual verification kamili: hakuna source fetcher, provenance persistence, independent grader, human approval UI, au durable evaluation run table integration katika runtime code.

### 3. Provider usage na fallback visibility

- Gemini fallback sasa hurudisha metadata ya `fallback.used`, provider ID, sababu ya fallback, na latency.
- `UsageLedger` na `ProviderAttempt` zimeongezwa kwa kurekodi provider/model/tier, token usage, usage source, price version, estimated cost, fallback na status.
- `estimateCostUsd()` inatumia price snapshot iliyo wazi; haitengenezi cost ya kubuni ikiwa usage au price haipo.

Hii ni accounting foundation na test fixture. Haijaunganishwa bado kwenye kila orchestrator task, haiingizi bei za live provider automatically, na provider tier routing/cancellation ya SDK bado haijathibitishwa live.

### 4. Database migration foundation

Imeongezwa:

- `db/migrations/001_baseline.sql` kwa baseline ya `neon_items` na `ai_memories` yenye constraints/indexes za msingi.
- `002_ai_core_state.sql` kwa `ai_job_runs`, `learning_gaps`, `candidate_lessons`, `evaluation_runs` na `evaluation_case_results`.
- `003_memory_provenance.sql` kwa scope/provenance/expiry fields za `ai_memories`.
- `scripts/migrate.ts` yenye checksum ledger, advisory lock, direct `DATABASE_URL_UNPOOLED` requirement, explicit non-production `NEON_BRANCH`, na `RUN_NEON_MIGRATIONS=true` guard.
- `npm run db:migration-check` na `npm run db:migrate` commands.

Migration files zilikaguliwa na `db:migration-check`; `db:migrate` ilikataa kuanza bila `RUN_NEON_MIGRATIONS=true`, kama ilivyotarajiwa. Migrations haziku-run dhidi ya Neon, hivyo schema compatibility, role privileges, branch identity na replay hazijathibitishwa live.

### 5. Automated verification

Imeongezwa `.github/workflows/ci.yml` inayotekeleza `npm ci`, migration check, lint, unit tests na build kwa pull requests na pushes kwenye branches zilizotajwa. Workflow haijathibitishwa na GitHub Actions kwa sababu haijapushwa.

## Matokeo halisi ya tests

Final local checks:

- `npm run db:migration-check` — **passed**, migrations `001`, `002`, `003` ziligundulika na version order ni valid.
- `npm run db:migrate` — **ilifeli kwa guard inayotarajiwa**: `Set RUN_NEON_MIGRATIONS=true to apply migrations`. Hakuna database request iliyofanywa.
- `npm test` — **15 passed, 1 skipped, 0 failed**. Skip ni Neon integration kwa sababu `DATABASE_URL` haipo.
- `npm run lint` — **passed** (`tsc --noEmit`).
- `npm run build` — **passed**. Vite ilitoa warning isiyozuia build kuhusu `__dirname` na `configLoader: native` ya baadaye.
- Scheduler tests mpya — retry/idempotency, timeout signal na file-store restart test zote zilipita.
- Provider tests mpya — usage/cost ledger na explicit Gemini fallback metadata zilipita.
- Candidate-learning tests — candidate haipromotiwi mpaka `approveLesson()` iitwe, zilipita.

## Gharama na matumizi

Hakuna live Gemini request, external model call, Neon mutation, backup, restore, branch creation, role creation, au paid operation iliyofanywa katika Mission 003. Tests zilitumia mock provider na local in-memory/file stores. Kwa hiyo hakuna gharama ya API au Neon operation inayoripotiwa kutoka kwenye kazi hii. Cost ledger imeandaliwa lakini haijapata usage ya production.

## Mapungufu na hatari zilizobaki

- **Durable jobs:** `FileJobRunStore` si replacement ya database-backed distributed queue. Inahitaji Neon adapter yenye leases/advisory locks, restart reconciliation, persistent job definitions, retry classification na idempotent side-effect boundaries.
- **Learning:** candidate validation bado ni conservative string check, si source verification wala semantic truth. Hakuna source retrieval, immutable provenance event log, grader calibration, baseline regression gate au approval actor persistence katika runtime.
- **Memory:** bado ni lexical search. Tenant/session authorization, RLS policy, expiry filtering kwenye runtime adapters, provenance round-trip, FTS, embeddings, hybrid fusion na retrieval-quality metrics hazijaunganishwa.
- **Provider:** tier routing bado haijawa route table ya stable model IDs; deadline ya Gemini request bado inatumia race na haiwezi kudai cancellation ya underlying SDK call; retries/fallback policy na per-task budget hazijaunganishwa kwenye orchestrator.
- **Migrations:** migration runner haijajaribiwa live, role separation haijatekelezwa, na runtime startup bado ina DDL ya zamani kwenye `server/db.ts` na `NeonMemoryStore.initializeSchema()`. Hii inahitaji cleanup ya deployment path kabla ya production.
- **Database operations:** hakuna Neon test branch salama, runtime least-privilege role, RLS, configured snapshot schedule, encrypted off-platform dump, restore drill, au RPO/RTO evidence.
- **GitHub:** changes ziko local tu. Hakuna claim kwamba zimefika GitHub mpaka push itakapofanywa na kuthibitishwa.

## Hatua zinazofuata kwa kipaumbele

1. Unda/idhinishe sanitized au schema-only Neon test branch; kisha run migrations na role-contract tests huko tu.
2. Ondoa runtime DDL na badilisha `server/db.ts`/`NeonMemoryStore` ziwe schema-compatibility checks pekee.
3. Unganisha `JobRunStore` na `ai_job_runs`, leases/advisory locks, restart reconciliation na safe idempotency keys.
4. Ongeza tenant/session identity contract, provenance/expiry fields kwenye `MemoryEntry`, SQL predicates/RLS tests, na adapter contract tests.
5. Unda versioned evaluation suite/cases/results na approval/promotion records; usidai factual learning mpaka regression/adversarial tests zipite.
6. Unganisha `UsageLedger` na orchestrator task records, price snapshots na explicit tier route policy.
7. Ongeza backup schedule na encrypted `pg_dump` restore drill kwenye non-production target baada ya RPO/RTO kuidhinishwa.
8. Baada ya final review, push branch au fungua pull request—lakini si moja kwa moja kwenye `main` bila approval.

## Madai ambayo hayapaswi kufanywa bado

Hadi hatua hizo zifanyike na kuthibitishwa, HINGA haipaswi kuelezwa kuwa inajifunza upya model weights, inafanya fine-tuning, inaendelea kujifunza kwa uhuru, ina exactly-once background execution, ina factual knowledge verification, ina tenant isolation production, au ina backup/restore iliyojaribiwa.
