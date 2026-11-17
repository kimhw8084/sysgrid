"""Portable, offline hard-gate primitives for data truth and API contracts.

This module validates project-supplied contracts and observed evidence. It makes
no network calls, infers no schema, and never treats missing evidence as PASS.
"""
from __future__ import annotations

import json
from urllib.parse import parse_qsl, urlsplit
from .gate_ids import GATE_IDS

STATUSES = {"PASS", "FAIL", "BLOCKED", "NOT_RUN", "UNKNOWN"}
ENVELOPE_STATUSES = STATUSES | {"NOT_APPLICABLE", "WAIVED"}


def _result(status: str, *reasons: str) -> dict:
    if status not in STATUSES:
        raise ValueError(f"invalid gate status: {status}")
    return {"status": status, "reasons": list(reasons)}


def combine(*results: dict) -> dict:
    """PASS only when every applicable input is a current explicit PASS."""
    if not results:
        return _result("NOT_RUN", "no gate results supplied")
    states = [r.get("status") for r in results]
    if any(s not in STATUSES for s in states):
        return _result("BLOCKED", "a gate returned an invalid or absent state")
    for status in ("FAIL", "BLOCKED", "UNKNOWN", "NOT_RUN"):
        if status in states:
            return _result(status, *(reason for r in results for reason in r.get("reasons", [])))
    return _result("PASS")



def _is_sha256(value) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value.lower())


def to_envelope(result: dict, gate_id: str, applicability: dict,
                rule_ids: list[str], evidence: list[dict],
                source_binding: dict) -> dict:
    """Normalize a gate result to the coordinator envelope without promotion.

    PASS requires complete source binding and at least one reproducible evidence
    reference. NOT_APPLICABLE/WAIVED require explicit justification and authority.
    """
    status = result.get("status") if isinstance(result, dict) else None
    reasons = list(result.get("reasons", [])) if isinstance(result, dict) else []
    if status not in ENVELOPE_STATUSES:
        status, reasons = "BLOCKED", ["underlying result has an invalid or absent status"]
    if not isinstance(gate_id, str) or gate_id not in GATE_IDS or not isinstance(rule_ids, list) or not rule_ids or not all(isinstance(x, str) and x for x in rule_ids):
        status, reasons = "BLOCKED", ["canonical gate identity or rule binding is incomplete"]
    app_status = applicability.get("status") if isinstance(applicability, dict) else None
    if app_status not in {"APPLICABLE", "NOT_APPLICABLE"}:
        status, reasons = "BLOCKED", ["applicability is missing or unresolved"]
    elif app_status == "NOT_APPLICABLE":
        auth = applicability.get("authority")
        if not applicability.get("justification") or not isinstance(auth, dict) or not auth.get("reference"):
            status, reasons = "BLOCKED", ["NOT_APPLICABLE lacks justification or authority reference"]
        elif status != "NOT_APPLICABLE":
            status, reasons = "BLOCKED", ["NOT_APPLICABLE applicability cannot be reported as another gate state"]
    elif status == "NOT_APPLICABLE":
        status, reasons = "BLOCKED", ["NOT_APPLICABLE result lacks an explicit applicability decision"]
    binding_ok = False
    if isinstance(source_binding, dict):
        revision = source_binding.get("source_revision")
        catalog = source_binding.get("catalog")
        profile = source_binding.get("project_profile")
        environment = source_binding.get("environment")
        checker = source_binding.get("checker")
        binding_ok = (isinstance(revision, dict) and _is_sha256(revision.get("sha256"))
                      and isinstance(catalog, dict) and _is_sha256(catalog.get("sha256"))
                      and isinstance(profile, dict)
                      and ((profile.get("status") == "BOUND" and _is_sha256(profile.get("sha256")))
                           or (profile.get("status") == "NOT_APPLICABLE" and bool(profile.get("reason"))))
                      and isinstance(environment, dict) and bool(environment.get("mode"))
                      and isinstance(checker, dict) and _is_sha256(checker.get("sha256")))
    if not binding_ok and status == "PASS":
        status, reasons = "BLOCKED", ["source/catalog/profile/environment/checker binding is incomplete"]
    valid_evidence = []
    if isinstance(evidence, list):
        valid_evidence = [item for item in evidence if isinstance(item, dict)
                          and (bool(item.get("case_id")) or _is_sha256(item.get("sha256")))]
    if status == "PASS" and not valid_evidence:
        status, reasons = "BLOCKED", ["PASS has no reproducible case or source-bound evidence"]
    if status == "WAIVED":
        authority = result.get("authority") if isinstance(result, dict) else None
        if not isinstance(authority, dict) or not authority.get("reference") or not result.get("justification"):
            status, reasons = "BLOCKED", ["WAIVED lacks explicit authority and justification"]
    # Keep the integration boundary JSON-serializable even when an adapter
    # accidentally passes runtime objects (for example Path or set values).
    try:
        json.dumps({"applicability": applicability, "rule_ids": rule_ids,
                    "evidence": valid_evidence, "source_binding": source_binding},
                   allow_nan=False)
    except (TypeError, ValueError):
        status, reasons = "BLOCKED", ["envelope contains non-JSON evidence or bindings"]
        applicability, rule_ids, valid_evidence, source_binding = {"status": "UNKNOWN"}, [], [], {}
    findings = []
    if status == "PASS":
        findings.append({"id": "gate-passed", "status": "PASS",
                         "summary": "declared checks passed for the bound input", "evidence": valid_evidence})
    else:
        findings.extend({"id": f"finding-{i+1}", "status": status, "summary": str(reason)}
                        for i, reason in enumerate(reasons or ["gate did not produce a supported PASS"]))
    return {"schema": "golden-uiux.hard-gate-result.v1", "gate_id": gate_id,
            "status": status,
            "applicability": applicability if isinstance(applicability, dict) else {"status": "UNKNOWN"},
            "rule_ids": rule_ids if isinstance(rule_ids, list) else [],
            "findings": findings, "evidence": valid_evidence,
            "source_binding": source_binding if isinstance(source_binding, dict) else {}}


