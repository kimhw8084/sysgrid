"""
Ultimate SysGrid Seeder (Refined & Perfected)

This script handles:
1. System Bootstrapping: config.db, tenant registration, and admin creation.
2. Domain Data Seeding: A high-fidelity production environment for UI testing.

Usage:
  ./backend/venv/bin/python seed.py --tenant-name "Local Demo" --seed-data
"""

from __future__ import annotations
import argparse
import os
import subprocess
import sys
import asyncio
import random
from starlette.requests import Request
from starlette.datastructures import State
from collections import defaultdict
from pathlib import Path
from datetime import datetime, timedelta

from sqlalchemy import create_engine, select, delete, text, func
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

# Setup paths
ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import settings
from app.models.config import ConfigBase, MasterSystemSetting, Tenant, UserTenantAccess, GlobalSetting
from app.models import models
from app.models.models import Base, Operator, Role
from app.schemas import schemas

# --- UTILITIES ---

def to_sync_sqlite_url(db_url: str) -> str:
    return db_url.replace("sqlite+aiosqlite", "sqlite")

def normalize_db_path(db_path: str) -> Path:
    path = Path(db_path).expanduser()
    if not path.is_absolute():
        path = (BACKEND_DIR / path).resolve()
    return path

def sqlite_async_url_from_path(db_path: Path) -> str:
    return f"sqlite+aiosqlite:///{db_path}"

def run_tenant_migrations(db_url: str) -> None:
    print(f"Running migrations for {db_url}...")
    env = os.environ.copy()
    env["SQLALCHEMY_DATABASE_URL"] = db_url
    result = subprocess.run(
        [sys.executable, str(ROOT_DIR / "scripts" / "run-alembic.py"), "upgrade", "head"],
        cwd=str(BACKEND_DIR),
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Migration Error: {result.stderr.strip()}")


def ensure_seed_schema_compatibility(db_url: str) -> None:
    engine = create_engine(to_sync_sqlite_url(db_url), future=True)
    compatibility_columns = {
        "far_failure_modes": {
            "version": "INTEGER DEFAULT 1",
        },
        "far_resolutions": {
            "guidance_notes": "TEXT",
        },
        "rca_records": {
            "version": "INTEGER DEFAULT 1",
        },
    }
    with engine.begin() as conn:
        for table_name, columns in compatibility_columns.items():
            existing = {
                row[1]
                for row in conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
            }
            for column_name, column_ddl in columns.items():
                if column_name not in existing:
                    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_ddl}"))

# --- BOOTSTRAP LOGIC ---

def ensure_config_schema() -> None:
    engine = create_engine(to_sync_sqlite_url(settings.CONFIG_DATABASE_URL), future=True)
    ConfigBase.metadata.create_all(engine)
    with Session(engine) as session:
        # 1. Tenant Storage Root
        storage_root = session.execute(
            select(MasterSystemSetting).where(MasterSystemSetting.key == "tenant_storage_root")
        ).scalar_one_or_none()
        if not storage_root:
            session.add(MasterSystemSetting(
                key="tenant_storage_root",
                value=str(BACKEND_DIR / "tenants"),
                description="Parent folder where tenant DBs are created",
            ))
        
        # 2. Global UI Settings
        default_settings = [
            ("app_name", settings.DEFAULT_APP_NAME, "Infrastructure", "Main application title", True),
            ("org_name", settings.DEFAULT_ORG_NAME, "Infrastructure", "Organization name", True),
            ("ui_title", settings.DEFAULT_UI_TITLE, "UI", "Browser tab title", True),
            ("feature_guided_bkm", "true", "Experimental", "Enable Directive [06] logic", False),
        ]
        
        # 3. Monitoring Options
        monitoring_options = [
            ("MonitoringPlatform", "Zabbix", "Monitoring system platform", False),
            ("MonitoringPlatform", "Prometheus", "Monitoring system platform", False),
            ("MonitoringPlatform", "Datadog", "Monitoring system platform", False),
            ("MonitoringCategory", "Hardware", "Monitoring category", False),
            ("MonitoringCategory", "Application", "Monitoring category", False),
            ("MonitoringCategory", "Network", "Monitoring category", False),
            ("MonitoringCategory", "Synthetic", "Monitoring category", False),
            ("NotificationMethod", "Email", "Notification delivery method", False),
            ("NotificationMethod", "Slack", "Notification delivery method", False),
            ("NotificationMethod", "PagerDuty", "Notification delivery method", False),
            ("LinkPurpose", "Data", "Network link purpose", False),
            ("LinkPurpose", "Management", "Network link purpose", False),
            ("LinkPurpose", "Storage", "Network link purpose", False),
            ("LinkPurpose", "Backup", "Network link purpose", False),
            ("LinkPurpose", "Control", "Network link purpose", False),
            ("LinkPurpose", "Voice", "Network link purpose", False),
            ("NetworkFarm", "Prod", "Network farm", False),
            ("NetworkFarm", "Stage", "Network farm", False),
            ("NetworkFarm", "Lab", "Network farm", False),
            ("NetworkCableType", "Fiber", "Network cable type", False),
            ("NetworkCableType", "Copper", "Network cable type", False),
            ("NetworkCableType", "DAC", "Network cable type", False),
            ("NetworkCableType", "AOC", "Network cable type", False),
        ]
        
        for key, val, cat, desc, public in default_settings:
            existing = session.execute(select(GlobalSetting).where(GlobalSetting.key == key)).scalar_one_or_none()
            if not existing:
                session.add(GlobalSetting(key=key, value=val, category=cat, description=desc, is_public=public))
        
        for cat, val, desc, public in monitoring_options:
            # For settings that have multiple options, the key needs to be unique.
            # Using category + val as unique key might work if they don't overlap,
            # but maybe a different key approach is needed.
            # Let's check how they are fetched.
            # The API returns options, so probably GlobalSetting.key isn't just the platform name.
            # I will use a composite key for now.
            key = f"option_{cat}_{val}"
            existing = session.execute(select(GlobalSetting).where(GlobalSetting.key == key)).scalar_one_or_none()
            if not existing:
                session.add(GlobalSetting(key=key, value=val, category=cat, description=desc, is_public=public))

        session.commit()

def register_tenant_and_access(*, tenant_name: str, tenant_db_url: str, admin_user: str, select_for_user: bool) -> None:
    engine = create_engine(to_sync_sqlite_url(settings.CONFIG_DATABASE_URL), future=True)
    with Session(engine) as session:
        tenant = session.execute(select(Tenant).where(Tenant.name == tenant_name)).scalar_one_or_none()
        if tenant:
            tenant.db_url = tenant_db_url
            tenant.is_active = True
        else:
            tenant = Tenant(name=tenant_name, db_url=tenant_db_url, is_active=True)
            session.add(tenant)
            session.flush()

        access = session.execute(
            select(UserTenantAccess).where(
                UserTenantAccess.user_id == admin_user,
                UserTenantAccess.tenant_id == tenant.id,
            )
        ).scalar_one_or_none()
        if not access:
            access = UserTenantAccess(user_id=admin_user, tenant_id=tenant.id, role="ADMIN", is_selected=False)
            session.add(access)

        if select_for_user:
            # Deselect others for this user
            session.execute(
                UserTenantAccess.__table__.update()
                .where(UserTenantAccess.user_id == admin_user)
                .values(is_selected=False)
            )
            access.is_selected = True

        session.commit()


def ensure_additional_admin_access(*, tenant_name: str, tenant_db_url: str, admin_users: list[str]) -> None:
    for user_id in admin_users:
        cleaned = (user_id or "").strip()
        if not cleaned:
            continue
        register_tenant_and_access(
            tenant_name=tenant_name,
            tenant_db_url=tenant_db_url,
            admin_user=cleaned,
            select_for_user=True,
        )

