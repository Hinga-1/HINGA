# MISSION 003 — Mfumo wa Kujifunza na Kufanya Kazi kwa Kujitegemea

**Tarehe:** 2026-10-30
**Repository:** `Hinga-1/HINGA`
**Branch ya ndani:** `mission-003-independent-work`
**Neon:** project `falling-moon-75342440`, test branch `mission-003-test-20261030` (`br-twilight-paper-b9hyxb1y`), production branch `br-shy-voice-b958sxiw`

## Hali ya Git/GitHub iliyothibitishwa

Nilithibitisha kwamba working tree ni clean mwanzoni mwa Mission 003. Branch ya ndani `mission-003-independent-work` iko mbele ya `origin/main` kwa commits 9; `origin/main` bado iko kwenye `84b87bb`. Hadi ripoti hii kuandikwa, commits hizo hazikuwa bado zimepushwa GitHub.

Neon test branch iliundwa kutoka production kwa kazi hii; production haikubadilishwa. Hakuna role/grant, snapshot, backup au restore iliyofanywa.

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
- `reconcileInterruptedRuns()` sasa inasoma runs zilizoachwa `running` baada ya worker restart na kuziandika kama `failed` kwa kosa la wazi `worker_restarted`; haifanyi side effect retry moja kwa moja.

Hii ni foundation iliyotekelezwa na kuthibitishwa. Haijawa bado durable distributed queue ya production: job definitions, leases, worker ownership, database-backed run store, restart reconciliation na exactly-once side-effect semantics bado havijaunganishwa na Neon.

Baada ya test branch kuundwa, `NeonJobRunStore` imeongezwa na kujaribiwa dhidi ya `ai_job_runs`. Ina-save, inatafuta kwa idempotency key, na inasoma running records bila kuunda schema runtime.

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
- `server/db.ts` na `NeonMemoryStore` sasa zina-verify schema iliyomigrated; hazifanyi tena `CREATE TABLE`/`CREATE INDEX` wakati wa startup.

Migration files zilikaguliwa na `db:migration-check`; `db:migrate` ilikataa kuanza bila `RUN_NEON_MIGRATIONS=true`, kama ilivyotarajiwa. Baada ya test branch kuidhinishwa, migrations zote 001–003 zili-run humo, na migration runner ilirudiwa mara ya pili bila checksum drift au duplicate apply.

### 5. Automated verification

Imeongezwa `.github/workflows/ci.yml` inayotekeleza `npm ci`, migration check, lint, unit tests na build kwa pull requests na pushes kwenye branches zilizotajwa. Workflow yenyewe bado haijathibitishwa na GitHub Actions kwa sababu branch haikuwa imepushwa wakati wa kuandika ripoti hii.

## Matokeo halisi ya tests

Final local checks:

- `npm run db:migration-check` — **passed**, migrations `001`, `002`, `003` ziligundulika na version order ni valid.
- `npm run db:migrate` — **ilifeli kwa guard inayotarajiwa**: `Set RUN_NEON_MIGRATIONS=true to apply migrations`. Hakuna database request iliyofanywa.
- `npm test` bila database — **15 passed, 2 skipped, 0 failed**. Skips ni Neon memory na Neon JobRunStore integration kwa sababu `DATABASE_URL` haipo.
- `npm test` ikiwa imeelekezwa kwenye test branch — **22 passed, 0 skipped, 0 failed**; hii ilijumuisha Neon memory persistence na Neon JobRunStore tests.
- `npm run test:integration` kwenye test branch — **7 passed, 0 skipped, 0 failed**; schema initialization, branch identity, CRUD insert/retrieve/delete zote zilipita.
- `npm run lint` — **passed** (`tsc --noEmit`).
- `npm run build` — **passed**. Vite ilitoa warning isiyozuia build kuhusu `__dirname` na `configLoader: native` ya baadaye.
- Scheduler tests mpya — retry/idempotency, timeout signal na file-store restart test zote zilipita.
- Provider tests mpya — usage/cost ledger na explicit Gemini fallback metadata zilipita.
- Candidate-learning tests — candidate haipromotiwi mpaka `approveLesson()` iitwe, zilipita.

## Neon test-branch validation

- Test branch `mission-003-test-20261030` iliundwa kutoka production, ikiwa na compute ndogo ya majaribio.
- Migration ledger ilithibitisha versions `001`, `002`, `003` na checksums.
- Tables za `ai_job_runs`, `learning_gaps`, `candidate_lessons`, `evaluation_runs`, `evaluation_case_results` na `schema_migrations` zilithibitishwa kuwepo.
- Columns za `tenant_id`, `session_id`, `source_uri`, `source_hash`, `source_captured_at`, `expires_at` na `verification_status` zilithibitishwa kwenye `ai_memories` ya test branch.
- `NeonJobRunStore` iliandika na kusoma execution record moja kwenye test branch, kisha ikaifuta baada ya test.
- Production read-only verification ilionyesha `schema_migrations` haipo na counts bado ni `ai_memories=3`, `neon_items=4`.
- Test branch baada ya CRUD cleanup ilikuwa na `migration_count=3`, `job_runs_count=0`, `neon_items_count=4`.