def _same_json_value(left, right) -> bool:
    # Python considers True == 1; JSON contract comparisons must preserve type.
    return type(left) is type(right) and left == right


def evaluate_data_truth(contract: dict | None, api_records, rendered_record,
                        identity: dict | None, selected_id=None) -> dict:
    """Compare one selected rendered record with its authoritative API row.

    Contract shape:
      {"entity": str, "primary_key": str, "rendered_id_field": str?,
       "expected_identity": {"requester": any},
       "record_scope": {"mode": "identity_bound", "bindings":
         [{"identity": str, "source": str}]} OR
         {"mode": "global", "justification": str},
       "fields": [{"source": str, "display": str, "required": bool?,
                   "redaction_allowed": bool?, "redacted_render_value": any?}]}
    Values are compared without returning values in diagnostic output.
    """
    if contract is None or not isinstance(contract, dict):
        return _result("BLOCKED", "data contract is missing or not an object")
    primary = contract.get("primary_key")
    fields = contract.get("fields")
    expected_identity = contract.get("expected_identity")
    if not isinstance(contract.get("entity"), str) or not contract["entity"].strip():
        return _result("BLOCKED", "contract entity is missing")
    if not isinstance(primary, str) or not primary or not isinstance(fields, list) or not fields:
        return _result("BLOCKED", "primary key or required field map is missing")
    if not isinstance(expected_identity, dict) or not expected_identity:
        return _result("BLOCKED", "expected synthetic identity and tenant are not bound")
    record_scope = contract.get("record_scope")
    if not isinstance(record_scope, dict):
        return _result("BLOCKED", "record scope binding is missing")
    scope_mode = record_scope.get("mode")
    if scope_mode == "identity_bound":
        bindings = record_scope.get("bindings")
        if (not isinstance(bindings, list) or not bindings
                or not all(isinstance(binding, dict)
                           and isinstance(binding.get("identity"), str) and binding["identity"]
                           and isinstance(binding.get("source"), str) and binding["source"]
                           and binding["identity"] in expected_identity
                           for binding in bindings)):
            return _result("BLOCKED", "record scope identity-to-source bindings are incomplete")
    elif scope_mode == "global":
        if not isinstance(record_scope.get("justification"), str) or not record_scope["justification"].strip():
            return _result("BLOCKED", "global record scope requires an explicit justification")
    else:
        return _result("BLOCKED", "record scope mode is missing or unsupported")
    if identity is None:
        return _result("NOT_RUN", "request identity evidence was not captured")
    for key, expected in expected_identity.items():
        if key not in identity:
            return _result("BLOCKED", f"identity evidence is missing {key}")
        if not _same_json_value(identity[key], expected):
            return _result("FAIL", f"request identity or tenant mismatch: {key}")
    if api_records is None or rendered_record is None:
        return _result("NOT_RUN", "authoritative API or rendered-record evidence is absent")
    if not isinstance(api_records, list) or not isinstance(rendered_record, dict):
        return _result("BLOCKED", "API rows or rendered record have an invalid shape")
    if selected_id is None:
        return _result("BLOCKED", "selected record identifier is not bound")
    if not all(isinstance(f, dict) and isinstance(f.get("source"), str)
               and f["source"] and isinstance(f.get("display"), str) and f["display"]
               and isinstance(f.get("required", True), bool)
               and isinstance(f.get("redaction_allowed", False), bool)
               for f in fields):
        return _result("BLOCKED", "field map contains an invalid source, display locator, or field policy")
    if not any(f.get("required", True) and f["source"] != primary for f in fields):
        return _result("BLOCKED", "field map has no required non-identifier display value")
    matches = [row for row in api_records if isinstance(row, dict)
               and _same_json_value(row.get(primary), selected_id)]
    if len(matches) != 1:
        return _result("FAIL", "selected identifier does not resolve to exactly one authoritative API row")
    source = matches[0]
    rendered_id_field = contract.get("rendered_id_field", primary)
    if rendered_id_field not in rendered_record:
        return _result("FAIL", "rendered selected-record identifier is missing")
    if not _same_json_value(rendered_record[rendered_id_field], selected_id):
        return _result("FAIL", "rendered record identifier differs from selected/API record")
    if scope_mode == "identity_bound":
        for binding in bindings:
            identity_key, source_key = binding["identity"], binding["source"]
            if source_key not in source:
                return _result("BLOCKED", f"record scope field is absent from authoritative row: {source_key}")
            if not _same_json_value(source[source_key], identity[identity_key]):
                return _result("FAIL", f"authoritative row is outside the bound identity scope: {identity_key}")
    for field in fields:
        source_key, display_key = field["source"], field["display"]
        required = field.get("required", True)
        if source_key not in source:
            if not required:
                continue
            return _result("FAIL", f"authoritative API row lacks mapped field {source_key}")
        if display_key not in rendered_record:
            if not required:
                continue
            return _result("FAIL", f"rendered record lacks required display {display_key}")
        source_value, rendered_value = source[source_key], rendered_record[display_key]
        if source_value is None and field.get("redaction_allowed"):
            if "redacted_render_value" not in field:
                return _result("BLOCKED", f"redaction allowed for {source_key} without an explicit rendering contract")
            if not _same_json_value(rendered_value, field["redacted_render_value"]):
                return _result("FAIL", f"redacted rendering mismatch for {display_key}")
            continue
        if not required and source_value is None:
            continue
        if not _same_json_value(source_value, rendered_value):
            return _result("FAIL", f"rendered value does not match selected API row: {display_key}")
    for rel in contract.get("relationships", []):
        if not isinstance(rel, dict) or not rel.get("source") or not rel.get("display"):
            return _result("BLOCKED", "relationship map is incomplete")
        if rel["source"] not in source or rel["display"] not in rendered_record:
            return _result("FAIL", "required relationship is absent from API or rendered record")
        if not _same_json_value(source[rel["source"]], rendered_record[rel["display"]]):
            return _result("FAIL", "rendered relationship does not match selected API row")
    return _result("PASS")


