#!/usr/bin/env python3
"""Check known active SysGrid UI requests against FastAPI source contracts.

This is a deterministic source check. It reads backend APIRouter declarations,
verifies their production mounting and rejects legacy URL variants in the
active UI files. It does not claim live-backend execution.
"""
from __future__ import annotations
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
from check_rack_api_contract import backend_routes, derive_api_prefix, redirects_disabled, verify_route_mounts

CONTRACTS = [
    ("asset registry including archived", "frontend/src/components/assets/assetGoldenData.ts", "'/api/v1/devices?include_deleted=true'", "devices", "GET", "", {"include_deleted"}),
    ("asset live fallback", "frontend/src/components/assets/assetGoldenData.ts", "'/api/v1/devices'", "devices", "GET", "", set()),
    ("asset linked services", "frontend/src/components/assets/AssetDetailsView.tsx", "`/api/v1/logical-services?device_id=${device.id}`", "logical_services", "GET", "", {"device_id"}),
    ("asset report linked services", "frontend/src/components/AssetGrid_Legacy.tsx", "`/api/v1/logical-services?device_id=${deviceId}`", "logical_services", "GET", "", {"device_id"}),
    ("monitoring linked services", "frontend/src/components/monitoring/MonitoringForm.tsx", "`/api/v1/logical-services?device_id=${formData.device_id}`", "logical_services", "GET", "", {"device_id"}),
    ("external linked assets", "frontend/src/components/External.tsx", "'/api/v1/devices'", "devices", "GET", "", set()),
    ("external linked services", "frontend/src/components/External.tsx", "`/api/v1/logical-services?device_id=${formData.device_id}`", "logical_services", "GET", "", {"device_id"}),
    ("external link create", "frontend/src/components/External.tsx", "'/api/v1/intelligence/links'", "intelligence", "POST", "/links", set()),
    ("vendor asset choices", "frontend/src/components/vendors/VendorGoldenOperationalWorkspace.tsx", "'/api/v1/devices'", "devices", "GET", "", set()),
    ("vendor create", "frontend/src/components/vendors/VendorGoldenOperationalWorkspace.tsx", "'/api/v1/vendors'", "vendors", "POST", "", set()),
    ("vendor contract create", "frontend/src/components/vendors/VendorGoldenOperationalWorkspace.tsx", "'/api/v1/vendors/contracts'", "vendors", "POST", "/contracts", set()),
    ("FAR linked knowledge", "frontend/src/components/FAR.tsx", "'/api/v1/knowledge?category=BKM'", "knowledge", "GET", "", {"category"}),
    ("FAR resolution knowledge", "frontend/src/components/shared/FARModals.tsx", "'/api/v1/knowledge?category=BKM'", "knowledge", "GET", "", {"category"}),
    ("asset monitoring records", "frontend/src/components/assets/AssetDetailsView.tsx", "`/api/v1/monitoring?device_id=${device.id}`", "monitoring", "GET", "", {"device_id"}),
    ("asset report monitoring records", "frontend/src/components/AssetGrid_Legacy.tsx", "`/api/v1/monitoring?device_id=${deviceId}`", "monitoring", "GET", "", {"device_id"}),
    ("FAR linked monitoring", "frontend/src/components/FAR.tsx", "'/api/v1/monitoring'", "monitoring", "GET", "", set()),
    ("service registry include archived", "frontend/src/components/ServiceRegistry.tsx", '"/api/v1/logical-services?include_deleted=true"', "logical_services", "GET", "", {"include_deleted"}),
    ("active services registry include archived", "frontend/src/components/ServicesReal.tsx", "'/api/v1/logical-services?include_deleted=true'", "logical_services", "GET", "", {"include_deleted"}),
    ("active services asset choices", "frontend/src/components/ServicesReal.tsx", "'/api/v1/devices'", "devices", "GET", "", set()),
    ("active service create", "frontend/src/components/ServicesReal.tsx", "'/api/v1/logical-services'", "logical_services", "POST", "", set()),
    ("active monitoring knowledge picker", "frontend/src/components/monitoring/MonitoringForm.tsx", "`/api/v1/knowledge?embedded_consumer=monitoring&monitoring_id=${item!.id}`", "knowledge", "GET", "", {"embedded_consumer", "monitoring_id"}),
    ("active monitoring create", "frontend/src/components/monitoring/MonitoringForm.tsx", "'/api/v1/monitoring'", "monitoring", "POST", "", set()),
    ("service registry asset choices", "frontend/src/components/ServiceRegistry.tsx", '"/api/v1/devices"', "devices", "GET", "", set()),
    ("service create", "frontend/src/components/ServiceRegistry.tsx", '"/api/v1/logical-services"', "logical_services", "POST", "", set()),
    ("rack reorder", "frontend/src/components/Racks.tsx", "apiFetch('/api/v1/racks/reorder', { method: 'POST'", "racks", "POST", "/reorder", set()),
    ("network activity", "frontend/src/components/network/NetworkActivityModal.tsx", "`/api/v1/audit?${query.toString()}`", "audit", "GET", "", {"target_table", "target_id", "limit", "offset"}),
]