## Gharama na matumizi

Hakuna live Gemini request, external model call, role creation, grant, backup au restore iliyofanywa. Neon test branch iliundwa na migrations/CRUD tests ziliendeshwa humo kwa idhini; production haikubadilishwa. Cost ledger imeandaliwa lakini haijapata usage ya production.

## Mapungufu na hatari zilizobaki

- **Durable jobs:** Neon-backed run records sasa zipo, lakini `AutomationEngine` bado haijaunganishwa default kwa Neon store, na bado inahitaji leases/advisory locks, restart reconciliation, persistent job definitions, retry classification na idempotent side-effect boundaries.
- **Learning:** candidate validation bado ni conservative string check, si source verification wala semantic truth. Hakuna source retrieval, immutable provenance event log, grader calibration, baseline regression gate au approval actor persistence katika runtime.
- **Memory:** bado ni lexical search. Tenant/session authorization, RLS policy, expiry filtering kwenye runtime adapters, provenance round-trip, FTS, embeddings, hybrid fusion na retrieval-quality metrics hazijaunganishwa.
- **Provider:** tier routing bado haijawa route table ya stable model IDs; deadline ya Gemini request bado inatumia race na haiwezi kudai cancellation ya underlying SDK call; retries/fallback policy na per-task budget hazijaunganishwa kwenye orchestrator.
- **Migrations:** migration runner imejaribiwa live kwenye test branch na runtime DDL imeondolewa kwenye startup. Role separation bado haijatekelezwa, na deployment process bado inahitaji migration job tofauti kabla ya production.
- **Database operations:** hakuna runtime least-privilege role, RLS, configured snapshot schedule, encrypted off-platform dump, restore drill, au RPO/RTO evidence.
- **GitHub:** PR #1 iko wazi, branch `mission-003-independent-work` iko clean kabla ya mabadiliko, na CI ya remote ilikuwa green kabla ya checkpoint hii. Push na remote verification ya checkpoint hii bado zinangoja.

### Kizuizi cha usalama cha execution hii

Hatua ya kwanza iliyoorodheshwa—runtime/migration roles na RLS—haikufanywa kwa sababu playbook inakataza roles, grants na RLS bila idhini ya wazi ya mtumiaji. Hakuna SQL ya production, DDL, role, grant au RLS iliyotekelezwa katika execution hii.

## Hatua zinazofuata kwa kipaumbele

1. Tengeneza runtime/migration roles na RLS contract kwenye test branch; usitumie owner credentials kwenye web runtime.
2. Ondoa runtime DDL na badilisha `server/db.ts`/`NeonMemoryStore` ziwe schema-compatibility checks pekee.
3. Unganisha `JobRunStore` na `ai_job_runs`, leases/advisory locks, persistent job definitions, retry classification na safe idempotency keys; restart reconciliation ya msingi imeongezwa lakini bado inahitaji worker lifecycle integration.
4. Ongeza tenant/session identity contract, provenance/expiry fields kwenye `MemoryEntry`, SQL predicates/RLS tests, na adapter contract tests.
5. Unda versioned evaluation suite/cases/results na approval/promotion records; usidai factual learning mpaka regression/adversarial tests zipite.
6. Unganisha `UsageLedger` na orchestrator task records, price snapshots na explicit tier route policy.
7. Ongeza backup schedule na encrypted `pg_dump` restore drill kwenye non-production target baada ya RPO/RTO kuidhinishwa.
8. Push branch na fungua pull request—lakini si moja kwa moja kwenye `main` bila approval.

## Madai ambayo hayapaswi kufanywa bado

Hadi hatua hizo zifanyike na kuthibitishwa, HINGA haipaswi kuelezwa kuwa inajifunza upya model weights, inafanya fine-tuning, inaendelea kujifunza kwa uhuru, ina exactly-once background execution, ina factual knowledge verification, ina tenant isolation production, au ina backup/restore iliyojaribiwa.

## Uthibitisho wa execution ya 2026-10-30

- `npm test` — **16 passed, 2 skipped, 0 failed**; skips zilikuwa integrations kwa sababu `DATABASE_URL` haikuwekwa.
- `npm run lint` — **passed** (`tsc --noEmit`).
- `npm run build` — **passed**; warning ya Vite kuhusu `configLoader: native`/`__dirname` haikuzuia build.
- `npm run db:migration-check` — **passed**, migrations `001`, `002`, `003` valid.
- `npm run test:integration` — **2 skipped, 0 failed** kwa sababu `DATABASE_URL` na `RUN_NEON_INTEGRATION` hazikuwekwa; hakuna connection attempt iliyofanywa.
- Neon test branch read-only check — **passed**: `schema_migrations=3`, `ai_job_runs=0`, na `public.ai_job_runs` ipo kwenye `br-twilight-paper-b9hyxb1y`; production branch haikuguswa.
- Mabadiliko ya checkpoint — `AutomationEngine.reconcileInterruptedRuns()` na unit test yake; runs zilizoachwa `running` hubadilishwa kuwa `failed` kwa `worker_restarted`, bila retry ya side effect.