def _query_pairs(value) -> tuple[tuple[str, str], ...] | None:
    if value is None:
        return ()
    if isinstance(value, dict):
        pairs = []
        for key, item in value.items():
            if isinstance(item, (list, tuple)):
                pairs.extend((str(key), str(v)) for v in item)
            else:
                pairs.append((str(key), str(item)))
        return tuple(sorted(pairs))
    if isinstance(value, (list, tuple)):
        try:
            return tuple(sorted((str(k), str(v)) for k, v in value))
        except (TypeError, ValueError):
            return None
    return None


def _route_signature(route: dict) -> tuple | None:
    method, path = route.get("method"), route.get("path")
    query = _query_pairs(route.get("query"))
    scope = route.get("identity_scope")
    if not isinstance(scope, (list, tuple)) or not scope or not all(isinstance(x, str) and x for x in scope):
        return None
    if len(set(scope)) != len(scope):
        return None
    if not isinstance(method, str) or not method.strip():
        return None
    if not isinstance(path, str) or not path.startswith("/") or "?" in path or "#" in path:
        return None
    if query is None:
        return None
    return method.upper(), path, query, tuple(sorted(scope))


def _origin_signature(value) -> tuple | None:
    """Return a normalized HTTP(S) origin, rejecting paths and credentials."""
    if not isinstance(value, str):
        return None
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return None
    scheme = parsed.scheme.lower()
    host = parsed.hostname
    if (scheme not in {"http", "https"} or not host or parsed.username is not None
            or parsed.password is not None or parsed.path not in {"", "/"}
            or parsed.query or parsed.fragment):
        return None
    default_port = 443 if scheme == "https" else 80
    return scheme, host.lower(), port or default_port