async def ensure_tenant_admin_async(*, tenant_db_url: str, admin_user: str, full_name: str | None, email: str | None, department: str | None) -> None:
    engine = create_async_engine(tenant_db_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        res_role = await session.execute(select(Role).where(Role.name == "Admin"))
        admin_role = res_role.scalar_one_or_none()
        if not admin_role:
            admin_role = Role(name="Admin", permissions={"all": 3})
            session.add(admin_role)
            await session.flush()

        res_op = await session.execute(select(Operator).where(Operator.username == admin_user))
        operator = res_op.scalar_one_or_none()
        
        derived_full_name = full_name or admin_user.replace(".", " ").replace("_", " ").title()
        derived_email = email or f"{admin_user}@{settings.DEFAULT_EMAIL_DOMAIN}"
        
        if operator:
            operator.full_name = derived_full_name
            operator.email = derived_email
            operator.department = department
            operator.role_id = admin_role.id
            operator.is_admin = True
        else:
            session.add(Operator(
                external_id=admin_user,
                username=admin_user,
                full_name=derived_full_name,
                email=derived_email,
                department=department,
                role_id=admin_role.id,
                is_admin=True,
                registration_status="Verified"
            ))
        await session.commit()
    await engine.dispose()


async def ensure_additional_admins_async(*, tenant_db_url: str, admin_users: list[str], department: str | None) -> None:
    for user_id in admin_users:
        cleaned = (user_id or "").strip()
        if not cleaned:
            continue
        await ensure_tenant_admin_async(
            tenant_db_url=tenant_db_url,
            admin_user=cleaned,
            full_name=cleaned.replace(".", " ").replace("_", " ").title(),
            email=f"{cleaned}@{settings.DEFAULT_EMAIL_DOMAIN}",
            department=department,
        )

# --- DOMAIN DATA SEEDING (PERFECTED) ---

async def clear_domain_data(session: AsyncSession):
    print("Clearing domain data...")
    # Order matters for foreign keys
    tables = [
        models.ProjectQA,
        models.ProjectComment,
        models.ProjectTask,
        models.Project,
        models.InvestigationProgress,
        models.Investigation,
        models.RcaTimelineEvent,
        models.RcaMitigation,
        models.RcaHistory,
        models.RcaRecord,
        models.FarHistory,
        models.FarPrevention,
        models.FarMitigation,
        models.FarResolution,
        models.FarFailureCause,
        models.FarFailureMode,
        models.ExternalLink,
        models.ExternalEntitySecret,
        models.ExternalEntity,
        models.KnowledgeQA,
        models.KnowledgeEntry,
        models.MonitoringHistory,
        models.MonitoringOwner,
        models.MonitoringItem,
        models.ServiceSecret,
        models.LogicalService,
        models.PortConnection,
        models.NetworkInterface,
        models.DeviceSoftware,
        models.DeviceRelationship,
        models.FirewallRule,
        models.Subnet,
        models.DeviceLocation,
        models.Device,
        models.Rack,
        models.Room,
        models.Site,
        models.DataFlowHistory,
        models.DataFlow,
        models.VendorContract,
        models.VendorPersonnel,
        models.Vendor,
        models.Team,
        models.SettingOption,
    ]
    association_tables = [
        models.far_mode_assets,
        models.far_mode_causes,
        models.far_cause_resolutions,
        models.far_mode_mitigations,
        models.rca_failure_mode_links,
    ]
    for table in association_tables:
        await session.execute(delete(table))
    for table in tables:
        await session.execute(delete(table))
    await session.commit()

async def seed_domain_data(tenant_db_url: str):
    print(f"Seeding Mass Domain Data into {tenant_db_url}...")
    random.seed(42)
    engine = create_async_engine(tenant_db_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        await clear_domain_data(session)
        
        # Seed Monitoring Options
        monitoring_options = [
            ("MonitoringPlatform", "Zabbix", "Monitoring system platform", False),
            ("MonitoringPlatform", "Prometheus", "Monitoring system platform", False),
            ("MonitoringPlatform", "Datadog", "Monitoring system platform", False),
            ("MonitoringCategory", "Hardware", "Monitoring category", False),
            ("MonitoringCategory", "Application", "Monitoring category", False),
            ("MonitoringCategory", "Network", "Monitoring category", False),
            ("MonitoringCategory", "Synthetic", "Monitoring category", False),
            ("NotificationMethod", "Email", "Notification delivery method", False),
            ("NotificationMethod", "Slack", "Notification delivery method", False),
            ("NotificationMethod", "PagerDuty", "Notification delivery method", False),
            ("LinkPurpose", "Data", "Network link purpose", False),
            ("LinkPurpose", "Management", "Network link purpose", False),
            ("LinkPurpose", "Storage", "Network link purpose", False),
            ("LinkPurpose", "Backup", "Network link purpose", False),
            ("LinkPurpose", "Control", "Network link purpose", False),
            ("LinkPurpose", "Voice", "Network link purpose", False),
            ("NetworkFarm", "Prod", "Network farm", False),
            ("NetworkFarm", "Stage", "Network farm", False),
            ("NetworkFarm", "Lab", "Network farm", False),
            ("NetworkCableType", "Fiber", "Network cable type", False),
            ("NetworkCableType", "Copper", "Network cable type", False),
            ("NetworkCableType", "DAC", "Network cable type", False),
            ("NetworkCableType", "AOC", "Network cable type", False),
        ]
        for cat, val, desc, is_default in monitoring_options:
            session.add(models.SettingOption(category=cat, label=val, value=val, description=desc, is_default=is_default))
        await session.commit()

        # 1. Teams & Org Structure
        print(" -> Teams & Sites")
        teams = [
            models.Team(name="Infrastructure", description="Core Platform Engineering"),
            models.Team(name="Network Operations", description="Global Connectivity & Security"),
            models.Team(name="Database Admin", description="Persistence & Performance"),
            models.Team(name="Manufacturing IT", description="Cleanroom & Automation Support"),
            models.Team(name="Platform Reliability", description="Observability, reliability engineering, and incident command"),
            models.Team(name="Cyber Defense", description="Threat detection, IAM, and security controls"),
        ]
        session.add_all(teams)
        
        sites = [
            models.Site(name="HQ-01", address="123 Tech Way, Silicon Valley", color="#3b82f6"),
            models.Site(name="FAB-08", address="456 Industry Blvd, Austin", color="#10b981"),
            models.Site(name="DR-EAST", address="789 Backup Ln, Virginia", color="#f59e0b"),
        ]
        session.add_all(sites)
        await session.commit()

        # 2. Racks & Rooms (REDUCED)
        print(" -> Racks & Rooms (Reduced to 6 total)")
        all_racks = []
        for site in sites:
            room = models.Room(site_id=site.id, name=f"Hall-{site.name}", floor_level="1F")
            session.add(room)
            await session.flush()
            for rack_idx in range(2):  # 2 racks per site * 3 sites = 6 racks
                rack = models.Rack(
                    room_id=room.id, 
                    name=f"{site.name}-R{rack_idx:02}", 
                    aisle="A", 
                    row=f"{rack_idx:02}",
                    total_u_height=42
                )
                session.add(rack)
                all_racks.append(rack)
        await session.commit()

        # 3. Assets (Golden Dossier + MASS)
        print(" -> Assets (Reduced count, packed into 6 racks)")
        systems = ["ERP", "FINANCE", "K8S-CLUSTER", "MANUFACTURING", "SECURITY", "BI-ANALYTICS", "MES", "SCADA"]
        types = ["Physical", "Virtual", "Storage", "Switch"]
        rack_mountable_types = {"Physical", "Storage", "Switch"}
        manufacturers = {
            "Physical": ["Dell", "HPE", "Cisco"],
            "Virtual": ["VMware", "AWS", "Nutanix"],
            "Storage": ["NetApp", "PureStorage"],
            "Switch": ["Arista", "Juniper"]
        }
        business_units = ["Finance", "Operations", "Reliability", "Platform", "Manufacturing", "Security"]
        environments = ["Production", "Staging", "Development"]
        statuses = ["Active", "Provisioning", "Maintenance"]
        device_roles = {
            "Physical": ["Application Node", "Compute Host", "Storage Controller", "Backup Host"],
            "Virtual": ["API Runtime", "Batch Executor", "Reporting Worker", "Control Plane Node"],
            "Storage": ["Primary Storage", "Archive Storage", "Snapshot Repository"],
            "Switch": ["Core Switch", "Aggregation Switch", "ToR Switch"],
        }

        rack_occupancy: dict[int, set[int]] = defaultdict(set)

        def place_device_location(rack_id: int, size_u: int) -> tuple[int, int] | None:
            total_u = 42
            occupied = rack_occupancy[rack_id]
            for start_unit in range(1, total_u - size_u + 2):
                proposed = set(range(start_unit, start_unit + size_u))
                if proposed.isdisjoint(occupied):
                    occupied.update(proposed)
                    return start_unit, size_u
            return None

        device_target_count = 200
        dense_fill_target_pct = 95

        all_devices = []
        device_sequence = 0

        async def create_seed_device(
            *,
            dev_type: str,
            sys_name: str,
            size_u: int,
            rack_pool: list[models.Rack] | None = None,
            allow_fallback: bool = True,
        ):
            nonlocal device_sequence
            device_sequence += 1
            mfr = random.choice(manufacturers[dev_type])
            dev = models.Device(
                name=f"{sys_name}-{dev_type[:1]}-{device_sequence:03}",
                system=sys_name,
                type=dev_type,
                status=random.choice(["Active", "Provisioning", "Maintenance"]),
                environment=random.choice(environments),
                primary_ip=f"10.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
                management_ip=f"172.20.{random.randint(0,32)}.{random.randint(1,254)}",
                management_url=f"https://console-{device_sequence:03}.sysgrid.local",
                serial_number=f"SN-{random.getrandbits(32)}",
                asset_tag=f"AT-{device_sequence:05}",
                tenant_id=1,
                manufacturer=mfr,
                model="Gen-X" if dev_type == "Physical" else "vNode-Pro",
                os_name="Linux" if device_sequence % 2 == 0 else "Windows",
                os_version="Standard",
                owner=random.choice(["haewon.kim", "sre.oncall", "fab.ops", "db.owner"]),
                business_unit=random.choice(business_units),
                vendor=mfr,
                purchase_order=f"PO-{2025 + (device_sequence % 2)}-{device_sequence:05}",
                cost_center=f"CC-{random.randint(100, 999)}",
                role=random.choice(device_roles[dev_type]),
                size_u=size_u,
                tool_group=random.choice(["Lithography", "Etch", "CMP", "General IT"]),
                fab_area=random.choice(["North Bay", "South Bay", "Cleanroom A", "Utility"]),
                recipe_critical=(device_sequence % 5 == 0),
                power_max_w=random.choice([350, 600, 900, 1200]),
                power_typical_w=random.choice([180, 320, 450, 700]),
                btu_hr=random.choice([1200, 1800, 2400, 3200]),
                logic_json=[{"id": 1, "name": "Boot", "state": "Healthy", "upstream_ids": [], "downstream_ids": []}],
            )
            session.add(dev)
            await session.flush()
            all_devices.append(dev)

            if dev_type in rack_mountable_types:
                candidate_racks = list(rack_pool or all_racks)
                random.shuffle(candidate_racks)
                mounted = None
                for rack in candidate_racks:
                    mounted = place_device_location(rack.id, size_u)
                    if mounted:
                        session.add(models.DeviceLocation(
                            device_id=dev.id,
                            rack_id=rack.id,
                            start_unit=mounted[0],
                            size_u=mounted[1],
                        ))
                        break
                if not mounted and allow_fallback:
                    for rack in all_racks:
                        mounted = place_device_location(rack.id, size_u)
                        if mounted:
                            session.add(models.DeviceLocation(
                                device_id=dev.id,
                                rack_id=rack.id,
                                start_unit=mounted[0],
                                size_u=mounted[1],
                            ))
                            break
            return dev

        def rack_fill_pct(rack_id: int) -> int:
            return round((len(rack_occupancy[rack_id]) / 42) * 100)

        # First, prioritize Switches and high-connectivity Physical assets for racking.
        # We'll create enough to fill the 6 racks significantly.
        print(" -> Prioritizing switches and physical servers for racking")
        for rack in all_racks:
            # Each rack gets at least 2 switches
            for _ in range(2):
                await create_seed_device(dev_type="Switch", sys_name=random.choice(systems), size_u=1, rack_pool=[rack])
            
            # Fill the rest with physical servers until ~90%
            attempts = 0
            while rack_fill_pct(rack.id) < dense_fill_target_pct and attempts < 50:
                attempts += 1
                size_u = random.choices([1, 2, 4], weights=[40, 40, 20], k=1)[0]
                await create_seed_device(
                    dev_type="Physical",
                    sys_name=random.choice(systems),
                    size_u=size_u,
                    rack_pool=[rack],
                    allow_fallback=False,
                )

        # Fill remaining device target with other types (mostly Virtual which don't need racks)
        remaining_count = device_target_count - len(all_devices)
        if remaining_count > 0:
            for _ in range(remaining_count):
                dev_type = random.choices(types, weights=[10, 70, 10, 10], k=1)[0]
                await create_seed_device(
                    dev_type=dev_type,
                    sys_name=random.choice(systems),
                    size_u=1,
                    allow_fallback=True
                )

        await session.commit()

        # 4. Network, interfaces, software, and relationships
        print(" -> Network, software, and topology density")
        subnets = [
            models.Subnet(
                network_cidr=f"10.{i}.0.0/24",
                name=f"ZONE-{i:02}",
                vlan_id=100 + i,
                gateway=f"10.{i}.0.1",
                dns_servers="10.0.0.10,10.0.0.11",
                description=f"Operational segment {i}",
            )
            for i in range(1, 9)
        ]
        session.add_all(subnets)
        await session.flush()

        switch_devices = [d for d in all_devices if d.type == "Switch"]
        physical_devices = [d for d in all_devices if d.type == "Physical"]
        service_hosts = [d for d in all_devices if d.type in {"Physical", "Virtual"}]

        for idx, dev in enumerate(all_devices[:220]):
            vlan_id = subnets[idx % len(subnets)].vlan_id
            session.add(models.NetworkInterface(
                device_id=dev.id,
                name="eth0" if dev.type != "Switch" else "mgmt0",
                mac_address=f"02:42:{idx:02x}:{(idx * 2) % 256:02x}:{(idx * 3) % 256:02x}:{(idx * 5) % 256:02x}",
                ip_address=dev.primary_ip,
                vlan_id=vlan_id,
                link_speed_gbps=random.choice([1, 10, 25, 40]),
            ))
            session.add(models.DeviceSoftware(
                device_id=dev.id,
                category="Platform" if dev.type != "Switch" else "Firmware",
                name=random.choice(["Node Agent", "Security Sensor", "Backup Agent", "Telemetry Collector"]),
                version=random.choice(["1.4.2", "2.1.0", "3.8.5", "5.0.1"]),
                install_date=datetime.now() - timedelta(days=random.randint(30, 720)),
                purpose=random.choice(["Observability", "Compliance", "Backup", "Runtime"]),
                notes="Seeded local demo payload",
            ))

        for idx in range(min(len(physical_devices), 120)):
            source = physical_devices[idx]
            target = switch_devices[idx % len(switch_devices)] if switch_devices else physical_devices[(idx + 1) % len(physical_devices)]
            session.add(models.PortConnection(
                source_device_id=source.id,
                source_port=f"eth{idx % 4}",
                source_ip=source.primary_ip,
                source_mac=f"aa:00:{idx:02x}:11:22:33",
                source_vlan=100 + (idx % 8),
                target_device_id=target.id,
                target_port=f"xe-0/0/{idx % 32}",
                target_ip=target.primary_ip,
                target_mac=f"bb:00:{idx:02x}:44:55:66",
                target_vlan=100 + (idx % 8),
                link_type=random.choice(["Production", "Management", "Replication"]),
                purpose=random.choice(["North-south ingress", "East-west service mesh", "Storage replication", "Plant telemetry"]),
                speed_gbps=random.choice([1.0, 10.0, 25.0, 40.0]),
                unit="Gbps",
                direction=random.choice(["Bidirectional", "Ingress", "Egress"]),
                cable_type=random.choice(["DAC", "Fiber", "Cat6"]),
                status=random.choice(["Active", "Maintenance", "Planned"]),
                farm=random.choice(["FAB-08", "HQ-01", "DR-EAST"]),
                request_link=f"https://netops.local/changes/{idx + 1000}",
            ))
            if idx < len(physical_devices) - 1:
                session.add(models.DeviceRelationship(
                    source_device_id=source.id,
                    target_device_id=physical_devices[idx + 1].id,
                    relationship_type=random.choice(["Depends On", "Backs Up", "Feeds Data To"]),
                    source_role=source.role,
                    target_role=physical_devices[idx + 1].role,
                    notes="Seeded relationship for topology testing",
                ))

        for idx in range(18):
            src_subnet = subnets[idx % len(subnets)]
            dst_subnet = subnets[(idx + 2) % len(subnets)]
            session.add(models.FirewallRule(
                name=f"ALLOW-{src_subnet.name}-TO-{dst_subnet.name}-{idx:02}",
                risk="Loss of manufacturing execution telemetry if missing",
                source_type="Subnet",
                source_subnet_id=src_subnet.id,
                dest_type="Subnet",
                dest_subnet_id=dst_subnet.id,
                protocol=random.choice(["TCP", "UDP"]),
                port_range=random.choice(["443", "1433", "1521", "8080-8082"]),
                direction=random.choice(["Inbound", "Outbound"]),
                action="Allow",
                status=random.choice(["Active", "Requested"]),
            ))

        await session.commit()

        # 5. Services
        print(" -> Services and app stacks")
        service_types = ["Database", "Web", "Middleware", "Container", "ToolStack", "API"]
        logical_services = []
        for idx, dev in enumerate(service_hosts[:180]):
            service_count = 2 if idx < 100 else 1
            for svc_idx in range(service_count):
                service_type = random.choice(service_types)
                svc = models.LogicalService(
                    device_id=dev.id,
                    name=f"{dev.system}-{service_type[:3].upper()}-{idx:03}-{svc_idx + 1}",
                    service_type=service_type,
                    status=random.choice(["Active", "Stopped", "Critical", "Maintenance"]),
                    version=random.choice(["2024.11", "2025.1", "3.7.19", "12.4"]),
                    environment=dev.environment,
                    purpose=random.choice([
                        "Serves manufacturing dashboards",
                        "Stores production batch metadata",
                        "Publishes API payloads to internal consumers",
                        "Orchestrates automation jobs",
                    ]),
                    documentation_link=f"https://wiki.local/services/{dev.id}-{svc_idx}",
                    installation_date=datetime.now() - timedelta(days=random.randint(90, 1400)),
                    config_json={
                        "engine": random.choice(["PostgreSQL", "IIS", "Tomcat", "Kubernetes", "Redis"]),
                        "port": random.choice([443, 8443, 1521, 5432, 8080]),
                        "instance_name": f"{dev.system.lower()}-{svc_idx + 1}",
                    },
                    purchase_type=random.choice(["One-time", "Subscription"]),
                    license_key=f"LIC-{idx:04}-{svc_idx}",
                    purchase_date=datetime.now() - timedelta(days=random.randint(200, 1200)),
                    expiry_date=datetime.now() + timedelta(days=random.randint(120, 900)),
                    cost=random.choice([2500.0, 5000.0, 12000.0, 40000.0]),
                    currency="USD",
                    manufacturer=random.choice(["Microsoft", "Red Hat", "Oracle", "VMware", "Elastic"]),
                    supplier=random.choice(["CDW", "AWS", "Direct", "SHI"]),
                    custom_attributes={"ownerTeam": random.choice([t.name for t in teams]), "tier": random.choice(["Tier 0", "Tier 1", "Tier 2"])},
                    logic_json=[{"id": 1, "name": "Steady State", "state": "Healthy"}],
                )
                session.add(svc)
                await session.flush()
                logical_services.append(svc)
                if service_type in {"Database", "Middleware", "API"}:
                    session.add(models.ServiceSecret(
                        service_id=svc.id,
                        username=f"svc_{dev.system.lower()}_{svc_idx}",
                        password=f"seed-only-{idx:04}",
                        note="Disposable local seed credential",
                    ))

        await session.commit()

        # 6. Vendors and contracts
        print(" -> Vendors, personnel, and contracts")
        vendors = []
        vendor_names = [
            ("Dell", "United States"),
            ("HPE", "United States"),
            ("NetApp", "United States"),
            ("PureStorage", "United States"),
            ("Arista", "United States"),
            ("Oracle", "United States"),
            ("Siemens", "Germany"),
            ("Samsung SDS", "South Korea"),
            ("Schneider Electric", "France"),
            ("Juniper", "United States"),
        ]
        for idx, (vendor_name, country) in enumerate(vendor_names):
            vendor = models.Vendor(
                name=vendor_name,
                country=country,
                metadata_json={"serviceLevel": random.choice(["Premier", "Standard", "Escalation Only"])},
            )
            session.add(vendor)
            await session.flush()
            vendors.append(vendor)

            primary_person = None
            for p_idx in range(3):
                person = models.VendorPersonnel(
                    vendor_id=vendor.id,
                    name=f"{vendor_name} Contact {p_idx + 1}",
                    name_original=f"{vendor_name} Contact {p_idx + 1}",
                    position=random.choice(["Account Manager", "Resident Engineer", "Escalation Manager"]),
                    team=random.choice(["Support", "Field", "Renewals"]),
                    company_email=f"{vendor_name.lower().replace(' ', '')}.{p_idx + 1}@vendor.example.com",
                    internal_email=f"{vendor_name.lower().replace(' ', '')}.{p_idx + 1}@partner.sysgrid.local",
                    phone=f"+1-512-555-{1200 + idx * 10 + p_idx}",
                    accounts=[{"type": "Portal", "username": f"{vendor_name.lower()}_{p_idx}", "purpose_description": "Support portal access"}],
                    pcs=[{"name": f"{vendor_name[:4].upper()}-LT-{p_idx+1}", "type": "Laptop", "purpose_description": "On-site maintenance"}],
                )
                session.add(person)
                await session.flush()
                if primary_person is None:
                    primary_person = person
            vendor.primary_personnel_id = primary_person.id if primary_person else None

            for c_idx in range(2):
                covered_assets = [d.id for d in random.sample(all_devices, k=min(8, len(all_devices)))]
                session.add(models.VendorContract(
                    vendor_id=vendor.id,
                    title=f"{vendor_name} Support Agreement {c_idx + 1}",
                    contract_id=f"CTR-{idx:02}-{c_idx:02}",
                    status=random.choice(["Completed", "In Review", "Expired"]),
                    effective_date=datetime.now() - timedelta(days=random.randint(300, 900)),
                    expiry_date=datetime.now() + timedelta(days=random.randint(90, 540)),
                    covered_systems=random.sample(systems, k=min(3, len(systems))),
                    covered_assets=covered_assets,
                    scope_of_work=[
                        {"work_description": "Quarterly health check", "frequency": "Quarterly", "response": "4h", "objective_description": "Stability assurance", "importance": "High"},
                        {"work_description": "Emergency escalation support", "frequency": "On demand", "response": "1h", "objective_description": "Service continuity", "importance": "Critical"},
                    ],
                    schedule={"work_schedule": "24x7", "oncall_method": "Hotline", "holiday_policy": "Global follow-the-sun"},
                    document_link=f"https://contracts.local/{vendor_name.lower().replace(' ', '-')}/{c_idx + 1}",
                    previous_contract_changes="Expanded manufacturing coverage and added DR validation.",
                ))

        await session.commit()

        # 7. Knowledge base
        print(" -> Knowledge, runbooks, and Q&A")
        knowledge_entries = []
        knowledge_categories = ["BKM", "Manual", "Q&A"]
        for idx in range(24):
            category = knowledge_categories[idx % len(knowledge_categories)]
            entry = models.KnowledgeEntry(
                category=category,
                title=f"{category} Reference {idx + 1}: {random.choice(['Database failover', 'Switch replacement', 'API certificate rotation', 'MES batch recovery'])}",
                content="Seeded long-form content for local demo usage.",
                content_json={
                    "purpose": "Seeded validation and walkthrough content",
                    "prerequisites": ["Access approval", "Known maintenance window"],
                    "steps": [
                        {"title": "Assess", "detail": "Validate blast radius and impacted systems."},
                        {"title": "Execute", "detail": "Apply coordinated remediation path."},
                        {"title": "Verify", "detail": "Check monitoring, customer impact, and logs."},
                    ],
                },
                question_context="Why did the workflow or system degrade and how do we recover safely?" if category == "Q&A" else None,
                is_answered=(category != "Q&A" or idx % 2 == 0),
                verified_by="haewon.kim" if category == "BKM" else None,
                tags=[random.choice(["Network", "Database", "Manufacturing", "Security", "Vendor"]), random.choice(systems)],
                impacted_systems=random.sample(systems, k=min(2, len(systems))),
                linked_device_ids=[d.id for d in random.sample(all_devices, k=min(3, len(all_devices)))],
                status=random.choice(["Published", "Draft", "Published", "Archived"]),
                metadata_json={"source": "local-seed", "reviewCycle": random.choice(["30d", "90d", "180d"])},
            )
            session.add(entry)
            await session.flush()
            knowledge_entries.append(entry)

            if category == "Q&A":
                question = models.KnowledgeQA(
                    knowledge_id=entry.id,
                    content="What exact indicators confirm the fault before failover?",
                    author="fab.ops",
                    author_team="Manufacturing IT",
                    target_audience="Internal",
                    entry_type="Question",
                )
                session.add(question)
                await session.flush()
                session.add(models.KnowledgeQA(
                    knowledge_id=entry.id,
                    parent_qa_id=question.id,
                    content="Cross-check the monitoring heartbeat, queue backlog, and audit log gap before switching.",
                    author="haewon.kim",
                    author_team="Platform Reliability",
                    target_audience="Internal",
                    is_answer=True,
                    is_verified=True,
                    entry_type="Answer",
                ))

        await session.commit()

        # 8. Monitoring
        print(" -> Monitoring (rich scenarios with owners and runbooks)")
        operator_result = await session.execute(select(models.Operator).where(models.Operator.is_admin.is_(True)))
        admin_operators = operator_result.scalars().all()
        monitored_keys = set()
        monitoring_items = []
        
        valid_platforms = ["Zabbix", "Prometheus", "Datadog"]
        valid_categories = ["Hardware", "Application", "Network", "Synthetic"]

        for i in range(72):
            dev = random.choice(all_devices)
            title = random.choice(['CPU High', 'Latency Spike', 'Disk Full', 'Auth Error'])
            category = random.choice(valid_categories)
            platform = random.choice(valid_platforms)
            
            key = (dev.id, title, category, platform)
            if key in monitored_keys:
                continue
            monitored_keys.add(key)
            
            linked_services = [svc.id for svc in random.sample(
                [svc for svc in logical_services if svc.device_id == dev.id] or logical_services,
                k=1,
            )]
            recovery_docs = [doc.id for doc in random.sample(knowledge_entries, k=min(2, len(knowledge_entries)))]
            mon = models.MonitoringItem(
                device_id=dev.id,
                category=category,
                status=random.choice(["Existing", "Planned", "Cancelled"]),
                title=f"{dev.name}: {title}",
                severity=random.choice(["Critical", "Warning", "Informational"]),
                platform=platform,
                is_active=True,
                impact="Potential service degradation",
                purpose=random.choice(["Protect throughput", "Detect auth failures", "Guard replication health", "Catch operator-impacting regression"]),
                notification_method=random.choice(["Email", "Slack", "PagerDuty"]),
                notification_recipients=["ops@sysgrid.local", "sre@sysgrid.local"],
                monitored_services=linked_services,
                owner_team=random.choice([t.name for t in teams]),
                recovery_docs=recovery_docs,
                logic_json=[{"id": 1, "type": "Threshold", "description": "Auto-generated", "logic_info": "> 80%"}],
            )
            session.add(mon)
            await session.flush()
            monitoring_items.append(mon)
            for owner_idx, operator in enumerate(random.sample(admin_operators, k=min(2, len(admin_operators)))):  # pragma: no branch
                session.add(models.MonitoringOwner(
                    monitoring_item_id=mon.id,
                    operator_id=operator.id,
                    name=operator.full_name,
                    external_id=operator.external_id,
                    role="Primary Support" if owner_idx == 0 else "Escalation",
                ))
            session.add(models.MonitoringHistory(
                monitoring_item_id=mon.id,
                version=1,
                snapshot={"title": mon.title, "status": mon.status, "platform": mon.platform, "recovery_docs": recovery_docs},
                change_summary="Initial seeded monitoring baseline",
            ))
        await session.commit()

        # 9. External systems and links
        print(" -> External entities and integrations")
        external_entities = []
        for idx in range(28):
            team_ref = teams[idx % len(teams)]
            operator_ref = admin_operators[idx % len(admin_operators)] if admin_operators else None
            entity = models.ExternalEntity(
                name=f"External Partner {idx + 1}",
                external_key=f"EXT-{idx + 1:03}",
                aliases_json=[f"Partner-{idx + 1}", f"Integration-{idx + 1}"],
                type=random.choice(["API", "Equipment", "DB", "Script", "Physical Server"]),
                subtype=random.choice(["B2B", "Telemetry", "Batch", "OEM"]),
                owner_organization=random.choice(["Contoso Manufacturing", "Northwind Logistics", "Fabrikam Systems", "Wingtip Devices"]),
                owner_team=team_ref.name,
                ownership_mode=random.choice(["team", "individual"]),
                internal_team_id=team_ref.id if idx % 2 == 0 else None,
                internal_operator_id=(operator_ref.id if operator_ref and idx % 2 == 1 else None),
                status=random.choice(["Active", "Planned", "Maintenance"]),
                environment=random.choice(environments),
                description="Seeded external dependency record for topology and credential views.",
                notes="Contains realistic integration metadata for local feature validation.",
                contacts_json=[{"full_name": f"Partner Contact {idx + 1}", "email": f"partner{idx + 1}@example.com", "phone": f"+1-555-30{idx:02}", "role": "Primary", "is_primary": True}],
                business_purpose=random.choice(["Order exchange", "Manufacturing telemetry", "EDI settlement", "Patch distribution"]),
                criticality=random.choice(["High", "Medium", "Low"]),
                dependency_tier=random.choice(["Tier 1", "Tier 2", "Tier 3"]),
                data_classification=random.choice(["Internal", "Restricted", "Confidential"]),
                integration_mode=random.choice(["API", "SFTP", "Database", "Manual"]),
                primary_endpoint_url=f"https://partner-{idx + 1}.vendor.local/api",
                secondary_endpoint_url=f"https://partner-{idx + 1}.vendor.local/dr",
                auth_method=random.choice(["mTLS", "Basic", "OAuth2", "Token"]),
                protocol_family=random.choice(["HTTPS", "SFTP", "TCP", "Database"]),
                port_override=random.choice([443, 8443, 22]),
                supports_inbound=(idx % 2 == 0),
                supports_outbound=True,
                source_system=random.choice(systems),
                source_record_id=f"SRC-{idx + 1000}",
                risk_rating=random.choice(["Critical", "Elevated", "Moderate"]),
                contains_customer_data=(idx % 3 == 0),
                contains_credentials=(idx % 4 == 0),
                stores_pii=(idx % 5 == 0),
                internet_exposed=(idx % 6 == 0),
                third_party_assessment_status=random.choice(["Approved", "Pending", "Review Needed"]),
                poc_json=[{"first_name": "Alex", "last_name": f"Partner{idx+1}", "id": f"EXTPOC-{idx+1}", "email": f"alex.partner{idx+1}@example.com", "phone": "+1-555-0100"}],
                metadata_json={"businessWindow": random.choice(["24x7", "Plant Shift", "Business Hours"])},
            )
            session.add(entity)
            await session.flush()
            external_entities.append(entity)
            if idx < 12:
                session.add(models.ExternalEntitySecret(
                    external_entity_id=entity.id,
                    secret_label="Primary Integration Credential",
                    secret_type=random.choice(["SharedSecret", "Token", "VaultReference"]),
                    username=f"ext_user_{idx + 1}",
                    password=f"seed-secret-{idx + 1:03}",
                    vault_provider="Other",
                    vault_path=f"/local/ext/{idx + 1}",
                    note="Disposable local seed value",
                    credential_status="Active",
                    rotation_frequency_days=90,
                    password_last_rotated_at=(datetime.now() - timedelta(days=random.randint(1, 80))).isoformat(),
                ))

        await session.flush()
        for idx, entity in enumerate(external_entities):
            target_device = all_devices[idx % len(all_devices)]
            target_services = [svc for svc in logical_services if svc.device_id == target_device.id]
            session.add(models.ExternalLink(
                external_entity_id=entity.id,
                device_id=target_device.id,
                service_id=target_services[0].id if target_services else None,
                direction=random.choice(["Inbound", "Outbound", "Bidirectional"]),
                purpose=random.choice(["Data exchange", "Remote maintenance", "Telemetry relay", "Partner API consumption"]),
                protocol=random.choice(["HTTPS", "SFTP", "TCP"]),
                port=random.choice([22, 443, 8443, 1521]),
                host_or_fqdn=f"{entity.external_key.lower()}.vendor.local",
                path_or_resource=random.choice(["/api/orders", "/telemetry", "/auth", "/files/drop"]),
                network_zone=random.choice(["DMZ", "Partner", "Restricted", "Internal"]),
                transport_security=random.choice(["TLS", "mTLS", "VPN", "Other"]),
                link_status=random.choice(["Active", "Planned", "Disabled"]),
                credential_reference=f"vault://seed/ext/{entity.id}",
                credentials={"username": f"link_user_{entity.id}", "note": "seed-only"},
            ))
        await session.commit()

        # 10. Strategic Projects (MASS)
        print(" -> Projects, comments, and Q&A")
        for p_idx in range(5):
            proj = models.Project(
                name=f"Mass Initiative {p_idx+1}: {random.choice(['Migration', 'Upgrade', 'Audit', 'Expansion'])}",
                type=random.choice(["Strategic", "Tactical", "Maintenance"]),
                status="In Progress",
                priority=random.choice(["High", "Medium", "Low"]),
                start_date=datetime.now() - timedelta(days=random.randint(1, 60)),
                end_date=datetime.now() + timedelta(days=random.randint(30, 180)),
                owner="haewon.kim",
                target_systems=[random.choice(systems)]
            )
            session.add(proj)
            await session.flush()
            
            for t_idx in range(40):
                task = models.ProjectTask(
                    project_id=proj.id,
                    name=f"Task {t_idx+1}: {random.choice(['Analyze', 'Implement', 'Verify', 'Document'])} Module {t_idx}",
                    status=random.choice(["To Do", "In Progress", "Completed"]),
                    progress=random.randint(0, 100),
                    owner=random.choice(["Infrastructure", "Network", "Database"])
                )
                session.add(task)
                await session.flush()
                if t_idx < 8:
                    session.add(models.ProjectComment(
                        project_id=proj.id,
                        task_id=task.id,
                        author=random.choice(["haewon.kim", "fab.ops", "sre.oncall"]),
                        content=random.choice([
                            "Validated sequencing with plant stakeholders.",
                            "Need vendor confirmation on cutover window.",
                            "Observed one blocking dependency on upstream service patching.",
                        ]),
                    ))
                    session.add(models.ProjectQA(
                        project_id=proj.id,
                        task_id=task.id,
                        question="Do we need a maintenance freeze exception for this task?",
                        answer=random.choice(["Yes, weekend only.", "No, standard window is enough.", None]),
                        asked_by="haewon.kim",
                        answered_by="fab.ops" if t_idx % 2 == 0 else None,
                        status="Answered" if t_idx % 2 == 0 else "Pending",
                    ))
        await session.commit()

        # 11. FAR and RCA
        print(" -> FAR, RCA, and investigations")
        far_modes = []
        for idx in range(10):
            severity = random.randint(5, 10)
            occurrence = random.randint(2, 8)
            detection = random.randint(1, 6)
            mode = models.FarFailureMode(
                system_name=random.choice(systems),
                failure_type=random.choice(["Design", "Operational", "Dependency", "Capacity"]),
                title=f"Failure Mode {idx + 1}: {random.choice(['DB replication lag', 'Certificate expiry', 'Switch path exhaustion', 'Batch processor deadlock'])}",
                effect=random.choice([
                    "Manufacturing queue stalls and delayed dispatching.",
                    "Operator login failures across the tool chain.",
                    "Cross-site reporting degradation with stale dashboards.",
                ]),
                severity=severity,
                occurrence=occurrence,
                detection=detection,
                rpn=severity * occurrence * detection,
                status=random.choice(["Analyzing", "Cause Identified", "Mitigated"]),
                has_incident_history=True,
                metadata_json={"ownerTeam": random.choice([t.name for t in teams])},
            )
            session.add(mode)
            await session.flush()
            far_modes.append(mode)
            await session.execute(
                models.far_mode_assets.insert(),
                [
                    {"mode_id": mode.id, "device_id": device.id}
                    for device in random.sample(all_devices, k=min(4, len(all_devices)))
                ],
            )

            cause = models.FarFailureCause(
                cause_text=random.choice([
                    "Stale failover configuration after manual override.",
                    "Capacity saturation under shift-change batch spikes.",
                    "Partner endpoint drift and incompatible auth rotation.",
                ]),
                occurrence_level=random.randint(2, 8),
                responsible_team=random.choice([t.name for t in teams]),
            )
            session.add(cause)
            await session.flush()
            await session.execute(
                models.far_mode_causes.insert().values(mode_id=mode.id, cause_id=cause.id)
            )

            resolution = models.FarResolution(
                knowledge_id=knowledge_entries[idx % len(knowledge_entries)].id,
                preventive_follow_up="Document the fix path and align ownership.",
                responsible_team=random.choice([t.name for t in teams]),
                guidance_notes="Update runbook, validate monitor coverage, and run tabletop verification.",
            )
            session.add(resolution)
            await session.flush()
            await session.execute(
                models.far_cause_resolutions.insert().values(cause_id=cause.id, resolution_id=resolution.id)
            )

            mitigation = models.FarMitigation(
                mitigation_type=random.choice(["Monitoring", "Workaround", "Process Change"]),
                mitigation_steps="Seeded mitigation path for immediate containment and signal improvement.",
                responsible_team=random.choice([t.name for t in teams]),
                status=random.choice(["Not Started", "In Progress", "Completed"]),
                cause_id=cause.id,
                monitoring_item_id=monitoring_items[idx % len(monitoring_items)].id if monitoring_items else None,
            )
            session.add(mitigation)
            await session.flush()
            await session.execute(
                models.far_mode_mitigations.insert().values(mode_id=mode.id, mitigation_id=mitigation.id)
            )

            session.add(models.FarPrevention(
                failure_mode_id=mode.id,
                cause_id=cause.id,
                prevention_action="Enforce config drift review and recurring resilience test.",
                status=random.choice(["Open", "In Progress", "Verified"]),
                target_date=datetime.now() + timedelta(days=random.randint(15, 120)),
                responsible_team=random.choice([t.name for t in teams]),
            ))
            session.add(models.FarHistory(
                far_mode_id=mode.id,
                version=1,
                snapshot={"title": mode.title, "status": mode.status, "severity": mode.severity},
                change_summary="Initial seeded FAR baseline",
            ))

        await session.flush()
        for idx in range(10):
            rca = models.RcaRecord(
                title=f"RCA {idx + 1}: {random.choice(['Throughput collapse', 'Auth outage', 'Replication interruption', 'Telemetry blind spot'])}",
                problem_statement="Seeded RCA for local testing across incident, history, and linked modules.",
                trigger_source=random.choice(["Auto Alert", "Manual Report", "Customer Escalation"]),
                severity=random.choice(["P1", "P2", "P3"]),
                priority=random.randint(3, 10),
                severity_logic={"flow_halted": idx % 2 == 0, "scrap_risk": idx % 3 == 0},
                initial_symptoms="Service degradation and operator-impacting alerts were observed.",
                occurrence_at=datetime.now() - timedelta(days=random.randint(5, 120)),
                detection_at=datetime.now() - timedelta(days=random.randint(4, 119)),
                acknowledged_at=datetime.now() - timedelta(days=random.randint(3, 118)),
                owner=random.choice(["haewon.kim", "fab.ops", "sre.oncall"]),
                owners=["haewon.kim", random.choice(["fab.ops", "sre.oncall"])],
                jira_link=f"https://jira.local/browse/RCA-{100+idx}",
                incident_type=random.choice(["Availability", "Performance", "Security"]),
                detection_type=random.choice(["Alert", "Manual", "Vendor"]),
                impact_type=random.choice(["Manufacturing", "Finance", "Reporting"]),
                target_system=random.choice(systems),
                target_systems=random.sample(systems, k=min(2, len(systems))),
                impacted_asset_ids=[d.id for d in random.sample(all_devices, k=min(3, len(all_devices)))],
                impacted_service_ids=[svc.id for svc in random.sample(logical_services, k=min(3, len(logical_services)))],
                fab_impact_json={"categories": ["Throughput", "Operator Delay"], "explanation": "Temporary dispatch lag", "severity": random.randint(2, 5)},
                identification_steps_json=[{"step": 1, "text": "Validated scope and active blast radius."}],
                rca_steps_json=[{"step": 1, "text": "Traced backlog growth to replication lag and auth retries."}],
                potential_causes_json=[{"cause": "Stale dependency config", "indicator": "Divergent auth handshake", "bkm_id": knowledge_entries[idx % len(knowledge_entries)].id, "status": "Likely"}],
                narrative_summary="Seeded RCA storyline with evidence, mitigations, and follow-up actions.",
                evidence_json=[{"type": "text", "content": "Latency graphs and event logs attached.", "timestamp": datetime.now().isoformat()}],
                mitigation_logs_json=[{"type": "Mitigation", "description": "Reduced queue depth and forced standby promotion.", "status": "Completed", "timestamp": datetime.now().isoformat(), "images": []}],
                cause_of_failure="Coordination gap between dependency change and recovery validation.",
                signature_indicator="Burst of retries paired with queue age increase.",
                knowledge_id=knowledge_entries[idx % len(knowledge_entries)].id,
                monitoring_item_id=monitoring_items[idx % len(monitoring_items)].id if monitoring_items else None,
                status=random.choice(["Open", "Investigation", "Resolved"]),
                version=1,
            )
            session.add(rca)
            await session.flush()
            await session.execute(
                models.rca_failure_mode_links.insert().values(
                    rca_id=rca.id,
                    failure_mode_id=far_modes[idx % len(far_modes)].id,
                )
            )
            session.add(models.RcaTimelineEvent(
                rca_id=rca.id,
                event_time=datetime.now() - timedelta(hours=random.randint(4, 48)),
                event_type="Detection",
                description="Alert exceeded engineered threshold and operator reports matched the signal.",
                owner="haewon.kim",
                owner_team="Platform Reliability",
                involved_pocs=["haewon.kim", "fab.ops"],
                images=[],
            ))
            session.add(models.RcaTimelineEvent(
                rca_id=rca.id,
                event_time=datetime.now() - timedelta(hours=random.randint(1, 24)),
                event_type="Resolution",
                description="Seeded final recovery checkpoint and controlled return to service.",
                owner="sre.oncall",
                owner_team="Infrastructure",
                involved_pocs=["sre.oncall"],
                images=[],
            ))
            session.add(models.RcaMitigation(
                rca_id=rca.id,
                type=random.choice(["Preventive", "Workaround", "Mitigation"]),
                action_description="Add deeper synthetic validation and enforce handoff checklist.",
                status=random.choice(["Planned", "In Progress", "Completed"]),
            ))
            session.add(models.RcaHistory(
                rca_id=rca.id,
                version=1,
                snapshot={"title": rca.title, "status": rca.status, "severity": rca.severity},
                change_summary="Initial seeded RCA baseline",
            ))

        await session.commit()

        # 12. Research / investigations
        print(" -> Investigations and research threads")
        for idx in range(12):
            investigation = models.Investigation(
                title=f"Investigation {idx + 1}: {random.choice(['Yield drift', 'Latency regression', 'Network asymmetry', 'Vendor access anomaly'])}",
                problem_statement="Seeded investigation record for research and troubleshooting workflows.",
                category=random.choice(["General", "Troubleshooting", "Security", "Maintenance"]),
                research_domain=random.choice(["Reliability", "Operations", "Security", "Manufacturing"]),
                failure_domain=random.choice(["Platform", "Network", "Database", "Vendor"]),
                status=random.choice(["Analyzing", "Escalated", "Monitoring", "Resolved"]),
                priority=random.choice(["Urgent", "High", "Medium", "Low"]),
                systems=random.sample(systems, k=min(2, len(systems))),
                impacted_device_ids=[d.id for d in random.sample(all_devices, k=min(3, len(all_devices)))],
                assigned_team=random.choice([t.name for t in teams]),
                impact="Potential to disrupt routine operations without immediate escalation.",
                trigger_event="Signal detected from correlated monitoring and operator observation.",
                root_cause="Under active investigation in seeded scenario.",
                resolution_steps="Collect evidence, isolate variables, and validate recovery path.",
                mitigation_items=["Raised monitor sensitivity", "Escalated vendor coordination"],
                prevention_method="Codify stable recovery checklists and improve telemetry.",
                monitoring_items=[m.id for m in random.sample(monitoring_items, k=min(2, len(monitoring_items)))],
                lessons_learned="Coordination and observability gaps amplify time-to-clarity.",
                initiation_at=datetime.now() - timedelta(days=random.randint(1, 45)),
                metadata_json={"seed": "local-demo"},
            )
            session.add(investigation)
            await session.flush()
            for p_idx in range(3):
                session.add(models.InvestigationProgress(
                    investigation_id=investigation.id,
                    entry_text=random.choice([
                        "Validated that customer-facing symptoms align with monitoring trends.",
                        "Compared shift-to-shift metrics and identified a narrow anomaly window.",
                        "Confirmed workaround stability after controlled rollback.",
                    ]),
                    entry_type=random.choice(["Update", "Diagnosis", "Action", "Observation"]),
                    poc=random.choice(["haewon.kim", "fab.ops", "sre.oncall"]),
                    added_by=random.choice(["haewon.kim", "fab.ops", "sre.oncall"]),
                    metadata_json={"source": "seed"},
                ))

        await session.commit()

        # 13. Data Flows
        print(" -> Topology Maps")
        flow = models.DataFlow(
            name="Mass Fleet Overview", category="System", status="Up to date",
            nodes_json=[
                {"id": f"n{i}", "type": "device", "position": {"x": i*50, "y": 100}, "data": {"name": d.name, "id": d.id}}
                for i, d in enumerate(all_devices[:10])
            ],
            edges_json=[
                {"id": f"e{i}", "source": f"n{i}", "target": f"n{i+1}", "type": "labeled", "data": {"label": "Link"}}
                for i in range(9)
            ],
            traces_json=[
                {"id": "trace-1", "name": "ERP to Analytics", "steps": [{"node_id": "n0"}, {"edge_id": "e0"}, {"node_id": "n1"}]},
            ],
        )
        session.add(flow)
        session.add(models.DataFlowHistory(
            data_flow=flow,
            version=1,
            snapshot={"name": flow.name, "status": flow.status},
            change_summary="Initial seeded topology baseline",
        ))
        await session.commit()

    print("MASS DOMAIN SEEDING COMPLETE.")
    await engine.dispose()


def collect_bootstrap_report(*, tenant_name: str, tenant_db_url: str, users: list[str]) -> dict:
    config_engine = create_engine(to_sync_sqlite_url(settings.CONFIG_DATABASE_URL), future=True)
    tenant_engine = create_engine(to_sync_sqlite_url(tenant_db_url), future=True)

    with Session(config_engine) as config_session, Session(tenant_engine) as tenant_session:
        tenant = config_session.execute(select(Tenant).where(Tenant.name == tenant_name)).scalar_one()
        access_rows = config_session.execute(
            select(UserTenantAccess).where(UserTenantAccess.tenant_id == tenant.id)
        ).scalars().all()
        operators = tenant_session.execute(
            select(Operator).where(Operator.username.in_(users))
        ).scalars().all()

        counts = {
            "teams": tenant_session.query(models.Team).count(),
            "sites": tenant_session.query(models.Site).count(),
            "racks": tenant_session.query(models.Rack).count(),
            "devices": tenant_session.query(models.Device).count(),
            "logical_services": tenant_session.query(models.LogicalService).count(),
            "network_interfaces": tenant_session.query(models.NetworkInterface).count(),
            "port_connections": tenant_session.query(models.PortConnection).count(),
            "firewall_rules": tenant_session.query(models.FirewallRule).count(),
            "monitoring_items": tenant_session.query(models.MonitoringItem).count(),
            "external_entities": tenant_session.query(models.ExternalEntity).count(),
            "external_links": tenant_session.query(models.ExternalLink).count(),
            "vendors": tenant_session.query(models.Vendor).count(),
            "vendor_contracts": tenant_session.query(models.VendorContract).count(),
            "knowledge_entries": tenant_session.query(models.KnowledgeEntry).count(),
            "far_failure_modes": tenant_session.query(models.FarFailureMode).count(),
            "rca_records": tenant_session.query(models.RcaRecord).count(),
            "investigations": tenant_session.query(models.Investigation).count(),
            "projects": tenant_session.query(models.Project).count(),
            "tasks": tenant_session.query(models.ProjectTask).count(),
            "data_flows": tenant_session.query(models.DataFlow).count(),
        }

        return {
            "tenant_name": tenant.name,
            "tenant_db_url": tenant.db_url,
            "user_access": [
                {
                    "user_id": row.user_id,
                    "role": row.role,
                    "is_selected": bool(row.is_selected),
                }
                for row in access_rows
            ],
            "operators": [
                {
                    "username": op.username,
                    "is_admin": bool(op.is_admin),
                    "role_id": op.role_id,
                    "registration_status": op.registration_status,
                }
                for op in operators
            ],
            "counts": counts,
        }


def validate_seed_foundation(*, tenant_db_url: str, seeded_domain_data: bool) -> dict:
    tenant_engine = create_engine(to_sync_sqlite_url(tenant_db_url), future=True)
    minimum_counts = {
        "teams": 5,
        "sites": 3,
        "racks": 6,
        "devices": 150,
        "device_locations": 25,
        "logical_services": 40,
        "monitoring_items": 10,
        "external_entities": 5,
        "vendors": 5,
        "knowledge_entries": 10,
        "far_failure_modes": 4,
        "rca_records": 4,
        "projects": 2,
    } if seeded_domain_data else {
        "teams": 0,
        "sites": 0,
        "racks": 0,
        "devices": 0,
        "logical_services": 0,
    }

    with Session(tenant_engine) as tenant_session:
        counts = {
            "teams": tenant_session.query(models.Team).count(),
            "sites": tenant_session.query(models.Site).count(),
            "racks": tenant_session.query(models.Rack).count(),
            "devices": tenant_session.query(models.Device).count(),
            "device_locations": tenant_session.query(models.DeviceLocation).count(),
            "logical_services": tenant_session.query(models.LogicalService).count(),
            "monitoring_items": tenant_session.query(models.MonitoringItem).count(),
            "external_entities": tenant_session.query(models.ExternalEntity).count(),
            "vendors": tenant_session.query(models.Vendor).count(),
            "knowledge_entries": tenant_session.query(models.KnowledgeEntry).count(),
            "far_failure_modes": tenant_session.query(models.FarFailureMode).count(),
            "rca_records": tenant_session.query(models.RcaRecord).count(),
            "projects": tenant_session.query(models.Project).count(),
        }

        occupancy_rows = tenant_session.execute(
            select(models.DeviceLocation.rack_id, func.count(models.DeviceLocation.id))
            .group_by(models.DeviceLocation.rack_id)
        ).all()
        occupancy_map = {row[0]: row[1] for row in occupancy_rows}
        rack_fill_sample = {
            rack.name: occupancy_map.get(rack.id, 0)
            for rack in tenant_session.execute(select(models.Rack).order_by(models.Rack.id).limit(12)).scalars().all()
        }

    failures = [
        f"{key} expected >= {minimum}, found {counts.get(key, 0)}"
        for key, minimum in minimum_counts.items()
        if counts.get(key, 0) < minimum
    ]
    if seeded_domain_data:
        populated_racks = sum(1 for mounted_count in occupancy_map.values() if mounted_count > 0)
        if populated_racks < 6:
            failures.append(f"expected at least 6 populated racks, found {populated_racks}")

    if failures:
        raise RuntimeError("Seed foundation validation failed: " + "; ".join(failures))

    return {
        "counts": counts,
        "rack_fill_sample": rack_fill_sample,
    }


async def validate_seed_api_contracts(*, tenant_db_url: str, seeded_domain_data: bool) -> dict:
    if not seeded_domain_data:
        return {"skipped": True, "reason": "domain data seeding disabled"}

    engine = create_async_engine(tenant_db_url)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    validation_summary: dict[str, int] = {}
    failures: list[str] = []

    async def validate_first(query, schema_cls, label: str, limit: int = 3):
        async with session_factory() as session:
            result = await session.execute(query.limit(limit))
            records = result.unique().scalars().all()
            if not records:
                failures.append(f"{label}: no records returned for validation")
                return
            for index, record in enumerate(records, start=1):
                try:
                    schema_cls.model_validate(record)
                except Exception as exc:  # pragma: no cover - explicit validation failure path
                    failures.append(f"{label} record {index} failed {schema_cls.__name__}: {exc}")
                    return
            validation_summary[label] = len(records)

    await validate_first(
        select(models.KnowledgeEntry).options(
            selectinload(models.KnowledgeEntry.qa_threads).selectinload(models.KnowledgeQA.replies)
        ).filter(models.KnowledgeEntry.is_deleted == False).order_by(models.KnowledgeEntry.updated_at.desc()),
        schemas.KnowledgeEntryResponse,
        "knowledge",
    )
    await validate_first(
        select(models.Project).options(
            selectinload(models.Project.tasks).selectinload(models.ProjectTask.subtasks),
            selectinload(models.Project.tasks).selectinload(models.ProjectTask.comments),
            selectinload(models.Project.tasks).selectinload(models.ProjectTask.qa_items),
            selectinload(models.Project.comments),
            selectinload(models.Project.qa_items),
        ).filter(models.Project.is_deleted == False).order_by(models.Project.order_index.asc(), models.Project.created_at.desc()),
        schemas.ProjectResponse,
        "projects",
    )
    await validate_first(
        select(models.RcaRecord).options(
            selectinload(models.RcaRecord.timeline),
            selectinload(models.RcaRecord.mitigations),
            selectinload(models.RcaRecord.knowledge_bkm),
            selectinload(models.RcaRecord.monitoring_config),
            selectinload(models.RcaRecord.linked_failure_modes).selectinload(models.FarFailureMode.affected_assets),
            selectinload(models.RcaRecord.linked_failure_modes).selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.resolutions).selectinload(models.FarResolution.knowledge_bkm),
            selectinload(models.RcaRecord.linked_failure_modes).selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.mitigations),
            selectinload(models.RcaRecord.linked_failure_modes).selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.prevention_actions),
            selectinload(models.RcaRecord.linked_failure_modes).selectinload(models.FarFailureMode.mitigations),
            selectinload(models.RcaRecord.linked_failure_modes).selectinload(models.FarFailureMode.prevention_actions),
            selectinload(models.RcaRecord.linked_failure_modes).selectinload(models.FarFailureMode.linked_rcas),
        ).filter(models.RcaRecord.is_deleted == False).order_by(models.RcaRecord.id.desc()),
        schemas.RcaRecordResponse,
        "rca",
    )
    await validate_first(
        select(models.FarFailureMode).options(
            selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.resolutions).selectinload(models.FarResolution.knowledge_bkm),
            selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.mitigations),
            selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.prevention_actions),
            selectinload(models.FarFailureMode.mitigations),
            selectinload(models.FarFailureMode.affected_assets),
            selectinload(models.FarFailureMode.prevention_actions),
            selectinload(models.FarFailureMode.linked_rcas),
        ).filter(models.FarFailureMode.is_deleted == False).order_by(models.FarFailureMode.id.desc()),
        schemas.FarFailureModeResponse,
        "far",
    )
    await validate_first(
        select(models.ExternalEntity).options(
            selectinload(models.ExternalEntity.secrets),
            selectinload(models.ExternalEntity.internal_team),
            selectinload(models.ExternalEntity.internal_operator),
        ).filter(models.ExternalEntity.is_deleted == False).order_by(models.ExternalEntity.id.desc()),
        schemas.ExternalEntityResponse,
        "external_entities",
    )
    await validate_first(
        select(models.ExternalLink).order_by(models.ExternalLink.id.desc()),
        schemas.ExternalLinkResponse,
        "external_links",
    )
    await validate_first(
        select(models.MonitoringItem).options(
            selectinload(models.MonitoringItem.owners),
            selectinload(models.MonitoringItem.device),
        ).filter(models.MonitoringItem.is_deleted == False).order_by(models.MonitoringItem.id.desc()),
        schemas.MonitoringItemResponse,
        "monitoring",
    )
    await validate_first(
        select(models.Project).options(
            selectinload(models.Project.tasks).selectinload(models.ProjectTask.comments),
            selectinload(models.Project.tasks).selectinload(models.ProjectTask.qa_items),
            selectinload(models.Project.tasks).selectinload(models.ProjectTask.subtasks),
            selectinload(models.Project.comments),
            selectinload(models.Project.qa_items),
        ).filter(models.Project.is_deleted == False).order_by(models.Project.id.desc()),
        schemas.ProjectResponse,
        "projects",
    )
    await validate_first(
        select(models.Vendor).options(
            selectinload(models.Vendor.personnel),
            selectinload(models.Vendor.contracts),
        ).filter(models.Vendor.is_deleted == False).order_by(models.Vendor.id.desc()),
        schemas.VendorResponse,
        "vendors",
    )

    from app.api.logical_services import serialize_service
    from app.api.devices import get_devices

    async with session_factory() as session:
        service_result = await session.execute(
            select(models.LogicalService)
            .options(
                selectinload(models.LogicalService.secrets),
                selectinload(models.LogicalService.device),
            )
            .filter(models.LogicalService.is_deleted == False)
            .order_by(models.LogicalService.id.desc())
            .limit(3)
        )
        services = service_result.unique().scalars().all()
        if not services:
            failures.append("services: no records returned for validation")
        else:
            for index, service in enumerate(services, start=1):
                try:
                    payload = serialize_service(service, service.device.name if service.device else "Unassigned")
                    schemas.LogicalServiceResponse.model_validate(payload)
                except Exception as exc:  # pragma: no cover
                    failures.append(f"services record {index} failed LogicalServiceResponse: {exc}")
                    break
            else:
                validation_summary["services"] = len(services)

    async with session_factory() as session:
        try:
            scope = {"type": "http", "method": "GET", "state": {"tenant_id": 1}}
            mock_request = Request(scope)
            device_payloads = await get_devices(request=mock_request, include_deleted=False, db=session)
        except Exception as exc:  # pragma: no cover
            failures.append(f"devices endpoint shape failed: {exc}")
        else:
            if not device_payloads:
                failures.append("devices: no records returned for validation")
            else:
                for index, payload in enumerate(device_payloads, start=1):
                    try:
                        schemas.DeviceResponse.model_validate(payload)
                    except Exception as exc:  # pragma: no cover
                        failures.append(f"devices record {index} failed DeviceResponse: {exc}")
                        break
                else:
                    validation_summary["devices"] = len(device_payloads)

    await engine.dispose()

    if failures:
        raise SeedDataValidationError(failures)

    return validation_summary

