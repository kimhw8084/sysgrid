"""Backend-derived OpenAPI contract checks for the G2 request path.

The caller must provide OpenAPI bytes generated from the actual backend route
table/source. This parser is deliberately strict and dependency-free: unsupported
JSON Schema constructs return BLOCKED instead of being treated as equivalent.
"""
from __future__ import annotations

import math
import re
from typing import Any
from urllib.parse import urlsplit

from .data_api_gates import _origin_signature, _query_pairs, _schema_declaration_valid

_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}
_PATH_PARAM = re.compile(r"\{([^{}]+)\}")
_SCHEMA_TYPES = {"object", "array", "string", "integer", "number", "boolean", "null"}
_NON_NULL_SCHEMA_TYPES = _SCHEMA_TYPES - {"null"}
_ANNOTATION_KEYS = {
    "title", "description", "summary", "default", "example", "examples",
    "deprecated", "readOnly", "writeOnly", "externalDocs", "xml",
}


def _only_annotations(schema: dict) -> bool:
    return all(key in _ANNOTATION_KEYS or key.startswith("x-") for key in schema)


def _result(status: str, *reasons: str, **details: Any) -> dict:
    return {"status": status, "reasons": list(reasons), **details}


def _resolve_schema(schema: Any, document: dict, seen: frozenset[str] = frozenset()) -> dict | None:
    if not isinstance(schema, dict):
        return None
    ref = schema.get("$ref")
    if ref is not None:
        if (not isinstance(ref, str) or not ref.startswith("#/components/schemas/")
                or ref in seen or any(key in schema for key in ("anyOf", "oneOf", "allOf", "not"))):
            return None
        node: Any = document
        for part in ref[2:].split("/"):
            part = part.replace("~1", "/").replace("~0", "~")
            if not isinstance(node, dict) or part not in node:
                return None
            node = node[part]
        resolved = _resolve_schema(node, document, seen | {ref})
        siblings = {key: value for key, value in schema.items() if key != "$ref"}
        if resolved is None or not _only_annotations(siblings):
            return None
        return {**resolved, **siblings}
    if "anyOf" in schema:
        if any(key in schema for key in ("allOf", "oneOf", "not")):
            return None
        branches = schema.get("anyOf")
        siblings = {key: value for key, value in schema.items() if key != "anyOf"}
        if not isinstance(branches, list) or len(branches) != 2 or not _only_annotations(siblings):
            return None
        resolved_branches = [_resolve_schema(branch, document, seen) for branch in branches]
        if any(branch is None for branch in resolved_branches):
            return None
        null_branches = [branch for branch in resolved_branches if branch.get("type") == "null"
                         and branch.get("nullable", False) is False
                         and _only_annotations({key: value for key, value in branch.items() if key != "type"})]
        typed_branches = [branch for branch in resolved_branches if branch.get("type") in _NON_NULL_SCHEMA_TYPES
                          and branch.get("nullable", False) is False]
        if len(null_branches) != 1 or len(typed_branches) != 1:
            return None
        # This normalization is lossless for one typed branch plus an
        # unconstrained null branch. Keep branch constraints and nullability.
        result = dict(typed_branches[0])
        result["nullable"] = True
        result.update(siblings)
        return result
    if any(key in schema for key in ("allOf", "oneOf", "not")):
        return None
    if "nullable" in schema and not isinstance(schema["nullable"], bool):
        return None
    result = dict(schema)
    if "items" in result:
        result["items"] = _resolve_schema(result["items"], document, seen)
        if result["items"] is None:
            return None
    properties = result.get("properties")
    if properties is not None:
        if not isinstance(properties, dict):
            return None
        result["properties"] = {}
        for key, value in properties.items():
            resolved = _resolve_schema(value, document, seen)
            if resolved is None:
                return None
            result["properties"][key] = resolved
    for key in ("additionalProperties",):
        value = result.get(key)
        if isinstance(value, dict):
            resolved = _resolve_schema(value, document, seen)
            if resolved is None:
                return None
            result[key] = resolved
    pattern_properties = result.get("patternProperties")
    if pattern_properties is not None:
        if not isinstance(pattern_properties, dict):
            return None
        resolved_patterns = {}
        for key, value in pattern_properties.items():
            resolved = _resolve_schema(value, document, seen)
            if resolved is None:
                return None
            resolved_patterns[key] = resolved
        result["patternProperties"] = resolved_patterns
    prefix_items = result.get("prefixItems")
    if prefix_items is not None:
        if not isinstance(prefix_items, list):
            return None
        resolved_prefix = [_resolve_schema(value, document, seen) for value in prefix_items]
        if any(value is None for value in resolved_prefix):
            return None
        result["prefixItems"] = resolved_prefix
    return result


