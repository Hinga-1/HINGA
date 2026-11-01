# MISSION 002 — AUTOMATION NA CHECKPOINT YA HALI

**Hali:** Imetekelezwa na kupimwa.
**Kanuni:** Hakuna API, hakuna mtandao, hakuna database kwa automation hii.
Kila kitu ni function ya input zake — hivyo matokeo yanarudiwa (reproducible).

---

## 1. KWA NINI AUTOMATION, SI "SCRIPT YA MARA MOJA"

Lango la tathmini lina thamani pale linapokimbia **kila siku**, si pale mtu
anapokumbuka. Automation hii inafanya mzunguko mzima kwa amri moja:

```text
suite → run → compare na baseline → uamuzi (exit code) → checkpoint ya hali
```

Hakuna hatua inayohitaji mtu kusoma matokeo ili kuamua kama mfumo umezorota.

---

## 2. AMRI

```bash
# 1. Kukimbia kwa haraka, bila modeli (stub ya sandbox) — kukagua harness
npx tsx scripts/eval-automation.ts

# 2. Kurekodi baseline baada ya kukimbia halisi kunakopita
npx tsx scripts/eval-automation.ts --live --update-baseline

# 3. Lang0 la CI/mashine: baseline ikikosekana, inashindwa
npx tsx scripts/eval-automation.ts --live --strict

# 4. Saraka nyingine ya artifacts
npx tsx scripts/eval-automation.ts --out /var/lib/hinga/eval
```

| Chaguo | Maana |
|---|---|
| `--live` | Tumia provider halisi; ikikosekana key, **exit 2** bila ombi lolote |
| `--local MODEL` | Tumia modeli ya ndani (Ollama); tazama [mission_002_local_model.md](mission_002_local_model.md) |
| `--local-url` / `--local-api` | URL na aina ya server ya ndani (`ollama` au `openai`) |
| `--strict` | Baseline ikikosekana, hii ni kosa (exit 1), si taarifa |
| `--update-baseline` | Hifadhi baseline **baada ya run iliyopita** tu |
| `--allow-mock-baseline` | Ruhusu baseline ya mock kwa makusudi (haishauriwi) |
| `--out` | Saraka ya baseline/runs/checkpoint (default `.cache/eval`) |

### Nambari za kutoka (exit codes)

| Code | Maana | Hatua |
|---|---|---|
| `0` | Pass, au `no_baseline` bila `--strict` | Endelea |
| `1` | Kesi imeshuka, suite haijakamilika, au baseline haipo chini ya `--strict` | Zuia mabadiliko |
| `2` | Hitilafu ya usanifu: baseline mbovu, toleo tofauti, `--live` bila key | Rekebisha mipangilio |

`2` haifichi kosa kama "no baseline" — ni muhimu: baseline iliyoharibika ni
hatari zaidi kuliko baseline isiyokuwepo.

---

## 3. KANUNI ZA LANGO (ZILIZOPIMWA)

1. **Kesi iliyoshuka = kushindwa**, hata kama wastani umeongezeka.
2. **Suite isiyokamilika haiandiki baseline**, hata kwa `--update-baseline`.
3. **Mock haiwezi kuwa baseline** bila bendera ya wazi — baseline ya 0% ingefanya
   lango likubali kila kitu baadaye.
4. **Toleo tofauti la suite halilinganishwi** (`incomparable`, exit 2).
5. **Baseline isiyo sahihi inakataliwa**: `passRate` lazima iwiane na kesi,
   `caseId` hazirudiwi, na `score` ziko kati ya 0 na 1.

Kila kanuni ina mtihani wake kwenye `src/core/evaluation/automation.test.ts`.

---

## 4. ARTIFACTS (HAZIINGII GIT)

