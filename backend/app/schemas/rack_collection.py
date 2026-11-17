"""Response contracts for the Rack collection endpoint.

These models describe the exact enriched objects emitted by
``GET /api/v1/racks``. The endpoint uses them for OpenAPI documentation only;
the response body is still built by the existing route implementation.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict


class RackCollectionDevice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    name: str | None
    status: str | None
    type: str | None
    system: str | None
    owner: str | None
    power_typical_w: float
    power_max_w: float
    is_reservation: bool
    reservation_info: dict[str, Any]
    depth: str


class RackCollectionDeviceLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    device_id: int
    rack_id: int
    start_unit: int | None
    size_u: int | None
    orientation: str
    depth: str
    device: RackCollectionDevice


class RackCollectionItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    name: str | None
    aisle: str | None
    row: str | None
    total_u: int | None
    max_power_kw: float
    pdu_a_name: str | None
    pdu_b_name: str | None
    pdu_a_cap_kw: float | None
    pdu_b_cap_kw: float | None
    room_id: int | None
    site_id: int | None
    site_name: str | None
    site_color: str | None
    order_index: int | None
    is_deleted: bool | None
    device_locations: list[RackCollectionDeviceLocation]


class RackModuleAccessError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    module_id: str
    operation: str
    stage: str | None
    reason: str
    message: str


class RackValidationIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str
    loc: list[str | int]
    msg: str


class RackApiErrorResponse(BaseModel):
    """Documented error shapes returned by auth, tenant and query handling."""

    detail: str | RackModuleAccessError | list[RackValidationIssue]
    message: str | None = None