## Uthibitisho wa checkpoint ya autonomous worker

Katika execution hii nilithibitisha PR #1 iko wazi, `mission-003-independent-work` iko kwenye remote, working tree ilikuwa clean kabla ya mabadiliko, na CI ya mwisho iliyopo GitHub ilikuwa green. Production branch `br-shy-voice-b958sxiw` haikuguswa.

Mabadiliko madogo yaliyotekelezwa ni kuunganisha `NeonJobRunStore` kwenye `AiCoreSystem` wakati tu `NeonMemoryStore` imefanikiwa ku-initialize. Hii inafanya automation engine itumie `ai_job_runs` iliyomigrated badala ya kurudi kwenye in-memory store katika runtime yenye Neon; fallback ya in-memory inabaki pale Neon haipatikani. Hakuna schema change, runtime DDL, migration apply, role, grant, RLS, fine-tuning au live model call iliyofanywa.

Matokeo ya commands ya checkpoint:

- `npm ci` — **passed**; dependencies ziliwekwa kutoka lockfile.
- `npm test` bila database — **16 passed, 2 skipped, 0 failed**.
- `npm test` ikiwa imeelekezwa kwenye test branch — **23 passed, 0 skipped, 0 failed**; NeonJobRunStore na Neon memory integration zilipita.
- `npm run test:integration` kwenye `mission-003-test-20261030` — **7 passed, 0 skipped, 0 failed**; schema check, branch identity na CRUD cleanup zilipita.
- `npm run lint` — **passed** (`tsc --noEmit`).
- `npm run build` — **passed**; warning ya Vite kuhusu `configLoader: native`/`__dirname` haikuzuia build.
- `npm run db:migration-check` — **passed**, migrations `001`, `002`, `003` valid.

Hatua hii bado si uthibitisho wa durable distributed execution: leases/advisory locks za worker, persistent job definitions, retry classification, tenant/session isolation, na exactly-once side-effect boundaries bado ni kazi zilizobaki. Roles/RLS bado ni blocker ya policy na hazitafanywa bila idhini ya wazi.

## Uthibitisho wa execution ya 2026-10-30 — retry classification

Katika execution hii nilikagua PR #1: iko wazi, `MERGEABLE`, na GitHub CI `verify` ya mwisho ilirudi `SUCCESS`. Branch ya kazi ilikuwa `mission-003-independent-work` na working tree ilikuwa clean kabla ya mabadiliko. Neon test branch `mission-003-test-20261030` (`br-twilight-paper-b9hyxb1y`) ilikuwa `ready`; production branch `br-shy-voice-b958sxiw` haikuguswa.

Mabadiliko madogo yaliyotekelezwa ni kuongeza `retryOnError` classifier kwa kila `ScheduledJob`. Tabia ya zamani imehifadhiwa kwa default (errors zote zinarudiwa), lakini job inaweza sasa kutenganisha transient errors na permanent errors na kusimamisha retries kwa kosa lisiloweza kurekebishwa. Regression test inathibitisha `invalid_request` inajaribiwa mara moja tu, inaishia `failed`, na haifanyi side-effect retry.

Matokeo halisi ya verification:

- `npm ci` — **passed** kutoka lockfile; npm iliripoti vulnerability moja ya kiwango cha chini kwenye dependency tree, bila kubadilisha lockfile.
- `npm test` — **17 passed, 2 skipped, 0 failed**. Skips zilikuwa Neon integrations kwa sababu credentials za `DATABASE_URL` hazikuwekwa kwenye shell hii.
- `npm run lint` — **passed** (`tsc --noEmit`).
- `npm run build` — **passed**; warning ya Vite kuhusu `configLoader: native`/`__dirname` haikuizuia build.
- `npm run db:migration-check` — **passed**, migrations `001`, `002`, `003` valid.
- Neon test-branch read-only integration check kupitia connector — **passed**: `database_name=neondb`, `migration_count=3`, `job_runs_count=0`; tables za `ai_job_runs`, `schema_migrations` na tables nyingine za migration zilikuwepo. Hakuna SQL ya production, DDL, role, grant, RLS, fine-tuning au live model call iliyofanywa.

Hatua hii haijatatua blocker ya roles/RLS kwa sababu playbook inakataza roles, grants na RLS bila idhini ya wazi. Pia leases/advisory locks, persistent job definitions, tenant/session isolation na exactly-once side-effect boundaries bado ni hatari zilizo wazi; retry classifier hii ni guard ya policy pekee, si uthibitisho wa distributed exactly-once execution.
