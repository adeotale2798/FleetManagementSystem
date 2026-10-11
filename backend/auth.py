import hashlib
import os
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from access_control import ADMIN_ACCESS_DEFAULTS, enforce_request_access
from db import PRIMARY_TENANT, platform_db, set_tenant

SECRET = os.environ["JWT_SECRET"]
ALGO = "HS256"
bearer = HTTPBearer(auto_error=False)


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def normalize_username(username: str) -> str:
    return username.strip().lower()


def hash_manager_pw(pw: str) -> str:
    digest = hashlib.sha256(pw.encode("utf-8")).hexdigest().encode("ascii")
    return f"bcrypt-sha256${bcrypt.hashpw(digest, bcrypt.gensalt()).decode()}"


def verify_pw(pw: str, hashed: str) -> bool:
    try:
        if hashed.startswith("bcrypt-sha256$"):
            digest = hashlib.sha256(pw.encode("utf-8")).hexdigest().encode("ascii")
            legacy_bcrypt_hash = hashed[len("bcrypt-sha256$"):]
            return bcrypt.checkpw(digest, legacy_bcrypt_hash.encode())
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def make_token(username: str) -> str:
    payload = {"sub": username, "exp": datetime.now(timezone.utc) + timedelta(days=30)}
    return jwt.encode(payload, SECRET, algorithm=ALGO)


def make_support_token(username: str, tenant_id: str):
    expires_at = datetime.now(timezone.utc) + timedelta(hours=2)
    session_id = uuid.uuid4().hex
    payload = {
        "sub": username,
        "purpose": "platform_support",
        "support_tenant_id": tenant_id,
        "support_session_id": session_id,
        "exp": expires_at,
    }
    return jwt.encode(payload, SECRET, algorithm=ALGO), session_id, expires_at


