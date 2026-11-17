import copy
import unittest

from golden_uiux.backend_contracts import _resolve_schema, evaluate_backend_openapi_contract
from golden_uiux.data_api_gates import evaluate_api_contract


def openapi_fixture():
    contract = {
        "method": "GET", "path": "/api/v1/racks", "origin": "http://app.local",
        "query": {"include_deleted": "true"}, "identity_scope": ["user", "tenant_id"],
        "expected_statuses": [200],
        "response_schema": {"kind": "array", "items_kind": "object",
                            "item_required_fields": ["id", "name"],
                            "item_field_types": {"id": "integer", "name": "string"}},
    }
    client = {"method": "GET", "path": "/api/v1/racks", "origin": "http://app.local",
              "query": {"include_deleted": "true"}, "identity_scope": ["user", "tenant_id"]}
    response_schema = {"type": "array", "items": {"type": "object", "required": ["id", "name"],
                        "properties": {"id": {"type": "integer"}, "name": {"type": "string"}}}}
    operation = {
        "operationId": "listRacks",
        "parameters": [{"name": "include_deleted", "in": "query", "required": False,
                        "schema": {"type": "boolean", "default": False}}],
        "responses": {"200": {"description": "OK", "content": {"application/json": {"schema": response_schema}}}},
    }
    document = {
        "openapi": "3.1.0", "security": [{"BearerAuth": []}],
        "components": {"securitySchemes": {"BearerAuth": {"type": "http", "scheme": "bearer"}}},
        "paths": {"/api/v1/racks": {"get": operation}},
    }
    return contract, client, document


