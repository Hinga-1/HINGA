# MISSION 002 — USANIFU: TABAKA LA TATHMINI NA LANGO LA UTHIBITISHO

**Toleo:** 1.0.0
**Hali:** Imetekelezwa (`src/core/evaluation/`) na kupimwa.
**Kanuni ya msingi:** Ongeza tabaka jipya **bila kubadilisha** kazi inayoendelea ya Manus.

---

## 1. TATIZO

Mfumo wa sasa (Mission 001) unaweza kuzalisha jibu, lakini hauna njia ya kuamua kwa
uhakika kama jibu ni **bora kuliko la jana**. Kila mabadiliko ya prompt, memory au modeli
yanapimwa kwa hisia. Utafiti (Huang et al. 2024; Kamoi et al. 2024) unaonyesha kuwa
kuacha modeli ijitathmini ni hatari: inaweza kuharibu jibu sahihi.

Kwa hiyo tabaka hili lina jukumu moja: **kufanya maamuzi ya kuboresha yapimwe, na
kuzuia mabadiliko yanayoshusha ubora.**

---

## 2. VIPENGELE

```text
src/core/evaluation/
├── grader.ts           Graders za deterministic (hakuna LLM, hakuna mtandao)
├── suite.ts            Suite runner + compareToBaseline (lang0 la regression)
├── promotion-gate.ts   Lango la kuingiza somo kwenye memory ya kudumu
├── store.ts            Port + InMemoryEvaluationStore + NeonEvaluationStore
├── suites/
│   └── hinga-baseline.ts   Suite ya tabia v1.0.0 (kesi 6)
└── evaluation.test.ts  Vipimo 29 (unit, hakuna DB)
```

### 2.1 Graders (`grader.ts`)

Aina saba: `contains_all`, `contains_none`, `regex`, `min_words`, `max_words`,
`json_keys`, `equals`. Kila grader hurudisha `{passed, detail}`; kesi hupita pale **zote**
zinapopita. Grader mbovu (regex isiyo sahihi, orodha tupu) hutupa `EvaluationConfigError`
badala ya kupita kimya.

**Kwa nini deterministic:** grader haiwezi "kushawishiwa" na modeli inayopimwa, inagharimu
0 tokens, na inatoa jibu lile lile kwenye CI kila mara.

### 2.2 Suite na lango (`suite.ts`)

```
cases[] --generate(prompt)--> output --graders--> CaseRun
                                                   |
                                             SuiteRun (passRate, weightedScore)
                                                   |
                                    compareToBaseline(current, baseline)
                                                   |
                          pass | regression | no_baseline | incomparable
```

- `runSuite` hukimbia kesi **mfululizo**, hurudisha `durationMs` kwa kila kesi, na
  hitilafu ya provider inakuwa kesi iliyoshindwa — suite haianguki yote.
- `compareToBaseline` hulaza kesi zote: **kesi iliyopita na sasa inashindwa = regression**.
  Maboresho hayafidishi kushuka. Toleo tofauti la suite halinganishwi (`incomparable`).

### 2.3 Lango la promotion (`promotion-gate.ts`)

Mpangilio wa maamuzi, kwa mpangilio huu:

1. **Uadilifu wa schema** — sehemu zote muhimu zipo, hakuna tupu.
2. **Kujithibitisha** — `expectedAnswer` lazima ipatikane ndani ya somo lenyewe.
3. **Grounding** — maneno ≥ 2 yenye maana yanayolingana na `sourceContext`.
4. **Dedup** — Jaccard ≥ 0.90 → `reject` (nakala); ≥ 0.75 → `needs_review`.
5. **Confidence** — `c₀ = 0.5`, corroboration `1-(1-c)·0.3`, contradiction `c·0.7`;
   `promote` ni `c ≥ 0.85`.

Matokeo: `promote | needs_review | reject`, pamoja na sababu zinazosomeka na maneno
yaliyotumika ku-ground. **Hakuna njia ya modeli kupita lango kwa hoja.**

### 2.4 Hifadhi (`store.ts`)

Port moja, adapters mbili:

| Utekelezaji | Matumizi |
|---|---|
| `InMemoryEvaluationStore` | Vipimo vya unit, kukimbia kwa haraka, sandbox |
| `NeonEvaluationStore` | Uzalishaji; **haitengenezi majedwali** |

