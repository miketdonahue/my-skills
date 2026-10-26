#!/usr/bin/env python3
"""Query Writer service logs through Grafana Loki."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python 3.10 fallback.
    tomllib = None  # type: ignore[assignment]


DEFAULT_GRAFANA_URL = "https://grafana.observability.writer.com"
DEFAULT_DATASOURCE_UID = "cfb7985d-c80e-4f83-9b87-a9b731eadafb"
DEFAULT_SERVICES = "skynet-backend|skynet-worker"

CLUSTER_ALIASES = {
    "dev": "dev-deer",
    "prod": "prod-pine",
    "prod-eu": "pepper",
    "aws": "pepper",
}

ENVIRONMENTS = {
    "dev-deer": "dev",
    "prod-pine": "prod",
    "pepper": "prod-eu",
}

LEVEL_FILTERS = {
    "DEFAULT": "",
    "DEBUG": 'lvl=~"debug|10"',
    "INFO": 'lvl=~"info|30"',
    "WARNING": 'lvl=~"warning|40"',
    "ERROR": 'lvl=~"error|critical|50|60"',
    "CRITICAL": 'lvl=~"critical|60"',
}

_SAFE_SERVICE_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._|*+?()\[\]-]{0,120}$")
_WINDOW_RE = re.compile(r"^(\d+)([smhd])$")
_WINDOW_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400}


class LokiError(Exception):
    """Base error for query failures."""


class LokiAuthError(LokiError):
    """Grafana rejected or could not find the Loki token."""


@dataclass(frozen=True)
class QueryConfig:
    cluster_arg: str
    cluster: str
    services: str
    window: str
    limit: int
    direction: str
    thread_id: str | None
    agent_run_id: str | None
    run_id: str | None
    request_id: str | None
    action_id: str | None
    text: str | None
    pattern: str | None
    level: str
    output: str | None
    print_query: bool
    grafana_url: str
    datasource_uid: str


def positive_int(raw: str) -> int:
    try:
        value = int(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("value must be a positive integer") from exc
    if value < 1:
        raise argparse.ArgumentTypeError("value must be a positive integer")
    return value


def parse_window(window: str) -> timedelta:
    match = _WINDOW_RE.match(window.strip())
    if not match:
        raise argparse.ArgumentTypeError("window must use a suffix like 30m, 6h, 24h, or 7d")
    return timedelta(seconds=int(match.group(1)) * _WINDOW_SECONDS[match.group(2)])


def normalize_services(raw: str | None) -> str:
    if raw in (None, ""):
        return DEFAULT_SERVICES
    if raw == "all":
        return ".+"
    if not _SAFE_SERVICE_RE.match(raw):
        raise argparse.ArgumentTypeError("service must be a safe Loki regex")
    return raw


def parse_args(argv: Sequence[str] | None = None) -> QueryConfig:
    parser = argparse.ArgumentParser(
        description="Query Writer service logs through the Grafana Loki datasource.",
    )
    parser.add_argument(
        "--cluster",
        default="dev",
        help="Loki k8s_cluster_name or alias: dev, prod, prod-eu, aws",
    )
    parser.add_argument(
        "--window",
        "--freshness",
        dest="window",
        default="24h",
        help="Lookback window ending now, such as 30m, 6h, 24h, or 7d",
    )
    parser.add_argument(
        "--service",
        type=normalize_services,
        default=DEFAULT_SERVICES,
        help=f"k8s_container_name regex, default: {DEFAULT_SERVICES}. Use all for every container.",
    )
    parser.add_argument("--thread-id")
    parser.add_argument("--agent-run-id")
    parser.add_argument("--run-id")
    parser.add_argument("--request-id")
    parser.add_argument("--action-id")
    parser.add_argument("--text", help="Raw-line substring filter")
    parser.add_argument("--pattern", help="Raw-line regex filter")
    parser.add_argument(
        "--level",
        "--severity",
        dest="level",
        choices=sorted(LEVEL_FILTERS),
        default="DEFAULT",
        help="DEFAULT applies no level filter. ERROR includes critical and pino fatal.",
    )
    parser.add_argument("--limit", type=positive_int, default=100)
    parser.add_argument("--direction", choices=("backward", "forward"), default="backward")
    parser.add_argument("--output")
    parser.add_argument("--print-query", action="store_true")
    parser.add_argument("--grafana-url", default=os.environ.get("GRAFANA_URL", DEFAULT_GRAFANA_URL))
    parser.add_argument("--datasource-uid", default=DEFAULT_DATASOURCE_UID)
    args = parser.parse_args(argv)

    # Validate now so callers get argument errors before any network or auth work.
    parse_window(args.window)
    cluster = CLUSTER_ALIASES.get(args.cluster, args.cluster)
    return QueryConfig(
        cluster_arg=args.cluster,
        cluster=cluster,
        services=args.service,
        window=args.window,
        limit=args.limit,
        direction=args.direction,
        thread_id=args.thread_id,
        agent_run_id=args.agent_run_id,
        run_id=args.run_id,
        request_id=args.request_id,
        action_id=args.action_id,
        text=args.text,
        pattern=args.pattern,
        level=args.level,
        output=args.output,
        print_query=args.print_query,
        grafana_url=args.grafana_url,
        datasource_uid=args.datasource_uid,
    )


def logql_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def selector(cluster: str, services: str) -> str:
    return f'{{k8s_cluster_name="{logql_escape(cluster)}", k8s_container_name=~"{logql_escape(services)}"}}'


def json_pipe() -> str:
    fields = [
        'lvl="level"',
        'message="message"',
        'msg="msg"',
        'event="event"',
        'thread_id="thread_id"',
        'agent_run_id="agent_run_id"',
        'run_id="run_id"',
        'request_id="request_id"',
    ]
    return f"| json {', '.join(fields)} | __error__=\"\""


def quoted_filter(op: str, value: str) -> str:
    return f'{op} "{logql_escape(value)}"'


def build_query(config: QueryConfig) -> str:
    parts = [selector(config.cluster, config.services)]

    # Raw-line filters work across Python JSON logs, gateway pino logs, and
    # nested fields such as gateway action strings.
    if config.action_id:
        parts.append(quoted_filter("|=", config.action_id))
    if config.text:
        parts.append(quoted_filter("|=", config.text))
    if config.pattern:
        parts.append(quoted_filter("|~", config.pattern))

    needs_json = any(
        (
            config.thread_id,
            config.agent_run_id,
            config.run_id,
            config.request_id,
            config.level != "DEFAULT",
        )
    )
    if needs_json:
        parts.append(json_pipe())
    if config.thread_id:
        parts.append(f'| thread_id="{logql_escape(config.thread_id)}"')
    if config.agent_run_id:
        parts.append(f'| agent_run_id="{logql_escape(config.agent_run_id)}"')
    if config.run_id:
        parts.append(f'| run_id="{logql_escape(config.run_id)}"')
    if config.request_id:
        parts.append(f'| request_id="{logql_escape(config.request_id)}"')
    if config.level != "DEFAULT":
        parts.append(f"| {LEVEL_FILTERS[config.level]}")
    return " ".join(parts)


def find_grafana_token_in_json(data: Any) -> str | None:
    if isinstance(data, dict):
        mcp_servers = data.get("mcpServers")
        if isinstance(mcp_servers, dict):
            grafana = mcp_servers.get("grafana")
            if isinstance(grafana, dict):
                env = grafana.get("env")
                if isinstance(env, dict):
                    token = env.get("GRAFANA_SERVICE_ACCOUNT_TOKEN")
                    if isinstance(token, str) and token.strip():
                        return token.strip()
        for value in data.values():
            token = find_grafana_token_in_json(value)
            if token:
                return token
    if isinstance(data, list):
        for value in data:
            token = find_grafana_token_in_json(value)
            if token:
                return token
    return None


def token_from_codex_config(path: Path) -> str | None:
    if tomllib is None:
        return None
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return None
    grafana = data.get("mcp_servers", {}).get("grafana")
    if not isinstance(grafana, dict):
        return None
    env = grafana.get("env")
    if not isinstance(env, dict):
        return None
    token = env.get("GRAFANA_SERVICE_ACCOUNT_TOKEN")
    return token.strip() if isinstance(token, str) and token.strip() else None


def resolve_token(env: Mapping[str, str] | None = None, home: Path | None = None) -> str:
    env = os.environ if env is None else env
    home = Path.home() if home is None else home

    token = env.get("GRAFANA_SERVICE_ACCOUNT_TOKEN", "").strip()
    if token:
        return token

    for path in (home / ".claude.json", home / ".mcp.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        token = find_grafana_token_in_json(data)
        if token:
            return token

    token = token_from_codex_config(home / ".codex" / "config.toml")
    if token:
        return token

    raise LokiAuthError(
        "No Grafana token found. Set GRAFANA_SERVICE_ACCOUNT_TOKEN or configure "
        "mcpServers.grafana.env.GRAFANA_SERVICE_ACCOUNT_TOKEN in ~/.claude.json. "
        "There is no GCP Cloud Logging fallback."
    )


class Loki:
    def __init__(self, base_url: str, datasource_uid: str, token: str):
        self.base = (
            f"{base_url.rstrip('/')}/api/datasources/proxy/uid/"
            f"{datasource_uid}/loki/api/v1"
        )
        self.token = token

    def _get(self, path: str, params: Mapping[str, str]) -> dict[str, Any]:
        url = f"{self.base}/{path}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.token}"})
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                body = resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")
            if exc.code in (401, 403):
                raise LokiAuthError(
                    f"HTTP {exc.code} from Grafana. The service-account token is missing, "
                    f"expired, or lacks access to the Loki datasource. Body: {body[:300]}"
                ) from None
            raise LokiError(f"HTTP {exc.code} from Grafana on {path}: {body[:300]}") from None
        except urllib.error.URLError as exc:
            raise LokiError(f"Network error reaching Grafana: {exc}") from None

        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise LokiError(f"Non-JSON response from Grafana: {exc}") from None
        if payload.get("status") != "success":
            raise LokiError(f"Loki status={payload.get('status')}: {str(payload)[:300]}")
        data = payload.get("data")
        return data if isinstance(data, dict) else {}

    def query_range(
        self,
        query: str,
        *,
        start: datetime,
        end: datetime,
        limit: int,
        direction: str,
    ) -> list[dict[str, Any]]:
        data = self._get(
            "query_range",
            {
                "query": query,
                "start": rfc3339(start),
                "end": rfc3339(end),
                "limit": str(limit),
                "direction": direction,
            },
        )
        rows: list[dict[str, Any]] = []
        for stream in data.get("result", []):
            if not isinstance(stream, dict):
                continue
            labels = stream.get("stream", {})
            if not isinstance(labels, dict):
                labels = {}
            for value in stream.get("values", []):
                if not isinstance(value, list) or len(value) != 2:
                    continue
                timestamp_ns, line = value
                if isinstance(timestamp_ns, str) and isinstance(line, str):
                    rows.append(
                        {
                            "timestamp": ns_to_iso(timestamp_ns),
                            "timestamp_ns": timestamp_ns,
                            "stream": labels,
                            "line": line,
                            "payload": parse_log_line(line),
                        }
                    )
        rows.sort(key=lambda row: row["timestamp_ns"], reverse=(direction == "backward"))
        return rows


def rfc3339(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def ns_to_iso(raw: str) -> str:
    try:
        return datetime.fromtimestamp(int(raw) / 1_000_000_000, timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
    except (ValueError, OverflowError):
        return ""


def parse_log_line(line: str) -> dict[str, Any]:
    try:
        parsed = json.loads(line)
    except json.JSONDecodeError:
        return {"_raw": line}
    return parsed if isinstance(parsed, dict) else {"_raw": line}


def output_path(cluster: str) -> str:
    fd, path = tempfile.mkstemp(prefix=f"loki-logs-{cluster}-", suffix=".json")
    os.close(fd)
    return path


def write_output(path: str, payload: dict[str, Any]) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def field_text(payload: Mapping[str, Any], *names: str) -> str:
    for name in names:
        value = payload.get(name)
        if isinstance(value, str) and value:
            return value
        if value is not None:
            return json.dumps(value, sort_keys=True, default=str)
    return ""


def preview(row: Mapping[str, Any], max_len: int = 180) -> str:
    payload = row.get("payload")
    if not isinstance(payload, dict):
        return ""
    text = field_text(payload, "event", "message", "msg", "error", "_raw")
    text = " ".join(text.split())
    return text if len(text) <= max_len else text[: max_len - 3] + "..."


def identifiers(row: Mapping[str, Any]) -> str:
    payload = row.get("payload")
    if not isinstance(payload, dict):
        return ""
    pairs: list[str] = []
    for key in ("thread_id", "agent_run_id", "run_id", "request_id", "action_id", "actionId"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            pairs.append(f"{key}={value}")
    return ", ".join(pairs)


def row_service(row: Mapping[str, Any]) -> str:
    stream = row.get("stream")
    if isinstance(stream, dict):
        service = stream.get("k8s_container_name") or stream.get("service_name")
        if isinstance(service, str):
            return service
    return "-"


def row_level(row: Mapping[str, Any]) -> str:
    payload = row.get("payload")
    if isinstance(payload, dict):
        level = payload.get("level")
        if level is not None:
            return str(level)
    return "-"


def result_payload(config: QueryConfig, query: str, start: datetime, end: datetime, rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "metadata": {
            "cluster": config.cluster,
            "cluster_alias": config.cluster_arg if config.cluster_arg != config.cluster else None,
            "environment": ENVIRONMENTS.get(config.cluster, "unknown"),
            "service_filter": config.services,
            "window": config.window,
            "start": rfc3339(start),
            "end": rfc3339(end),
            "limit": config.limit,
            "direction": config.direction,
            "grafana_url": config.grafana_url,
            "datasource_uid": config.datasource_uid,
        },
        "query": query,
        "rows": rows,
    }


def print_summary(config: QueryConfig, query: str, output: str, start: datetime, end: datetime, rows: list[dict[str, Any]]) -> None:
    services = sorted({row_service(row) for row in rows if row_service(row) != "-"})
    timestamps = [row["timestamp"] for row in rows if row.get("timestamp")]

    print("Loki log query summary")
    print(f"cluster: {config.cluster}")
    print(f"environment: {ENVIRONMENTS.get(config.cluster, 'unknown')}")
    print(f"service_filter: {config.services}")
    print(f"window: {config.window} [{rfc3339(start)} to {rfc3339(end)}]")
    print(f"query: {query}")
    print(f"output: {output}")
    print(f"returned_lines: {len(rows)}")
    print(f"result_limit: {config.limit}")
    print(f"services: {', '.join(services) if services else '-'}")
    print(f"first_timestamp: {min(timestamps) if timestamps else '-'}")
    print(f"last_timestamp: {max(timestamps) if timestamps else '-'}")
    print("representative_rows:")
    if not rows:
        print("- none")
        return
    for row in rows[:10]:
        ids = identifiers(row)
        suffix = f" [{ids}]" if ids else ""
        print(f"- {row.get('timestamp', '-')} {row_level(row)} {row_service(row)}: {preview(row)}{suffix}")


def main(argv: Sequence[str] | None = None) -> int:
    config = parse_args(argv)
    query = build_query(config)
    if config.print_query:
        print(query)
        return 0

    delta = parse_window(config.window)
    end = datetime.now(timezone.utc).replace(microsecond=0)
    start = end - delta

    try:
        token = resolve_token()
        loki = Loki(config.grafana_url, config.datasource_uid, token)
        rows = loki.query_range(
            query,
            start=start,
            end=end,
            limit=config.limit,
            direction=config.direction,
        )
    except LokiAuthError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        print("Do not fall back to GCP Cloud Logging or another cluster.", file=sys.stderr)
        return 1
    except LokiError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    path = config.output or output_path(config.cluster)
    write_output(path, result_payload(config, query, start, end, rows))
    print_summary(config, query, path, start, end, rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