def _schema_declaration_valid(schema: dict | None) -> bool:
    if not isinstance(schema, dict):
        return False
    kinds = {"object", "array", "string", "integer", "number", "boolean", "null"}
    if not isinstance(schema.get("kind"), str) or schema["kind"] not in kinds:
        return False
    if "nullable" in schema and not isinstance(schema["nullable"], bool):
        return False
    if "items_nullable" in schema and (schema["kind"] != "array" or not isinstance(schema["items_nullable"], bool)):
        return False
    for key in ("required_fields", "item_required_fields"):
        if key in schema and (not isinstance(schema[key], list) or not all(isinstance(x, str) and x for x in schema[key])):
            return False
    allowed_types = {"object", "array", "string", "integer", "number", "boolean", "null"}
    for key in ("field_types", "item_field_types"):
        mapping = schema.get(key, {})
        if not isinstance(mapping, dict) or not all(
                isinstance(k, str) and k and isinstance(v, str) and v in allowed_types
                for k, v in mapping.items()):
            return False
    nullability_fields = schema.get("field_nullability", {})
    nullability_items = schema.get("item_field_nullability", {})
    if (not isinstance(nullability_fields, dict)
            or not all(isinstance(k, str) and k and type(v) is bool for k, v in nullability_fields.items())
            or not isinstance(nullability_items, dict)
            or not all(isinstance(k, str) and k and type(v) is bool for k, v in nullability_items.items())):
        return False
    if not set(nullability_fields) <= set(schema.get("field_types", {})):
        return False
    if not set(nullability_items) <= set(schema.get("item_field_types", {})):
        return False
    if nullability_fields and schema["kind"] != "object":
        return False
    if nullability_items and (schema["kind"] != "array" or schema.get("items_kind") != "object"):
        return False
    if schema["kind"] == "object":
        constrained = bool(schema.get("required_fields") or schema.get("field_types"))
        if not constrained and schema.get("allow_empty_object") is not True:
            return False
        if schema.get("allow_empty_object") is True and constrained:
            return False
    if schema["kind"] == "array":
        item_kind = schema.get("items_kind")
        item_kinds = kinds - {"array"}
        if not isinstance(item_kind, str) or item_kind not in item_kinds:
            return False
        if item_kind == "object" and not (schema.get("item_required_fields") or schema.get("item_field_types")):
            return False
    return True


def _schema_matches(body, schema: dict | None) -> bool:
    if schema is None:
        return True
    if not isinstance(schema, dict):
        return False
    if body is None:
        return schema.get("nullable", False) is True
    kind = schema.get("kind", "any")
    kinds = {"any": object, "object": dict, "array": list, "string": str,
             "integer": int, "number": (int, float), "boolean": bool, "null": type(None)}
    expected = kinds.get(kind)
    if expected is None or not isinstance(body, expected):
        return False
    # Reject bool as number/integer despite Python's subclass relationship.
    if kind in {"integer", "number"} and isinstance(body, bool):
        return False
    if isinstance(body, dict):
        if schema.get("allow_empty_object") is True:
            return body == {}
        for key in schema.get("required_fields", []):
            if key not in body:
                return False
        for key, type_name in schema.get("field_types", {}).items():
            type_kind = kinds.get(type_name)
            if key not in body:
                return False
            if body[key] is None:
                if schema.get("field_nullability", {}).get(key, False) is True:
                    continue
                return False
            if type_kind is None or not isinstance(body[key], type_kind):
                return False
            if type_name in {"integer", "number"} and isinstance(body[key], bool):
                return False
    if isinstance(body, list):
        for row in body:
            if row is None:
                if schema.get("items_nullable", False) is True:
                    continue
                return False
            item_kind = schema.get("items_kind")
            if item_kind == "object":
                if not isinstance(row, dict):
                    return False
                if any(key not in row for key in schema.get("item_required_fields", [])):
                    return False
                for key, type_name in schema.get("item_field_types", {}).items():
                    type_kind = kinds.get(type_name)
                    if key not in row:
                        return False
                    if row[key] is None:
                        if schema.get("item_field_nullability", {}).get(key, False) is True:
                            continue
                        return False
                    if type_kind is None or not isinstance(row[key], type_kind):
                        return False
                    if type_name in {"integer", "number"} and isinstance(row[key], bool):
                        return False
            else:
                item_type = kinds.get(item_kind)
                if item_type is None or not isinstance(row, item_type):
                    return False
                if item_kind in {"integer", "number"} and isinstance(row, bool):
                    return False
    return True