FORBIDDEN = [
    ("frontend/src/components/assets/assetGoldenData.ts", "/api/v1/devices/?include_deleted=true"),
    ("frontend/src/components/assets/assetGoldenData.ts", "'/api/v1/devices/'"),
    ("frontend/src/components/assets/AssetDetailsView.tsx", "/api/v1/logical-services/?device_id="),
    ("frontend/src/components/AssetGrid_Legacy.tsx", "/api/v1/logical-services/?device_id="),
    ("frontend/src/components/monitoring/MonitoringForm.tsx", "/api/v1/logical-services/?device_id="),
    ("frontend/src/components/External.tsx", "/api/v1/devices/'"),
    ("frontend/src/components/External.tsx", "/api/v1/logical-services/?device_id="),
    ("frontend/src/components/ServiceRegistry.tsx", "/api/v1/logical-services/?include_deleted=true"),
    ("frontend/src/components/ServiceRegistry.tsx", '"/api/v1/logical-services/"'),
    ("frontend/src/components/ServiceRegistry.tsx", '"/api/v1/devices/"'),
    ("frontend/src/components/ServicesReal.tsx", "/api/v1/logical-services/?include_deleted=true"),
    ("frontend/src/components/ServicesReal.tsx", "/api/v1/devices/'"),
    ("frontend/src/components/ServicesReal.tsx", "/api/v1/logical-services/'"),
    ("frontend/src/components/External.tsx", "/api/v1/intelligence/links/'"),
    ("frontend/src/components/vendors/VendorGoldenOperationalWorkspace.tsx", "/api/v1/devices/'"),
    ("frontend/src/components/vendors/VendorGoldenOperationalWorkspace.tsx", "/api/v1/vendors/'"),
    ("frontend/src/components/vendors/VendorGoldenOperationalWorkspace.tsx", "/api/v1/vendors/contracts/`"),
    ("frontend/src/components/FAR.tsx", "/api/v1/knowledge/?category=BKM"),
    ("frontend/src/components/FAR.tsx", "/api/v1/monitoring/"),
    ("frontend/src/components/shared/FARModals.tsx", "/api/v1/knowledge/?category=BKM"),
    ("frontend/src/components/assets/AssetDetailsView.tsx", "/api/v1/monitoring/?device_id="),
    ("frontend/src/components/AssetGrid_Legacy.tsx", "/api/v1/monitoring/?device_id="),
    ("frontend/src/components/monitoring/MonitoringForm.tsx", "/api/v1/knowledge/?embedded_consumer=monitoring"),
    ("frontend/src/components/monitoring/MonitoringForm.tsx", "'/api/v1/monitoring/'"),
    ("frontend/src/components/NetworkReal.tsx", "/api/v1/networks/connections/${item.id}/history"),
    ("frontend/src/components/NetworkReal.tsx", "/api/v1/networks/connections/${item.id}/restore/"),
    ("frontend/src/components/Racks.tsx", "/api/v1/sites/${siteId}/racks/reorder"),
]


def main() -> int:
    api = derive_api_prefix().rstrip("/")
    if api != "/api/v1":
        raise AssertionError(f"Unexpected API prefix {api!r}")
    if not redirects_disabled():
        raise AssertionError("Expected strict slash behavior is not configured; negative slash checks are no longer valid")

    backend_cache: dict[str, tuple[str, dict[str, set[str]]]] = {}
    required_modules = {contract[3] for contract in CONTRACTS}
    verify_route_mounts(required_modules)
    for _, _, _, module, _, _, _ in CONTRACTS:
        if module not in backend_cache:
            backend_cache[module] = backend_routes(module)

    for label, relative_file, needle, module, method, suffix, query_keys in CONTRACTS:
        source_path = ROOT / relative_file
        source = source_path.read_text(encoding="utf-8")
        if needle not in source:
            raise AssertionError(f"{label}: active frontend request missing from {relative_file}: {needle}")
        prefix, routes = backend_cache[module]
        route_path = prefix.rstrip("/") + suffix if suffix else prefix.rstrip("/") or "/"
        if suffix == "":
            route_path = prefix.rstrip("/") or "/"
        if suffix not in routes.get(method, set()):
            raise AssertionError(f"{label}: backend does not define {method} {prefix}{suffix}")
        request_path = urlsplit(needle.strip("'\"`"))
        if "${query.toString()}" in needle:
            missing = {key for key in query_keys if f"{key}:" not in source}
            if missing:
                raise AssertionError(f"{label}: URLSearchParams is missing fields: {sorted(missing)}")
        elif "?" in needle:
            present = {key for key, _ in parse_qsl(request_path.query)}
            if not query_keys.issubset(present):
                raise AssertionError(f"{label}: required query fields are missing: {sorted(query_keys - present)}")
        print(f"PASS {label}: {method} {api}{route_path} derives from backend/{module}.py")

    for relative_file, forbidden in FORBIDDEN:
        if forbidden in (ROOT / relative_file).read_text(encoding="utf-8"):
            raise AssertionError(f"Unsupported frontend route remains in {relative_file}: {forbidden}")
    print(f"PASS {len(FORBIDDEN)} known invalid active-route variants absent; trailing slash is not redirected")
    print("Evidence: source-derived frontend/backend contract only; live endpoint behavior is reported separately.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
