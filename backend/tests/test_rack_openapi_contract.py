"""Disposable in-process Rack API contract checks (no server socket or .env).

Run with the backend lock-compatible interpreter from an empty temporary cwd:
    python backend/tests/test_rack_openapi_contract.py

The test seeds only temporary SQLite databases and uses Starlette's in-process
ASGI client. It does not start lifespan, migrations, a listening service, or
access production resources.
"""
from __future__ import annotations

import json
import hashlib
import os
import sys
import tempfile
import unittest
from pathlib import Path


SCRATCH = Path(tempfile.mkdtemp(prefix="sysgrid-rack-contract-"))
CONFIG_DB = SCRATCH / "config.sqlite"
TENANT_DB = SCRATCH / "tenant.sqlite"
STORAGE = SCRATCH / "tenant-storage"
STORAGE.mkdir()
os.environ.update({
    "ENVIRONMENT": "test",
    "TESTING": "1",
    "IDENTITY_MODE": "trusted_proxy",
    "TRUSTED_PROXY_USER_HEADER": "X-Authenticated-User",
    "DATABASE_URL": f"sqlite+aiosqlite:///{TENANT_DB}",
    "CONFIG_DATABASE_URL": f"sqlite+aiosqlite:///{CONFIG_DB}",
    "TENANT_STORAGE_ROOT": str(STORAGE),
    "DEFAULT_USER_ID": "sysgrid.qualifier",
    "USER_ID": "sysgrid.qualifier",
    "DEFAULT_TENANT_NAME": "Golden G2 disposable tenant",
    "AUTO_ADMIN_USER_IDS": "",
    "CONTROL_PLANE_ADMIN_USER_IDS": "",
    "SYSTEM_ROOT_USER_IDS": "",
    "BACKEND_ENV_FILE_PATH": "",
    "FRONTEND_ENV_FILE_PATH": "",
    "ALLOWED_HOSTS": "localhost,127.0.0.1,testserver",
    "BACKEND_CORS_ORIGINS": "*",
    "PUBLIC_READONLY_ENABLED": "false",
    "CONTROL_PLANE_BOOTSTRAP_ENABLED": "false",
})
if ".env" in {entry.name for entry in SCRATCH.iterdir()}:
    raise RuntimeError("Disposable test cwd unexpectedly contains .env")
os.chdir(SCRATCH)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.main import app  # noqa: E402
from app.database_base import Base  # noqa: E402
from app.models.config import ConfigBase, Tenant, UserTenantAccess  # noqa: E402
from app.models.models import Device, DeviceLocation, Operator, Rack, Room, Site  # noqa: E402


class RackContractBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config_engine = create_engine(f"sqlite:///{CONFIG_DB}")
        ConfigBase.metadata.create_all(config_engine)
        with Session(config_engine) as session:
            tenant = Tenant(name="Golden G2 disposable tenant", db_url=f"sqlite+aiosqlite:///{TENANT_DB}", is_active=True)
            session.add(tenant)
            session.flush()
            session.add(UserTenantAccess(user_id="sysgrid.qualifier", tenant_id=tenant.id,
                                         role="ADMIN", is_selected=True))
            session.commit()
            cls.tenant_id = tenant.id
        config_engine.dispose()

        tenant_engine = create_engine(f"sqlite:///{TENANT_DB}")
        Base.metadata.create_all(tenant_engine, tables=[
            Site.__table__, Room.__table__, Rack.__table__, Device.__table__, DeviceLocation.__table__, Operator.__table__
        ])
        with Session(tenant_engine) as session:
            site = Site(name="G2 Synthetic Site", color="#345678")
            session.add(site)
            session.flush()
            room = Room(site_id=site.id, name="G2 Room")
            session.add(room)
            active = Rack(name="G2-RACK-A", aisle="A", row="01", room=room,
                          total_u_height=42, max_power_kw=8.0, pdu_a_name="PDU-A", pdu_b_name="PDU-B",
                          pdu_a_cap_kw=10.0, pdu_b_cap_kw=10.0, order_index=1, is_deleted=False)
            deleted = Rack(name="G2-RACK-DELETED", aisle="A", row="02", room=room,
                           total_u_height=42, max_power_kw=8.0, order_index=2, is_deleted=True)
            device = Device(name="G2-SYNTHETIC-DEVICE", status="Active", type="Physical", system="G2-SYSTEM",
                            owner="G2-QUALIFIER", power_typical_w=45.0, power_max_w=90.0,
                            is_reservation=False, reservation_info={"requester": "G2-QUALIFIER"}, depth="Full")
            location = DeviceLocation(device=device, rack=active, start_unit=10, size_u=2,
                                      orientation="Front", depth="Full")
            operator = Operator(external_id="sysgrid.qualifier", username="sysgrid.qualifier",
                                full_name="Golden G2 Synthetic", is_admin=True, custom_permissions={})
            session.add_all([active, deleted, location, operator])
            session.commit()
            cls.active_rack_id = active.id
            cls.device_id = device.id
        tenant_engine.dispose()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        # Database engines are created by the application dependency on demand.
        # Dispose the temporary tenant engine so files can be removed on platforms
        # that lock SQLite files while handles remain open.
        from app.database import engine_cache
        for engine in list(engine_cache.values()):
            engine.sync_engine.dispose()
        import shutil
        shutil.rmtree(SCRATCH, ignore_errors=True)

    def headers(self, user="sysgrid.qualifier", tenant_id=None):
        return {"X-Authenticated-User": user, "X-Tenant-Id": str(tenant_id or self.tenant_id)}

    def test_exact_route_returns_typed_tenant_scoped_collection(self):
        response = self.client.get("/api/v1/racks?include_deleted=true", headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        rows = response.json()
        self.assertEqual({row["name"] for row in rows}, {"G2-RACK-A", "G2-RACK-DELETED"})
        active = next(row for row in rows if row["id"] == self.active_rack_id)
        self.assertEqual(active["site_name"], "G2 Synthetic Site")
        self.assertEqual(len(active["device_locations"]), 1)
        mounted = active["device_locations"][0]
        self.assertEqual(mounted["device_id"], self.device_id)
        self.assertEqual(mounted["device"]["system"], "G2-SYSTEM")
        self.assertEqual(mounted["device"]["owner"], "G2-QUALIFIER")
        self.assertIsInstance(active["max_power_kw"], (int, float))
        self.assertIsInstance(active["is_deleted"], bool)
        self.assertEqual(set(active), {
            "id", "name", "aisle", "row", "total_u", "max_power_kw", "pdu_a_name", "pdu_b_name",
            "pdu_a_cap_kw", "pdu_b_cap_kw", "room_id", "site_id", "site_name", "site_color",
            "order_index", "is_deleted", "device_locations",
        })
        evidence_path = os.environ.get("SYSGRID_RACK_CONTRACT_EVIDENCE_PATH")
        if evidence_path:
            evidence = {
                "schema": "sysgrid.synthetic-asgi-observation.v1",
                "execution": "in-process ASGI transport; no listening service or network request",
                "method": "GET",
                "url": "http://127.0.0.1:8000/api/v1/racks?include_deleted=true",
                "status": response.status_code,
                "identity": {"user_id": "sysgrid.qualifier", "tenant_id": self.tenant_id},
                "response_json": rows,
                "response_sha256": hashlib.sha256(
                    json.dumps(rows, sort_keys=True, separators=(",", ":")).encode("utf-8")
                ).hexdigest(),
                "production_accessed": False,
                "credentials_recorded": False,
            }
            target = Path(evidence_path)
            target.write_text(json.dumps(evidence, sort_keys=True, indent=2) + "\n", encoding="utf-8")

    def test_missing_identity_is_401(self):
        response = self.client.get("/api/v1/racks?include_deleted=true", headers={"X-Tenant-Id": str(self.tenant_id)})
        self.assertEqual(response.status_code, 401, response.text)

    def test_identity_without_tenant_membership_is_403(self):
        response = self.client.get("/api/v1/racks?include_deleted=true", headers=self.headers("g2-no-membership"))
        self.assertEqual(response.status_code, 403, response.text)

    def test_unknown_tenant_is_404(self):
        response = self.client.get("/api/v1/racks?include_deleted=true", headers=self.headers(tenant_id=987654))
        self.assertEqual(response.status_code, 404, response.text)

    def test_invalid_query_is_422_and_slash_variant_is_not_redirected(self):
        invalid = self.client.get("/api/v1/racks?site_id=not-a-site", headers=self.headers())
        self.assertEqual(invalid.status_code, 422, invalid.text)
        slash = self.client.get("/api/v1/racks/?include_deleted=true", headers=self.headers(), follow_redirects=False)
        self.assertEqual(slash.status_code, 404, slash.text)

    def test_default_query_excludes_deleted_rows(self):
        response = self.client.get("/api/v1/racks", headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([row["name"] for row in response.json()], ["G2-RACK-A"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
