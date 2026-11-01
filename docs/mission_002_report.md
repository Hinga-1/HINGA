# MISSION 002 — RIPOTI YA UTEKELEZAJI

**Tarehe:** 2026-11-01
**Tawi:** `freebuff/c057d894793ce959ed6cf6be`
**Hali:** Sehemu moja muhimu imejengwa na kupimwa; hakuna merge kwenye `main`.

---

## 1. TATHMINI YA MAZINGIRA NA REPOSITORY

### Kilichopo kwenye `main` (HEAD `84b87bb`)

- Moduli 8 (A–H) za Mission 001: identity, reasoning, memory (in-memory + Neon),
  orchestrator, learning, safety, automation, observability.
- CLI yenye `status | task | learn | rollback`; Express API; Vite UI.
- Majedwali mawili kwenye Neon: `ai_memories`, `neon_items`.
- Vipimo 3 vya vitatu (`src/core/core.test.ts`, `src/core/neon-memory.test.ts`,
  `server/db.test.ts`).

### Kazi inayoendelea ya Manus (`mission-003-independent-work`, commits 44 mbele)

Kufuatilia kwa `git fetch` na `git diff --name-status` kulionyesha Manus amejenga:

| Eneo | Kile kilichopo |
|---|---|
| Migrations | `db/migrations/001..004` — `ai_job_runs`, `learning_gaps`, `candidate_lessons`, `evaluation_runs`, `evaluation_case_results`, provenance ya memory |
| Providers | `model-routing.ts` (tier → model), `usage.ts` (ledger ya matumizi/bei), abort/circuit breaker |
| Automation | execution ledger, Neon job-run store, retries zilizoainishwa |
| Learning | hatua ya `candidate` → `approveLesson`, evaluation suite yenye `criterionPhrases` |
| Reasoning | uthibitisho mkali wa JSON (hakuna fallback ya `0.85`) |
| API | auth ya `HINGA_API_KEY`, mipaka ya body, majibu salama |
| Nyaraka | `docs/mission_002_audit.md`, ripoti za mission 003 |

**Hitimisho:** kurudia model routing, migrations, scheduler au validation ya reasoning
kungebomoa kazi yake. Kwa hiyo Mission 002 **imejikita kwenye pengo ambalo halijafunikwa**:
tabaka la tathmini linalotegemewa na lango la promotion, linalotumia **schema yake** bila
kuigusa.

---

## 2. KILICHOJENGWA

Faili mpya pekee (hakuna faili ya Manus iliyobadilishwa):

| Faili | Mistari | Kazi |
|---|---:|---|
| `src/core/evaluation/grader.ts` | 176 | Graders 7 za deterministic |
| `src/core/evaluation/suite.ts` | 214 | Suite runner, `summarize`, `compareToBaseline` |
| `src/core/evaluation/promotion-gate.ts` | 196 | Lango la grounding/dedup/confidence |
| `src/core/evaluation/store.ts` | 197 | Port + in-memory + Neon (haitekelezi DDL) |
| `src/core/evaluation/suites/hinga-baseline.ts` | 78 | Suite ya tabia v1.0.0 (kesi 6) |
| `src/core/evaluation/evaluation.test.ts` | 300 | Vipimo 29 |
| `scripts/eval-baseline.ts` | 62 | Kukimbia suite + lango kutoka terminal |
| `src/core/evaluation/automation.ts` | 330 | Baseline yenye uthibitisho, uamuzi wa lango, checkpoint |
| `src/core/evaluation/automation.test.ts` | 200 | Vipimo 10 vya automation |
| `scripts/eval-automation.ts` | 190 | CLI: run → lango → checkpoint (bila API/mtandao) |
| `.github/workflows/evaluation.yml` | 38 | CI ya harness (bun + `bun.lock`) |
| `docs/mission_002_research.md` | — | Utafiti wenye vyanzo |
| `docs/mission_002_architecture.md` | — | Usanifu na maelekezo |
| `docs/mission_002_automation.md` | — | Automation, exit codes, cron, artifacts |

### Uhusiano na schema ya Manus

`NeonEvaluationStore` huandika kwenye `evaluation_runs`, `evaluation_case_results`,
`learning_gaps`, `candidate_lessons` — **majedwali yaliyoainishwa kwenye migration 002**.
Adapter **haitengenezi majedwali**; `assertSchema()` hukagua na kutupa `StoreSchemaError`
ikiwa migration haijatumika. Hivyo hakuna DDL mpya, hakuna mgongano wa nambari za migration.

---

## 3. VIPIMO NA MATOKEO HALISI

### 3.1 Unit tests (zilizokimbizwa)

```
npx tsx --test src/core/evaluation/evaluation.test.ts
tests 29 | pass 29 | fail 0 | duration ~299 ms
```

Zinashughulikia: kila grader (pamoja na regex mbovu na JSON yenye fence), uhalali wa suite,
hesabu ya pass rate na weighted score, hitilafu ya provider isiyoangusha suite, lango la
regression (regression, maboresho yasiyofidisha, kesi zilizoondolewa, toleo tofauti),
recurrence ya confidence, na path zote za promotion (promote/review/reject, dedup,
grounding, kujithibitisha).

### 3.2 Typecheck

```
npx tsc --noEmit   → exit 0
```

### 3.3 Kipimo cha baseline (halisi, si dai)

```
npx tsx scripts/eval-baseline.ts
Provider: Mock Sandbox AI Provider (deterministic sandbox stub)
Pass rate: 0.0% | weighted score: 25.0%
Gate: no_baseline
exit 1
```

