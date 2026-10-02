"""Privacy-minimized request controls used by the PV1 application boundary.

The limiter is intentionally process-local. Deployments with more than one
worker should put the same policy at the gateway, but the application still
enforces a bounded fallback so an overloaded worker cannot silently allocate
unbounded request state. No request body, query value, document, financial
value, or architecture description is retained here.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from hashlib import sha256
from time import monotonic
from typing import Deque


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    retry_after_seconds: int = 0
    remaining: int = 0


class SlidingWindowRateLimiter:
    """Small bounded sliding-window limiter for mutating/expensive requests."""

    def __init__(self, *, limit: int = 600, window_seconds: int = 60, max_keys: int = 20_000):
        self.limit = max(1, int(limit))
        self.window_seconds = max(1, int(window_seconds))
        self.max_keys = max(100, int(max_keys))
        self._events: dict[str, Deque[float]] = {}

    def check(self, key: str, *, now: float | None = None) -> RateLimitDecision:
        current = monotonic() if now is None else float(now)
        bucket = self._events.get(key)
        if bucket is None:
            if len(self._events) >= self.max_keys:
                # Evict the oldest bucket. This bounds memory without making a
                # request that already has a bucket unexpectedly unauthorised.
                oldest_key = min(self._events, key=lambda item: self._events[item][0] if self._events[item] else current)
                self._events.pop(oldest_key, None)
            bucket = deque()
            self._events[key] = bucket
        cutoff = current - self.window_seconds
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= self.limit:
            retry_after = max(1, int(bucket[0] + self.window_seconds - current + 0.999))
            return RateLimitDecision(False, retry_after, 0)
        bucket.append(current)
        return RateLimitDecision(True, 0, max(0, self.limit - len(bucket)))

    def clear(self) -> None:
        self._events.clear()


def request_rate_limit_key(request, actor_id: str | None = None) -> str:
    """One budget per resolved principal, or transport peer when unauthenticated.

    The caller must resolve identity through the authentication contract. Do
    not let arbitrary headers, tenant hints, paths or verbs mint new budgets.
    Hash the identifier so the in-memory key does not retain its plaintext.
    """
    if actor_id:
        namespace, identity = "actor", actor_id
    else:
        namespace, identity = "peer", request.client.host if request.client else "unknown"
    return f"{namespace}:{sha256(identity.encode('utf-8')).hexdigest()}"


def safe_request_metric(*, request_id: str, method: str, path: str, status_code: int, duration_ms: float, workspace: str | None = None, command_id_present: bool = False, outcome: str | None = None, projection_lag_ms: float | None = None, schedule_calculation_version: str | None = None, schedule_calculation_duration_ms: float | None = None, schedule_cache_status: str | None = None, upload_scan_state: str | None = None, job_delivery_status: str | None = None) -> dict[str, object]:
    """Return only fields permitted in operational telemetry."""
    metric = {
        "request_id": request_id,
        "method": method.upper(),
        "path": path[:240],
        "status_code": int(status_code),
        "duration_ms": round(max(0.0, duration_ms), 2),
        "workspace": (workspace or "other")[:40],
        "command_id_present": bool(command_id_present),
        "outcome": (outcome or ("success" if status_code < 400 else "failure"))[:40],
    }
    if projection_lag_ms is not None:
        metric["projection_lag_ms"] = round(max(0.0, float(projection_lag_ms)), 2)
    if schedule_calculation_version:
        metric["schedule_calculation_version"] = str(schedule_calculation_version)[:80]
    if schedule_calculation_duration_ms is not None:
        metric["schedule_calculation_duration_ms"] = round(max(0.0, float(schedule_calculation_duration_ms)), 2)
    if schedule_cache_status in {"hit", "miss", "coalesced"}:
        metric["schedule_cache_status"] = schedule_cache_status
    if upload_scan_state:
        metric["upload_scan_state"] = str(upload_scan_state)[:40]
    if job_delivery_status:
        metric["job_delivery_status"] = str(job_delivery_status)[:40]
    return metric