def _schema_matches_backend(actual: Any, expected: dict, document: dict) -> bool | None:
    resolved = _resolve_schema(actual, document)
    if resolved is None:
        return None
    kinds = {"object": "object", "array": "array", "string": "string",
             "integer": "integer", "number": "number", "boolean": "boolean", "null": "null"}
    kind = expected.get("kind")
    actual_kind = resolved.get("type")
    if actual_kind != kinds.get(kind):
        return False
    if resolved.get("nullable", False) is not expected.get("nullable", False):
        return False
    if kind == "object":
        required = resolved.get("required", [])
        props = resolved.get("properties", {})
        if not isinstance(required, list) or not isinstance(props, dict):
            return None
        if not set(expected.get("required_fields", [])) <= set(required):
            return False
        for name, expected_type in expected.get("field_types", {}).items():
            prop = props.get(name)
            if not isinstance(prop, dict):
                return False
            if (prop.get("type") != kinds[expected_type]
                    or prop.get("nullable", False) is not expected.get("field_nullability", {}).get(name, False)):
                return False
        return True
    if kind == "array":
        item = resolved.get("items")
        if not isinstance(item, dict):
            return None
        item_kind = expected.get("items_kind")
        if (item.get("type") != kinds[item_kind]
                or item.get("nullable", False) is not expected.get("items_nullable", False)):
            return False
        if item_kind == "object":
            required = item.get("required", [])
            props = item.get("properties", {})
            if not isinstance(required, list) or not isinstance(props, dict):
                return None
            if not set(expected.get("item_required_fields", [])) <= set(required):
                return False
            for name, expected_type in expected.get("item_field_types", {}).items():
                prop = props.get(name)
                if (not isinstance(prop, dict) or prop.get("type") != kinds[expected_type]
                        or prop.get("nullable", False) is not expected.get("item_field_nullability", {}).get(name, False)):
                    return False
        return True
    return True


def _params(document: dict, path_item: dict, operation: dict) -> tuple[dict, str | None]:
    merged: dict[tuple[str, str], dict] = {}
    for group in (path_item.get("parameters", []), operation.get("parameters", [])):
        if not isinstance(group, list):
            return {}, "OpenAPI parameters must be arrays"
        for param in group:
            if not isinstance(param, dict) or not isinstance(param.get("name"), str) or param.get("in") not in {"path", "query", "header", "cookie"}:
                return {}, "OpenAPI parameter declaration is malformed or unresolved"
            if "$ref" in param:
                return {}, "Referenced parameter objects are unsupported; expand them in the backend OpenAPI document"
            merged[(param["in"], param["name"])] = param
    return merged, None


def _query_value_matches(value: Any, parameter: dict) -> bool | None:
    schema = parameter.get("schema")
    if not isinstance(schema, dict) or "$ref" in schema or any(k in schema for k in ("oneOf", "anyOf", "allOf")):
        return None
    kind = schema.get("type")
    values = value if isinstance(value, (list, tuple)) else [value]
    if kind == "array":
        item_type = schema.get("items", {}).get("type") if isinstance(schema.get("items"), dict) else None
        if item_type not in {"string", "integer", "number", "boolean"}:
            return None
        kind = item_type
    elif len(values) != 1:
        return False
    for item in values:
        text = str(item).lower() if isinstance(item, bool) else str(item)
        if kind == "boolean" and text not in {"true", "false"}:
            return False
        if kind == "integer" and re.fullmatch(r"-?(?:0|[1-9][0-9]*)", text) is None:
            return False
        if kind == "number":
            try:
                if not math.isfinite(float(text)):
                    return False
            except (TypeError, ValueError, OverflowError):
                return False
        if kind == "string" and not isinstance(item, (str, bool, int, float)):
            return False
        if kind not in {"boolean", "integer", "number", "string"}:
            return None
        enum = schema.get("enum")
        if enum is not None and text not in {str(entry).lower() if isinstance(entry, bool) else str(entry) for entry in enum}:
            return False
    return True