`NeonEvaluationStore.assertSchema()` hukagua `information_schema` na kutupa
`StoreSchemaError` ikiwa migration haijatumika. Hii ni kwa makusudi: schema ni ya
**migration 002 ya Manus** (`evaluation_runs`, `evaluation_case_results`, `learning_gaps`,
`candidate_lessons`), hivyo hakuna DDL mpya na hakuna mgongano wa uhamishaji.

---

## 3. MTIRIRIKO WA DATA

```text
        ┌──────────────────────┐
        │  Prompt / kazi       │
        └──────────┬───────────┘
                   ▼
        ┌──────────────────────┐        ┌─────────────────────┐
        │  Modeli (provider)   │───────▶│  Jibu la awali      │
        └──────────────────────┘        └──────────┬──────────┘
                                                   ▼
                                    ┌──────────────────────────┐
                                    │  Graders (deterministic) │
                                    └──────────┬───────────────┘
                             amepita ◀─────────┴─────────▶ ameshindwa
                                 │                            │
                                 │                  ┌─────────▼─────────┐
                                 │                  │ Rekodi pengo      │
                                 │                  │ (knowledge gap)   │
                                 │                  └─────────┬─────────┘
                                 │                            ▼
                                 │                  ┌───────────────────┐
                                 │                  │ Somo la mgombea   │
                                 │                  └─────────┬─────────┘
                                 ▼                            ▼
                       ┌──────────────────┐        ┌──────────────────────┐
                       │ Jibu limekubaliwa│        │ Promotion gate       │
                       └──────────────────┘        │ (grounding+dedup+c)  │
                                                   └──────────┬───────────┘
                                     promote ◀────────────────┼──────────▶ reject / needs_review
                                         │
                                         ▼
                              ┌────────────────────────┐
                              │ Semantic memory +      │
                              │ evaluation_runs (Neon) │
                              └────────────────────────┘
```

---

## 4. MAELEKEZO YA UJUMLA (INTERFACES)

```ts
// Hatua 1: pima
const run = await runSuite(HINGA_BASELINE_SUITE, generate);

// Hatua 2: linganisha na baseline iliyokubaliwa
const report = compareToBaseline(summarize(run), baseline);
if (report.verdict === 'regression') return; // usibadilishe chochote

// Hatua 3: hifadhi ushahidi
await store.saveRun(run, { providerId, modelId, codeCommit });

// Hatua 4: ingiza somo lililothibitishwa tu
const decision = evaluatePromotion(candidate, { existing: promotedFacts });
if (decision.verdict === 'promote') await store.saveCandidate(lesson, decision);
```

---

## 5. MAAMUZI YA USANIFU NA SABABU

| Uamuzi | Sababu | Ushahidi |
|---|---|---|
| Graders za deterministic, si LLM-judge | Modeli haiwezi kujitathmini kwa kuaminika; judge ina bias | Huang 2024; Zheng 2023 |
| Hakuna `tolerance` kwenye lango | Kesi iliyoshuka ni ishara, si kelele | Kamoi 2024 |
| `needs_review` ndio default ya kutokuwa na uhakika | Promotion ya kimya hueneza makosa | Atlas 2026 |
| Grounding ya maneno, si embeddings (bado) | Rahisi, inaonekana, haihitaji modeli | Atlas 2026 |
| Hakuna DDL kwenye adapter | Heshima kwa migrations za Manus | Mission 002 masharti |
| Faili mpya pekee | Kuzuia migongano na kazi inayoendelea | Mission 002 masharti |

---

## 6. YASIYOKUWA NDANI YA AWAMU HII (NON-GOALS)

- Hakuna embeddings/pgvector; retrieval bado ni lexical (`ILIKE`).
- Hakuna wiring kwenye `AiCoreSystem`/CLI; moduli iko tayari lakini haijafungwa
  (kuacha `index.ts`, `cli.ts` na `types.ts` kwa Manus).
- Hakuna jaribio la Neon halisi kwenye awamu hii (tazama ripoti, kizuizi cha secret).
- Hakuna LLM-judge, hakuna fine-tuning, hakuna mabadiliko ya model weights.
