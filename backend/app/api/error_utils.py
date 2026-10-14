from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import TypeAdapter
from pydantic_core import ErrorType
from typing import get_args


_ERROR_TYPES = frozenset(get_args(ErrorType))
_MESSAGES = {
    "missing": "This field is required.",
    "extra_forbidden": "An undeclared field is not allowed.",
    "json_invalid": "The request must contain valid JSON.",
    "int_parsing": "Enter a valid integer.",
    "int_type": "Enter an integer.",
    "float_parsing": "Enter a valid number.",
    "float_type": "Enter a number.",
    "finite_number": "Enter a finite number.",
    "bool_parsing": "Enter a valid boolean.",
    "bool_type": "Enter a boolean.",
    "string_type": "Enter text.",
    "string_too_short": "Text is shorter than the allowed minimum.",
    "string_too_long": "Text exceeds the allowed maximum.",
    "string_pattern_mismatch": "Text does not match the required format.",
    "list_type": "Provide a list.",
    "dict_type": "Provide an object.",
    "greater_than": "The value must exceed the allowed minimum.",
    "greater_than_equal": "The value is below the allowed minimum.",
    "less_than": "The value must be below the allowed maximum.",
    "less_than_equal": "The value exceeds the allowed maximum.",
    "literal_error": "Select one of the supported values.",
    "enum": "Select one of the supported values.",
}


def _declared_names(request: Request) -> set[str]:
    # Error locations can contain user-supplied dictionary keys and extra
    # field names. Only names from the route's schemas may be echoed.
    names = {"body", "query", "path", "header", "cookie"}

    def collect_schema(schema):
        if isinstance(schema, dict):
            names.update(schema.get("properties", {}))
            for value in schema.values():
                collect_schema(value)
        elif isinstance(schema, list):
            for value in schema:
                collect_schema(value)

    pending = [getattr(request.scope.get("route"), "dependant", None)]
    while pending:
        dependant = pending.pop()
        if dependant is None:
            continue
        pending.extend(dependant.dependencies)
        for group in ("body_params", "query_params", "path_params", "header_params", "cookie_params"):
            for field in getattr(dependant, group, []):
                names.add(field.alias)
                try:
                    collect_schema(TypeAdapter(field.field_info.annotation).json_schema())
                except Exception:
                    # An unrepresentable schema must not fall back to raw data.
                    pass
    return names


def _public_error(error, declared_names):
    error_type = error.get("type")
    if error_type not in _ERROR_TYPES:
        error_type = "validation_error"
    return {
        "type": error_type,
        "loc": [part if (type(part) is int or isinstance(part, str) and part in declared_names) else "[entry]"
                for part in error.get("loc", ())[:16]],
        # Even custom validator messages, discriminator errors and ctx.error
        # may interpolate rejected credentials. Never serialize them or input.
        "msg": _MESSAGES.get(error_type, "Invalid value; review the specified fields and their constraints."),
    }


def standardize_validation_errors(app: FastAPI):
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        names = _declared_names(request)
        return JSONResponse(
            status_code=422,
            content={"detail": [_public_error(error, names) for error in exc.errors()[:50]], "message": "Validation Failed"},
            headers={"Cache-Control": "no-store"},
        )
