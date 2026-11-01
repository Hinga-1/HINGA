# MISSION 002 — UTAFITI: MSINGI WA AKILI INAYOJIFUNZA

**Tarehe:** 2026-11-01
**Hali:** Utafiti umekamilika; kila dai lina chanzo kinachosomeka.
**Lengo:** Kuchagua mbinu zenye ushahidi kwa ajili ya HINGA, si kuiga mfumo mmoja.

> Kanuni iliyotumika: **ushahidi kabla ya madai**. Pale tafiti zinapingana, nimeandika
> mgongano badala ya kuchagua upande kwa utashi. Nambari zote hapa zimetolewa kutoka
> kwenye karatasi/ukurasa uliosomwa; chochote ambacho hakikuweza kuthibitishwa kimesimama
> wazi kama "hakijathibitishwa".

---

## 1. REASONING, REFLECTION NA SELF-CORRECTION

### Kilichopatikana

| Kazi | Mchango | Matokeo muhimu |
|---|---|---|
| **Self-Refine** (Madaan et al., NeurIPS 2023, [arXiv:2303.17651](https://arxiv.org/abs/2303.17651)) | Model moja huzalisha, hukosoa na kuboresha | Ongezeko la wastani ~20% kamili kwenye kazi 7 — lakini ni wastani wa metrik tofauti, na sehemu ya tathmini inafanywa na modeli ya aina moja |
| **Reflexion** (Shinn et al., NeurIPS 2023, [arXiv:2303.11366](https://arxiv.org/abs/2303.11366)) | "Verbal reinforcement": tafakari huhifadhiwa kwenye episodic memory | 91% pass@1 HumanEval vs 80% ya GPT-4 — **lakini** mafanikio hutegemea reward ya nje (unit tests / mazingira) |
| **Chain-of-Verification (CoVe)** (Dhuliawala et al., Findings ACL 2024, [arXiv:2309.11495](https://arxiv.org/abs/2309.11495)) | Rasimu → maswali ya uthibitisho → majibu **bila kuona rasimu** → jibu lililothibitishwa | Precision ya orodha 0.17 → 0.36; hallucinated entities 2.95 → 0.68 kwa jibu; FactScore 55.9 → 71.4 |

### Upande wa kinyume — muhimu zaidi kwa usanifu wetu

- **Huang et al., "Large Language Models Cannot Self-Correct Reasoning Yet"** (ICLR 2024,
  [arXiv:2310.01798](https://arxiv.org/abs/2310.01798)): bila jibu la oracle, kujikosoa
  kwa modeli hupunguza usahihi. Mfano halisi: GPT-4 GSM8K **95.5 → 91.5 → 89.0** katika
  raundi mbili; GPT-3.5 CSQA **75.8 → 38.1**; Llama-2-70B GSM8K **62.0 → 43.5 → 36.5**.
  Sababu: modeli haiwezi kuamua kwa uhakika kama hoja yake ni sahihi; mara nyingi huharibu
  jibu sahihi kuliko kurekebisha jibu lisilo sahihi.
- **Kamoi et al., "When Can LLMs Actually Correct Their Own Mistakes?"** (TACL 2024,
  [arXiv:2406.01297](https://arxiv.org/abs/2406.01297)): hakuna kazi iliyoonyesha
  self-correction yenye mafanikio kwa feedback ya modeli yenyewe kwenye kazi za jumla;
  inafanya kazi pale **feedback ya nje ya kuaminika** ipo.
- **Self-Correction Bench** (Tsui, 2025, [arXiv:2507.02778](https://arxiv.org/abs/2507.02778)):
  wastani wa **64.5% blind spot** kwenye modeli 14 — modeli hurekebisha kosa la mtu mwingine
  lakini si kosa lile lile lililo ndani ya matokeo yake.

### Uamuzi wa HINGA

1. **Kujikosoa hakutegemei "unga" la modeli.** Lango letu la mabadiliko ni **graders za
   deterministic** (regex, contains, JSON keys, urefu) zinazoweza kuhesabiwa kutoka kwenye
   matokeo pekee. Hakuna LLM-judge kwenye njia ya promotion.
2. **Marekebisho yanaruhusiwa tu pale grader ya nje inashindwa**, na kila raundi mpya
   inapaswa kupita lango; kama haipiti, toleo la awali linabaki. Hii inaepuka upunguzaji
   ulioandikwa na Huang et al.
3. **Uthibitisho unafanywa "blind"**: hatutauliza "je, jibu lako ni sahihi?" — tutaweka
   maswali huru ya uthibitisho na kupima msimamo wa majibu yao (CoVe factored).

---

## 2. TATHMINI (LLM-as-a-judge) — NA KWA NINI HATUITUMII KWENYE LANG0

- **MT-Bench / Chatbot Arena** (Zheng et al., NeurIPS 2023, [arXiv:2306.05685](https://arxiv.org/abs/2306.05685)):
  GPT-4 judge ilifikia makubaliano **>80%** na wataalamu — sawa na makubaliano kati ya
  wanadamu wawili. Lakini: **position bias** (consistency 23.8% Claude-v1, 46.2% GPT-3.5,
  65.0% GPT-4), **verbosity bias** (GPT-4 8.7% vs Claude/GPT-3.5 91.3% kwenye "repetitive
  list" attack), na kushindwa kwa hesabu 14/20 → **3/20** kwa reference-guided grading.
- **Self-preference / family bias**: Wataoka et al. 2024 ([arXiv:2410.21819](https://arxiv.org/html/2410.21819v1));
  Spiliopoulou et al. (AWS, 2025, [arXiv:2508.06709](https://arxiv.org/html/2508.06709v1))
  kwa jozi >5,000 na majaji 9 — GPT-4o na Claude 3.5 Sonnet hupenda matokeo yao wenyewe.
- **Kipimo cha makubaliano** (Rao & Callison-Burch, 2026, [arXiv:2606.00093](https://arxiv.org/html/2606.00093v2)):
  uchaguzi wa protokoli pekee unaweza kubadilisha usahihi ulioripotiwa kutoka **0.551 hadi 0.899**
  bila kubadilisha hukumu hata moja.

**Uamuzi:** LLM-judge inaweza kutumika baadaye kwa ukaguzi wa hiari, lakini **haiwezi**
kuwa lango la kiotomatiki la promotion. Kila ripoti ya judge itatakiwa kutaja protokoli
(tie rule, abstention rule, scale) na kupimwa dhidi ya seti ya dhahabu iliyoandikwa na mtu.

---

## 3. MEMORY NA MAARIFA

- **MemGPT / Letta** ([arXiv:2310.08560](https://arxiv.org/abs/2310.08560);
  [letta.com/blog/agent-memory](https://www.letta.com/blog/agent-memory)): viwango vya
  buffer → core → recall → archival; **eviction ~70%** (si kufuta 100%), na **recursive
  summarization huharibu** kwa sababu muhtasari mpya hujumuisha wa zamani.
- **Zep / Graphiti** ([arXiv:2501.13956](https://arxiv.org/html/2501.13956v1)): episodic →
  semantic entity → community; **bi-temporal** (t_valid/t_invalid, t_created/t_expired);
  retrieval = BM25 + cosine + graph + reranker. LongMemEval: **71.2%** na **1.6k tokens**
  dhidi ya 60.2% na 115k ya full-context; lakini **hupungua** kwenye `single-session-assistant`
  (94.6% → 80.4%). Hitimisho: hifadhi buffer ya mazungumzo ya hivi karibuni **sambamba** na graph.
- **Mem0** ([arXiv:2504.19413](https://arxiv.org/html/2504.19413v1)): extraction + operesheni
  nne tu **ADD / UPDATE / DELETE / NOOP**; graph variant huhifadhi uhusiano na kuweka
  alama ya "invalid" badala ya kufuta.
- **MemoryAgentBench** ([arXiv:2507.05257](https://arxiv.org/html/2507.05257v2)): uwezo
  vinne — retrieval sahihi, test-time learning, long-range understanding, **selective
  forgetting**; hakuna mfumo unaokamilisha vyote.
- **Retrieval**: BM25 ilishinda dense embeddings kwenye corpus ya fedha (nDCG@10 **0.515 vs
  0.466**); **hybrid + cross-encoder rerank** ilitoa R@5 **0.816** na MRR@3 **0.605**
  ([arXiv:2604.01733](https://arxiv.org/html/2604.01733v1)). "Lost in the Middle"
  ([arXiv:2307.03172](https://arxiv.org/abs/2307.03172)): taarifa katikati ya context hupotea.

**Uamuzi:** hatuhami kwenye graph database. Tutaanza na Postgres: `episodes` (ghafi,
haiyabadilishwi) + `memories` (fact/preference/procedure, confidence, provenance,
valid_from/valid_until) na **RRF fusion** ya lexical + vector baadaye. Saraka ya sasa
(`ai_memories`) inatosha kwa awamu hii; tulichojenga ni **lango** la kile kinachoingia humo.

---

## 4. MAPUNGUFU YA MAARIFA NA KUJIFUNZA KWA USHAHIDI

- **Abstention survey** ([arXiv:2407.18418](https://arxiv.org/html/2407.18418v3)): kukataa
  ni muunganiko wa `a(x)` (jibu linapatikana?), `c(x)` (uhakika wa modeli), `h(x)` (maadili).
- **Kadavath et al.** ([arXiv:2207.05221](https://arxiv.org/abs/2207.05221)): `P(True)` na
  `P(IK)` zinaweza kuwa calibrated; `P(IK)` huongezeka pale nyenzo husika zipo — hivyo
  kutofautisha "sijui" na "sijui kwa sababu memory haikupata".
- **Atlas / Compiled Memory** (2026, [arXiv:2603.15666](https://arxiv.org/html/2603.15666v1)):
  lango la hatua tatu — **dedup** (cosine ≥ 0.92), **uthibitisho** wa LLM (accept/reject/
  merge/needs_review; kosa → needs_review, **kamwe** promotion ya kimya), **grounding**
  (maneno ≥ 2 yanayolingana na chanzo). Confidence: c₀ = 0.5; corroboration
  `c ← 1-(1-c)·0.3`; contradiction `c ← c·0.7`; promoting ni `c ≥ 0.85`. Matokeo: CUAD
  token F1 61.9% → 70.5%. Muhimu zaidi: **facts 4 safi (+6.7pp) zilishinda facts 20 zenye
  kelele (+1.0pp)**.

**Uamuzi:** lango letu la promotion linatekeleza kanuni hizi kwa hesabu safi, bila modeli:
grounding ya maneno, dedup ya Jaccard, na recurrence ya confidence. Kila kitu kinachokosa
kiwango kinaenda `needs_review`, si `promote`.

---

## 5. TATHMINI NA MAREKEBISHO YENYE USALAMA

- **Eval-Driven Development** ([deepeval.com/blog/eval-driven-development](https://deepeval.com/blog/eval-driven-development)):
  goldens **100–500**; regression suite hukimbizwa kila mabadiliko ya prompt, modeli au
  usanifu; retrieval hupimwa **peke yake** na generation.
- **Seven Failure Points** (Barnett et al., CAIN 2024, [arXiv:2401.05856](https://arxiv.org/html/2401.05856v1)):
  "validation is only feasible during operation"; robustness **hukua**, haijengwi mara moja.

**Uamuzi:** suite yetu ni ya **tabia** (safety, honesty, architecture, memory), ina
`minPassRate = 1`, na lango hukataa **kesi yoyote** iliyoshuka — maboresho hayafidishi
kushuka. Ndio maana `compareToBaseline` haina `tolerance`.

---

## 6. MIPAKA YA UTAFITI HUU

1. Nambari za CoVe (0.17 → 0.36; 2.95 → 0.68) zilithibitishwa kupitia muhtasari wa alphaXiv
   na ACL snippet; jedwali kamili la karatasi halikusomeka kikamilifu.
2. Majaribio ya Zep vs Mem0 kwenye LoCoMo yanapingana; situmii nambari za upande wowote
   kama hoja ya usanifu.
3. Atlas ni preprint ya 2026 (n=6 runs); nimechukua **muundo wa lango**, si ukubwa wa effect.
4. Hakuna karatasi iliyotoa kiwango cha abstention kilichothibitishwa kwa mawakala wetu;
   kiwango chochote ni lazima kipimwe kwenye data zetu wenyewe.
