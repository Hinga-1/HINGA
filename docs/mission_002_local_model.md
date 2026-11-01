# MODELI YA NDANI — KUPIMA BILA API

**Hali:** Imetekelezwa na kupimwa (`src/core/evaluation/local-model.ts`).
**Kanuni:** Hakuna key, hakuna cloud. Modeli inakimbia kwenye vifaa vyako.

---

## 1. KWA NINI HII NI HATUA MUHIMU

Lango la tathmini lina maana pale linapopima **modeli halisi**. Ukingo wa mock
unalinda muundo, lakini hauwezi kukuambia kama modeli yako inajua kukataa,
kutaja chanzo, au kuepuka siri. Adapter hii inaunganisha suite yetu na modeli
inayokimbia ndani ya kompyuta — bila API, bila tokeni, bila gharama ya kila ombi.

---

## 2. AINA MBILI ZINAZOJULIKANA

| Flavour | Mwisho | Hutumika na |
|---|---|---|
| `ollama` (default) | `POST /api/generate` | Ollama |
| `openai-compatible` | `POST /v1/chat/completions` | llama.cpp server, vLLM, LM Studio |

Amri:

```bash
# Ollama (default port 11434)
ollama pull qwen2.5:7b
ollama serve
npx tsx scripts/eval-automation.ts --local qwen2.5:7b --live  # --live haihitajiki

# llama.cpp server (OpenAI-compatible, default port 8080)
llama-server -m ./models/qwen2.5-7b-instruct-q4_k_m.gguf --port 8080
npx tsx scripts/eval-automation.ts --local qwen2.5-7b-instruct --local-api openai \
  --local-url http://127.0.0.1:8080
```

Baada ya run ya kwanza inayopita:

```bash
npx tsx scripts/eval-automation.ts --local qwen2.5:7b --update-baseline
npx tsx scripts/eval-automation.ts --local qwen2.5:7b --strict   # kila siku / cron
```

---

## 3. KANUNI ZA USALAMA ZILIZOMO KWENYE CODE

1. **Loopback pekee.** `127.0.0.1`, `localhost`, `::1` — vingine vinakataliwa.
   Kutoka nje kunahitaji `allowRemote: true` kwa makusudi, si kwa bahati.
2. **Hakuna kurudi kwenye mock.** Modeli ikikosekana au kuchelewa, CLI inatoa
   **exit 2** na ujumbe; haipimi kwa stub na kudai mafanikio.
3. **Hakuna key.** Provider haisomi, haihifadhi, wala kutuma key yoyote.
4. **Timeout halisi.** `AbortSignal.timeout` (default 120s) — modeli iliyokwama
   haitazuia cron asubuhi yote.
5. **Majibu yasiyo sahihi yanakataliwa.** JSON isiyo na `response`/`choices`
   inatoa `LocalModelError`, si maandishi tupu yanayopita lango.

Kila kanuni ina mtihani wake, ikiwa ni pamoja na server halisi ya `node:http`
ndani ya vipimo (hakuna mtandao wa nje).

---

## 4. MAJARIBIO YALIYOFANYIKA

```
npx tsx --test src/core/evaluation/local-model.test.ts
  ollama body + parsing ............... pass
  openai messages + usage ............. pass
  HTTP 500 → LocalModelError(status) .. pass
  timeout 50ms → error ................ pass
  server imezimwa → false, hakuna fallback ... pass
  remote host imekataliwa .............. pass
  payload mbovu imekataliwa ............ pass
```

---

## 5. MIPAKA

- Haijapimwa na modeli halisi kwenye sandbox hii (hakuna Ollama/llama.cpp na
  hakuna vifaa vya modeli hapa). Vipimo vinathibitisha **mkataba wa HTTP**, si ubora
  wa modeli.
- Hakuna streaming; kila ombi linasubiri jibu kamili. Kwa suite ya kesi 6 hilo ni
  sawa; kwa mamia ya kesi, streaming itahitajika.
- Hakuna batching; kesi zinakimbia mfululizo. Hilo ni kwa makusudi — kupima kwa
  usawa kunahitaji hali ile ile kwa kila kesi.
