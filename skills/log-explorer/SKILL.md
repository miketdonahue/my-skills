---
name: log-explorer
description: Query, trace, and analyze Writer service logs from OMP through Grafana Loki. Use for production or dev log lookup by service, Action-Id, thread id, run id, request id, text, pattern, level, or freshness across skynet backend, worker, gateway, and related services.
---

# Log Explorer

Use Grafana Loki for Writer service logs. DevOps moved usable log access away
from GCP Cloud Logging, and this OMP skill follows the writer-monorepo
`.ruler/skills/log-explorer` Loki/Grafana access pattern.

Do not use `gcloud logging read` for this skill. GCP user credentials expire
under Writer reauth policy, Cloud Logging results can be capped or misleading,
and unscoped queries can cross clusters. Every Loki query from this skill must
include `k8s_cluster_name`.

## Access

| Field | Value |
| --- | --- |
| Grafana | `https://grafana.observability.writer.com` |
| Loki datasource UID | `cfb7985d-c80e-4f83-9b87-a9b731eadafb` |
| Auth | `GRAFANA_SERVICE_ACCOUNT_TOKEN` env var, or `mcpServers.grafana.env.GRAFANA_SERVICE_ACCOUNT_TOKEN` in `~/.claude.json` |

If the token is missing, expired, or returns HTTP 401/403, stop and report the
blocker. Do not fall back to GCP Cloud Logging, a different cluster, or a
different environment.

## Clusters

Always state the queried cluster in the answer.

| Alias | Loki `k8s_cluster_name` | Meaning | Default |
| --- | --- | --- | --- |
| `dev` | `dev-deer` | GCP dev | yes |
| `prod` | `prod-pine` | GCP production | no |
| `prod-eu` | `pepper` | AWS EU production | no |
| `aws` | `pepper` | AWS EU production | no |

Other cluster names can be passed explicitly, but never omit the cluster.

## Services

The default service regex is `skynet-backend|skynet-worker`, matching the
writer-monorepo report workflow. Pass `--service skynet-gateway` for gateway
investigations, or a safe Loki regex such as
`--service "skynet-backend|skynet-worker|skynet-gateway"`.

Known useful service labels include:

- `skynet-backend`
- `skynet-worker`
- `skynet-gateway`
- `skynet-frontend`
- `skynet-meet`
- `skynet-backend-migration`

## Script

Use the bundled script for ad-hoc lookups:

```bash
python3 /Users/michael/.omp/agent/skills/log-explorer/scripts/query-loki-logs.py \
  [--cluster dev|prod|prod-eu|aws|<k8s_cluster_name>] \
  [--service 'skynet-backend|skynet-worker|skynet-gateway'] \
  [--thread-id VALUE] \
  [--agent-run-id VALUE] \
  [--run-id VALUE] \
  [--request-id VALUE] \
  [--action-id VALUE] \
  [--text VALUE] \
  [--pattern VALUE] \
  [--level DEFAULT|DEBUG|INFO|WARNING|ERROR|CRITICAL] \
  [--window 30m|1h|6h|24h|48h|7d] \
  [--limit N] \
  [--direction backward|forward] \
  [--output /tmp/logs.json]
```

Common searches:

```bash
python3 /Users/michael/.omp/agent/skills/log-explorer/scripts/query-loki-logs.py --cluster prod --service skynet-gateway --action-id '<Action-Id>' --window 24h
python3 /Users/michael/.omp/agent/skills/log-explorer/scripts/query-loki-logs.py --cluster dev --service skynet-backend --thread-id '<thread-id>' --direction forward
python3 /Users/michael/.omp/agent/skills/log-explorer/scripts/query-loki-logs.py --cluster prod-eu --service skynet-gateway --text 'token_revoked' --level ERROR --window 48h
python3 /Users/michael/.omp/agent/skills/log-explorer/scripts/query-loki-logs.py --cluster dev --request-id '<request-id>' --window 6h
```

Use `--print-query` when you need to inspect the LogQL without requiring a
Grafana token.

## LogQL Shape

The script always starts with a cluster-scoped selector:

```logql
{k8s_cluster_name="dev-deer", k8s_container_name=~"skynet-backend|skynet-worker"}
```

Identifier filters use `| json | __error__=""` before field predicates:

```logql
| json lvl="level", thread_id="thread_id", agent_run_id="agent_run_id", run_id="run_id", request_id="request_id" | __error__=""
| thread_id="<UUID>"
```

`Action-Id` uses a raw-line substring filter so it works across Python JSON
logs and gateway pino logs where the value can be nested inside `action`,
headers, `msg`, or `event`.

## Interpretation

Use IDs before text when possible. `Action-Id`, `thread_id`, `agent_run_id`,
`run_id`, and `request_id` are stronger correlation signals than message text.

Treat `Action-Id` as the cross-system HTTP/log correlation value. Do not
confuse it with arbitrary UI `actionId` fields in frontend code.

The script reports returned raw lines, not exhaustive event counts. If you need
ranked, exhaustive error counts or historical report comparison, cross-check the
latest writer-monorepo skill at
`/Users/michael/development/writer/writer-monorepo/.ruler/skills/log-explorer/`
and use its `scripts/error_report.py` workflow.

An empty Loki result is not proof that nothing happened. Confirm the time
window, cluster, service label, and identifier, and report unavailable auth or
ambiguous query evidence as a limit.
