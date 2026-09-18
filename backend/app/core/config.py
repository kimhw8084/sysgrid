from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List
from urllib.parse import urlparse
import os
import re


class Settings(BaseSettings):
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "SYSGRID Production API"

    # Runtime mode. Production must be selected explicitly in deployment config.
    ENVIRONMENT: str = "development"  # development, production, test
    PORT: int = 8000

    # CORS and host controls
    BACKEND_CORS_ORIGINS: str = "*"
    ALLOWED_HOSTS: str = "localhost,127.0.0.1,testserver"

    # Identity contract
    # development: browser X-User-Id fallback is accepted for local/test use.
    # trusted_proxy: only the configured proxy-authenticated header is accepted.
    IDENTITY_MODE: str = "development"
    TRUSTED_PROXY_USER_HEADER: str = "X-Authenticated-User"

    # Deployment/runtime configuration
    DATABASE_URL: str = ""
    CONFIG_DATABASE_URL: str = ""
    TENANT_STORAGE_ROOT: str = ""
    BACKEND_ENV_FILE_PATH: str = ""
    FRONTEND_ENV_FILE_PATH: str = ""
    DEFAULT_TENANT_NAME: str = "Default Engine"
    PUBLIC_READONLY_TENANT_NAME: str = ""
    PUBLIC_READONLY_ENABLED: bool = True
    ALLOW_PUBLIC_READONLY_IN_PRODUCTION: bool = False
    DEFAULT_USER_ID: str = "admin_root"
    AUTO_ADMIN_USER_IDS: str = "admin_root"
    ALLOW_AUTO_ADMIN_IN_PRODUCTION: bool = False
    # Global control-plane administration is intentionally separate from
    # tenant ADMIN access. Production must configure this explicitly.
    CONTROL_PLANE_ADMIN_USER_IDS: str = ""
    CONTROL_PLANE_BOOTSTRAP_ENABLED: bool = False
    CONTROL_PLANE_BOOTSTRAP_USER_ID: str = ""
    # Reserved System Root is a deployment-owned identity plane. It is never
    # inferred from tenant ADMIN/is_admin, wildcard permissions, or browser state.
    SYSTEM_ROOT_USER_IDS: str = ""
    # Optional deployment kill-switches for catalog stages, expressed as
    # comma-separated module=stage pairs (production, preview, disabled, retired).
    MODULE_STAGE_OVERRIDES: str = ""
    SCHEDULE_PREVIEW_SIGNING_KEY: str = "development-only-schedule-preview-key"
    # Trusted deployment identity for release field evidence. Browser hints
    # are never authoritative for this value.
    PV1_RELEASE_CANDIDATE_SHA: str = ""
    PV1_RELEASE_ID: str = ""

    # Application-boundary overload protection. A gateway should enforce the
    # same policy across workers; this bounded fallback remains enabled in the
    # application so a single worker cannot be driven without a limit.
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_REQUESTS: int = 600
    RATE_LIMIT_WINDOW_SECONDS: int = 60

    # Startup schema mutation is convenient in development/test but dangerous in
    # production. Production requires an explicit acknowledgement before either
    # config create_all or Alembic upgrade runs during application startup.
    AUTO_MIGRATE_ON_STARTUP: bool = True
    ALLOW_AUTO_MIGRATE_IN_PRODUCTION: bool = False

    USER_ID_ENV_VAR: str = "USER_ID"
    DEFAULT_OPERATOR_DEPARTMENT: str = "Infrastructure"
    DEFAULT_SUPPORT_EMAIL: str = "admin@infra.local"
    DEFAULT_EMAIL_DOMAIN: str = "sysgrid.local"
    DEFAULT_ORG_NAME: str = "Global Infrastructure Corp"
    DEFAULT_SITE_ID: str = "HQ-01"
    DEFAULT_APP_NAME: str = "SYSGRID ENGINE"
    DEFAULT_UI_TITLE: str = "SYSGRID Tactical"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    @property
    def environment_name(self) -> str:
        return (self.ENVIRONMENT or "development").strip().lower()

    @property
    def is_production(self) -> bool:
        return self.environment_name == "production"

    @property
    def identity_mode(self) -> str:
        return (self.IDENTITY_MODE or "development").strip().lower()

    @property
    def startup_schema_management_enabled(self) -> bool:
        if not self.AUTO_MIGRATE_ON_STARTUP:
            return False
        if self.is_production:
            return bool(self.ALLOW_AUTO_MIGRATE_IN_PRODUCTION)
        return True

    @property
    def startup_schema_policy(self) -> str:
        return "automatic" if self.startup_schema_management_enabled else "operator_managed"

    @property
    def is_testing(self) -> bool:
        return self.environment_name == "test" or (
            os.getenv("TESTING", "").strip().lower() in {"1", "true", "yes", "on"}
        )

    @property
    def cors_origins(self) -> List[str]:
        # Test runs must be deterministic and must not inherit a developer's
        # local CORS allow-list from backend/.env. Production never enters this
        # branch and explicitly rejects TESTING mode below.
        if self.is_testing and not self.is_production:
            return ["*"]
        if not self.BACKEND_CORS_ORIGINS or self.BACKEND_CORS_ORIGINS == "*":
            return ["*"]
        return [origin.strip() for origin in self.BACKEND_CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def allowed_hosts(self) -> List[str]:
        configured = [host.strip() for host in self.ALLOWED_HOSTS.split(",") if host.strip()]
        if self.is_production:
            return configured

        # Starlette/httpx test clients commonly use `test` or `testserver` as
        # the Host header. Keep those development-only aliases accepted even
        # when a local .env overrides ALLOWED_HOSTS.
        development_hosts = ["localhost", "127.0.0.1", "test", "testserver"]
        return list(dict.fromkeys([*configured, *development_hosts]))

    def production_guard_errors(self) -> list[str]:
        if not self.is_production:
            return []

        errors: list[str] = []
        if self.is_testing:
            errors.append("TESTING mode must not be enabled in production.")
        if self.identity_mode != "trusted_proxy":
            errors.append("IDENTITY_MODE must be 'trusted_proxy' in production.")
        if not self.TRUSTED_PROXY_USER_HEADER.strip():
            errors.append("TRUSTED_PROXY_USER_HEADER must be configured in production.")
        if self.TRUSTED_PROXY_USER_HEADER.strip().lower() == "x-user-id":
            errors.append("TRUSTED_PROXY_USER_HEADER must not use the browser-controlled X-User-Id header.")
        if not re.fullmatch(r"[0-9a-f]{64}", self.PV1_RELEASE_CANDIDATE_SHA.strip().lower()):
            errors.append("PV1_RELEASE_CANDIDATE_SHA must be a valid committed candidate SHA in production.")
        if not self.PV1_RELEASE_ID.strip():
            errors.append("PV1_RELEASE_ID must identify the deployed release in production.")

        origins = self.cors_origins
        if not origins or "*" in origins:
            errors.append("BACKEND_CORS_ORIGINS must contain explicit HTTPS origins; wildcard CORS is forbidden in production.")
        else:
            for origin in origins:
                parsed = urlparse(origin)
                if parsed.scheme != "https" or not parsed.hostname:
                    errors.append(f"Production CORS origin must be an explicit HTTPS origin: {origin}")

        hosts = self.allowed_hosts
        if not hosts or "*" in hosts:
            errors.append("ALLOWED_HOSTS must contain explicit deployment hostnames; wildcard hosts are forbidden in production.")

        if self.PUBLIC_READONLY_ENABLED and not self.ALLOW_PUBLIC_READONLY_IN_PRODUCTION:
            errors.append("PUBLIC_READONLY_ENABLED must be false in production unless explicitly acknowledged.")
        if self.auto_admin_user_ids and not self.ALLOW_AUTO_ADMIN_IN_PRODUCTION:
            errors.append("AUTO_ADMIN_USER_IDS must be empty in production unless explicitly acknowledged.")
        if not self.control_plane_admin_user_ids:
            errors.append("CONTROL_PLANE_ADMIN_USER_IDS must contain explicit global administrator identities in production.")
        if not self.system_root_user_ids:
            errors.append("SYSTEM_ROOT_USER_IDS must contain explicit reserved System Root identities in production.")
        if self.CONTROL_PLANE_BOOTSTRAP_ENABLED:
            errors.append("CONTROL_PLANE_BOOTSTRAP_ENABLED must be false in production.")
        if self.CONTROL_PLANE_BOOTSTRAP_USER_ID.strip():
            errors.append("CONTROL_PLANE_BOOTSTRAP_USER_ID must be empty in production.")
        if self.DEFAULT_USER_ID.strip().lower() == "admin_root":
            errors.append("DEFAULT_USER_ID must not remain admin_root in production.")
        if len(self.SCHEDULE_PREVIEW_SIGNING_KEY.strip()) < 32 or self.SCHEDULE_PREVIEW_SIGNING_KEY == "development-only-schedule-preview-key":
            errors.append("SCHEDULE_PREVIEW_SIGNING_KEY must be a deployment-specific secret of at least 32 characters.")

        for env_name in ("DATABASE_URL", "CONFIG_DATABASE_URL", "TENANT_STORAGE_ROOT"):
            if not os.getenv(env_name):
                errors.append(f"{env_name} must be explicitly configured in production.")
        return errors

    def assert_production_safe(self) -> None:
        errors = self.production_guard_errors()
        if errors:
            formatted = "\n - ".join(errors)
            raise RuntimeError(f"Unsafe SysGrid production configuration:\n - {formatted}")

    def model_post_init(self, __context) -> None:
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        frontend_dir = os.path.join(os.path.dirname(base_dir), "frontend")

        def resolve_db_url(url: str, default_filename: str) -> str:
            if not url:
                return f"sqlite+aiosqlite:///{os.path.join(base_dir, default_filename)}"
            if url.startswith("sqlite+aiosqlite:///./"):
                relative_path = url.replace("sqlite+aiosqlite:///./", "")
                return f"sqlite+aiosqlite:///{os.path.join(base_dir, relative_path)}"
            return url

        object.__setattr__(self, "DATABASE_URL", resolve_db_url(self.DATABASE_URL, "system_grid.db"))
        object.__setattr__(self, "CONFIG_DATABASE_URL", resolve_db_url(self.CONFIG_DATABASE_URL, "config.db"))

        if not self.TENANT_STORAGE_ROOT:
            object.__setattr__(self, "TENANT_STORAGE_ROOT", os.path.join(base_dir, "tenants"))
        if not self.BACKEND_ENV_FILE_PATH:
            object.__setattr__(self, "BACKEND_ENV_FILE_PATH", os.path.join(base_dir, ".env"))
        if not self.FRONTEND_ENV_FILE_PATH:
            frontend_env_local = os.path.join(frontend_dir, ".env.local")
            frontend_env_default = os.path.join(frontend_dir, ".env")
            object.__setattr__(
                self,
                "FRONTEND_ENV_FILE_PATH",
                frontend_env_local if os.path.exists(frontend_env_local) else frontend_env_default,
            )
        if not self.PUBLIC_READONLY_TENANT_NAME:
            object.__setattr__(self, "PUBLIC_READONLY_TENANT_NAME", self.DEFAULT_TENANT_NAME)

    @property
    def auto_admin_user_ids(self) -> set[str]:
        return {
            user_id.strip()
            for user_id in self.AUTO_ADMIN_USER_IDS.split(",")
            if user_id.strip()
        }

    def is_auto_admin_user(self, user_id: str | None) -> bool:
        return bool(user_id and user_id in self.auto_admin_user_ids)

    @property
    def control_plane_admin_user_ids(self) -> set[str]:
        return {
            user_id.strip()
            for user_id in self.CONTROL_PLANE_ADMIN_USER_IDS.split(",")
            if user_id.strip()
        }

    @property
    def control_plane_bootstrap_user_id(self) -> str:
        return self.CONTROL_PLANE_BOOTSTRAP_USER_ID.strip()

    @property
    def system_root_user_ids(self) -> set[str]:
        return {
            user_id.strip()
            for user_id in self.SYSTEM_ROOT_USER_IDS.split(",")
            if user_id.strip()
        }

    @property
    def module_stage_overrides(self) -> dict[str, str]:
        allowed = {"production", "preview", "disabled", "retired"}
        overrides: dict[str, str] = {}
        for raw_entry in self.MODULE_STAGE_OVERRIDES.split(","):
            if "=" not in raw_entry:
                continue
            module_id, stage = (part.strip().lower() for part in raw_entry.split("=", 1))
            if module_id and stage in allowed:
                overrides[module_id] = stage
        return overrides


settings = Settings()
