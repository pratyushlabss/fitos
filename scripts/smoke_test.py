"""HTTP smoke test for the public, unauthenticated FITOS system surface."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request


def check(base_url: str, path: str, expected: set[int]) -> bool:
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(f"{base_url}{path}", timeout=5) as response:
            body = response.read()
            ok = response.status in expected
            print(f"{'PASS' if ok else 'FAIL'} {response.status} {path} {time.perf_counter() - started:.3f}s")
            if path.endswith("capabilities") and ok:
                json.loads(body)
            return ok
    except urllib.error.HTTPError as error:
        ok = error.code in expected
        print(f"{'PASS' if ok else 'FAIL'} {error.code} {path} {time.perf_counter() - started:.3f}s")
        return ok
    except (OSError, ValueError) as error:
        print(f"FAIL {path}: {error}")
        return False


def main() -> int:
    base_url = os.getenv("FITOS_BASE_URL", "http://localhost:8000")
    checks = [
        check(base_url, "/api/v1/health", {200}),
        check(base_url, "/api/v1/system/live", {200}),
        check(base_url, "/api/v1/system/ready", {200}),
        check(base_url, "/api/v1/system/capabilities", {200}),
        check(base_url, "/openapi.json", {200}),
        check(base_url, "/api/v1/workouts", {401}),
    ]
    print(f"{'PASS' if all(checks) else 'FAIL'} {sum(checks)}/{len(checks)} smoke checks")
    return 0 if all(checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())