async def upsert_user(username, name, password, role, tenant_id):
    username = normalize_username(username)
    existing = await platform_db.users.find_one({"_id": username})
    if existing and (
        existing.get("role", "owner") != role
        or existing.get("tenant_id") != tenant_id
    ):
        raise RuntimeError("Configured username conflicts with an existing account")
    fields = {"name": name, "role": role, "tenant_id": tenant_id, "active": True}
    if existing:
        stored = existing.get("password") or ""
        if not stored or not verify_pw(password, stored):
            fields["password"] = hash_pw(password)
        await platform_db.users.update_one({"_id": username}, {"$set": fields})
        return
    await platform_db.users.insert_one({
        "_id": username, "password": hash_pw(password), **fields,
        "created_by_id": "system:bootstrap",
        "created_by_login": "system:bootstrap",
        "created_by_name": "System bootstrap",
        "created_by_role": "system",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


async def seed_owner():
    """Platform super admin + the first business (New Naidu Transport) and its owner."""
    owner_username = normalize_username(os.environ["OWNER_USERNAME"])
    tenant = await platform_db.tenants.find_one({"_id": PRIMARY_TENANT})
    if not tenant:
        await platform_db.tenants.insert_one({
            "_id": PRIMARY_TENANT,
            "name": "New Naidu Transport",
            "owner_name": "Priyanshu Naidu",
            "owner_username": owner_username,
            "city": "Hinganghat", "state": "Maharashtra", "mobile": "",
            "plan": "Business", "license_status": "Active",
            "license_start": datetime.now(timezone.utc).date().isoformat(),
            "license_expiry": (datetime.now(timezone.utc) + timedelta(days=365)).date().isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    else:
        await platform_db.tenants.update_one(
            {"_id": PRIMARY_TENANT}, {"$set": {"owner_username": owner_username}},
        )

    await upsert_user(normalize_username(os.environ["PLATFORM_USERNAME"]), "Platform Owner",
                      os.environ["PLATFORM_PASSWORD"], "superadmin", None)
    await upsert_user(owner_username, "Priyanshu Naidu",
                      os.environ["OWNER_PASSWORD"], "owner", PRIMARY_TENANT)
    await upsert_user("priyanshu", "Priyanshu Naidu",
                      os.environ["OWNER_PASSWORD"], "owner", PRIMARY_TENANT)


async def _resolve_principal(cred: HTTPAuthorizationCredentials):
    if not cred:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        data = jwt.decode(cred.credentials, SECRET, algorithms=[ALGO])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = await platform_db.users.find_one({"_id": data["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("active") is False:
        raise HTTPException(status_code=403, detail="This account has been deactivated")
    role = user.get("role", "owner")
    if data.get("purpose") == "platform_support":
        tenant_id = data.get("support_tenant_id")
        session_id = data.get("support_session_id")
        if role != "superadmin" or not tenant_id or not session_id:
            raise HTTPException(status_code=401, detail="Invalid platform support session")
        session = await platform_db.platform_support_sessions.find_one({
            "_id": session_id,
            "username": user["_id"],
            "tenant_id": tenant_id,
            "active": True,
        })
        if not session:
            raise HTTPException(status_code=401, detail="Platform support session has ended")
        tenant = await platform_db.tenants.find_one({"_id": tenant_id})
        if not tenant:
            raise HTTPException(status_code=404, detail="Customer business not found")
        set_tenant(tenant_id)
        return {
            "username": user["_id"],
            "name": user.get("name", "Platform Owner"),
            "role": "owner",
            "actor_role": "platform_support",
            "platform_support": True,
            "platform_actor": user["_id"],
            "support_session_id": session_id,
            "tenant_id": tenant_id,
            "tenant_name": tenant.get("name", ""),
            "site_ids": [],
            "site_permissions": {},
            "admin_access": dict(ADMIN_ACCESS_DEFAULTS),
            "tenant_access": dict(ADMIN_ACCESS_DEFAULTS),
            "tenant_features": {
                key: True for key in (
                    "trips", "vehicles", "parties", "team", "finance", "reports",
                    "tracking", "lr_charts", "dashboard_charts",
                )
            },
        }
    if "support_tenant_id" in data or "support_session_id" in data:
        raise HTTPException(status_code=401, detail="Invalid platform support session")
    tenant_id = user.get("tenant_id")
    tenant = await platform_db.tenants.find_one({"_id": tenant_id}) if tenant_id else None
    if tenant and tenant.get("license_status") != "Active" and role != "superadmin":
        raise HTTPException(status_code=403, detail="Licence is not active. Please contact the platform owner.")
    set_tenant(tenant_id)
    return {"username": user["_id"], "name": user.get("name", "Owner"), "role": role,
            "tenant_id": tenant_id, "tenant_name": (tenant or {}).get("name", ""),
            "site_ids": user.get("site_ids") or [],
            "site_permissions": user.get("site_permissions") or {},
            "admin_access": user.get("admin_access"),
            "tenant_access": (tenant or {}).get("subscription_access"),
            "tenant_features": (tenant or {}).get("features") or {}}


async def current_user(
    cred: HTTPAuthorizationCredentials = Depends(bearer), request: Request = None,
):
    user = await _resolve_principal(cred)
    if user["role"] != "owner":
        raise HTTPException(status_code=403, detail="Business owner access only")
    if request is not None:
        if user.get("platform_support"):
            request.state.platform_support = {
                "tenant_id": user["tenant_id"],
                "actor": user["platform_actor"],
                "session_id": user["support_session_id"],
            }
        await enforce_request_access(request, user)
    return user


async def site_user(
    cred: HTTPAuthorizationCredentials = Depends(bearer), request: Request = None,
):
    user = await _resolve_principal(cred)
    if user["role"] == "owner":
        if request is not None:
            if user.get("platform_support"):
                request.state.platform_support = {
                    "tenant_id": user["tenant_id"],
                    "actor": user["platform_actor"],
                    "session_id": user["support_session_id"],
                }
            await enforce_request_access(request, user)
    elif (user["role"] == "site_manager"
          and isinstance(user.get("tenant_access"), dict)
          and user["tenant_access"].get("booking") is not True
          and request is not None and request.url.path != "/api/me"):
        raise HTTPException(
            status_code=403,
            detail="Booking is not included in this customer subscription. Please contact the platform owner.",
        )
    return user


async def require_super(cred: HTTPAuthorizationCredentials = Depends(bearer)):
    u = await _resolve_principal(cred)
    if u["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Platform owner access only")
    return u


async def require_platform_support(cred: HTTPAuthorizationCredentials = Depends(bearer)):
    user = await _resolve_principal(cred)
    if not user.get("platform_support"):
        raise HTTPException(status_code=403, detail="Active platform support session required")
    return user
