# Base44 runtime sources

These four files are the sources of record for the HINGA automation functions that run
on Base44. They are mirrored here so the repository stays the source of truth for code,
review and diffing.

| File | Deployed name | Role |
|---|---|---|
| `hingaTick.ts` | `hingaTick` | Scheduled gate: lease, stale recovery, budgets, retry policy, atomic claim |
| `hingaReport.ts` | `hingaReport` | Heartbeat, terminal result, evidence enforcement, alerts, lease release |
| `hingaControl.ts` | `hingaControl` | pause / resume / disable / enable / complete / reset_budget / set_config |
| `hingaStatus.ts` | `hingaStatus` | Read model for the monitoring dashboard |

They are excluded from `tsc --noEmit` (see `tsconfig.json`) because they run on the Deno
runtime with `npm:@base44/sdk` and platform globals that the app build does not resolve.
They are never imported by application code.