def _backend_operation(document: dict, contract: dict) -> tuple[dict | None, dict | None, str | None, str | None, str | None]:
    paths = document.get("paths")
    if not isinstance(paths, dict):
        return None, None, None, "BLOCKED", "backend OpenAPI paths are missing or malformed"
    route_path = contract["path"]
    servers = document.get("servers")
    if servers is None:
        candidates = [(route_path, "SERVER_ORIGIN_NOT_DECLARED")]
    else:
        if not isinstance(servers, list) or not servers:
            return None, None, None, "BLOCKED", "backend OpenAPI servers are malformed"
        candidates = []
        expected_origin = _origin_signature(contract.get("origin")) if contract.get("origin") else None
        for server in servers:
            if not isinstance(server, dict) or not isinstance(server.get("url"), str) or "{" in server["url"] or "}" in server["url"]:
                return None, None, None, "BLOCKED", "backend OpenAPI server URL is malformed or templated"
            try:
                parsed = urlsplit(server["url"])
                parsed.port
            except ValueError:
                return None, None, None, "BLOCKED", "backend OpenAPI server URL is invalid"
            if parsed.query or parsed.fragment or parsed.username is not None or parsed.password is not None:
                return None, None, None, "BLOCKED", "backend OpenAPI server URL contains unsupported query, fragment, or credentials"
            origin_status = "RELATIVE_SERVER_SAME_ORIGIN"
            if parsed.scheme or parsed.netloc:
                server_origin = _origin_signature(f"{parsed.scheme}://{parsed.netloc}")
                if server_origin is None:
                    return None, None, None, "BLOCKED", "backend OpenAPI server origin is invalid"
                if expected_origin is not None and server_origin != expected_origin:
                    continue
                origin_status = "SERVER_ORIGIN_MATCHED"
            prefix = parsed.path.rstrip("/")
            if prefix and route_path.startswith(prefix + "/"):
                operation_path = route_path[len(prefix):]
            elif prefix and route_path == prefix:
                operation_path = "/"
            elif not prefix:
                operation_path = route_path
            else:
                continue
            candidates.append((operation_path, origin_status))
        if not candidates:
            return None, None, None, "FAIL", "backend server origin/base path does not match the frontend route contract"
    for operation_path, origin_status in candidates:
        path_item = paths.get(operation_path)
        if not isinstance(path_item, dict):
            continue
        operation = path_item.get(contract["method"].lower())
        if isinstance(operation, dict):
            return path_item, operation, operation_path, origin_status, None
    return None, None, None, "FAIL", "backend does not expose the exact method/path; trailing-slash variants are not equivalent"

