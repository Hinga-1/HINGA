# HINGA AI CORE (MISSION 001)

> **Msingi wa Ndani wa Mfumo wa AI Unaoweza Kupanuliwa, Kujifunza na Kujilinda**  
> *Hexagonal Architecture • Multi-Agent Orchestration • Tiered Memory • Neon PostgreSQL*

---

## 1. UTANGULIZI

Huu ni mradi wa msingi wa kiufundi wa AI ulioundwa chini ya viwango vya juu vya uhandisi (Principal/Senior Engineering Standards). Lengo ni kuwa na mfumo wa ndani imara (Core Intelligence) ambao unaweza kukua kwa miaka mingi bila kulazimika kuanza upya pale mifumo ya nje inapobadilika.

Mfumo huu **hautegemei muundo wa nje pekee**. Unatenganisha akili ya msingi na miundombinu kupitia *Hexagonal Architecture (Ports & Adapters)*.

---

## 2. MODULI NANE (8) ZA MFUMO

| Moduli | Jina | Wajibu Mkuu |
|---|---|---|
| **A** | **Identity & Personality** | Kusimamia katiba ya AI (`AI Constitution`), misingi, tabia na kanuni za maamuzi. |
| **B** | **Reasoning Engine** | Uchambuzi wa kina wa matatizo kwa hatua za kuthibitishika (`Chain-of-Thought` & `Self-Reflection`). |
| **C** | **Memory Subsystem** | Hifadhi ya viwango 3: `Working Memory`, `Episodic Memory`, na `Semantic Memory` (Neon PostgreSQL). |
| **D** | **Agent Orchestrator** | Ugawaji wa majukumu kwa Agents maalum (`Analyst`, `Researcher`, `Critic`, `Generalist`). |
| **E** | **Learning Engine** | Utambuzi wa mapungufu ya maarifa (`Knowledge Gaps`), mafunzo (`Lessons`), na mitihani (`Benchmarks`). |
| **F** | **Evaluation & Safety** | Ulinzi dhidi ya amri hatari, kuficha siri (`Redaction`), na kurejesha mfumo salama (`Rollback`). |
| **G** | **Automation Engine** | Utekelezaji wa kazi za nyuma bila msimamizi, ulinzi wa muda (`Timeouts`), na kurudia salama (`Idempotency`). |
| **H** | **Observability & Recovery** | Rekodi za matukio (`Audit Logs`), takwimu za kasi (`Latency`), na ukaguzi wa afya (`Health Diagnostics`). |

---

## 3. MWONGOZO WA AMRI ZA TERMINAL (CLI WORKBENCH)

Kazi zote zinaweza kuendeshwa na kupimwa moja kwa moja kutoka kwenye terminal:

```bash
# 1. Kagua afya na hali ya mifumo yote 8:
npm run ai:status

# 2. Endesha kazi ya uchambuzi wa kiakili (Reasoning):
npm run ai:task "Chambua jinsi ya kulinda hifadhidata ya Neon dhidi ya makosa"

# 3. Endesha mzunguko wa kujifunza, kurekodi mapungufu na kufanya mtihani:
npm run ai:learn

# 4. Jaribu mfumo wa snapshot na rollback ya toleo:
npm run ai:rollback

# 5. Endesha mitihani yote ya kiotomatiki (Automated Tests):
npm run test

# 6. Jenga toleo la uzalishaji:
npm run build
```

---

## 4. HIFADHI YA DATA (NEON POSTGRESQL)

- **Mradi wa Neon**: `falling-moon-75342440`
- **Tawi**: `production`
- **Eneo (Region)**: `aws-eu-central-1`
- **Majedwali**:
  - `ai_memories`: Hifadhi ya kudumu ya kumbukumbu (episodic & semantic) yenye indexing na JSONB metadata.
  - `neon_items`: Jedwali la mtihani wa CRUD na kasi ya maombi ya moja kwa moja.

---

## 5. NYARAKA ZA KIUFUNDI (DOCUMENTATION)

- [Nyaraka za Utafiti wa Kiufundi (Research Findings)](docs/research_findings.md)
- [Usanifu Kamili wa Mfumo (System Architecture)](docs/system_architecture.md)
- [Miongozo ya Kiuhandisi na Majaribio (Engineering Standards)](docs/engineering_standards.md)