def evaluate_api_contract(contract: dict | None, client_route: dict | None,
                          server_route: dict | None, observed: dict | None,
                          expected_identity: dict | None) -> dict:
    """Check exact client/server route agreement and one captured request/response.

    Route descriptor shape: {"method": "GET", "path": "/api/v1/items",
    "query": {"include_deleted": "true"}, "identity_scope": ["user", "tenant_id"]}. Observed evidence binds method,
    absolute/relative URL, status, user/tenant and parsed response body.
    """
    if not isinstance(contract, dict):
        return _result("BLOCKED", "API contract is missing")
    if not isinstance(client_route, dict) or not isinstance(server_route, dict):
        return _result("BLOCKED", "client or server route declaration is missing")
    expected = _route_signature(contract)
    client = _route_signature(client_route)
    server = _route_signature(server_route)
    if expected is None or client is None or server is None:
        return _result("BLOCKED", "route declaration is incomplete or malformed")
    expected_origin = _origin_signature(contract.get("origin"))
    client_origin = _origin_signature(client_route.get("origin"))
    if expected_origin is None or client_origin is None:
        return _result("BLOCKED", "exact API origin is missing or malformed")
    if client_origin != expected_origin:
        return _result("FAIL", "frontend client origin differs from the API contract")
    if client != expected:
        return _result("FAIL", "frontend client route differs from the approved API contract")
    if server != expected:
        return _result("FAIL", "backend route differs from the approved API contract")
    if not isinstance(expected_identity, dict) or not expected_identity:
        return _result("BLOCKED", "expected identity and tenant are not bound")
    if tuple(sorted(expected_identity)) != expected[3]:
        return _result("BLOCKED", "route identity_scope does not match the bound identity/tenant fields")
    statuses = contract.get("expected_statuses")
    if not isinstance(statuses, list) or not statuses or not all(type(code) is int and 100 <= code <= 599 for code in statuses):
        return _result("BLOCKED", "expected HTTP statuses are not explicitly and validly defined")
    schema = contract.get("response_schema")
    if not _schema_declaration_valid(schema):
        return _result("BLOCKED", "response schema is missing, too broad, or malformed")
    request_schema = contract.get("request_schema")
    if request_schema is not None and not _schema_declaration_valid(request_schema):
        return _result("BLOCKED", "request schema is missing, too broad, or malformed")
    if observed is None:
        return _result("NOT_RUN", "no browser/API request evidence was captured")
    if not isinstance(observed, dict):
        return _result("BLOCKED", "observed request evidence has an invalid shape")
    method, url = observed.get("method"), observed.get("url")
    if not isinstance(method, str) or not isinstance(url, str):
        return _result("BLOCKED", "observed method or URL is missing")
    try:
        split = urlsplit(url)
    except ValueError:
        return _result("FAIL", "observed request URL is invalid")
    observed_origin = _origin_signature(f"{split.scheme}://{split.netloc}")
    if observed_origin is None:
        return _result("FAIL", "observed request has no valid absolute HTTP(S) origin")
    if observed_origin != expected_origin:
        return _result("FAIL", "observed request origin differs from the API contract")
    if split.path != expected[1]:
        return _result("FAIL", "observed request path differs, including trailing-slash semantics")
    actual = (method.upper(), split.path, tuple(sorted(parse_qsl(split.query, keep_blank_values=True))))
    if actual != expected[:3]:
        return _result("FAIL", "observed method, path or query differs from the API contract")
    identity = observed.get("identity")
    if not isinstance(identity, dict):
        return _result("BLOCKED", "observed request identity is missing")
    for key, value in expected_identity.items():
        if key not in identity:
            return _result("BLOCKED", f"observed identity evidence is missing {key}")
        if not _same_json_value(identity[key], value):
            return _result("FAIL", f"observed user or tenant does not match: {key}")
    status = observed.get("status")
    if status is None:
        return _result("UNKNOWN", "request was observed but no HTTP response status was captured")
    if status not in statuses:
        return _result("FAIL", "observed HTTP status is outside the API contract")
    if request_schema is not None:
        if "request_json" not in observed and observed.get("request_body_captured") is not True:
            return _result("UNKNOWN", "request body required by the contract was not captured")
        request_body = observed.get("request_json")
        if not _schema_matches(request_body, request_schema):
            return _result("FAIL", "request body does not match the declared client contract")
    body = observed.get("response_json")
    if not _schema_matches(body, schema):
        return _result("FAIL", "response does not match the declared response schema")
    return _result("PASS")