**Tafsiri:** suite inakataa stub ya sandbox kwa kesi 6/6. Hii ni sahihi — MockProvider
hairudishi majibu ya kimaarifa, ni stub ya kudhibiti mtihani. Kipimo hiki kinathibitisha
kwamba lango **linakataa** badala ya kukubali kwa udhaifu. Haithibitishi ubora wa modeli
halisi; hilo linahitaji `GEMINI_API_KEY` (haipo kwenye workspace hii).

### 3.4 Vipimo vya awali (regression ya jumla)

`npm test` → **22/22 pass**, pamoja na jaribio la Neon memory.

### 3.5 Automation (hatua 5 ya Mission 002)

```
npx tsx --test src/core/evaluation/evaluation.test.ts src/core/evaluation/automation.test.ts
ℹ tests 39 | pass 39 | fail 0

npx tsx scripts/eval-automation.ts --out .cache/eval
Gate: no_baseline (exit 1)   ← mock stub haipiti kesi 6/6, kama inavyotakiwa
Checkpoint: .cache/eval/checkpoint.md
```

Checkpoint halisi ilirekodi suite, provider, commit, pass rate, kesi zilizoshindwa,
sababu za lango na hatua zinazofuata. Hakuna key, connection string au maudhui ya
prompt ndani yake. Automation hii haitumii API, mtandao, wala database.

---

## 4. MIPAKA NA VITU VISIVYOTHIBITISHWA

1. **NeonEvaluationStore haijajaribiwa kwenye database halisi.** Sababu: `DATABASE_URL`
   iliyopo ni ya `production`, na Mission 002 inakataza mabadiliko ya production; connection
   string ya tawi la majaribio haiwezi kuwekwa kwenye command/faili (ni secret).
   **Suluhisho:** ongeza secret ya pili `DATABASE_URL_TEST` (tawi la Neon lisilo production),
   kisha `assertSchema()` + `saveRun()` zinaweza kupimwa kwa usalama.
2. **Hakuna wiring kwenye `AiCoreSystem`/CLI.** Kwa makusudi: `index.ts`, `cli.ts`,
   `types.ts` na `curriculum.ts` ndizo Manus anazobadilisha. Moduli iko tayari kufungwa
   baada ya merge.
3. **Hakuna LLM-judge.** Ni uamuzi wa usanifu (bias + gharama), si uhaba wa uwezo.
4. **Suite ni ndogo (kesi 6).** Utafiti unapendekeza goldens 100–500; hii ni msingi wa
   muundo, si seti kamili. Kesi zitaongezwa kutoka kwenye makosa halisi ya uzalishaji.
5. **Retrieval bado ni lexical.** Hybrid BM25+vector haijajengwa; imeainishwa kama hatua
   inayofuata.
6. **`npm test` ya sasa hukimbia jaribio la Neon memory dhidi ya `DATABASE_URL`, ambayo
   katika workspace hii ni `production`.** Jaribio hilo huunda na kufuta rekodi yake;
   baada ya kukimbia, `ai_memories` ilibaki na rekodi **3** (sawa na awali) na rekodi 0
   za majaribio zilizobaki. Hatari ni ndogo lakini si sifuri: jaribio linapaswa kuhitaji
   `RUN_NEON_INTEGRATION=true` na tawi lisilo production (kama ilivyo kwenye tawi la Manus).

---

## 5. HATUA INAYOFUATA (kwa mpangilio)

1. **Funga moduli** kwenye `AiCoreSystem` baada ya merge ya Manus: `evaluation` kama
   subsystem, na `ai:eval` kwenye CLI.
2. **Ongeza `DATABASE_URL_TEST`** na uimarishe `NeonEvaluationStore` kwa jaribio halisi la
   `saveRun`/`latestSummary` kwenye tawi la Neon lisilo production, kisha futa tawi.
3. **Panua suite hadi kesi 30–50** kutoka kwenye makosa halisi (safety, honesty, memory
   provenance), kisha 100+.
4. **Weka lango kwenye CI**: `eval-baseline.ts` + baseline JSON iliyohifadhiwa; kushuka
   kokote kuzuie merge.
5. **Hybrid retrieval**: BM25 (lexical) + embeddings + RRF; pima kwa recall@k **peke yake**
   kabla ya kuhusisha generation.
6. **Abstention ya kweli**: hatua ya `a(x)` (retrieval score floor) na `c(x)` (confidence)
   ziwe sehemu ya `ReasoningEngine`, na gap iliyorekodiwa iwe ndiyo kiini cha mzunguko wa
   kujifunza.

---

## 6. HALI YA KAZI (RESUME STATE)

```yaml
mission: 002
branch: freebuff/c057d894793ce959ed6cf6be
head_before: 84b87bb
built:
  - src/core/evaluation/{grader,suite,promotion-gate,store,index}.ts
  - src/core/evaluation/suites/hinga-baseline.ts
  - src/core/evaluation/evaluation.test.ts
  - scripts/eval-baseline.ts
  - docs/mission_002_{research,architecture,report}.md
checks:
  - command: npx tsc --noEmit
    result: pass
  - command: npx tsx --test src/core/evaluation/evaluation.test.ts src/core/evaluation/automation.test.ts
    result: 39/39 pass
  - command: npm test
    result: 22/22 pass
  - command: npx tsx scripts/eval-automation.ts
    result: mock run, gate no_baseline, exit 1 (expected), checkpoint written
not_done:
  - Neon live store test (needs DATABASE_URL_TEST on non-production branch)
  - wiring into AiCoreSystem / CLI (deferred to avoid Manus conflict)
  - hybrid retrieval, abstention integration, CI gate
next_command: npx tsx --test src/core/evaluation/evaluation.test.ts
```
