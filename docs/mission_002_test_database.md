# DATABASE YA MAJARIBIO — `DATABASE_URL_TEST`

**Hali:** Tawi la Neon `mission-002-test` limeundwa; code inasoma `DATABASE_URL_TEST` pekee.
**Kanuni:** Vipimo hiviandike kamwe kwenye production.

---

## 1. TATIZO LILILOKUWA

Kipimo cha kumbukumbu ya Neon (`src/core/neon-memory.test.ts`) kilisoma
`DATABASE_URL` — ambayo ni production. Kila `npm test` iliandika na kufuta
kumbukumbu kwenye database halisi.

Ushahidi wa moja kwa moja: kabla ya marekebisho, `npm test` ilikimbia **vipimo 22**;
baada yake, **17** na **1 imerukwa**. Tofauti ya 5 ni sub-tests zile zilizokuwa
zinaandika kwenye production. Sasa hazikimbii bila `DATABASE_URL_TEST`.

---

## 2. TAWI LA NEON

| Kipengele | Thamani |
|---|---|
| Project | `falling-moon-75342440` (`my-first-project`) |
| Tawi la majaribio | `mission-002-test` (`br-noisy-voice-b9slg2na`) |
| Endpoint | `ep-royal-rice-b9wizw00` (read-write, aws-eu-central-1) |
| Database / role | `neondb` / `neondb_owner` |
| Tawi la production | `production` (`br-shy-voice-b958sxiw`) — **haliguswi** |

Tawi la Manus (`mission-003-test-20261030`) haliguswi pia.

---

## 3. KUPATA CONNECTION STRING (wezi)

1. Fungua Neon Dashboard → project → **Branches** → `mission-002-test`
2. **Connection string** → nakili ile **isiyo na `-pooler`** (unpooled; bora kwa DDL)
3. Bandika kwenye `.env` (hii iko `.gitignore`):

```bash
DATABASE_URL_TEST="postgresql://neondb_owner:...@ep-royal-rice-b9wizw00.c-7.eu-central-1.aws.neon.tech/neondb?sslmode=require"
```

Hakuna haja ya `DATABASE_URL_TEST_UNPOOLED` — code inatumia `DATABASE_URL_TEST`
kama hakuna toleo la unpooled.

**Usiweke string hii kwenye code, command, au ujumbe wa chat.** Ikiwa unaihitaji
kwenye CI, weka kama GitHub secret.

---

## 4. KANUNI ZILIZOMO KWENYE CODE

1. Bila `DATABASE_URL_TEST` → kipimo **kinarukwa** (`skip`), hakuna kurudi kwenye production.
2. `DATABASE_URL_TEST === DATABASE_URL` → **kinakataliwa** kwa wazi.
3. Migration 002 haijatumika → `NeonEvaluationStore` inaruka kwa sababu, haianguki kimya.
4. Kumbukumbu ya jaribio hutumia `suiteId` yenye timestamp, hivyo runs hazigongani.

---

## 5. KUPIMA

```bash
npx tsx --test src/core/neon-memory.test.ts src/core/evaluation/store-live.test.ts
```

Bila URL: `skipped 2`. Ukiweka URL: vipimo vinakimbia dhidi ya tawi la majaribio pekee.

Store live inahitaji migration ya Mission 003:

```bash
psql "$DATABASE_URL_TEST" -f db/migrations/002_ai_core_state.sql
```