def schema_result(field_schema, expected_kind, *, expected_nullable=True, expected_required=True):
    contract, client, document = openapi_fixture()
    contract["response_schema"]["item_field_types"]["name"] = expected_kind
    contract["response_schema"]["item_field_nullability"] = {"name": expected_nullable}
    if not expected_required:
        contract["response_schema"]["item_required_fields"] = ["id"]
        document["paths"]["/api/v1/racks"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["items"]["required"] = ["id"]
    document["paths"]["/api/v1/racks"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["items"]["properties"]["name"] = field_schema
    return evaluate_backend_openapi_contract(contract, client, document)


class NullableOpenApiSchemaTests(unittest.TestCase):
    def test_nullable_string_number_integer_object_and_array_are_typed(self):
        cases = [
            ("string", {"type": "string", "minLength": 2, "maxLength": 64}),
            ("number", {"type": "number", "minimum": 0, "maximum": 500}),
            ("integer", {"type": "integer", "minimum": 0, "maximum": 42}),
            ("object", {"type": "object", "required": ["code"],
                         "properties": {"code": {"type": "string"}}}),
            ("array", {"type": "array", "items": {"type": "integer"}}),
        ]
        for kind, typed in cases:
            with self.subTest(kind=kind):
                self.assertEqual(schema_result({"anyOf": [typed, {"type": "null"}]}, kind)["status"], "PASS")

    def test_nullable_branches_accept_reversed_order(self):
        result = schema_result({"anyOf": [{"type": "null"}, {"type": "string", "maxLength": 40}]}, "string")
        self.assertEqual(result["status"], "PASS")

    def test_referenced_nullable_component_and_referenced_typed_branch_pass(self):
        contract, client, document = openapi_fixture()
        document["components"]["schemas"] = {
            "RackName": {"type": "string", "minLength": 2, "maxLength": 64},
            "NullableRackName": {"anyOf": [{"$ref": "#/components/schemas/RackName"}, {"type": "null"}]},
        }
        item = document["paths"]["/api/v1/racks"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["items"]
        item["properties"]["name"] = {"$ref": "#/components/schemas/NullableRackName"}
        contract["response_schema"]["item_field_nullability"] = {"name": True}
        self.assertEqual(evaluate_backend_openapi_contract(contract, client, document)["status"], "PASS")

    def test_nullable_resolution_retains_type_constraints_and_annotations(self):
        schema = {"anyOf": [{"type": "string", "minLength": 3, "maxLength": 32,
                             "pattern": "^[A-Z0-9-]+$"}, {"type": "null"}],
                  "title": "RackName"}
        resolved = _resolve_schema(schema, {"components": {"schemas": {}}})
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved["type"], "string")
        self.assertIs(resolved["nullable"], True)
        self.assertEqual((resolved["minLength"], resolved["maxLength"], resolved["pattern"]),
                         (3, 32, "^[A-Z0-9-]+$"))
        self.assertEqual(resolved["title"], "RackName")

    def test_nested_referenced_response_keeps_nullable_array_item_property(self):
        document = {"components": {"schemas": {
            "Rack": {"type": "object", "required": ["id", "slots"], "properties": {
                "id": {"type": "integer"}, "slots": {"type": "array", "items": {"$ref": "#/components/schemas/Slot"}}}},
            "Slot": {"type": "object", "required": ["position"], "properties": {
                "position": {"anyOf": [{"type": "integer", "minimum": 0}, {"type": "null"}]}}},
        }}}
        resolved = _resolve_schema({"type": "array", "items": {"$ref": "#/components/schemas/Rack"}}, document)
        position = resolved["items"]["properties"]["slots"]["items"]["properties"]["position"]
        self.assertEqual(position["type"], "integer")
        self.assertIs(position["nullable"], True)
        self.assertEqual(position["minimum"], 0)
        self.assertIn("position", resolved["items"]["properties"]["slots"]["items"]["required"])

    def test_required_nullable_field_remains_required(self):
        contract, client, document = openapi_fixture()
        item = document["paths"]["/api/v1/racks"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["items"]
        item["properties"]["name"] = {"anyOf": [{"type": "string"}, {"type": "null"}]}
        item["required"].remove("name")
        contract["response_schema"]["item_field_nullability"] = {"name": True}
        self.assertEqual(evaluate_backend_openapi_contract(contract, client, document)["status"], "FAIL")

    def test_optional_nullable_field_is_not_promoted_to_required(self):
        result = schema_result({"anyOf": [{"type": "string"}, {"type": "null"}]}, "string", expected_required=False)
        self.assertEqual(result["status"], "PASS")

    def test_incompatible_non_null_type_does_not_pass_nullable_union(self):
        result = schema_result({"anyOf": [{"type": "string"}, {"type": "null"}]}, "integer")
        self.assertEqual(result["status"], "FAIL")

    def test_nullable_expectation_mismatch_fails(self):
        self.assertEqual(schema_result({"anyOf": [{"type": "string"}, {"type": "null"}]},
                                       "string", expected_nullable=False)["status"], "FAIL")
        self.assertEqual(schema_result({"type": "string"}, "string", expected_nullable=True)["status"], "FAIL")

    def test_missing_typed_branch_and_ambiguous_compositions_block(self):
        invalid = [
            {"anyOf": [{"description": "missing type"}, {"type": "null"}]},
            {"anyOf": [{"type": "string"}, {"type": "integer"}, {"type": "null"}]},
            {"anyOf": [{"type": "string"}, {"type": "string"}]},
            {"oneOf": [{"type": "string"}, {"type": "null"}]},
            {"allOf": [{"type": "string"}, {"type": "null"}]},
            {"anyOf": [{"type": "string"}, {"type": "null"}], "minLength": 1},
        ]
        for schema in invalid:
            with self.subTest(schema=schema):
                self.assertEqual(schema_result(schema, "string")["status"], "BLOCKED")

    def test_data_api_gate_allows_only_explicitly_nullable_values(self):
        contract = {"method": "GET", "path": "/api/v1/racks", "origin": "http://app.local",
                    "query": {"include_deleted": "true"}, "identity_scope": ["user", "tenant_id"],
                    "expected_statuses": [200], "response_schema": {
                        "kind": "array", "items_kind": "object", "item_required_fields": ["id", "name"],
                        "item_field_types": {"id": "integer", "name": "string"},
                        "item_field_nullability": {"name": True}}}
        route = {"method": "GET", "path": "/api/v1/racks", "origin": "http://app.local",
                 "query": {"include_deleted": "true"}, "identity_scope": ["user", "tenant_id"]}
        identity = {"user": "sysgrid.qualifier", "tenant_id": 1}
        observed = {"method": "GET", "url": "http://app.local/api/v1/racks?include_deleted=true",
                    "status": 200, "identity": identity, "response_json": [{"id": 1, "name": None}]}
        self.assertEqual(evaluate_api_contract(contract, route, route, observed, identity)["status"], "PASS")
        no_null_permission = copy.deepcopy(contract)
        no_null_permission["response_schema"].pop("item_field_nullability")
        self.assertEqual(evaluate_api_contract(no_null_permission, route, route, observed, identity)["status"], "FAIL")
        missing_field = copy.deepcopy(observed)
        missing_field["response_json"] = [{"id": 1}]
        self.assertEqual(evaluate_api_contract(contract, route, route, missing_field, identity)["status"], "FAIL")

    def test_missing_tenant_evidence_blocks_and_authentication_remains_required(self):
        contract, client, document = openapi_fixture()
        document.pop("security")
        self.assertEqual(evaluate_backend_openapi_contract(contract, client, document)["status"], "FAIL")
        api_contract = {"method": "GET", "path": "/api/v1/racks", "origin": "http://app.local",
                        "query": {"include_deleted": "true"}, "identity_scope": ["user", "tenant_id"],
                        "expected_statuses": [200], "response_schema": {"kind": "array", "items_kind": "object",
                        "item_required_fields": ["id", "name"]}}
        route = {"method": "GET", "path": "/api/v1/racks", "origin": "http://app.local",
                 "query": {"include_deleted": "true"}, "identity_scope": ["user", "tenant_id"]}
        identity = {"user": "sysgrid.qualifier", "tenant_id": 1}
        observed = {"method": "GET", "url": "http://app.local/api/v1/racks?include_deleted=true", "status": 200,
                    "identity": {"user": "sysgrid.qualifier"}, "response_json": [{"id": 1, "name": "R1"}]}
        self.assertEqual(evaluate_api_contract(api_contract, route, route, observed, identity)["status"], "BLOCKED")


if __name__ == "__main__":
    unittest.main()
