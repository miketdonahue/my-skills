#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "query-loki-logs.py"
SPEC = importlib.util.spec_from_file_location("query_loki_logs", SCRIPT_PATH)
assert SPEC is not None
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


class QueryLokiLogsTests(unittest.TestCase):
    def config(self, *argv: str):
        return MODULE.parse_args(list(argv))

    def test_default_selector_is_scoped_to_dev_deer(self) -> None:
        query = MODULE.build_query(self.config())
        self.assertIn('k8s_cluster_name="dev-deer"', query)
        self.assertIn('k8s_container_name=~"skynet-backend|skynet-worker"', query)
        self.assertNotIn("tether", query)
        self.assertNotIn("gcloud", query)

    def test_cluster_aliases_are_mapped_to_loki_cluster_names(self) -> None:
        prod = MODULE.build_query(self.config("--cluster", "prod", "--service", "skynet-gateway"))
        eu = MODULE.build_query(self.config("--cluster", "prod-eu", "--service", "skynet-gateway"))
        self.assertIn('k8s_cluster_name="prod-pine"', prod)
        self.assertIn('k8s_cluster_name="pepper"', eu)
        self.assertIn('k8s_container_name=~"skynet-gateway"', prod)

    def test_identifier_filters_use_json_pipeline_inside_cluster_selector(self) -> None:
        query = MODULE.build_query(
            self.config(
                "--cluster",
                "dev",
                "--service",
                "skynet-gateway",
                "--request-id",
                "req-1",
                "--level",
                "ERROR",
            )
        )
        self.assertTrue(query.startswith('{k8s_cluster_name="dev-deer"'))
        self.assertIn('| json ', query)
        self.assertIn('| __error__=""', query)
        self.assertIn('| request_id="req-1"', query)
        self.assertIn('| lvl=~"error|critical|50|60"', query)

    def test_action_id_is_a_raw_line_filter_for_gateway_logs(self) -> None:
        query = MODULE.build_query(self.config("--action-id", "act-123"))
        self.assertIn('|= "act-123"', query)
        self.assertNotIn("actionId=", query)

    def test_rejects_unsafe_service_regex(self) -> None:
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            with self.assertRaises(SystemExit):
                self.config("--service", 'skynet-gateway"; {k8s_cluster_name="tether"}')
        self.assertIn("service must be a safe Loki regex", stderr.getvalue())

    def test_missing_token_fails_closed_without_network_call(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            stderr = io.StringIO()
            with patch.dict(MODULE.os.environ, {}, clear=True):
                with patch.object(MODULE.Path, "home", return_value=Path(tmpdir)):
                    with patch.object(MODULE.urllib.request, "urlopen") as urlopen_mock:
                        with redirect_stderr(stderr):
                            code = MODULE.main(["--service", "skynet-gateway", "--window", "1h"])
            self.assertEqual(1, code)
            self.assertFalse(urlopen_mock.called)
        self.assertIn("No Grafana token found", stderr.getvalue())
        self.assertIn("no GCP Cloud Logging fallback", stderr.getvalue())

    def test_resolves_token_from_nested_claude_mcp_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            home = Path(tmpdir)
            (home / ".claude.json").write_text(
                json.dumps(
                    {
                        "projects": {
                            "/repo": {
                                "mcpServers": {
                                    "grafana": {
                                        "env": {"GRAFANA_SERVICE_ACCOUNT_TOKEN": "from-file"}
                                    }
                                }
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            token = MODULE.resolve_token(env={}, home=home)
        self.assertEqual("from-file", token)

    def test_http_auth_error_fails_closed(self) -> None:
        error = urllib.error.HTTPError(
            url="https://grafana.example.test",
            code=403,
            msg="Forbidden",
            hdrs={},
            fp=io.BytesIO(b"forbidden"),
        )
        with patch.dict(MODULE.os.environ, {"GRAFANA_SERVICE_ACCOUNT_TOKEN": "secret"}, clear=True):
            with patch.object(MODULE.urllib.request, "urlopen", side_effect=error):
                stderr = io.StringIO()
                with redirect_stderr(stderr):
                    code = MODULE.main(["--service", "skynet-gateway", "--window", "1h"])
        self.assertEqual(1, code)
        self.assertIn("HTTP 403 from Grafana", stderr.getvalue())
        self.assertIn("Do not fall back", stderr.getvalue())

    def test_writes_loki_output_and_prints_summary(self) -> None:
        payload = {
            "status": "success",
            "data": {
                "result": [
                    {
                        "stream": {
                            "k8s_cluster_name": "dev-deer",
                            "k8s_container_name": "skynet-gateway",
                        },
                        "values": [
                            [
                                "1781807046122000000",
                                json.dumps(
                                    {
                                        "level": 50,
                                        "msg": "gateway failed",
                                        "request_id": "req-1",
                                    }
                                ),
                            ]
                        ],
                    }
                ]
            },
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            output = Path(tmpdir) / "logs.json"
            stdout = io.StringIO()
            with patch.dict(MODULE.os.environ, {"GRAFANA_SERVICE_ACCOUNT_TOKEN": "secret"}, clear=True):
                with patch.object(MODULE.urllib.request, "urlopen", return_value=FakeResponse(payload)):
                    with redirect_stdout(stdout):
                        code = MODULE.main(
                            [
                                "--cluster",
                                "dev",
                                "--service",
                                "skynet-gateway",
                                "--output",
                                str(output),
                                "--limit",
                                "1",
                            ]
                        )
            self.assertEqual(0, code)
            written = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual("dev-deer", written["metadata"]["cluster"])
        self.assertIn('k8s_cluster_name="dev-deer"', written["query"])
        self.assertEqual(1, len(written["rows"]))
        summary = stdout.getvalue()
        self.assertIn("Loki log query summary", summary)
        self.assertIn("cluster: dev-deer", summary)
        self.assertIn("returned_lines: 1", summary)
        self.assertIn("skynet-gateway", summary)
        self.assertIn("gateway failed", summary)


if __name__ == "__main__":
    unittest.main()
