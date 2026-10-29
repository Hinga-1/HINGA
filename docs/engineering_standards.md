# MIONGOZO YA KIUHANDISI NA UTARATIBU WA KAZI (ENGINEERING STANDARDS)

**Mradi**: AI Foundation Core (Mission 001)  
**Kiwango**: Senior / Principal Engineering  

---

## 1. MISINGI YA UHANDISI (CORE ENGINEERING PRINCIPLES)

1. **Ushahidi Kabla ya Madai (Evidence-Based Engineering)**:
   - Hakuna kudai kipengele "kinafanya kazi" bila kuendesha mtihani wa kiotomatiki (automated test) au kuonyesha matokeo halisi ya amri.
2. **Kutenganisha Akili na Miundombinu (Decoupled Core)**:
   - Logic yote ya AI (Reasoning, Safety, Learning, Orchestration) lazima iweze kufanya kazi kama *pure TypeScript modules* bila kutegemea mtandao au database ya nje, kupitia Mock Adapters.
3. **Ulinzi wa Siri (Zero Credential Leakage)**:
   - Kamwe usihifadhi API keys, nywila, au connection strings kwenye code au Git. Tumia vigezo vya mazingira (`process.env`) pekee.
4. **Mabadiliko Yanayoweza Kurudishwa (Rollback-First Design)**:
   - Kila mabadiliko ya sera, maarifa au tabia lazima yawe na toleo (`versioning`) na nakala ya awali (`snapshot`) inayoweza kurejeshwa mara moja ikitokea hitilafu.

---

## 2. UTARATIBU WA MAJARIBIO (TESTING PROTOCOL)

1. **Unit Tests (`node:test` + `node:assert/strict`)**:
   - Kupima kila moduli (Identity, Reasoning, Memory, Safety, Orchestration, Automation) kwa uhuru.
   - Hakuna dependency ya nje kwenye unit tests.
2. **Integration Tests**:
   - Kupima ushirikiano kati ya moduli (k.m. Orchestrator + Memory + Provider).
   - Kupima hifadhi ya Neon Postgres kwa kutumia schema halisi.
3. **Regression Tests**:
   - Baada ya kurekebisha kosa, andika mtihani utakaothibitisha kosa hilo halitajirudia tena.

---

## 3. AMRI ZA TERMINAL NA WORKBENCH

- `npm run ai:status` — Kukagua afya ya moduli zote 8 na miunganisho.
- `npm run ai:task` — Kuendesha kazi ya kiakili na kuona hatua za reasoning.
- `npm run ai:learn` — Kuchunguza mapungufu ya maarifa na kuingiza mafunzo mapya.
- `npm run ai:test` — Kuendesha mitihani yote ya kiotomatiki.
- `npm run ai:rollback` — Kurejesha mfumo kwenye toleo salama lililopita.
