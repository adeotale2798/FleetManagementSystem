import os
import re
import uuid
import hashlib
import contextvars
from pathlib import Path
from datetime import datetime, timezone, date

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")

BASE_DB = os.environ["DB_NAME"]
PRIMARY_TENANT = "naidu"
MAX_MONGO_DATABASE_NAME_BYTES = 63

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
platform_db = client[f"{BASE_DB}_platform"]
_tenant = contextvars.ContextVar("tenant_db", default=BASE_DB)


def slug_label(text, n=28):
    t = re.sub(r"[^A-Za-z0-9]+", "_", (text or "").strip())
    t = re.sub(r"_+", "_", t).strip("_")
    return (t or "biz")[:n]


def tenant_key(business_name, owner_name, collision_index=None):
    """Readable tenant id: BusinessName_OwnerName"""
    readable = f"{slug_label(business_name)}_{slug_label(owner_name)}"
    suffix = f"_{collision_index}" if collision_index is not None else ""
    max_id_bytes = (
        MAX_MONGO_DATABASE_NAME_BYTES
        - len(BASE_DB.encode("utf-8"))
        - 1
        - len(suffix.encode("utf-8"))
    )
    if max_id_bytes < 1:
        raise ValueError("DB_NAME is too long to create a tenant database.")
    if len(readable.encode("utf-8")) <= max_id_bytes:
        return f"{readable}{suffix}"

    digest = hashlib.sha256(readable.encode("utf-8")).hexdigest()[:8]
    prefix_bytes = max_id_bytes - len(digest) - 1
    if prefix_bytes > 0:
        readable = f"{readable[:prefix_bytes].rstrip('_')}_{digest}"
    else:
        readable = digest[:max_id_bytes]
    return f"{readable}{suffix}"


def tenant_db_name(tenant_id):
    if tenant_id in (None, "", PRIMARY_TENANT):
        return BASE_DB
    # Old licences used a 12-char hex id as the database suffix.
    if re.fullmatch(r"[a-f0-9]{12}", str(tenant_id)):
        return f"{BASE_DB}_{tenant_id}"
    return f"{BASE_DB}_{tenant_id}"


def set_tenant(tenant_id):
    _tenant.set(tenant_db_name(tenant_id))


def current_db_name():
    return _tenant.get()


def tenant_db(tenant_id):
    return client[tenant_db_name(tenant_id)]


class _TenantDB:
    """Every business collection resolves to the signed-in tenant's own database."""

    def __getattr__(self, name):
        return client[_tenant.get()][name]

    def __getitem__(self, name):
        return client[_tenant.get()][name]


db = _TenantDB()


def new_id() -> str:
    return uuid.uuid4().hex


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today() -> str:
    return date.today().isoformat()


def ser(doc):
    if not doc:
        return None
    d = dict(doc)
    d["id"] = d.pop("_id")
    return d


def sers(docs):
    return [ser(d) for d in docs]