def evaluate_backend_openapi_contract(contract: dict | None, client_route: dict | None,
                                      document: dict | None) -> dict:
    """Compare a client route to an exact route in backend-generated OpenAPI.

    The result includes a server route descriptor for the existing observed-request
    evaluator. It does not replace runtime request/identity/data evidence.
    """
    if not isinstance(contract, dict) or not isinstance(client_route, dict):
        return _result("BLOCKED", "contract and frontend route declarations are required")
    if not isinstance(document, dict) or not str(document.get("openapi", "")).startswith("3."):
        return _result("BLOCKED", "a backend-generated OpenAPI 3 document is required")
    method = contract.get("method")
    path = contract.get("path")
    if not isinstance(method, str) or method.lower() not in _METHODS or not isinstance(path, str) or not path.startswith("/") or "?" in path:
        return _result("BLOCKED", "contract method/path is malformed")
    client_method = client_route.get("method")
    if not isinstance(client_method, str) or client_method.upper() != method.upper() or client_route.get("path") != path:
        return _result("FAIL", "frontend method or exact path differs from the expected contract")
    path_item, operation, operation_path, server_origin_status, route_error = _backend_operation(document, contract)
    if path_item is None or operation is None:
        return _result(server_origin_status or "FAIL", route_error or "backend route does not match the exact contract")
    if contract.get("operation_id") is not None and operation.get("operationId") != contract["operation_id"]:
        return _result("FAIL", "backend operationId differs from the bound operation contract")
    parameters, error = _params(document, path_item, operation)
    if error:
        return _result("BLOCKED", error)
    expected_query = contract.get("query", {})
    client_query = client_route.get("query", {})
    expected_pairs = _query_pairs(expected_query)
    client_pairs = _query_pairs(client_query)
    if expected_pairs is None or client_pairs is None:
        return _result("BLOCKED", "expected or frontend query declaration is malformed")
    if expected_pairs != client_pairs:
        return _result("FAIL", "frontend query names or values differ from the frozen contract")
    query_names = {name for name, _ in expected_pairs}
    backend_query_names = {name for (where, name) in parameters if where == "query"}
    if query_names - backend_query_names:
        return _result("FAIL", "frontend query contains parameter(s) absent from the backend route")
    for (where, name), parameter in parameters.items():
        if where == "query" and parameter.get("required") is True and name not in query_names:
            return _result("FAIL", f"required backend query parameter is missing: {name}")
    for name in query_names:
        parameter = parameters.get(("query", name))
        if parameter is None:
            return _result("FAIL", f"backend query parameter is not declared: {name}")
        raw = expected_query.get(name) if isinstance(expected_query, dict) else None
        compatible = _query_value_matches(raw, parameter)
        if compatible is None:
            return _result("BLOCKED", f"backend query schema is unsupported or incomplete: {name}")
        if compatible is False:
            return _result("FAIL", f"frontend query value is incompatible with backend semantics: {name}")
    path_names = set(_PATH_PARAM.findall(path))
    backend_path_names = {name for (where, name) in parameters if where == "path"}
    if path_names != backend_path_names:
        return _result("FAIL", "backend path parameters do not match the exact route template")
    for name in path_names:
        if parameters[("path", name)].get("required") is not True:
            return _result("FAIL", f"backend path parameter is not required: {name}")
    identity_scope = contract.get("identity_scope")
    if not isinstance(identity_scope, list) or not identity_scope or not all(isinstance(x, str) and x for x in identity_scope):
        return _result("BLOCKED", "expected backend identity scope is missing")
    security = operation.get("security", document.get("security"))
    if not isinstance(security, list) or not security or any(not isinstance(item, dict) or not item for item in security):
        return _result("FAIL", "backend OpenAPI operation does not require an authentication scheme")
    extension = contract.get("identity_scope_extension")
    if extension is not None:
        if not isinstance(extension, str) or not extension.startswith("x-"):
            return _result("BLOCKED", "identity_scope_extension must name an OpenAPI x- extension")
        actual_scope = operation.get(extension)
        if not isinstance(actual_scope, list) or sorted(actual_scope) != sorted(identity_scope):
            return _result("FAIL", "backend identity-scope extension differs from the contract")
    statuses = contract.get("expected_statuses")
    responses = operation.get("responses")
    if (not isinstance(statuses, list) or not statuses or
            not all(type(code) is int and 100 <= code <= 599 for code in statuses) or
            not isinstance(responses, dict)):
        return _result("BLOCKED", "expected statuses or backend responses are missing or malformed")
    for status in statuses:
        code = str(status)
        if code not in responses and f"{code[0]}XX" not in responses and "default" not in responses:
            return _result("FAIL", f"backend does not document expected HTTP status {code}")
    response_schema = contract.get("response_schema")
    if not _schema_declaration_valid(response_schema):
        return _result("BLOCKED", "expected response schema is missing or too broad")
    success_status = next((str(code) for code in statuses if 200 <= code < 300), None)
    if success_status is None:
        return _result("BLOCKED", "contract has no successful response status to validate")
    response = responses.get(success_status) or responses.get(f"{success_status[0]}XX") or responses.get("default")
    content = response.get("content") if isinstance(response, dict) else None
    media = content.get("application/json") if isinstance(content, dict) else None
    actual_schema = media.get("schema") if isinstance(media, dict) else None
    if actual_schema is None:
        return _result("FAIL", "backend success response lacks a documented application/json schema")
    schema_match = _schema_matches_backend(actual_schema, response_schema, document)
    if schema_match is None:
        return _result("BLOCKED", "backend response schema uses unsupported or unresolved OpenAPI constructs")
    if not schema_match:
        return _result("FAIL", "backend success response schema does not satisfy the expected response contract")
    request_schema = contract.get("request_schema")
    if request_schema is not None:
        if not _schema_declaration_valid(request_schema):
            return _result("BLOCKED", "expected request schema is malformed")
        body = operation.get("requestBody")
        if not isinstance(body, dict):
            return _result("FAIL", "frontend requires a request body but backend route has none")
        request_content = body.get("content")
        request_media = request_content.get("application/json", {}) if isinstance(request_content, dict) else {}
        actual_request_schema = request_media.get("schema") if isinstance(request_media, dict) else None
        body_match = _schema_matches_backend(actual_request_schema, request_schema, document)
        if body_match is None:
            return _result("BLOCKED", "backend request schema uses unsupported or unresolved OpenAPI constructs")
        if not body_match:
            return _result("FAIL", "backend request schema does not satisfy the expected client contract")
    server_route = {"method": method.upper(), "path": path, "query": expected_query,
                    "identity_scope": identity_scope, "origin": contract.get("origin")}
    return _result("PASS", backend_route={"method": method.upper(), "path": path,
        "operation_id": operation.get("operationId"), "query_parameters": sorted(backend_query_names),
        "openapi_path": operation_path, "server_origin_status": server_origin_status,
        "path_parameters": sorted(path_names), "expected_statuses": statuses,
        "authentication_required": True, "response_schema_verified": True,
        "request_schema_verified": request_schema is not None,
        "identity_scope_status": "OPENAPI_EXTENSION_VERIFIED" if extension else "SEPARATELY_BOUND_NOT_INFERRED_FROM_OPENAPI"},
        server_route=server_route)
