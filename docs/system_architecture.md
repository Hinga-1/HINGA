# USANIFU WA MFUMO WA NDANI WA AI (MISSION 001)

**Mwandishi**: Mhandisi Mkuu wa Usanifu wa Mifumo ya AI (Principal AI Systems Architect)  
**Toleo**: 1.0.0-foundation  
**Hali**: Rasmi (Approved for Implementation)  

---

## 1. RAMANI KUU YA MFUMO (SYSTEM BLUEPRINT)

Mfumo umeundwa kwa moduli nane (8) zinazojitegemea (loosely coupled) na zinazowasiliana kupitia mifumo rasmi ya kimkataba (Interfaces & Domain Events):

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        AGENT ORCHESTRATOR                              │
│         (Routing, Delegation, Multi-Agent Collaboration)               │
└──────┬────────────────────┬────────────────────┬───────────────────────┘
       │                    │                    │
       ▼                    ▼                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  IDENTITY &  │     │  REASONING   │     │   LEARNING   │
│ PERSONALITY  │     │    ENGINE    │     │    ENGINE    │
│ (Principles) │     │ (COT / Plan) │     │(Gaps/Lessons)│
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       ▼                    ▼                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        MEMORY SUBSYSTEM                                │
│   [Working Memory]  │  [Episodic Memory]  │  [Semantic Knowledge]     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
       ┌───────────────────────────┼───────────────────────────┐
       ▼                           ▼                           ▼
┌──────────────┐            ┌──────────────┐            ┌──────────────┐
│ EVALUATION & │            │  AUTOMATION  │            │OBSERVABILITY │
│    SAFETY    │            │    ENGINE    │            │  & RECOVERY  │
│ (Rollbacks)  │            │  (Background)│            │(Logs/Audits) │
└──────────────┘            └──────────────┘            └──────────────┘
                                   │
                                   ▼
              ┌────────────────────────────────────────┐
              │    PERSISTENCE LAYER (Ports/Adapters)  │
              │  • Neon Postgres (Production)          │
              │  • In-Memory / SQLite (Sandbox / Test) │
              └────────────────────────────────────────┘
```

---

## 2. UCHAMBUZI WA KINA WA MODULI NANE

### Moduli A: Identity & Personality (`src/core/identity`)
- **Wajibu**: Kusimamia utambulisho, misingi, kanuni za kimaadili (AI Constitution) na namna AI inavyozungumza na kutoa hoja.
- **Kanuni Kuu**:
  1. *Ukweli & Uwazi*: Kusema "sijui" pale ushahidi unapokosekana badala ya kubuni taarifa (hallucination).
  2. *Usalama Kwanza*: Kukataa maelekezo yanayoweza kuharibu mfumo, siri za mazingira, au data ya mtumiaji.
  3. *Unyenyekevu wa Kujifunza*: Kukubali makosa, kurekodi mapungufu na kuomba mwongozo.

### Moduli B: Reasoning Engine (`src/core/reasoning`)
- **Wajibu**: Kuchambua tatizo, kutengeneza mpango wa hatua kwa hatua (Chain-of-Thought / Tree of Thoughts), kupima ushahidi na kutathmini hitimisho kabla ya kutoa jibu.
- **Mzunguko wa Kazi**:
  `Problem Analysis` ➔ `Hypothesis Generation` ➔ `Step-by-Step Execution` ➔ `Self-Reflection / Verification`.

### Moduli C: Memory System (`src/core/memory`)
- **Wajibu**: Kuhifadhi na kurejesha taarifa kwa viwango vitatu:
  1. `Working Memory`: Hali ya kikao cha sasa, mambo yaliyojadiliwa hivi karibuni.
  2. `Episodic Memory`: Historia ya kazi zilizofanyika, mafanikio na changamoto zilizojitokeza.
  3. `Semantic Memory`: Maarifa yaliyoidhinishwa, sheria za kikoa, nyaraka za kiufundi.

### Moduli D: Agent Orchestrator (`src/core/orchestrator`)
- **Wajibu**: Kupokea majukumu, kuchambua ugumu wake na kuchagua:
  - Model inayofaa (Fast model kwa kazi rahisi, Analytical model kwa kazi ngumu).
  - Agent inayohusika (General, Researcher, Coder, Evaluator).
  - Kuratibu majadiliano kati ya Agents (Multi-Agent Debate au Review).

### Moduli E: Learning Engine (`src/core/learning`)
- **Wajibu**: 
  - Kugundua mapungufu ya maarifa (`KnowledgeGapDetector`).
  - Kupokea mafunzo mapya (`LessonIngestion`).
  - Kuendesha majaribio ya maarifa (`CurriculumBenchmark`).

### Moduli F: Evaluation & Safety (`src/core/safety`)
- **Wajibu**:
  - Kuchuja maingizo na matokeo (Input/Output Guardrails).
  - Kuzuia uvujaji wa siri (Credentials Sanitizer).
  - Kupima usahihi wa majibu (Evaluator Judge).
  - Mfumo wa kurudisha nyuma toleo lililopita (`RollbackManager`).

### Moduli G: Automation Engine (`src/core/automation`)
- **Wajibu**: Kuendesha kazi za nyuma hata mtumiaji akiwa hayupo mtandaoni.
  - Ratiba za kazi (Scheduled tasks).
  - Ulinzi wa gharama (Token Quotas na Max Execution Timeouts).
  - Uthibitishaji wa kurudia kazi bila kuharibu data (Idempotency).

### Moduli H: Observability & Recovery (`src/core/observability`)
- **Wajibu**:
  - Rekodi za matukio ya kina (Structured Audit Logs).
  - Takwimu za utendaji (Latency, token usage, success rate).
  - Tahadhari za hitilafu (Error telemetry & Recovery triggers).

---

## 3. MPANGO WA HIFADHI YA DATA (PERSISTENCE SCHEMAS)
Majedwali ya PostgreSQL kwenye Neon:
1. `ai_identity_configs`: Mipangilio na matoleo ya utambulisho.
2. `ai_memories`: Hifadhi ya kumbukumbu (episodic na semantic) yenye lebo, viwango vya umuhimu na timestamps.
3. `ai_tasks`: Rekodi ya kila kazi, hatua za reasoning zilizochukuliwa, na matokeo.
4. `ai_knowledge_gaps`: Mapungufu ya maarifa yaliyogunduliwa.
5. `ai_evaluations`: Matokeo ya mitihani na tathmini za uwezo.
6. `ai_system_snapshots`: Nakala za hali salama ya mfumo kwa ajili ya rollback.

Muundo huu unaruhusu kuhamishwa kwenda kwenye mfumo wowote wa SQL (kama Cloud SQL au standard Postgres) bila kubadilisha code ya ndani.
