# Mzunguko wa kiotomatiki (siku mbili bila mtu)

## Ukweli wa kwanza

Buffy **haiwezi** kuendelea kufanya kazi baada ya chat kufungwa. Kila jibu lake ni
duru moja; haiishi nyuma kama mchakato unaoendelea siku mbili. Hakuna ujanja wa
coding unaobadilisha hilo — ni jinsi mfumo unavyofanya kazi.

Kinachowezekana ni kitu kingine, na ndicho kilichojengwa: **mfumo** unaojiendesha
mwenyewe bila mtu. Siku mbili za kazi zinaendelea, sio kwa Buffy kuwa hai, bali
kwa script kukimbia kwenye kompyuta yako.

## Kinachofanyika kila duru

`scripts/agent-loop.ts` inafanya haya bila mtu:

1. Inathibitisha modeli ya ndani ipo (loopback pekee).
2. Inaendesha suite ya tathmini na kutumia lango la kupandisha.
3. Inaandika duru kwenye `.cache/eval/cycles.jsonl`.
4. Kwa `--record-gaps`: inaandika kila kesi inayoshindwa kama `learning_gap`
   kwenye **database ya majaribio pekee** (production inakataliwa).
5. Inaandika upya `.cache/eval/agent-report.md` — ripoti unayoisoma ukirudi.

## Kinachohitaji mtu (kusema ukweli)

Mzunguko huu **unapima, unaandika na unaripoti**. Hauandiki code mpya, haubuni
skills mpya, na hauboresha modeli yenyewe. Kujifunza kikamilifu bila mtu ni
tatizo la utafiti, sio kazi ya usiku mmoja. Kile kinachopatikana ni hiki:
ukirudi, unakuta **data halisi** badala ya kukisia.

## Kuiendesha

```bash
# Duru moja (jaribio)
npx tsx scripts/agent-loop.ts --local qwen2.5:7b --once

# Siku mbili kamili, kila saa mbili
npx tsx scripts/agent-loop.ts --local qwen2.5:7b --hours 48 --every 120

# Pamoja na kuandika gaps kwenye database ya majaribio
npx tsx scripts/agent-loop.ts --local qwen2.5:7b --hours 48 --record-gaps
```

Acha kwa utulivu wakati wowote: `touch .cache/eval/STOP` (au `Ctrl+C`).

| Flag | Maana |
|---|---|
| `--local MODEL` | Jina la modeli kwenye Ollama/llama.cpp. Bila hii inatumia mock (jaribio la mfumo pekee) |
| `--local-url URL` | Mfano `http://127.0.0.1:11434` |
| `--local-api ollama\|openai` | `openai` kwa `llama-server` |
| `--every DAKIKA` | Muda kati ya duru (chaguo-msingi 120) |
| `--hours SAA` | Kikomo cha muda (chaguo-msingi 48) |
| `--once` | Duru moja tu |
| `--record-gaps` | Andika kesi zinazoshindwa kwenye database ya majaribio |
| `--out SARAKA` | Saraka ya artifacts (chaguo-msingi `.cache/eval`) |

Kama modeli haipo, duru inaandikwa kama `model_unavailable` na haianguki. Baada ya
duru 12 mfululizo bila modeli, script inaacha yenyewe — isikae siku mbili ikipima
ukuta.

## Kuiweka ijiendeshe (bila terminal wazi)

**Linux / macOS (cron):**

```bash
crontab -e
# kila saa mbili, kuanzia saa 8 usiku
0 */2 * * * cd /njia/ya/HINGA && npx tsx scripts/agent-loop.ts --local qwen2.5:7b --hours 48 --every 120 >> .cache/eval/loop.log 2>&1
```

**Windows (Task Scheduler):**

```powershell
schtasks /Create /SC HOURLY /MO 2 /TN "HINGA agent loop" ^
  /TR "cmd /c cd /d C:\njia\ya\HINGA && npx tsx scripts/agent-loop.ts --local qwen2.5:7b --hours 48 --every 120" ^
  /ST 20:00
```

**systemd (Linux, inaendelea baada ya logout):**

```ini
# ~/.config/systemd/user/hinga-loop.service
[Unit]
Description=HINGA evaluation loop

[Service]
WorkingDirectory=%h/HINGA
ExecStart=/usr/bin/npx tsx scripts/agent-loop.ts --local qwen2.5:7b --hours 48 --every 120
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now hinga-loop
```

## Kusoma matokeo ukirudi

```bash
cat .cache/eval/agent-report.md
```

Ripoti ina: pass rate ya mwisho, iliyobora, mwenendo, hali za lango, jedwali la
duru, na kesi zinazoshindwa sasa. Hiyo ndiyo sehemu muhimu: badala ya "sijui
kilitokea nini", unapata orodha ya kesi zilizoshindwa.

## Mipaka

- Modeli lazima iwe imewashwa. Kompyuta ikilala au kuzimwa, duru zinakosa modeli
  na zinaandikwa hivyo — kwa uaminifu.
- Hakuna kuandika production: gaps zinaenda kwenye `DATABASE_URL_TEST` pekee.
- Baseline haibadilishwi kiotomatiki. Kuipandisha ni uamuzi wa mtu, kwa makusudi:
  kubadilisha baseline kiotomatiki kunaficha regressions.
