"""State-continuity evaluator for keyboard navigation such as skip links.

This checks supplied browser/application observations; it is not a browser driver
or an authentic collector. Missing observations never pass.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

_SHA = re.compile(r"^[0-9a-f]{64}$")


def evaluate_navigation_continuity(record: Any) -> dict:
    if not isinstance(record, dict) or record.get("executed") is not True:
        return {"status": "NOT_RUN", "reasons": ["navigation state-continuity observation was not executed"]}
    if record.get("transition") != "skip-link" or record.get("native_keyboard") is not True:
        return {"status": "UNKNOWN", "reasons": ["transition is not a verified native-keyboard skip-link action"]}
    required = record.get("preserve_keys")
    before, after = record.get("before_state"), record.get("after_state")
    if not isinstance(required, list) or not required or any(not isinstance(k, str) or not k for k in required) or len(set(required)) != len(required):
        return {"status": "NOT_RUN", "reasons": ["required application-state continuity keys are not declared"]}
    if not isinstance(before, dict) or not isinstance(after, dict):
        return {"status": "NOT_RUN", "reasons": ["before/after state observations are missing"]}
    binding = record.get("source_binding")
    if not isinstance(binding, dict):
        return {"status": "BLOCKED", "reasons": ["source/profile/environment/checker binding is incomplete"]}
    full_binding = (isinstance(binding.get("source_tree_digest"), str) and len(binding["source_tree_digest"]) == 64
                    and isinstance(binding.get("profile_digest"), str) and len(binding["profile_digest"]) == 64
                    and isinstance(binding.get("environment"), dict) and isinstance(binding.get("checker_version"), str))
    compact_binding = all(isinstance(binding.get(k), str) and binding[k] for k in ("source_tree_sha256", "profile_sha256", "environment_sha256", "test_selector", "checker_version"))
    if not (full_binding or compact_binding):
        return {"status": "BLOCKED", "reasons": ["source/profile/environment/checker binding is incomplete"]}
    digest = record.get("state_capture_digest")
    if not isinstance(digest, str) or not _SHA.fullmatch(digest):
        return {"status": "UNKNOWN", "reasons": ["state-continuity capture is not hash-addressed"]}
    missing = [key for key in required if key not in before or key not in after]
    if missing:
        return {"status": "UNKNOWN", "reasons": [f"state values were not observed on both sides: {missing!r}"]}
    try:
        before_values = {key: json.dumps(before[key], sort_keys=True, separators=(",", ":"), allow_nan=False) for key in required}
        after_values = {key: json.dumps(after[key], sort_keys=True, separators=(",", ":"), allow_nan=False) for key in required}
    except (TypeError, ValueError):
        return {"status": "UNKNOWN", "reasons": ["state observation contains values outside JSON semantics"]}
    changed = [key for key in required if before_values[key] != after_values[key]]
    if changed:
        return {"status": "FAIL", "reasons": [f"skip-link navigation discarded or changed preserved application state: {changed!r}"],
                "evidence": {"changed_keys": changed}}
    return {"status": "PASS", "reasons": [], "evidence": {"preserved_keys": required, "state_capture_digest": digest,
            "state_fingerprint_sha256": hashlib.sha256(json.dumps(before_values, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}}