```text
.cache/eval/
├── baseline.json            # baseline iliyokubaliwa (haipo hadi --update-baseline)
├── checkpoint.json          # hali ya kuendelea, mashine inayosomeka
├── checkpoint.md            # hali hiyo hiyo kwa mtu
└── runs/
    └── 2026-11-01T00-25-00-000Z.json   # kila run, na sababu za lango
```

`.cache/` iko kwenye `.gitignore`, hivyo hakuna artifact inayochafua repo.
Checkpoint **haiweki** API key, connection string, wala maudhui ya prompt.

### Muundo wa checkpoint

```json
{
  "version": 1,
  "createdAt": "2026-11-01T00:25:00.000Z",
  "suite": { "id": "hinga-baseline", "version": "1.0.0" },
  "provider": { "id": "Mock Sandbox AI Provider", "modelId": "mock", "mock": true },
  "code": { "commit": "d6ef73c", "branch": "mission-002-learning-gate" },
  "run": { "passed": false, "passRate": 0, "weightedScore": 0.25, "cases": 6, "failedCases": ["..."] },
  "gate": { "verdict": "no_baseline", "exitCode": 1, "reasons": ["..."] },
  "baseline": { "present": false, "recordedAt": null, "providerId": null },
  "nextActions": ["..."]
}
```

`nextActions` hutolewa kutoka kwenye hali halisi — hitilafu, mock, regression au
mafanikio — hivyo mtu anayerudi baada ya siku mbili anajua pa kuanzia bila kusoma logi.

---

## 5. KUKIMBIA KILA SIKU (BILA API, BILA CLOUD)

Automation haihitaji scheduler ya nje. Kwenye mashine ya modeli:

```bash
# crontab -e  — kila saa mbili kwa siku mbili, modeli ya ndani, logi kwenye .cache
0 20 * * * cd /opt/hinga && /usr/bin/npx tsx scripts/agent-loop.ts --local qwen2.5:7b --hours 48 --every 120 >> .cache/eval/cron.log 2>&1
```

Kanuni: `>>` (si `>`) ili historia ibaki; hakuna key kwenye crontab; `--local`
ili hakuna ombi la nje linatoka. Kwa mzunguko unaojiendesha kwa siku mbili bila
mtu (pamoja na ripoti na kurekodi gaps), tazama
[mission_002_agent_loop.md](mission_002_agent_loop.md).

Kwenye CI (GitHub Actions) **lango halikimbii**: runner haina modeli, na kutaka
ikimbie kungebidi kuweka API ya nje — kinyume cha sharti. Workflow
`.github/workflows/evaluation.yml` hukagua **harness yenyewe** (vipimo + typecheck)
kwa bun na `bun.lock` iliyopo.

---

## 6. JINSI YA KUONGEZA KESI

1. Ongeza kesi kwenye `src/core/evaluation/suites/hinga-baseline.ts`.
2. Pandisha `version` ya suite (mf. `1.0.0` → `1.1.0`); bila hivyo baseline ya zamani
   itakuwa `incomparable` — kwa makusudi.
3. Kimbiza `npx tsx scripts/eval-automation.ts --live --update-baseline` ili baseline
   mpya irekodiwe **baada ya** run kupita.
4. Kimbiza tena bila `--update-baseline`: lazima litoe `pass` na exit `0`.

Hatua 4 ndiyo inayothibitisha kwamba baseline mpya inaweza kutegemewa.

---

## 7. MIPAKA

- Automation haipimi ubora wa modeli yenyewe; inapima **tabia dhidi ya kesi zilizoandikwa**.
- Haiwezi kugundua aina mpya ya kosa ambayo haijaandikwa kama kesi.
- Kwa sasa ina kesi 6; utafiti unapendekeza 100–500. Ongezeko linakuja kutoka kwenye
  makosa halisi, si kutoka kwenye mawazo.
- `NeonEvaluationStore` haijaunganishwa kwenye CLI hii: automation haiandiki database.
  Hiyo ni kwa makusudi — checkpoint ni faili, na database inahitaji tawi la majaribio.