class SeedDataValidationError(Exception):
    def __init__(self, failures: list[str]):
        self.failures = failures
        super().__init__("Seed Data Validation Errors:\n" + "\n".join(f"- {f}" for f in failures))

async def main():
    parser = argparse.ArgumentParser(description="Ultimate SysGrid Seeder")
    parser.add_argument("--tenant-name", default="Local Demo")
    parser.add_argument("--tenant-db", default="tenants/local-demo/local_demo.db")
    parser.add_argument("--admin-user", default="haewon.kim")
    parser.add_argument("--admin-full-name", default=None, help="Display name for the primary disposable admin")
    parser.add_argument("--admin-email", default=None, help="Email for the primary disposable admin")
    parser.add_argument("--admin-department", default="Infrastructure", help="Department for disposable admins")
    parser.add_argument("--extra-admin-user", action="append", default=[], help="Additional user ids to grant admin access and select for this tenant")
    parser.add_argument("--seed-data", action="store_true", help="Seed full domain data")
    parser.add_argument("--no-seed-data", action="store_true", help="Skip domain/demo data and create only the bootstrap shell")
    args = parser.parse_args()

    tenant_db_path = normalize_db_path(args.tenant_db)
    tenant_db_path.parent.mkdir(parents=True, exist_ok=True)
    tenant_db_url = sqlite_async_url_from_path(tenant_db_path)

    print(f"--- Bootstrapping {args.tenant_name} ---")
    ensure_config_schema()
    run_tenant_migrations(tenant_db_url)
    ensure_seed_schema_compatibility(tenant_db_url)
    register_tenant_and_access(
        tenant_name=args.tenant_name,
        tenant_db_url=tenant_db_url,
        admin_user=args.admin_user,
        select_for_user=True
    )
    await ensure_tenant_admin_async(
        tenant_db_url=tenant_db_url,
        admin_user=args.admin_user,
        full_name=args.admin_full_name,
        email=args.admin_email,
        department=args.admin_department,
    )
    ensure_additional_admin_access(
        tenant_name=args.tenant_name,
        tenant_db_url=tenant_db_url,
        admin_users=args.extra_admin_user,
    )
    await ensure_additional_admins_async(
        tenant_db_url=tenant_db_url,
        admin_users=args.extra_admin_user,
        department=args.admin_department,
    )

    should_seed_data = args.seed_data and not args.no_seed_data
    try:
        if should_seed_data:
            await seed_domain_data(tenant_db_url)

        foundation_validation = validate_seed_foundation(
            tenant_db_url=tenant_db_url,
            seeded_domain_data=should_seed_data,
        )
        api_contract_validation = await validate_seed_api_contracts(
            tenant_db_url=tenant_db_url,
            seeded_domain_data=should_seed_data,
        )
    except SeedDataValidationError as e:
        print("\n" + "="*80)
        print("SEED DATA VALIDATION FAILED")
        print("The seeded data does not conform to the required schema.")
        print("Please fix the data generation logic in seed.py.")
        print("="*80)
        for failure in e.failures:
            print(f"FAILED: {failure}")
        sys.exit(1)
    except Exception as e:
        print(f"\nUNEXPECTED APPLICATION ERROR: {e}")
        sys.exit(1)


    report = collect_bootstrap_report(
        tenant_name=args.tenant_name,
        tenant_db_url=tenant_db_url,
        users=[args.admin_user, *args.extra_admin_user],
    )

    print("\nSUCCESS: Environment Ready.")
    print(f"Tenant: {args.tenant_name}")
    print(f"DB Path: {tenant_db_path}")
    print(f"Admin: {args.admin_user}")
    if args.extra_admin_user:
        print(f"Extra Admins: {', '.join(args.extra_admin_user)}")
    print(f"Seeded Domain Data: {'yes' if should_seed_data else 'no'}")
    print("Validation Summary:")
    print({
        "foundation": foundation_validation,
        "api_contracts": api_contract_validation,
    })
    print("Bootstrap Report:")
    print(report)

if __name__ == "__main__":
    asyncio.run(main())
