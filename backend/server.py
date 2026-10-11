import asyncio
import os
import re
import traceback
import json
import math
import jwt
from typing import Optional

from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pymongo import ReturnDocument
from starlette.exceptions import HTTPException as StarletteHTTPException

import ledger as L
import storage as S
from access_control import (
    ADMIN_ACCESS_DENIED, ADMIN_ACCESS_DEFAULTS, has_admin_access, normalize_admin_access,
    validate_admin_access,
)
from auth import (
    ALGO, SECRET, current_user, hash_pw, make_support_token, make_token,
    require_platform_support, require_super, seed_owner, site_user, verify_pw,
)
from db import PRIMARY_TENANT, db, new_id, now_iso, platform_db, ser, sers, tenant_db, tenant_db_name, tenant_key, today

app = FastAPI(title="Fleet Management System")
api = APIRouter(prefix="/api")
from site_ops import initialize_site_storage, router as site_router

app.include_router(site_router, prefix="/api")

_SENSITIVE_VALUE = re.compile(
    r"(?i)([\"']?[A-Za-z0-9_.-]*(?:password|passwd|token|authorization|secret)"
    r"[A-Za-z0-9_.-]*[\"']?\s*[:=]\s*)"
    r"(?:(?:Bearer)\s+)?(?:\"[^\"]*\"|'[^']*'|[^\s,;}]+)"
)
_BEARER_TOKEN = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")
_URI_CREDENTIALS = re.compile(r"(?i)(://[^:/@\s]+:)[^@/\s]+(@)")
_JWT = re.compile(
    r"(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}(?![A-Za-z0-9_-])"
)


def _redact_error_text(value):
    text = str(value)
    text = _SENSITIVE_VALUE.sub(r"\1[REDACTED]", text)
    text = _URI_CREDENTIALS.sub(r"\1[REDACTED]\2", text)
    text = _JWT.sub("[REDACTED]", text)
    return _BEARER_TOKEN.sub("Bearer [REDACTED]", text)


async def _record_server_error(request, status, reference_id, detail, stack=""):
    try:
        await platform_db.error_logs.insert_one({
            "_id": new_id(),
            "status": status,
            "path": request.url.path,
            "method": request.method,
            "detail": f"Reference {reference_id}: {_redact_error_text(detail)}",
            "traceback": _redact_error_text(stack) if stack else "",
            "reference_id": reference_id,
            "created_at": now_iso(),
        })
    except Exception:
        pass


async def _record_data_revision(request):
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    try:
        claims = jwt.decode(token, SECRET, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None
    scope_id = claims.get("support_tenant_id")
    if not scope_id:
        user = await platform_db.users.find_one(
            {"_id": claims.get("sub")}, {"tenant_id": 1},
        )
        if not user:
            return None
        scope_id = user.get("tenant_id") or "__platform__"
    scope_id = str(scope_id)
    revision = await platform_db.data_revisions.find_one_and_update(
        {"_id": scope_id},
        {"$inc": {"revision": 1}, "$set": {"updated_at": now_iso()}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(revision["revision"])


def _server_error_response(reference_id):
    return JSONResponse(
        status_code=500,
        content={
            "detail": "The server could not complete this request. Please try again.",
            "reference_id": reference_id,
        },
        headers={"X-Reference-ID": reference_id},
    )


def _safe_client_error_detail(response):
    status = response.status_code
    if status >= 500 or status < 400:
        return ""
    detail = ""
    body = getattr(response, "body", b"")
    try:
        if body:
            payload = json.loads(body.decode("utf-8"))
            detail = payload.get("detail", "") if isinstance(payload, dict) else ""
    except (UnicodeDecodeError, json.JSONDecodeError):
        return ""
    if isinstance(detail, str):
        return _redact_error_text(detail)[:400]
    if isinstance(detail, list):
        messages = []
        for item in detail:
            if not isinstance(item, dict):
                if isinstance(item, str):
                    messages.append(_redact_error_text(item)[:200])
                continue
            # Validation input/context can contain private values; retain only
            # the field location and standard diagnostic message.
            location = item.get("loc")
            message = item.get("msg")
            if isinstance(location, (list, tuple)):
                location = ".".join(str(part) for part in location if part not in {"body", "query", "path"})
            else:
                location = ""
            safe_message = _redact_error_text(message)[:200] if isinstance(message, str) else ""
            if location or safe_message:
                messages.append(": ".join(part for part in (location[:160], safe_message) if part))
        return "; ".join(messages)[:400]
    return ""


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code < 500:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": jsonable_encoder(exc.detail)},
            headers=exc.headers,
        )
    reference_id = getattr(request.state, "reference_id", new_id())
    await _record_server_error(
        request, exc.status_code, reference_id, exc.detail,
        f"{type(exc).__name__}: {exc.detail}",
    )
    response = _server_error_response(reference_id)
    if exc.headers:
        response.headers.update(exc.headers)
    return response


@app.middleware("http")
async def log_failures(request: Request, call_next):
    request.state.reference_id = new_id()
    try:
        response = await call_next(request)
    except Exception as e:
        reference_id = request.state.reference_id
        await _record_server_error(
            request, 500, reference_id, str(e),
            "".join(traceback.format_exception(type(e), e, e.__traceback__)),
        )
        return _server_error_response(reference_id)
    if response.status_code >= 500 and not response.headers.get("X-Reference-ID"):
        reference_id = request.state.reference_id
        await _record_server_error(
            request, response.status_code, reference_id,
            f"Server returned HTTP {response.status_code} without an exception detail.",
        )
        response = _server_error_response(reference_id)
    elif (
        400 <= response.status_code < 500
        and request.method.upper() in {"POST", "PUT", "PATCH", "DELETE"}
        and not request.url.path.rstrip("/").endswith("/auth/login")
    ):
        await _record_server_error(
            request, response.status_code, request.state.reference_id,
            _safe_client_error_detail(response),
        )
    if (
        200 <= response.status_code < 300
        and request.method.upper() in {"POST", "PUT", "PATCH", "DELETE"}
        and request.url.path.startswith("/api/")
        and not request.url.path.rstrip("/").endswith("/auth/login")
    ):
        support_context = getattr(request.state, "platform_support", None)
        if support_context and request.url.path != "/api/platform/support-session/end":
            try:
                await platform_db.subscription_audit_events.insert_one({
                    "_id": new_id(),
                    "tenant_id": support_context["tenant_id"],
                    "actor": support_context["actor"],
                    "action": "support.data.write",
                    "summary": (
                        f"Platform support performed {request.method.upper()} "
                        f"{request.url.path}."
                    ),
                    "details": {
                        "session_id": support_context["session_id"],
                        "method": request.method.upper(),
                        "path": request.url.path,
                        "status_code": response.status_code,
                    },
                    "created_at": now_iso(),
                })
            except Exception as e:
                response.headers["X-Support-Audit-Status"] = "unavailable"
                await _record_server_error(
                    request, 500, new_id(),
                    "Could not record a platform support data change.",
                    "".join(traceback.format_exception(type(e), e, e.__traceback__)),
                )
        try:
            revision = await _record_data_revision(request)
            if revision is not None:
                response.headers["X-Data-Revision"] = str(revision)
        except Exception as e:
            response.headers["X-Data-Sync-Status"] = "unavailable"
            await _record_server_error(
                request, 500, new_id(), "Could not publish a tenant data revision.",
                "".join(traceback.format_exception(type(e), e, e.__traceback__)),
            )
    return response


app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
    expose_headers=[
        "X-Data-Revision", "X-Data-Sync-Status", "X-Reference-ID",
        "X-Support-Audit-Status",
    ],
)


DEFAULT_SETTINGS = {
    "_id": "settings",
    "company": {
        "name": "New Naidu Transport", "logo": "", "address": "",
        "city": "Hinganghat", "state": "Maharashtra", "mobile": "",
        "alt_mobile": "", "email": "", "gstin": "", "pan": "",
        "footer": "Thank you for your business.",
        "terms": "Goods are transported at owner's risk. Subject to Hinganghat jurisdiction.",
    },
    "base_locations": [
        {"id": "loc_hinganghat", "name": "Hinganghat", "address": "Hinganghat, Maharashtra", "city": "Hinganghat", "state": "Maharashtra", "active": True},
        {"id": "loc_nagpur", "name": "Nagpur", "address": "Nagpur, Maharashtra", "city": "Nagpur", "state": "Maharashtra", "active": True},
        {"id": "loc_wadi", "name": "Wadi", "address": "Wadi, Nagpur, Maharashtra", "city": "Wadi", "state": "Maharashtra", "active": True},
    ],
    "routes": [
        {"id": "rt_hng_ngp", "from_id": "loc_hinganghat", "to_id": "loc_nagpur", "name": "Hinganghat > Nagpur", "default_amount": 0, "active": True},
        {"id": "rt_ngp_hng", "from_id": "loc_nagpur", "to_id": "loc_hinganghat", "name": "Nagpur > Hinganghat", "default_amount": 0, "active": True},
        {"id": "rt_hng_wadi", "from_id": "loc_hinganghat", "to_id": "loc_wadi", "name": "Hinganghat > Wadi", "default_amount": 0, "active": True},
        {"id": "rt_wadi_hng", "from_id": "loc_wadi", "to_id": "loc_hinganghat", "name": "Wadi > Hinganghat", "default_amount": 0, "active": True},
    ],
    "expense_categories": ["Fuel", "Toll", "Loading", "Unloading", "Parking", "Repair",
                           "Service", "Food", "Driver Advance", "Employee Advance",
                           "Driver Hire", "Vehicle Hire", "Other"],
    "payment_modes": ["Cash", "UPI", "Bank", "Cheque", "Other"],
    "lr": {"prefix": "LR", "next": 1001, "pad": 4},
    "trip": {"prefix": "TRP", "next": 1001, "pad": 4},
    "receivable_due_days": 30,
    "opening_cash": 0,
    "opening_bank": 0,
}


async def cash_position():
    pos = await L.cash_position()
    s = await get_settings()
    pos["cash"] = round(pos.get("cash", 0) + float(s.get("opening_cash") or 0), 2)
    pos["bank"] = round(pos.get("bank", 0) + float(s.get("opening_bank") or 0), 2)
    return pos


async def get_settings():
    s = await db.settings.find_one({"_id": "settings"})
    if not s:
        await db.settings.insert_one(dict(DEFAULT_SETTINGS))
        s = await db.settings.find_one({"_id": "settings"})
    return s


async def next_number(kind):
    s = await db.settings.find_one_and_update(
        {"_id": "settings"}, {"$inc": {f"{kind}.next": 1}}
    )
    cfg = s.get(kind, {})
    return f"{cfg.get('prefix', kind.upper())}{str(cfg.get('next', 1)).zfill(cfg.get('pad', 4))}"


@app.on_event("startup")
async def startup():
    await seed_owner()
    await seed_subscription_plans()
    await platform_db.subscription_audit_events.create_index(
        [("tenant_id", 1), ("created_at", -1)],
    )
    await platform_db.subscription_audit_events.create_index([("created_at", -1)])
    await get_settings()
    await initialize_site_storage()
    for c, f in [("trips", "trip_no"), ("lrs", "lr_no"), ("ledger", "entity_id"),
                 ("lrs", "trip_id"), ("expenses", "trip_id"), ("fuel", "trip_id"),
                 ("cashbook", "date"), ("parties", "name")]:
        try:
            await db[c].create_index(f)
        except Exception:
            pass


# ------------------------------------------------------------------ auth
class LoginIn(BaseModel):
    username: str
    password: str


@api.post("/auth/login")
async def login(body: LoginIn):
    user = await platform_db.users.find_one({"_id": body.username.strip().lower()})
    if not user or not verify_pw(body.password, user["password"]):
        raise HTTPException(status_code=401, detail="Wrong username or password")
    if user.get("active") is False:
        raise HTTPException(status_code=403, detail="This account has been deactivated")
    tenant = await platform_db.tenants.find_one({"_id": user.get("tenant_id")}) if user.get("tenant_id") else None
    if tenant and tenant.get("license_status") != "Active":
        raise HTTPException(status_code=403, detail="Licence is not active. Please contact the platform owner.")
    return {"token": make_token(user["_id"]),
            "user": {"username": user["_id"], "name": user.get("name"),
                     "role": user.get("role", "owner"), "tenant_id": user.get("tenant_id"),
                     "tenant_name": (tenant or {}).get("name", "")}}


@api.get("/auth/me")
async def me(u=Depends(site_user)):
    return u


@api.get("/sync/revision")
async def data_revision(response: Response, u=Depends(site_user)):
    scope_id = str(u.get("tenant_id") or "__platform__")
    current = await platform_db.data_revisions.find_one(
        {"_id": scope_id}, {"revision": 1},
    )
    response.headers["Cache-Control"] = "no-store"
    return {"revision": int(current.get("revision", 0)) if current else 0}


# ------------------------------------------------------------------ settings
@api.get("/settings")
async def read_settings(u=Depends(current_user)):
    settings = ser(await get_settings())
    if not has_admin_access(u, "industrial_settings"):
        routes = settings.get("routes") or []
        if not has_admin_access(u, "industrial_finance"):
            routes = [{key: value for key, value in route.items() if key != "default_amount"}
                      for route in routes]
        return {"routes": routes, "base_locations": settings.get("base_locations") or []}
    return settings


@api.put("/settings")
async def update_settings(payload: dict, u=Depends(current_user)):
    payload.pop("id", None)
    payload.pop("_id", None)
    await db.settings.update_one({"_id": "settings"}, {"$set": payload})
    return ser(await get_settings())


# ------------------------------------------------------------------ masters
MASTERS = {
    "vehicles": ["vehicle_no", "make", "model", "vehicle_type", "owner_name"],
    "drivers": ["name", "mobile", "licence_no"],
    "team": ["name", "mobile", "role"],
    "parties": ["name", "mobile", "city", "gstin"],
    "fuel_pumps": ["name", "location", "contact"],
    "partners": ["name", "contact_person", "mobile", "city"],
}
LEDGER_ENTITY = {"parties": "party", "drivers": "driver", "team": "employee",
                 "fuel_pumps": "fuel_pump", "partners": "partner"}


def check_master(res):
    if res not in MASTERS:
        raise HTTPException(status_code=404, detail="Unknown resource")


@api.get("/masters/{res}")
async def list_master(res: str, q: Optional[str] = None, status: Optional[str] = None,
                      u=Depends(current_user)):
    check_master(res)
    query = {"archived": {"$ne": True}}
    if status:
        query["status"] = status
    if q:
        query["$or"] = [{f: {"$regex": q, "$options": "i"}} for f in MASTERS[res]]
    rows = sers(await db[res].find(query).sort("name" if res != "vehicles" else "vehicle_no", 1).to_list(2000))
    ent = LEDGER_ENTITY.get(res)
    if ent:
        bal = await L.balances(ent)
        for r in rows:
            b = bal.get(r["id"], {})
            r["balance"] = b.get("balance", 0)
            r["last_txn_date"] = b.get("last_date")
    if res == "vehicles" or res == "drivers":
        key = "vehicle_id" if res == "vehicles" else "driver_id"
        active = await db.trips.find(
            {"status": {"$in": ["Assigned", "Started", "In Transit", "Delivered"]}}
        ).to_list(500)
        m = {t.get(key): t for t in active if t.get(key)}
        for r in rows:
            t = m.get(r["id"])
            r["current_trip"] = {"id": t["_id"], "trip_no": t["trip_no"],
                                 "route": f"{t['from_name']} > {t['to_name']}",
                                 "status": t["status"]} if t else None
            if res == "vehicles" and t:
                r["current_driver_name"] = t.get("driver_name")
    if res == "vehicles" and not has_admin_access(u, "industrial_vehicles"):
        rows = [{key: row[key] for key in ("id", "vehicle_no", "status", "current_trip")
                 if key in row} for row in rows]
    if res == "drivers" and not has_admin_access(u, "industrial_team"):
        rows = [{key: row[key] for key in ("id", "name", "mobile", "status", "current_trip")
                 if key in row} for row in rows]
    return rows


@api.post("/masters/{res}")
async def create_master(res: str, payload: dict, u=Depends(current_user)):
    check_master(res)
    payload.pop("id", None)
    if res == "vehicles":
        payload["vehicle_no"] = (payload.get("vehicle_no") or "").upper().replace(" ", "")
        if not payload["vehicle_no"]:
            raise HTTPException(400, "Vehicle number is required")
        if await db.vehicles.find_one({"vehicle_no": payload["vehicle_no"], "archived": {"$ne": True}}):
            raise HTTPException(400, "This vehicle number already exists")
    else:
        if not (payload.get("name") or "").strip():
            raise HTTPException(400, "Name is required")
        payload["name"] = payload["name"].strip()
    payload.setdefault("status", "Active" if res != "vehicles" else "Available")
    opening = float(payload.pop("opening_balance", 0) or 0)
    doc = {"_id": new_id(), **payload, "archived": False, "created_at": now_iso()}
    await db[res].insert_one(doc)
    ent = LEDGER_ENTITY.get(res)
    if ent and opening:
        await L.post(ent, doc["_id"], payload.get("created_date") or today(),
                     "Opening balance", debit=max(opening, 0), credit=max(-opening, 0),
                     ref_type="opening", ref_id=doc["_id"])
    return ser(doc)


@api.get("/masters/{res}/{item_id}")
async def get_master(res: str, item_id: str, u=Depends(current_user)):
    check_master(res)
    doc = await db[res].find_one({"_id": item_id})
    if not doc:
        raise HTTPException(404, "Not found")
    out = ser(doc)
    ent = LEDGER_ENTITY.get(res)
    if ent:
        out["balance"] = (await L.balance_of(ent, item_id))["balance"]
    return out


@api.put("/masters/{res}/{item_id}")
async def update_master(res: str, item_id: str, payload: dict, u=Depends(current_user)):
    check_master(res)
    for k in ("id", "_id", "balance", "current_trip", "opening_balance"):
        payload.pop(k, None)
    if res == "vehicles" and payload.get("vehicle_no"):
        payload["vehicle_no"] = payload["vehicle_no"].upper().replace(" ", "")
    await db[res].update_one({"_id": item_id}, {"$set": payload})
    return await get_master(res, item_id, u)


@api.delete("/masters/{res}/{item_id}")
async def archive_master(res: str, item_id: str, u=Depends(current_user)):
    check_master(res)
    ent = LEDGER_ENTITY.get(res)
    if ent:
        b = await L.balance_of(ent, item_id)
        if abs(b["balance"]) > 0.5:
            raise HTTPException(400, "Cannot remove: outstanding balance exists. Settle first.")
    await db[res].update_one({"_id": item_id}, {"$set": {"archived": True, "status": "Inactive"}})
    return {"ok": True}


# party autocomplete -------------------------------------------------
@api.get("/parties/suggest")
async def suggest_parties(q: str = "", u=Depends(current_user)):
    query = {"archived": {"$ne": True}}
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}},
                        {"mobile": {"$regex": q, "$options": "i"}}]
    rows = sers(await db.parties.find(query).limit(10).to_list(10))
    bal = await L.balances("party")
    for r in rows:
        r["balance"] = bal.get(r["id"], {}).get("balance", 0)
    if not has_admin_access(u, "industrial_parties"):
        rows = [{key: row[key] for key in ("id", "name", "mobile", "city") if key in row}
                for row in rows]
    return rows


async def find_or_create_party(name, mobile=None, extra=None):
    name = (name or "").strip()
    if not name:
        return None, None
    q = {"name": {"$regex": f"^{name}$", "$options": "i"}, "archived": {"$ne": True}}
    if mobile:
        q["mobile"] = mobile
    doc = await db.parties.find_one(q)
    if doc:
        return doc["_id"], doc["name"]
    doc = {"_id": new_id(), "name": name, "mobile": mobile or "", "status": "Active",
           "archived": False, "auto_created": True, "created_at": now_iso(),
           **(extra or {})}
    await db.parties.insert_one(doc)
    return doc["_id"], doc["name"]


# ------------------------------------------------------------------ trips
ACTIVE_TRIP = ["Assigned", "Started", "In Transit", "Delivered"]


async def _trip_financial_totals(trip_ids):
    """Aggregate LR and trip-cost totals only for trips on the current page."""
    if not trip_ids:
        return {}, {}

    trip_id_filter = {"$in": trip_ids}
    lr_counts = {}
    async for r in db.lrs.aggregate([
        {"$match": {"cancelled": False, "trip_id": trip_id_filter}},
        {"$group": {"_id": "$trip_id", "n": {"$sum": 1}, "f": {"$sum": "$freight"}}},
    ]):
        lr_counts[r["_id"]] = (r["n"], round(r["f"], 2))

    cost = {}
    for coll in ("expenses", "fuel"):
        match = {
            "cancelled": False,
            "trip_id": {"$nin": [None, ""], **trip_id_filter},
        }
        if coll == "expenses":
            match["site_id"] = {"$exists": False}
        async for r in db[coll].aggregate([
            {"$match": match},
            {"$group": {"_id": "$trip_id", "t": {"$sum": "$amount"}}},
        ]):
            cost[r["_id"]] = round(cost.get(r["_id"], 0) + r["t"], 2)
    return lr_counts, cost


async def resolve_endpoint(payload, key):
    """key = 'from' | 'to'. Indoor uses base locations, outdoor free/map."""
    s = await get_settings()
    loc_id = payload.get(f"{key}_id")
    if loc_id:
        loc = next((l for l in s["base_locations"] if l["id"] == loc_id), None)
        if loc:
            return loc_id, loc["name"], loc.get("address", "")
    return None, payload.get(f"{key}_name") or "", payload.get(f"{key}_address") or ""


@api.post("/trips")
async def create_trip(payload: dict, u=Depends(current_user)):
    if not has_admin_access(u, "industrial_finance"):
        financial_values = [
            payload.get("trip_amount"), payload.get("expected_collection"),
            (payload.get("temp_vehicle") or {}).get("hire_amount"),
            (payload.get("temp_driver") or {}).get("hire_amount"),
        ]
        if any(value not in (None, "", 0, 0.0, "0", "0.0") for value in financial_values) or any(
            (payload.get(field) or {}).get("paid")
            for field in ("temp_vehicle", "temp_driver")
        ):
            raise HTTPException(403, "Industrial Finance access is required to enter trip amounts or hire payments.")
    if payload.get("save_vehicle") and not has_admin_access(u, "industrial_vehicles"):
        raise HTTPException(403, "Vehicles access is required to add a permanent fleet vehicle.")
    if payload.get("save_driver") and not has_admin_access(u, "industrial_team"):
        raise HTTPException(403, "Team access is required to add a permanent driver.")
    if not has_admin_access(u, "industrial_parties") and (
        payload.get("party_id") or (payload.get("party_name") or "").strip()
    ):
        raise HTTPException(403, "Parties access is required to associate a party with a trip.")
    s = await get_settings()
    mode = payload.get("mode", "indoor")
    if mode == "indoor":
        route = next((r for r in s["routes"] if r["id"] == payload.get("route_id")), None)
        if not route:
            raise HTTPException(400, "Please select a route")
        locs = {l["id"]: l for l in s["base_locations"]}
        f, t = locs.get(route["from_id"], {}), locs.get(route["to_id"], {})
        from_id, from_name, from_addr = route["from_id"], f.get("name", ""), f.get("address", "")
        to_id, to_name, to_addr = route["to_id"], t.get("name", ""), t.get("address", "")
    else:
        from_id, from_name, from_addr = await resolve_endpoint(payload, "from")
        to_id, to_name, to_addr = await resolve_endpoint(payload, "to")
        if not from_name or not to_name:
            raise HTTPException(400, "Source and destination are required")

    # vehicle (existing or temporary)
    vehicle_id = payload.get("vehicle_id")
    temp = payload.get("temp_vehicle") or {}
    if not vehicle_id and temp.get("vehicle_no"):
        vno = temp["vehicle_no"].upper().replace(" ", "")
        if payload.get("save_vehicle"):
            existing = await db.vehicles.find_one({"vehicle_no": vno})
            if existing:
                vehicle_id, vehicle_no = existing["_id"], vno
            else:
                doc = {"_id": new_id(), "vehicle_no": vno,
                       "vehicle_type": temp.get("vehicle_type", ""),
                       "make": temp.get("make", ""), "model": temp.get("model", ""),
                       "owner_name": temp.get("owner_name", ""), "status": "Available",
                       "archived": False, "created_at": now_iso(),
                       "joining_date": payload.get("start_date") or today(),
                       "payment_cycle": temp.get("payment_cycle") or "Owned"}
                await db.vehicles.insert_one(doc)
                vehicle_id, vehicle_no = doc["_id"], vno
        else:
            vehicle_no = vno
    elif vehicle_id:
        v = await db.vehicles.find_one({"_id": vehicle_id})
        if not v:
            raise HTTPException(400, "Vehicle not found")
        vehicle_no = v["vehicle_no"]
        busy = await db.trips.find_one({"vehicle_id": vehicle_id, "status": {"$in": ACTIVE_TRIP}})
        if busy and not payload.get("force"):
            raise HTTPException(400, f"Vehicle {vehicle_no} is already on trip {busy['trip_no']}")
    else:
        raise HTTPException(400, "Select a vehicle or add a temporary vehicle")

    driver_id = payload.get("driver_id")
    driver_name = payload.get("driver_name", "")
    temp_drv = payload.get("temp_driver") or {}
    if not driver_id and temp_drv.get("name"):
        if payload.get("save_driver"):
            existing = await db.drivers.find_one({"name": temp_drv["name"].strip(), "archived": {"$ne": True}})
            if existing and temp_drv.get("mobile") and existing.get("mobile") == temp_drv.get("mobile"):
                driver_id, driver_name = existing["_id"], existing["name"]
            else:
                ddoc = {
                    "_id": new_id(), "name": temp_drv["name"].strip(),
                    "mobile": temp_drv.get("mobile", ""), "licence_no": temp_drv.get("licence_no", ""),
                    "status": "Active", "archived": False, "created_at": now_iso(),
                    "joining_date": payload.get("start_date") or today(),
                    "employment": "permanent",
                    "payment_cycle": temp_drv.get("payment_cycle") or "Monthly",
                }
                await db.drivers.insert_one(ddoc)
                driver_id, driver_name = ddoc["_id"], ddoc["name"]
        else:
            driver_name = temp_drv["name"].strip()
    elif driver_id:
        d = await db.drivers.find_one({"_id": driver_id})
        if not d:
            raise HTTPException(400, "Driver not found")
        driver_name = d["name"]
        busy = await db.trips.find_one({"driver_id": driver_id, "status": {"$in": ACTIVE_TRIP}})
        if busy and not payload.get("force"):
            raise HTTPException(400, f"{driver_name} is already on trip {busy['trip_no']}")

    party_id = payload.get("party_id")
    party_name = payload.get("party_name", "")
    if not party_id and party_name:
        party_id, party_name = await find_or_create_party(party_name, payload.get("party_mobile"))

    trip_no = await next_number("trip")
    doc = {
        "_id": new_id(), "trip_no": trip_no, "mode": mode,
        "trip_type": payload.get("trip_type", "One Way"),
        "route_id": payload.get("route_id"),
        "from_id": from_id, "from_name": from_name, "from_address": from_addr,
        "from_latlng": payload.get("from_latlng"),
        "to_id": to_id, "to_name": to_name, "to_address": to_addr,
        "to_latlng": payload.get("to_latlng"),
        "start_date": payload.get("start_date") or today(),
        "start_time": payload.get("start_time", ""),
        "return_date": payload.get("return_date", ""),
        "return_time": payload.get("return_time", ""),
        "vehicle_id": vehicle_id, "vehicle_no": vehicle_no,
        "temp_vehicle": None if vehicle_id else temp,
        "driver_id": driver_id, "driver_name": driver_name,
        "temp_driver": None if driver_id else (temp_drv if temp_drv.get("name") else None),
        "party_id": party_id, "party_name": party_name,
        "trip_amount": float(payload.get("trip_amount") or 0),
        "expected_collection": float(payload.get("expected_collection") or 0),
        "remarks": payload.get("remarks", ""),
        "status": payload.get("status") or ("Assigned" if driver_id else "New"),
        "posted": False, "created_at": now_iso(),
    }
    await db.trips.insert_one(doc)
    await sync_assets(doc)
    await record_trip_hire(doc, temp or {}, "Vehicle Hire",
                           vehicle_id=vehicle_id, vehicle_no=vehicle_no)
    await record_trip_hire(doc, temp_drv or {}, "Driver Hire", driver_id=driver_id)
    return ser(doc)


async def record_trip_hire(trip, hire, category, driver_id=None, vehicle_id=None, vehicle_no=""):
    """Post this-trip hire into expenses/cash/ledger when amount is given."""
    amt = float(hire.get("hire_amount") or 0)
    if amt <= 0:
        return
    dt = hire.get("payment_date") or trip.get("start_date") or today()
    mode = hire.get("pay_mode") or "Cash"
    who = hire.get("name") or hire.get("vehicle_no") or trip.get("driver_name") or trip.get("vehicle_no") or ""
    remarks = hire.get("notes") or f"{category} — {who} — trip {trip.get('trip_no')}"
    paid = bool(hire.get("paid"))
    if paid:
        eid = new_id()
        await db.expenses.insert_one({
            "_id": eid, "date": dt, "category": category, "amount": amt,
            "vehicle_id": vehicle_id, "vehicle_no": vehicle_no or trip.get("vehicle_no", ""),
            "trip_id": trip["_id"], "trip_no": trip.get("trip_no", ""),
            "driver_id": driver_id, "employee_id": None, "vendor": who, "mode": mode,
            "proof_url": "", "remarks": remarks, "cancelled": False, "created_at": now_iso(),
        })
        await L.cash("cash" if mode in ("Cash", "Other") else "bank", "out", amt, dt, remarks,
                     "expense", eid, mode=mode)
        if category == "Driver Hire" and driver_id:
            await L.post("driver", driver_id, dt, f"{remarks} (paid)", debit=amt,
                         ref_type="expense", ref_id=eid)
    elif driver_id and category == "Driver Hire":
        await L.post("driver", driver_id, dt, f"{remarks} (due)", credit=amt,
                     ref_type="trip", ref_id=trip["_id"])


async def sync_assets(trip):
    on = trip["status"] in ACTIVE_TRIP
    if trip.get("vehicle_id"):
        v = await db.vehicles.find_one({"_id": trip["vehicle_id"]})
        if v and v.get("status") in (None, "Available", "On Trip"):
            await db.vehicles.update_one({"_id": trip["vehicle_id"]},
                                         {"$set": {"status": "On Trip" if on else "Available"}})
    if trip.get("driver_id"):
        await db.drivers.update_one({"_id": trip["driver_id"]},
                                    {"$set": {"status": "On Trip" if on else "Active"}})


@api.get("/trips")
async def list_trips(q: Optional[str] = None, status: Optional[str] = None,
                     vehicle_id: Optional[str] = None, driver_id: Optional[str] = None,
                     route_id: Optional[str] = None, mode: Optional[str] = None,
                     trip_type: Optional[str] = None, frm: Optional[str] = None,
                     to: Optional[str] = None,
                     limit: int = Query(300, ge=1, le=500), u=Depends(current_user)):
    query = {}
    for k, v in [("status", status), ("vehicle_id", vehicle_id), ("driver_id", driver_id),
                 ("route_id", route_id), ("mode", mode), ("trip_type", trip_type)]:
        if v:
            query[k] = v
    if frm or to:
        query["start_date"] = {}
        if frm:
            query["start_date"]["$gte"] = frm
        if to:
            query["start_date"]["$lte"] = to
    if q:
        query["$or"] = [{f: {"$regex": q, "$options": "i"}} for f in
                        ("trip_no", "vehicle_no", "driver_name", "from_name", "to_name", "party_name")]
    rows = sers(await db.trips.find(query).sort("created_at", -1).to_list(limit))
    lr_counts, cost = await _trip_financial_totals([r["id"] for r in rows])
    for r in rows:
        n, freight = lr_counts.get(r["id"], (0, 0))
        if has_admin_access(u, "industrial_lrs"):
            r["lr_count"] = n
        if has_admin_access(u, "industrial_finance"):
            r["earning"] = round(max(r.get("trip_amount") or 0, freight), 2)
            r["trip_cost"] = cost.get(r["id"], 0)
            r["profit"] = round(r["earning"] - r["trip_cost"], 2)
        else:
            r.pop("trip_amount", None)
            r.pop("expected_collection", None)
    return rows


@api.get("/trips/{trip_id}")
async def get_trip(trip_id: str, u=Depends(current_user)):
    t = await db.trips.find_one({"_id": trip_id})
    if not t:
        raise HTTPException(404, "Trip not found")
    out = ser(t)
    out["lrs"] = sers(await db.lrs.find({"trip_id": trip_id}).to_list(100))
    out["expenses"] = sers(await db.expenses.find({
        "trip_id": trip_id, "cancelled": False, "site_id": {"$exists": False},
    }).to_list(100))
    out["fuel"] = sers(await db.fuel.find({"trip_id": trip_id, "cancelled": False}).to_list(100))
    lr_freight = round(sum(l["freight"] for l in out["lrs"] if not l.get("cancelled")), 2)
    expense_total = round(sum(e["amount"] for e in out["expenses"]), 2)
    fuel_total = round(sum(f["amount"] for f in out["fuel"]), 2)
    earning = round(max(t.get("trip_amount") or 0, lr_freight), 2)
    out["profit"] = {"earning": earning, "lr_freight": lr_freight, "expenses": expense_total,
                     "diesel": fuel_total, "total_cost": round(expense_total + fuel_total, 2),
                     "profit": round(earning - expense_total - fuel_total, 2)}
    if not has_admin_access(u, "industrial_lrs"):
        out.pop("lrs", None)
    if not has_admin_access(u, "industrial_finance"):
        for field in ("trip_amount", "expected_collection", "profit", "expenses", "fuel"):
            out.pop(field, None)
        for lr in out.get("lrs", []):
            for field in ("freight", "payment_status"):
                lr.pop(field, None)
    return out


@api.put("/trips/{trip_id}")
async def update_trip(trip_id: str, payload: dict, u=Depends(current_user)):
    t = await db.trips.find_one({"_id": trip_id})
    if not t:
        raise HTTPException(404, "Trip not found")
    if not has_admin_access(u, "industrial_finance") and any(
        field in payload and payload[field] != t.get(field)
        for field in ("trip_amount", "expected_collection")
    ):
        raise HTTPException(403, "Industrial Finance access is required to change trip amounts.")
    if (
        not has_admin_access(u, "industrial_finance")
        and payload.get("status") == "Completed"
        and t.get("trip_amount")
        and not t.get("posted")
    ):
        raise HTTPException(403, "Industrial Finance access is required to post a completed trip amount.")
    if not has_admin_access(u, "industrial_parties") and any(
        field in payload and payload[field] != t.get(field)
        for field in ("party_id", "party_name")
    ):
        raise HTTPException(403, "Parties access is required to change a trip's party.")
    for k in ("id", "_id", "trip_no", "posted", "lrs", "expenses", "fuel"):
        payload.pop(k, None)
    if payload.get("driver_id") and payload["driver_id"] != t.get("driver_id"):
        d = await db.drivers.find_one({"_id": payload["driver_id"]})
        payload["driver_name"] = d["name"] if d else ""
    await db.trips.update_one({"_id": trip_id}, {"$set": payload})
    t = await db.trips.find_one({"_id": trip_id})
    await sync_assets(t)
    # trip amount becomes receivable once completed (only if no LR carries the freight)
    if t["status"] == "Completed" and not t.get("posted") and t.get("party_id") and t.get("trip_amount"):
        has_lr = await db.lrs.find_one({"trip_id": trip_id, "cancelled": False})
        if not has_lr:
            await L.post("party", t["party_id"], t.get("start_date") or today(),
                         f"Trip {t['trip_no']} {t['from_name']} > {t['to_name']}",
                         debit=t["trip_amount"], ref_type="trip", ref_id=trip_id)
            await db.trips.update_one({"_id": trip_id}, {"$set": {"posted": True}})
    return await get_trip(trip_id, u)


@api.post("/trips/{trip_id}/cancel")
async def cancel_trip(trip_id: str, u=Depends(current_user)):
    if not has_admin_access(u, "industrial_finance"):
        raise HTTPException(403, "Industrial Finance access is required to cancel a trip and reverse its ledger posting.")
    t = await db.trips.find_one({"_id": trip_id})
    if not t:
        raise HTTPException(404, "Trip not found")
    await L.reverse("trip", trip_id)
    await db.trips.update_one({"_id": trip_id}, {"$set": {"status": "Cancelled", "posted": False}})
    t["status"] = "Cancelled"
    await sync_assets(t)
    return {"ok": True}


# ------------------------------------------------------------------ LR
@api.post("/lrs")
async def create_lr(payload: dict, u=Depends(current_user)):
    trip = None
    if payload.get("trip_id"):
        trip = await db.trips.find_one({"_id": payload["trip_id"]})
    sender = payload.get("sender") or {}
    party_id = sender.get("party_id")
    if not party_id:
        party_id, pname = await find_or_create_party(
            sender.get("name"), sender.get("mobile"),
            {"address": sender.get("address", ""), "city": sender.get("city", ""),
             "state": sender.get("state", ""), "pincode": sender.get("pincode", ""),
             "gstin": sender.get("gstin", "")})
        if not party_id:
            raise HTTPException(400, "Sender name is required")
        sender["party_id"] = party_id
        sender["name"] = pname
    else:
        p = await db.parties.find_one({"_id": party_id})
        if p:
            sender["name"] = p["name"]
            sender.setdefault("mobile", p.get("mobile", ""))

    items = payload.get("items") or []
    for it in items:
        it["quantity"] = float(it.get("quantity") or 0)
        it["weight"] = float(it.get("weight") or 0)
        it["rate"] = float(it.get("rate") or 0)
        it["amount"] = round(it.get("amount") if it.get("amount") else it["quantity"] * it["rate"], 2)
    freight = float(payload.get("freight") or sum(i["amount"] for i in items) or 0)

    lr_no = payload.get("lr_no") or await next_number("lr")
    dt = payload.get("date") or (trip or {}).get("start_date") or today()
    doc = {
        "_id": new_id(), "lr_no": lr_no, "date": dt,
        "trip_id": payload.get("trip_id"), "trip_no": (trip or {}).get("trip_no", ""),
        "from_name": payload.get("from_name") or (trip or {}).get("from_name", ""),
        "to_name": payload.get("to_name") or (trip or {}).get("to_name", ""),
        "vehicle_no": payload.get("vehicle_no") or (trip or {}).get("vehicle_no", ""),
        "driver_id": payload.get("driver_id") or (trip or {}).get("driver_id"),
        "driver_name": payload.get("driver_name") or (trip or {}).get("driver_name", ""),
        "sender": sender, "receiver": payload.get("receiver") or {},
        "goods_description": payload.get("goods_description", ""),
        "articles": payload.get("articles", ""),
        "quantity": float(payload.get("quantity") or sum(i["quantity"] for i in items) or 0),
        "weight": float(payload.get("weight") or sum(i["weight"] for i in items) or 0),
        "items": items, "freight": freight,
        "freight_type": payload.get("freight_type", "NOT PAID"),
        "payment_status": payload.get("payment_status") or ("Paid" if payload.get("freight_type") == "PAID" else "Pending"),
        "due_date": payload.get("due_date", ""),
        "remarks": payload.get("remarks", ""),
        "optional": payload.get("optional") or {},
        "cancelled": False, "created_at": now_iso(),
    }
    await db.lrs.insert_one(doc)
    if freight:
        await L.post("party", party_id, dt, f"LR {lr_no} {doc['from_name']} > {doc['to_name']}",
                     debit=freight, ref_type="lr", ref_id=doc["_id"])
        if doc["payment_status"] == "Paid":
            await receipt_core({
                "date": dt, "party_id": party_id, "lr_id": doc["_id"], "lr_no": lr_no,
                "trip_id": doc["trip_id"], "amount": freight, "mode": payload.get("paid_mode", "Cash"),
                "collected_by_type": "office", "remarks": f"Freight paid with LR {lr_no}",
            })
    return ser(doc)


@api.get("/lrs")
async def list_lrs(q: Optional[str] = None, party_id: Optional[str] = None,
                   payment_status: Optional[str] = None, frm: Optional[str] = None,
                   to: Optional[str] = None, trip_id: Optional[str] = None,
                   limit: int = 300, u=Depends(current_user)):
    query = {}
    if party_id:
        query["sender.party_id"] = party_id
    if payment_status:
        query["payment_status"] = payment_status
    if trip_id:
        query["trip_id"] = trip_id
    if frm or to:
        query["date"] = {}
        if frm:
            query["date"]["$gte"] = frm
        if to:
            query["date"]["$lte"] = to
    if q:
        query["$or"] = [{f: {"$regex": q, "$options": "i"}} for f in
                        ("lr_no", "vehicle_no", "sender.name", "receiver.name",
                         "from_name", "to_name", "goods_description")]
    rows = sers(await db.lrs.find(query).sort("created_at", -1).to_list(limit))
    paid = {}
    async for r in db.receipts.aggregate([{"$match": {"cancelled": False, "lr_id": {"$ne": None}}},
                                          {"$group": {"_id": "$lr_id", "t": {"$sum": "$amount"}}}]):
        paid[r["_id"]] = r["t"]
    for r in rows:
        r["received"] = round(paid.get(r["id"], 0), 2)
        r["outstanding"] = round(r["freight"] - r["received"], 2)
        if not has_admin_access(u, "industrial_finance"):
            for field in ("freight", "received", "outstanding", "payment_status"):
                r.pop(field, None)
    return rows


@api.get("/lrs/{lr_id}")
async def get_lr(lr_id: str, u=Depends(current_user)):
    d = await db.lrs.find_one({"_id": lr_id})
    if not d:
        raise HTTPException(404, "LR not found")
    out = ser(d)
    out["company"] = (await get_settings())["company"]
    rec = await db.receipts.find({"lr_id": lr_id, "cancelled": False}).to_list(100)
    out["received"] = round(sum(r["amount"] for r in rec), 2)
    out["outstanding"] = round(out["freight"] - out["received"], 2)
    out["receipts"] = sers(rec)
    if not has_admin_access(u, "industrial_finance"):
        for field in ("received", "outstanding", "receipts"):
            out.pop(field, None)
    return out


@api.put("/lrs/{lr_id}")
async def update_lr(lr_id: str, payload: dict, u=Depends(current_user)):
    d = await db.lrs.find_one({"_id": lr_id})
    if not d:
        raise HTTPException(404, "LR not found")
    for k in ("id", "_id", "lr_no", "company", "received", "outstanding", "receipts"):
        payload.pop(k, None)
    if "freight" in payload and float(payload["freight"]) != d["freight"]:
        await db.ledger.update_many({"ref_type": "lr", "ref_id": lr_id, "credit": 0},
                                    {"$set": {"debit": float(payload["freight"])}})
    await db.lrs.update_one({"_id": lr_id}, {"$set": payload})
    return await get_lr(lr_id, u)


@api.post("/lrs/{lr_id}/cancel")
async def cancel_lr(lr_id: str, u=Depends(current_user)):
    if not has_admin_access(u, "industrial_finance"):
        raise HTTPException(403, "Industrial Finance access is required to cancel an LR and reverse its ledger posting.")
    await L.reverse("lr", lr_id)
    await db.lrs.update_one({"_id": lr_id}, {"$set": {"cancelled": True, "payment_status": "Cancelled"}})
    return {"ok": True}


# ------------------------------------------------------------------ receipts / collections
async def receipt_core(p):
    mode = p.get("mode", "Cash")
    by_type = p.get("collected_by_type", "office")
    amount = float(p.get("amount") or 0)
    if amount <= 0:
        raise HTTPException(400, "Amount must be more than zero")
    if not p.get("party_id"):
        raise HTTPException(400, "Please select a party")
    dt = p.get("date") or today()
    doc = {"_id": new_id(), "date": dt, "party_id": p["party_id"],
           "party_name": p.get("party_name", ""), "lr_id": p.get("lr_id"),
           "lr_no": p.get("lr_no", ""), "trip_id": p.get("trip_id"),
           "amount": amount, "mode": mode, "reference": p.get("reference", ""),
           "collected_by_type": by_type, "deewanji_id": p.get("deewanji_id"),
           "deewanji_name": p.get("deewanji_name", ""), "remarks": p.get("remarks", ""),
           "cancelled": False, "created_at": now_iso()}
    if not doc["party_name"]:
        party = await db.parties.find_one({"_id": p["party_id"]})
        doc["party_name"] = party["name"] if party else ""
    if by_type == "deewanji" and doc["deewanji_id"] and not doc["deewanji_name"]:
        dw = await db.team.find_one({"_id": doc["deewanji_id"]})
        doc["deewanji_name"] = dw["name"] if dw else ""
    await db.receipts.insert_one(doc)
    desc = f"Payment received {mode}" + (f" against LR {doc['lr_no']}" if doc["lr_no"] else "")
    if by_type == "deewanji":
        desc += f" via {doc['deewanji_name']}"
    await L.post("party", doc["party_id"], dt, desc, credit=amount,
                 ref_type="receipt", ref_id=doc["_id"])
    if by_type == "deewanji":
        account = "deewanji"
    else:
        account = "cash" if mode in ("Cash", "Other") else "bank"
    await L.cash(account, "in", amount, dt, desc, "receipt", doc["_id"],
                 deewanji_id=doc.get("deewanji_id"), mode=mode)
    if doc["lr_id"]:
        lr = await db.lrs.find_one({"_id": doc["lr_id"]})
        if lr:
            rec = await db.receipts.find({"lr_id": doc["lr_id"], "cancelled": False}).to_list(200)
            tot = sum(r["amount"] for r in rec)
            st = "Paid" if tot >= lr["freight"] - 0.5 else ("Partial" if tot > 0 else "Pending")
            await db.lrs.update_one({"_id": doc["lr_id"]}, {"$set": {"payment_status": st}})
    return ser(doc)


@api.post("/receipts")
async def create_receipt(payload: dict, u=Depends(current_user)):
    return await receipt_core(payload)


@api.get("/receipts")
async def list_receipts(frm: Optional[str] = None, to: Optional[str] = None,
                        party_id: Optional[str] = None, deewanji_id: Optional[str] = None,
                        mode: Optional[str] = None, q: Optional[str] = None,
                        limit: int = 500, u=Depends(current_user)):
    query = {}
    if party_id:
        query["party_id"] = party_id
    if deewanji_id:
        query["deewanji_id"] = deewanji_id
    if mode:
        query["mode"] = mode
    if frm or to:
        query["date"] = {}
        if frm:
            query["date"]["$gte"] = frm
        if to:
            query["date"]["$lte"] = to
    if q:
        query["$or"] = [{f: {"$regex": q, "$options": "i"}} for f in
                        ("party_name", "lr_no", "reference", "deewanji_name")]
    return sers(await db.receipts.find(query).sort("created_at", -1).to_list(limit))


@api.post("/receipts/{rid}/cancel")
async def cancel_receipt(rid: str, u=Depends(current_user)):
    r = await db.receipts.find_one({"_id": rid})
    if not r:
        raise HTTPException(404, "Not found")
    await L.reverse("receipt", rid)
    await db.receipts.update_one({"_id": rid}, {"$set": {"cancelled": True}})
    if r.get("lr_id"):
        lr = await db.lrs.find_one({"_id": r["lr_id"]})
        rec = await db.receipts.find({"lr_id": r["lr_id"], "cancelled": False}).to_list(200)
        tot = sum(x["amount"] for x in rec)
        if lr:
            st = "Paid" if tot >= lr["freight"] - 0.5 else ("Partial" if tot > 0 else "Pending")
            await db.lrs.update_one({"_id": r["lr_id"]}, {"$set": {"payment_status": st}})
    return {"ok": True}


# ------------------------------------------------------------------ handovers
@api.post("/handovers")
async def create_handover(payload: dict, u=Depends(current_user)):
    amount = float(payload.get("amount") or 0)
    if amount <= 0:
        raise HTTPException(400, "Amount must be more than zero")
    if not payload.get("deewanji_id"):
        raise HTTPException(400, "Select the Deewanji")
    dw = await db.team.find_one({"_id": payload["deewanji_id"]})
    held = (await L.deewanji_cash()).get(payload["deewanji_id"], 0)
    if amount > held + 0.5:
        raise HTTPException(400, f"Only Rs {held:,.0f} is with {dw['name'] if dw else 'this person'}")
    dt = payload.get("date") or today()
    mode = payload.get("mode", "Cash")
    doc = {"_id": new_id(), "date": dt, "deewanji_id": payload["deewanji_id"],
           "deewanji_name": dw["name"] if dw else "", "amount": amount,
           "to": payload.get("to", "Office"), "mode": mode,
           "reference": payload.get("reference", ""), "proof_url": payload.get("proof_url", ""), "remarks": payload.get("remarks", ""),
           "cancelled": False, "created_at": now_iso()}
    await db.handovers.insert_one(doc)
    desc = f"Handover from {doc['deewanji_name']} to {doc['to']}"
    await L.cash("deewanji", "out", amount, dt, desc, "handover", doc["_id"],
                 deewanji_id=doc["deewanji_id"], mode=mode)
    await L.cash("cash" if mode == "Cash" else "bank", "in", amount, dt, desc,
                 "handover", doc["_id"], mode=mode)
    return ser(doc)


@api.get("/handovers")
async def list_handovers(frm: Optional[str] = None, to: Optional[str] = None,
                         deewanji_id: Optional[str] = None, u=Depends(current_user)):
    query = {}
    if deewanji_id:
        query["deewanji_id"] = deewanji_id
    if frm or to:
        query["date"] = {}
        if frm:
            query["date"]["$gte"] = frm
        if to:
            query["date"]["$lte"] = to
    return sers(await db.handovers.find(query).sort("created_at", -1).to_list(500))


@api.post("/handovers/{hid}/cancel")
async def cancel_handover(hid: str, u=Depends(current_user)):
    await L.reverse("handover", hid)
    await db.handovers.update_one({"_id": hid}, {"$set": {"cancelled": True}})
    return {"ok": True}


@api.get("/deewanji/daily")
async def deewanji_daily(frm: Optional[str] = None, to: Optional[str] = None,
                         u=Depends(current_user)):
    frm = frm or today()
    to = to or today()
    rec = await db.receipts.find({"cancelled": False, "collected_by_type": "deewanji",
                                 "date": {"$gte": frm, "$lte": to}}).to_list(2000)
    hand = await db.handovers.find({"cancelled": False, "date": {"$gte": frm, "$lte": to}}).to_list(2000)
    held = await L.deewanji_cash()
    team = {t["_id"]: t for t in await db.team.find({"archived": {"$ne": True}}).to_list(200)}
    days = {}
    for r in rec:
        k = (r["date"], r.get("deewanji_id") or "unknown")
        d = days.setdefault(k, {"date": r["date"], "deewanji_id": r.get("deewanji_id"),
                                "deewanji_name": r.get("deewanji_name") or "-",
                                "cash": 0, "upi": 0, "bank": 0, "other": 0,
                                "total": 0, "handed_over": 0, "entries": 0})
        m = (r.get("mode") or "Cash").lower()
        d[m if m in ("cash", "upi", "bank") else "other"] += r["amount"]
        d["total"] += r["amount"]
        d["entries"] += 1
    for h in hand:
        k = (h["date"], h.get("deewanji_id") or "unknown")
        d = days.setdefault(k, {"date": h["date"], "deewanji_id": h.get("deewanji_id"),
                                "deewanji_name": h.get("deewanji_name") or "-",
                                "cash": 0, "upi": 0, "bank": 0, "other": 0,
                                "total": 0, "handed_over": 0, "entries": 0})
        d["handed_over"] += h["amount"]
    rows = sorted(days.values(), key=lambda r: (r["date"], r["deewanji_name"]), reverse=True)
    for r in rows:
        r["cash_with_deewanji"] = round(held.get(r["deewanji_id"], 0), 2)
    people = [{"id": k, "name": v["name"], "cash_with": round(held.get(k, 0), 2)}
              for k, v in team.items() if (v.get("role") or "").lower() == "deewanji" or held.get(k)]
    return {"rows": rows, "people": people, "total_held": round(sum(held.values()), 2)}


# ------------------------------------------------------------------ expenses
@api.post("/expenses")
async def create_expense(payload: dict, u=Depends(current_user)):
    amount = float(payload.get("amount") or 0)
    if amount <= 0:
        raise HTTPException(400, "Amount must be more than zero")
    dt = payload.get("date") or today()
    mode = payload.get("mode", "Cash")
    cat = payload.get("category") or "Other"
    doc = {"_id": new_id(), "date": dt, "category": cat, "amount": amount,
           "vehicle_id": payload.get("vehicle_id"), "vehicle_no": payload.get("vehicle_no", ""),
           "trip_id": payload.get("trip_id"), "trip_no": payload.get("trip_no", ""),
           "driver_id": payload.get("driver_id"), "employee_id": payload.get("employee_id"),
           "vendor": payload.get("vendor", ""), "mode": mode,
           "proof_url": payload.get("proof_url", ""), "remarks": payload.get("remarks", ""), "cancelled": False, "created_at": now_iso()}
    if doc["vehicle_id"] and not doc["vehicle_no"]:
        v = await db.vehicles.find_one({"_id": doc["vehicle_id"]})
        doc["vehicle_no"] = v["vehicle_no"] if v else ""
    await db.expenses.insert_one(doc)
    desc = f"{cat} expense" + (f" - {doc['vehicle_no']}" if doc["vehicle_no"] else "") + \
           (f" ({doc['remarks']})" if doc["remarks"] else "")
    await L.cash("cash" if mode in ("Cash", "Other") else "bank", "out", amount, dt, desc,
                 "expense", doc["_id"], mode=mode)
    if cat == "Driver Advance" and doc["driver_id"]:
        await L.post("driver", doc["driver_id"], dt, "Advance given (expense entry)",
                     debit=amount, ref_type="expense", ref_id=doc["_id"])
    if cat == "Employee Advance" and doc["employee_id"]:
        await L.post("employee", doc["employee_id"], dt, "Advance given (expense entry)",
                     debit=amount, ref_type="expense", ref_id=doc["_id"])
    return ser(doc)


@api.get("/expenses")
async def list_expenses(frm: Optional[str] = None, to: Optional[str] = None,
                        category: Optional[str] = None, vehicle_id: Optional[str] = None,
                        trip_id: Optional[str] = None, q: Optional[str] = None,
                        limit: int = 500, u=Depends(current_user)):
    query = {"cancelled": False, "site_id": {"$exists": False}}
    for k, v in [("category", category), ("vehicle_id", vehicle_id), ("trip_id", trip_id)]:
        if v:
            query[k] = v
    if frm or to:
        query["date"] = {}
        if frm:
            query["date"]["$gte"] = frm
        if to:
            query["date"]["$lte"] = to
    if q:
        query["$or"] = [{f: {"$regex": q, "$options": "i"}} for f in
                        ("category", "vehicle_no", "vendor", "remarks", "trip_no")]
    return sers(await db.expenses.find(query).sort("created_at", -1).to_list(limit))


@api.post("/expenses/{eid}/cancel")
async def cancel_expense(eid: str, u=Depends(current_user)):
    expense = await db.expenses.find_one({"_id": eid, "site_id": {"$exists": False}})
    if not expense:
        raise HTTPException(404, "Expense not found")
    await L.reverse("expense", eid)
    await db.expenses.update_one(
        {"_id": eid, "site_id": {"$exists": False}}, {"$set": {"cancelled": True}},
    )
    return {"ok": True}


# ------------------------------------------------------------------ fuel
@api.post("/fuel")
async def create_fuel(payload: dict, u=Depends(current_user)):
    qty = float(payload.get("quantity") or 0)
    rate = float(payload.get("rate") or 0)
    amount = float(payload.get("amount") or round(qty * rate, 2))
    if amount <= 0:
        raise HTTPException(400, "Enter quantity and rate")
    dt = payload.get("date") or today()
    mode = payload.get("mode", "Credit")
    v = await db.vehicles.find_one({"_id": payload.get("vehicle_id")}) if payload.get("vehicle_id") else None
    pump = await db.fuel_pumps.find_one({"_id": payload.get("pump_id")}) if payload.get("pump_id") else None
    doc = {"_id": new_id(), "date": dt, "vehicle_id": payload.get("vehicle_id"),
           "vehicle_no": v["vehicle_no"] if v else payload.get("vehicle_no", ""),
           "pump_id": payload.get("pump_id"), "pump_name": pump["name"] if pump else "",
           "trip_id": payload.get("trip_id"), "quantity": qty, "rate": rate, "amount": amount,
           "odometer": float(payload.get("odometer") or 0), "mode": mode,
           "proof_url": payload.get("proof_url", ""), "remarks": payload.get("remarks", ""), "cancelled": False, "created_at": now_iso()}
    await db.fuel.insert_one(doc)
    desc = f"Diesel {qty:g} L @ {rate:g} - {doc['vehicle_no']}"
    if mode == "Credit" and doc["pump_id"]:
        await L.post("fuel_pump", doc["pump_id"], dt, desc, credit=amount,
                     ref_type="fuel", ref_id=doc["_id"])
    else:
        await L.cash("cash" if mode in ("Cash", "Other") else "bank", "out", amount, dt,
                     desc, "fuel", doc["_id"], mode=mode)
        if doc["pump_id"]:
            await L.post("fuel_pump", doc["pump_id"], dt, desc + " (paid)", credit=amount,
                         ref_type="fuel", ref_id=doc["_id"])
            await L.post("fuel_pump", doc["pump_id"], dt, f"Paid {mode} for above", debit=amount,
                         ref_type="fuel", ref_id=doc["_id"])
    return ser(doc)


@api.get("/fuel")
async def list_fuel(frm: Optional[str] = None, to: Optional[str] = None,
                    vehicle_id: Optional[str] = None, pump_id: Optional[str] = None,
                    q: Optional[str] = None, limit: int = 500, u=Depends(current_user)):
    query = {}
    for k, v in [("vehicle_id", vehicle_id), ("pump_id", pump_id)]:
        if v:
            query[k] = v
    if frm or to:
        query["date"] = {}
        if frm:
            query["date"]["$gte"] = frm
        if to:
            query["date"]["$lte"] = to
    if q:
        query["$or"] = [{f: {"$regex": q, "$options": "i"}} for f in ("vehicle_no", "pump_name", "remarks")]
    return sers(await db.fuel.find(query).sort("created_at", -1).to_list(limit))


@api.post("/fuel/{fid}/cancel")
async def cancel_fuel(fid: str, u=Depends(current_user)):
    await L.reverse("fuel", fid)
    await db.fuel.update_one({"_id": fid}, {"$set": {"cancelled": True}})
    return {"ok": True}


# ------------------------------------------------------------------ payments out (payables)
@api.post("/payments")
async def create_payment(payload: dict, u=Depends(current_user)):
    """Money paid out to fuel pump / 3PL partner / driver / employee / vendor."""
    amount = float(payload.get("amount") or 0)
    if amount <= 0:
        raise HTTPException(400, "Amount must be more than zero")
    etype = payload.get("entity_type")
    if etype not in ("fuel_pump", "partner", "driver", "employee", "vendor"):
        raise HTTPException(400, "Select whom you are paying")
    dt = payload.get("date") or today()
    mode = payload.get("mode", "Cash")
    name = payload.get("entity_name", "")
    if payload.get("entity_id") and not name:
        coll = {"fuel_pump": "fuel_pumps", "partner": "partners",
                "driver": "drivers", "employee": "team"}.get(etype)
        if coll:
            d = await db[coll].find_one({"_id": payload["entity_id"]})
            name = d["name"] if d else ""
    doc = {"_id": new_id(), "date": dt, "entity_type": etype,
           "entity_id": payload.get("entity_id"), "entity_name": name,
           "purpose": payload.get("purpose", ""), "amount": amount, "mode": mode,
           "reference": payload.get("reference", ""), "proof_url": payload.get("proof_url", ""), "remarks": payload.get("remarks", ""),
           "cancelled": False, "created_at": now_iso()}
    await db.payments.insert_one(doc)
    desc = f"Paid {mode} to {name or etype}" + (f" - {doc['purpose']}" if doc["purpose"] else "")
    await L.cash("cash" if mode in ("Cash", "Other") else "bank", "out", amount, dt, desc,
                 "payment", doc["_id"], mode=mode)
    if payload.get("entity_id") and etype != "vendor":
        await L.post(etype, payload["entity_id"], dt, desc, debit=amount,
                     ref_type="payment", ref_id=doc["_id"])
    return ser(doc)


@api.get("/payments")
async def list_payments(frm: Optional[str] = None, to: Optional[str] = None,
                        entity_type: Optional[str] = None, entity_id: Optional[str] = None,
                        limit: int = 500, u=Depends(current_user)):
    query = {}
    for k, v in [("entity_type", entity_type), ("entity_id", entity_id)]:
        if v:
            query[k] = v
    if frm or to:
        query["date"] = {}
        if frm:
            query["date"]["$gte"] = frm
        if to:
            query["date"]["$lte"] = to
    return sers(await db.payments.find(query).sort("created_at", -1).to_list(limit))


@api.post("/payments/{pid}/cancel")
async def cancel_payment(pid: str, u=Depends(current_user)):
    await L.reverse("payment", pid)
    await db.payments.update_one({"_id": pid}, {"$set": {"cancelled": True}})
    return {"ok": True}


# ------------------------------------------------------------------ advances (driver / employee)
@api.post("/advances")
async def create_advance(payload: dict, u=Depends(current_user)):
    amount = float(payload.get("amount") or 0)
    if amount <= 0:
        raise HTTPException(400, "Amount must be more than zero")
    etype = payload.get("entity_type")
    if etype not in ("driver", "employee"):
        raise HTTPException(400, "Invalid person type")
    kind = payload.get("kind", "Advance")  # Advance | Loan | Pre-salary | Repayment | Deduction | Salary Paid
    dt = payload.get("date") or today()
    mode = payload.get("mode", "Cash")
    coll = "drivers" if etype == "driver" else "team"
    p = await db[coll].find_one({"_id": payload.get("entity_id")})
    if not p:
        raise HTTPException(400, "Person not found")
    doc = {"_id": new_id(), "date": dt, "entity_type": etype, "entity_id": p["_id"],
           "entity_name": p["name"], "kind": kind, "amount": amount, "mode": mode,
           "proof_url": payload.get("proof_url", ""), "remarks": payload.get("remarks", ""), "cancelled": False, "created_at": now_iso()}
    await db.advances.insert_one(doc)
    out_kinds = ("Advance", "Loan", "Pre-salary")
    if kind in out_kinds:
        await L.post(etype, p["_id"], dt, f"{kind} given", debit=amount,
                     ref_type="advance", ref_id=doc["_id"])
        await L.cash("cash" if mode in ("Cash", "Other") else "bank", "out", amount, dt,
                     f"{kind} to {p['name']}", "advance", doc["_id"], mode=mode)
    elif kind == "Salary Paid":
        await L.cash("cash" if mode in ("Cash", "Other") else "bank", "out", amount, dt,
                     f"Salary paid to {p['name']}", "advance", doc["_id"], mode=mode)
        await db.advances.update_one({"_id": doc["_id"]}, {"$set": {"salary_payment": True}})
    else:  # Repayment / Deduction
        await L.post(etype, p["_id"], dt, kind, credit=amount,
                     ref_type="advance", ref_id=doc["_id"])
        if kind == "Repayment":
            await L.cash("cash" if mode in ("Cash", "Other") else "bank", "in", amount, dt,
                         f"{kind} from {p['name']}", "advance", doc["_id"], mode=mode)
    return ser(doc)


@api.get("/advances")
async def list_advances(entity_type: Optional[str] = None, entity_id: Optional[str] = None,
                        frm: Optional[str] = None, to: Optional[str] = None,
                        limit: int = 500, u=Depends(current_user)):
    query = {}
    for k, v in [("entity_type", entity_type), ("entity_id", entity_id)]:
        if v:
            query[k] = v
    if frm or to:
        query["date"] = {}
        if frm:
            query["date"]["$gte"] = frm
        if to:
            query["date"]["$lte"] = to
    return sers(await db.advances.find(query).sort("created_at", -1).to_list(limit))


@api.post("/advances/{aid}/cancel")
async def cancel_advance(aid: str, u=Depends(current_user)):
    await L.reverse("advance", aid)
    await db.advances.update_one({"_id": aid}, {"$set": {"cancelled": True}})
    return {"ok": True}


# ------------------------------------------------------------------ 3PL trips
@api.post("/tpl")
async def create_tpl(payload: dict, u=Depends(current_user)):
    cust_amt = float(payload.get("customer_amount") or 0)
    partner_amt = float(payload.get("partner_amount") or 0)
    dt = payload.get("date") or today()
    party_id = payload.get("party_id")
    if not party_id and payload.get("party_name"):
        party_id, _ = await find_or_create_party(payload["party_name"], payload.get("party_mobile"))
    partner = await db.partners.find_one({"_id": payload.get("partner_id")}) if payload.get("partner_id") else None
    party = await db.parties.find_one({"_id": party_id}) if party_id else None
    doc = {"_id": new_id(), "date": dt, "party_id": party_id,
           "party_name": party["name"] if party else payload.get("party_name", ""),
           "partner_id": payload.get("partner_id"),
           "partner_name": partner["name"] if partner else "",
           "vehicle_no": payload.get("vehicle_no", ""), "driver_name": payload.get("driver_name", ""),
           "from_name": payload.get("from_name", ""), "to_name": payload.get("to_name", ""),
           "customer_amount": cust_amt, "partner_amount": partner_amt,
           "expenses": float(payload.get("expenses") or 0),
           "remarks": payload.get("remarks", ""), "status": payload.get("status", "Active"),
           "cancelled": False, "created_at": now_iso()}
    doc["margin"] = round(cust_amt - partner_amt - doc["expenses"], 2)
    await db.tpl.insert_one(doc)
    if party_id and cust_amt:
        await L.post("party", party_id, dt,
                     f"3PL trip {doc['from_name']} > {doc['to_name']} ({doc['partner_name']})",
                     debit=cust_amt, ref_type="tpl", ref_id=doc["_id"])
    if doc["partner_id"] and partner_amt:
        await L.post("partner", doc["partner_id"], dt,
                     f"3PL trip {doc['from_name']} > {doc['to_name']} for {doc['party_name']}",
                     credit=partner_amt, ref_type="tpl", ref_id=doc["_id"])
    return ser(doc)


@api.get("/tpl")
async def list_tpl(frm: Optional[str] = None, to: Optional[str] = None,
                   partner_id: Optional[str] = None, q: Optional[str] = None,
                   u=Depends(current_user)):
    query = {}
    if partner_id:
        query["partner_id"] = partner_id
    if frm or to:
        query["date"] = {}
        if frm:
            query["date"]["$gte"] = frm
        if to:
            query["date"]["$lte"] = to
    if q:
        query["$or"] = [{f: {"$regex": q, "$options": "i"}} for f in
                        ("party_name", "partner_name", "vehicle_no", "from_name", "to_name")]
    return sers(await db.tpl.find(query).sort("created_at", -1).to_list(500))


@api.post("/tpl/{tid}/cancel")
async def cancel_tpl(tid: str, u=Depends(current_user)):
    await L.reverse("tpl", tid)
    await db.tpl.update_one({"_id": tid}, {"$set": {"cancelled": True, "status": "Cancelled"}})
    return {"ok": True}


# ------------------------------------------------------------------ ledger
@api.get("/ledger/{etype}/{eid}")
async def read_ledger(etype: str, eid: str, frm: Optional[str] = None,
                      to: Optional[str] = None, u=Depends(current_user)):
    rows, bal = await L.statement(etype, eid, frm, to)
    return {"rows": rows, "balance": bal}


# ------------------------------------------------------------------ profiles
@api.get("/profile/vehicle/{vid}")
async def vehicle_profile(vid: str, u=Depends(current_user)):
    v = await db.vehicles.find_one({"_id": vid})
    if not v:
        raise HTTPException(404, "Vehicle not found")
    trips = sers(await db.trips.find({"vehicle_id": vid}).sort("created_at", -1).to_list(200))
    exp = sers(await db.expenses.find({
        "vehicle_id": vid, "cancelled": False, "site_id": {"$exists": False},
    }).sort("date", -1).to_list(300))
    fuel = sers(await db.fuel.find({"vehicle_id": vid, "cancelled": False}).sort("date", -1).to_list(300))
    return {
        "vehicle": ser(v),
        "trips": trips,
        "expenses": exp, "fuel": fuel,
        "totals": {"trips": len(trips), "expense": round(sum(e["amount"] for e in exp), 2),
                   "fuel": round(sum(f["amount"] for f in fuel), 2),
                   "litres": round(sum(f["quantity"] for f in fuel), 2)},
        "current_trip": next((t for t in trips if t["status"] in ACTIVE_TRIP), None),
    }


@api.get("/profile/driver/{did}")
async def driver_profile(did: str, u=Depends(current_user)):
    d = await db.drivers.find_one({"_id": did})
    if not d:
        raise HTTPException(404, "Driver not found")
    trips = sers(await db.trips.find({"driver_id": did}).sort("created_at", -1).to_list(200))
    adv = sers(await db.advances.find({"entity_type": "driver", "entity_id": did,
                                       "cancelled": False}).sort("date", -1).to_list(200))
    rows, bal = await L.statement("driver", did)
    return {"driver": ser(d), "trips": trips, "advances": adv, "ledger": rows,
            "outstanding": bal, "current_trip": next((t for t in trips if t["status"] in ACTIVE_TRIP), None)}


@api.get("/profile/party/{pid}")
async def party_profile(pid: str, u=Depends(current_user)):
    p = await db.parties.find_one({"_id": pid})
    if not p:
        raise HTTPException(404, "Party not found")
    lrs = await list_lrs(party_id=pid, u=u)
    rec = sers(await db.receipts.find({"party_id": pid, "cancelled": False}).sort("date", -1).to_list(300))
    rows, bal = await L.statement("party", pid)
    return {"party": ser(p), "lrs": lrs, "receipts": rec, "ledger": rows, "outstanding": bal}


@api.get("/profile/employee/{eid}")
async def employee_profile(eid: str, u=Depends(current_user)):
    p = await db.team.find_one({"_id": eid})
    if not p:
        raise HTTPException(404, "Team member not found")
    adv = sers(await db.advances.find({"entity_type": "employee", "entity_id": eid,
                                       "cancelled": False}).sort("date", -1).to_list(300))
    rows, bal = await L.statement("employee", eid)
    held = (await L.deewanji_cash()).get(eid, 0)
    paid = round(sum(a["amount"] for a in adv if a["kind"] == "Salary Paid"), 2)
    return {"employee": ser(p), "advances": adv, "ledger": rows, "outstanding": bal,
            "salary_paid": paid, "cash_with": round(held, 2)}


@api.get("/profile/fuel_pump/{pid}")
async def pump_profile(pid: str, u=Depends(current_user)):
    p = await db.fuel_pumps.find_one({"_id": pid})
    if not p:
        raise HTTPException(404, "Fuel pump not found")
    fuel = sers(await db.fuel.find({"pump_id": pid, "cancelled": False}).sort("date", -1).to_list(500))
    rows, bal = await L.statement("fuel_pump", pid)
    pays = sers(await db.payments.find({"entity_id": pid, "cancelled": False}).to_list(300))
    return {"pump": ser(p), "fuel": fuel, "ledger": rows,
            "purchased": round(sum(f["amount"] for f in fuel), 2),
            "paid": round(sum(p2["amount"] for p2 in pays), 2),
            "outstanding": round(-bal, 2), "payments": pays}


@api.get("/profile/partner/{pid}")
async def partner_profile(pid: str, u=Depends(current_user)):
    p = await db.partners.find_one({"_id": pid})
    if not p:
        raise HTTPException(404, "Partner not found")
    trips = sers(await db.tpl.find({"partner_id": pid, "cancelled": False}).sort("date", -1).to_list(300))
    rows, bal = await L.statement("partner", pid)
    return {"partner": ser(p), "trips": trips, "ledger": rows, "outstanding": round(-bal, 2),
            "customer_amount": round(sum(t["customer_amount"] for t in trips), 2),
            "partner_amount": round(sum(t["partner_amount"] for t in trips), 2)}


# ------------------------------------------------------------------ finance helpers
async def sum_coll(coll, match):
    m = {"cancelled": False, **match}
    if coll == "expenses":
        m["site_id"] = {"$exists": False}
    agg = [{"$match": m}, {"$group": {"_id": None, "t": {"$sum": "$amount"}}}]
    async for r in db[coll].aggregate(agg):
        return round(r["t"], 2)
    return 0.0


async def receivables_rows():
    bal = await L.balances("party")
    parties = {p["_id"]: p for p in await db.parties.find().to_list(3000)}
    s = await get_settings()
    due_days = int(s.get("receivable_due_days", 30))
    from datetime import date, timedelta
    t = date.today()
    rows = []
    for pid, b in bal.items():
        if b["balance"] <= 0.5:
            continue
        p = parties.get(pid, {})
        lastdt = b.get("last_date") or t.isoformat()
        try:
            y, m, d = [int(x) for x in lastdt.split("-")]
            age = (t - date(y, m, d)).days
            due = (date(y, m, d) + timedelta(days=due_days)).isoformat()
        except Exception:
            age, due = 0, t.isoformat()
        bucket = ("Current" if age <= due_days else "1-30" if age <= due_days + 30
                  else "31-60" if age <= due_days + 60 else "61-90" if age <= due_days + 90 else "90+")
        rows.append({"party_id": pid, "party": p.get("name", "-"), "mobile": p.get("mobile", ""),
                     "city": p.get("city", ""), "total": b["debit"], "received": b["credit"],
                     "outstanding": b["balance"], "last_date": b.get("last_date"),
                     "due_date": due, "age": max(age - due_days, 0), "bucket": bucket,
                     "status": "Overdue" if age > due_days else "Pending"})
    return sorted(rows, key=lambda r: -r["outstanding"])


async def payables_rows():
    rows = []
    for etype, coll, label in [("fuel_pump", "fuel_pumps", "Fuel Pump"),
                               ("partner", "partners", "3PL Partner")]:
        bal = await L.balances(etype)
        docs = {d["_id"]: d for d in await db[coll].find().to_list(2000)}
        for eid, b in bal.items():
            out = round(-b["balance"], 2)
            if out <= 0.5:
                continue
            rows.append({"entity_type": etype, "entity_id": eid, "type": label,
                         "name": docs.get(eid, {}).get("name", "-"), "total": b["credit"],
                         "paid": b["debit"], "outstanding": out,
                         "last_date": b.get("last_date"), "status": "Pending"})
    return sorted(rows, key=lambda r: -r["outstanding"])


async def advances_outstanding(etype):
    bal = await L.balances(etype)
    return round(sum(b["balance"] for b in bal.values() if b["balance"] > 0), 2)


@api.get("/finance/summary")
async def finance_summary(u=Depends(current_user)):
    t = today()
    cashpos = await cash_position()
    rec = await receivables_rows()
    pay = await payables_rows()
    return {
        "to_receive": round(sum(r["outstanding"] for r in rec), 2),
        "overdue": round(sum(r["outstanding"] for r in rec if r["status"] == "Overdue"), 2),
        "to_pay": round(sum(r["outstanding"] for r in pay), 2),
        "received_today": await sum_coll("receipts", {"date": t}),
        "paid_today": round(await sum_coll("payments", {"date": t}) +
                            await sum_coll("advances", {"date": t, "kind": {"$in": ["Advance", "Loan", "Pre-salary", "Salary Paid"]}}), 2),
        "expenses_today": await sum_coll("expenses", {"date": t}),
        "fuel_today": await sum_coll("fuel", {"date": t}),
        "cash": cashpos.get("cash", 0), "bank": cashpos.get("bank", 0),
        "deewanji_cash": cashpos.get("deewanji", 0),
        "driver_advances": await advances_outstanding("driver"),
        "employee_advances": await advances_outstanding("employee"),
        "received_month": await sum_coll("receipts", {"date": {"$gte": t[:8] + "01"}}),
        "expense_month": await sum_coll("expenses", {"date": {"$gte": t[:8] + "01"}}),
    }


@api.get("/finance/receivables")
async def finance_receivables(u=Depends(current_user)):
    rows = await receivables_rows()
    buckets = {}
    for r in rows:
        buckets[r["bucket"]] = round(buckets.get(r["bucket"], 0) + r["outstanding"], 2)
    return {"rows": rows, "buckets": buckets,
            "total": round(sum(r["outstanding"] for r in rows), 2)}


@api.get("/finance/payables")
async def finance_payables(u=Depends(current_user)):
    rows = await payables_rows()
    return {"rows": rows, "total": round(sum(r["outstanding"] for r in rows), 2)}


@api.get("/finance/cashbook")
async def finance_cashbook(frm: Optional[str] = None, to: Optional[str] = None,
                           account: Optional[str] = None, u=Depends(current_user)):
    query = {"cancelled": False, "site_id": {"$exists": False}}
    if account:
        query["account"] = account
    if frm or to:
        query["date"] = {}
        if frm:
            query["date"]["$gte"] = frm
        if to:
            query["date"]["$lte"] = to
    rows = sers(await db.cashbook.find(query).sort("date", -1).to_list(1000))
    for r in rows:
        r.pop("meta", None)
    return {"rows": rows, "position": await cash_position()}


@api.get("/finance/charts")
async def finance_charts(days: int = 14, u=Depends(current_user)):
    from datetime import date, timedelta
    t = date.today()
    start = (t - timedelta(days=days - 1)).isoformat()
    inout = {}
    async for r in db.cashbook.aggregate([
        {"$match": {
            "cancelled": False, "site_id": {"$exists": False}, "date": {"$gte": start},
        }},
        {"$group": {"_id": {"d": "$date", "dir": "$direction"}, "t": {"$sum": "$amount"}}}]):
        d = inout.setdefault(r["_id"]["d"], {"date": r["_id"]["d"], "in": 0, "out": 0})
        d[r["_id"]["dir"]] = round(r["t"], 2)
    series = []
    for i in range(days):
        dd = (t - timedelta(days=days - 1 - i)).isoformat()
        row = inout.get(dd, {"date": dd, "in": 0, "out": 0})
        series.append({"date": dd[5:], "money_in": row.get("in", 0), "money_out": row.get("out", 0)})
    exp = []
    async for r in db.expenses.aggregate([
        {"$match": {
            "cancelled": False, "site_id": {"$exists": False}, "date": {"$gte": start},
        }},
        {"$group": {"_id": "$category", "t": {"$sum": "$amount"}}}, {"$sort": {"t": -1}}]):
        exp.append({"name": r["_id"], "value": round(r["t"], 2)})
    fuel_total = await sum_coll("fuel", {"date": {"$gte": start}})
    if fuel_total:
        exp.append({"name": "Diesel (fuel entries)", "value": fuel_total})
    recv = await finance_receivables(u)
    pay = await finance_payables(u)
    coll = []
    async for r in db.receipts.aggregate([
        {"$match": {"cancelled": False, "date": {"$gte": start}}},
        {"$group": {"_id": "$date", "t": {"$sum": "$amount"}}}, {"$sort": {"_id": 1}}]):
        coll.append({"date": r["_id"][5:], "amount": round(r["t"], 2)})
    return {"money_flow": series, "expense_breakdown": exp,
            "receivable_aging": [{"name": k, "value": v} for k, v in recv["buckets"].items()],
            "payable_aging": [{"name": r["name"], "value": r["outstanding"]} for r in pay["rows"][:8]],
            "collection_trend": coll}


@api.get("/dashboard/monthly")
async def dashboard_monthly(months: int = 6, u=Depends(current_user)):
    from datetime import date
    t = date.today()
    keys, labels = [], []
    y, m = t.year, t.month
    for _ in range(months):
        keys.append(f"{y:04d}-{m:02d}")
        labels.append(date(y, m, 1).strftime("%b %y"))
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    keys.reverse()
    labels.reverse()
    start = keys[0] + "-01"

    async def by_month(coll, field="amount", dkey="date"):
        out = {k: 0.0 for k in keys}
        async for r in db[coll].aggregate([
            {"$match": {"cancelled": {"$ne": True}, dkey: {"$gte": start}}},
            {"$group": {"_id": {"$substr": [f"${dkey}", 0, 7]}, "t": {"$sum": f"${field}"}}}]):
            if r["_id"] in out:
                out[r["_id"]] = round(r["t"], 2)
        return out

    freight = await by_month("lrs", "freight")
    trips = await by_month("trips", "trip_amount", "start_date")
    # LRs created from a trip already carry the trip amount — count them once
    lr_standalone = {k: 0.0 for k in keys}
    async for r in db.lrs.aggregate([
        {"$match": {"cancelled": {"$ne": True}, "date": {"$gte": start},
                    "$or": [{"trip_id": None}, {"trip_id": ""}, {"trip_id": {"$exists": False}}]}},
        {"$group": {"_id": {"$substr": ["$date", 0, 7]}, "t": {"$sum": "$freight"}}}]):
        if r["_id"] in lr_standalone:
            lr_standalone[r["_id"]] = round(r["t"], 2)
    collections = await by_month("receipts")
    expenses = await by_month("expenses")
    fuel = await by_month("fuel")
    payments = await by_month("payments")
    lr_count = {k: 0 for k in keys}
    async for r in db.lrs.aggregate([
        {"$match": {"cancelled": {"$ne": True}, "date": {"$gte": start}}},
        {"$group": {"_id": {"$substr": ["$date", 0, 7]}, "n": {"$sum": 1}}}]):
        if r["_id"] in lr_count:
            lr_count[r["_id"]] = r["n"]
    trip_count = {k: 0 for k in keys}
    async for r in db.trips.aggregate([
        {"$match": {"cancelled": {"$ne": True}, "start_date": {"$gte": start}}},
        {"$group": {"_id": {"$substr": ["$start_date", 0, 7]}, "n": {"$sum": 1}}}]):
        if r["_id"] in trip_count:
            trip_count[r["_id"]] = r["n"]

    series = []
    for k, lbl in zip(keys, labels):
        revenue = round(lr_standalone[k] + trips[k], 2)
        expense = round(expenses[k] + fuel[k] + payments[k], 2)
        series.append({"month": lbl, "key": k, "revenue": revenue, "expenses": expense,
                       "collections": collections[k], "profit": round(revenue - expense, 2),
                       "diesel": fuel[k], "lrs": lr_count[k], "trips": trip_count[k],
                       "lr_freight": freight[k]})

    rec = await receivables_rows()
    top_parties = [{"name": r["party"], "outstanding": r["outstanding"]} for r in rec[:5]]
    can_finance = has_admin_access(u, "industrial_finance")
    can_trips = has_admin_access(u, "industrial_trips")
    can_lrs = has_admin_access(u, "industrial_lrs")
    if not can_finance:
        for row in series:
            for field in ("revenue", "expenses", "collections", "profit", "diesel", "lr_freight"):
                row[field] = 0
        top_parties = []
    if not can_trips:
        for row in series:
            row["trips"] = 0
    if not can_lrs:
        for row in series:
            row["lrs"] = 0
    return {"series": series, "top_parties": top_parties,
            "totals": {
                "revenue": round(sum(s["revenue"] for s in series), 2) if can_finance else 0,
                "expenses": round(sum(s["expenses"] for s in series), 2) if can_finance else 0,
                "collections": round(sum(s["collections"] for s in series), 2) if can_finance else 0,
                "profit": round(sum(s["profit"] for s in series), 2) if can_finance else 0}}


@api.get("/lr-stats")
async def lr_stats(days: int = 30, u=Depends(current_user)):
    from datetime import date, timedelta
    t = date.today()
    start = (t - timedelta(days=days - 1)).isoformat()
    rows = await db.lrs.find({"date": {"$gte": start}}).to_list(2000)
    status = {"Pending": 0, "Partial": 0, "Paid": 0, "Cancelled": 0}
    per_day = {}
    freight = received = outstanding = 0.0
    senders = {}
    routes = {}
    for r in rows:
        key = "Cancelled" if r.get("cancelled") else r.get("payment_status", "Pending")
        status[key] = status.get(key, 0) + 1
        per_day[r["date"]] = per_day.get(r["date"], 0) + 1
        if r.get("cancelled"):
            continue
        freight += r.get("freight") or 0
        received += r.get("received") or 0
        name = (r.get("sender") or {}).get("name") or "—"
        senders[name] = round(senders.get(name, 0) + (r.get("freight") or 0), 2)
        rt = f"{r.get('from_name', '')} → {r.get('to_name', '')}"
        routes[rt] = routes.get(rt, 0) + 1
    outstanding = round(freight - received, 2)
    trend = [{"date": (t - timedelta(days=days - 1 - i)).isoformat()[5:],
              "lrs": per_day.get((t - timedelta(days=days - 1 - i)).isoformat(), 0)} for i in range(days)]
    result = {
        "total": len(rows), "status": [{"name": k, "value": v} for k, v in status.items() if v],
        "freight": round(freight, 2), "received": round(received, 2), "outstanding": outstanding,
        "trend": trend,
        "top_senders": [{"name": k, "freight": v} for k, v in sorted(senders.items(), key=lambda x: -x[1])[:5]],
        "top_routes": [{"name": k, "lrs": v} for k, v in sorted(routes.items(), key=lambda x: -x[1])[:5]],
    }
    if not has_admin_access(u, "industrial_finance"):
        result.update({"status": [], "freight": 0, "received": 0, "outstanding": 0,
                       "top_senders": []})
    return result


DEFAULT_FEATURES = {
    "trips": True, "vehicles": True, "parties": True, "team": True, "finance": True,
    "reports": True, "tracking": True, "lr_charts": True, "dashboard_charts": True,
}


def subscription_features(access):
    return {
        "trips": access.get("industrial_trips") is True or access.get("industrial_lrs") is True,
        "vehicles": access.get("industrial_vehicles") is True,
        "parties": access.get("industrial_parties") is True,
        "team": access.get("industrial_team") is True,
        "finance": access.get("industrial_finance") is True,
        "reports": access.get("industrial_reports") is True,
        "tracking": access.get("industrial_tracking") is True,
        "lr_charts": access.get("industrial_lrs") is True,
        "dashboard_charts": access.get("industrial_dashboard") is True,
    }


def _plan_access(enabled_keys):
    return {key: key in enabled_keys for key in ADMIN_ACCESS_DEFAULTS}


async def seed_subscription_plans():
    if await platform_db.subscription_plans.count_documents({}):
        return
    booking = {"booking", "booking_finance", "booking_audit", "booking_settings"}
    industrial = {
        key for key in ADMIN_ACCESS_DEFAULTS if key.startswith("industrial_")
    }
    all_access = set(ADMIN_ACCESS_DEFAULTS)
    now = now_iso()
    await platform_db.subscription_plans.insert_many([
        {
            "_id": "booking-essentials",
            "name": "Booking Essentials",
            "description": "Booking operations: Dashboard, Trips, Receipts and Ledger.",
            "monthly_price": None, "annual_price": None,
            "access": _plan_access({"booking"}), "active": True, "created_at": now,
        },
        {
            "_id": "booking-complete",
            "name": "Booking Complete",
            "description": "Booking operations plus Finance, Audit and Booking settings.",
            "monthly_price": None, "annual_price": None,
            "access": _plan_access(booking), "active": True, "created_at": now,
        },
        {
            "_id": "industrial-modules",
            "name": "Industrial Modules",
            "description": "Industrial modules; choose exact admin access per customer.",
            "monthly_price": None, "annual_price": None,
            "access": _plan_access(industrial), "active": True, "created_at": now,
        },
        {
            "_id": "full-operations",
            "name": "Full Operations",
            "description": "All existing Booking and Industrial sections.",
            "monthly_price": None, "annual_price": None,
            "access": _plan_access(all_access), "active": True, "created_at": now,
        },
    ])


@api.get("/me")
async def me_profile(u=Depends(site_user)):
    tenant = await platform_db.tenants.find_one({"_id": u.get("tenant_id")}) if u.get("tenant_id") else None
    feats = {**DEFAULT_FEATURES, **((tenant or {}).get("features") or {})}
    company = {}
    if u.get("role") != "superadmin":
        s = await get_settings()
        company = s.get("company") or {}
    return {"user": {"username": u["username"], "name": u.get("name"), "role": u.get("role"),
                     "tenant_id": u.get("tenant_id"), "tenant_name": (tenant or {}).get("name", "") or company.get("name", ""),
                     "photo": company.get("owner_photo", ""), "site_ids": u.get("site_ids", []),
                     "site_permissions": u.get("site_permissions", {}),
                     "admin_access": u.get("admin_access"),
                     "tenant_access": u.get("tenant_access"),
                     "platform_support": u.get("platform_support", False),
                     "platform_actor": u.get("platform_actor"),
                     "support_session_id": u.get("support_session_id")},
            "features": ({key: True for key in DEFAULT_FEATURES} if u.get("platform_support") else feats),
            "branding": {
                "logo": company.get("logo", ""),
                "name": company.get("name", ""),
                "address": company.get("address", ""),
                "city": company.get("city", ""),
                "state": company.get("state", ""),
                "mobile": company.get("mobile", ""),
                "alt_mobile": company.get("alt_mobile", ""),
                "footer": company.get("footer", ""),
            },
            "tenant": {"plan": (tenant or {}).get("plan", ""), "license_status": (tenant or {}).get("license_status", ""),
                       "license_expiry": (tenant or {}).get("license_expiry", ""),
                       "custom_requests": (tenant or {}).get("custom_requests", ""),
                       "db_name": tenant_db_name(u.get("tenant_id")) if u.get("tenant_id") else None}}


@api.post("/upload")
async def upload_file(kind: str = "misc", file: UploadFile = File(...), u=Depends(current_user)):
    data = await file.read()
    if len(data) > 6 * 1024 * 1024:
        raise HTTPException(400, "Please upload an image under 6 MB")
    extension = (file.filename or "").rsplit(".", 1)[-1].lower()
    if kind in {"logo", "owner-photo"} and extension not in {"jpg", "jpeg", "png", "webp", "gif"}:
        raise HTTPException(
            415,
            "Logo and owner photo must be JPG, PNG, WEBP, or GIF. Convert HEIC images before uploading.",
        )
    path, ctype = S.build_path(u.get("tenant_id") or PRIMARY_TENANT, kind, file.filename or "photo.jpg")
    try:
        res = await run_in_threadpool(S.put_object, path, data, file.content_type or ctype)
    except Exception as e:
        raise HTTPException(502, f"Upload failed: {e}")
    await db.files.insert_one({"_id": new_id(), "storage_path": res["path"], "kind": kind,
                               "original_filename": file.filename, "content_type": file.content_type or ctype,
                               "size": res.get("size", len(data)), "is_deleted": False, "created_at": now_iso()})
    return {"path": res["path"], "url": f"/api/files/{res['path']}"}


@api.get("/files/{path:path}")
async def serve_file(path: str):
    if "/site-ledgers/" in f"/{path.lstrip('/')}":
        raise HTTPException(404, "File not found")
    try:
        data, ctype = await run_in_threadpool(S.get_object, path)
    except Exception:
        raise HTTPException(404, "File not found")
    return Response(content=data, media_type=ctype, headers={"Cache-Control": "public, max-age=86400"})


@api.get("/tracking/live")
async def tracking_live(u=Depends(current_user)):
    """Live location per vehicle that has its own WheelsEye token."""
    import httpx
    out, errors = [], []
    veh = await db.vehicles.find({"archived": {"$ne": True}}).to_list(500)
    tokens = [(v, (v.get("wheelseye_token") or "").strip()) for v in veh]
    tokens = [(v, t) for v, t in tokens if t]
    if not tokens:
        return {"configured": False, "vehicles": [],
                "help": "Add a WheelsEye token on each vehicle to see live location."}
    async with httpx.AsyncClient(timeout=20) as cx:
        for v, token in tokens:
            try:
                r = await cx.get("https://api.wheelseye.com/currentLoc",
                                 params={"accessToken": token, "isLocationReq": "true"})
                data = r.json()
                raw = data.get("data")
                rows = raw.get("list") if isinstance(raw, dict) else raw
                if not isinstance(rows, list):
                    errors.append(v.get("vehicle_no", ""))
                    continue
                pick = rows[0] if rows else {}
                for row in rows:
                    if (row.get("vehicleNumber") or row.get("vehicle_no") or "").replace(" ", "").upper() == (v.get("vehicle_no") or "").replace(" ", "").upper():
                        pick = row
                        break
                out.append({
                    "vehicle_no": v.get("vehicle_no") or pick.get("vehicleNumber") or "—",
                    "location": pick.get("location") or pick.get("address") or "—",
                    "lat": pick.get("latitude") or pick.get("lat"), "lng": pick.get("longitude") or pick.get("lng"),
                    "speed": pick.get("speed"), "ignition": pick.get("ignition"),
                    "updated_at": pick.get("lastUpdated") or pick.get("time") or "",
                })
            except Exception as e:
                errors.append(f"{v.get('vehicle_no')}: {e}")
    return {"configured": True, "vehicles": out, "error": "; ".join(errors) if errors else None}


# ------------------------------------------------------------------ platform (super admin)
class TenantIn(BaseModel):
    name: str
    owner_name: str
    owner_username: str
    owner_password: str
    email: Optional[str] = ""
    mobile: Optional[str] = ""
    city: Optional[str] = ""
    state: Optional[str] = ""
    plan: Optional[str] = "Business"
    plan_id: Optional[str] = None
    license_days: Optional[int] = 365


class SubscriptionPlanIn(BaseModel):
    name: str
    description: Optional[str] = ""
    monthly_price: Optional[float] = None
    annual_price: Optional[float] = None
    access: dict


class TenantSubscriptionIn(BaseModel):
    plan_id: Optional[str] = None
    plan: str
    monthly_price: Optional[float] = None
    annual_price: Optional[float] = None
    access: dict
    license_expiry: Optional[str] = None
    custom_requests: Optional[str] = ""


async def tenant_stats(tid):
    tdb = tenant_db(tid)

    async def revenue_total():
        total = 0.0
        async for row in tdb.lrs.aggregate([
            {"$match": {"cancelled": {"$ne": True}}},
            {"$group": {"_id": None, "t": {"$sum": "$freight"}}},
        ]):
            total = round(row["t"], 2)
        return total

    collections = ("trips", "lrs", "vehicles", "parties", "drivers")
    counts, revenue, last_trip = await asyncio.gather(
        asyncio.gather(*(
            tdb[collection].count_documents({}) for collection in collections
        )),
        revenue_total(),
        tdb.trips.find_one(sort=[("created_at", -1)]),
    )
    return {
        **dict(zip(collections, counts)),
        "revenue": revenue,
        "last_activity": (last_trip or {}).get("created_at", ""),
    }


@api.get("/platform/tenants")
async def platform_tenants(u=Depends(require_super)):
    tenants = await platform_db.tenants.find().sort("created_at", -1).to_list(500)
    concurrency_limit = asyncio.Semaphore(12)

    async def load_tenant(tenant):
        async with concurrency_limit:
            admins, stats = await asyncio.gather(
                platform_db.users.find(
                    {"tenant_id": tenant["_id"], "role": "owner"},
                    {"password": 0},
                ).sort("created_at", 1).to_list(500),
                tenant_stats(tenant["_id"]),
            )
        admin_rows = [{
            "username": admin["_id"],
            "name": admin.get("name", ""),
            "active": admin.get("active") is not False,
            "created_at": admin.get("created_at", ""),
            "admin_access": admin.get("admin_access"),
        } for admin in admins]
        return {
            **ser(tenant),
            "admins": admin_rows,
            "admin_count": len(admin_rows),
            "stats": stats,
            "db_name": tenant.get("db_name") or tenant_db_name(tenant["_id"]),
        }

    return await asyncio.gather(*(load_tenant(tenant) for tenant in tenants))


@api.get("/platform/errors")
async def platform_errors(u=Depends(require_super)):
    return sers(await platform_db.error_logs.find().sort("created_at", -1).to_list(200))


@api.get("/platform/summary")
async def platform_summary(u=Depends(require_super)):
    rows = await platform_tenants(u)
    plans = sers(await platform_db.subscription_plans.find().sort("name", 1).to_list(200))
    from datetime import date
    t = date.today().isoformat()
    active = [r for r in rows if r.get("license_status") == "Active"]
    return {
        "tenants": rows,
        "plans": plans,
        "totals": {
            "licenses": len(rows),
            "admins": sum(r["admin_count"] for r in rows),
            "active_admins": sum(
                1 for row in rows for admin in row["admins"] if admin["active"]
            ),
            "active": len(active),
            "suspended": len([r for r in rows if r.get("license_status") != "Active"]),
            "expiring": len([r for r in active if (r.get("license_expiry") or "9999") <= t]),
            "trips": sum(r["stats"]["trips"] for r in rows),
            "lrs": sum(r["stats"]["lrs"] for r in rows),
            "vehicles": sum(r["stats"]["vehicles"] for r in rows),
            "revenue": round(sum(r["stats"]["revenue"] for r in rows), 2),
        },
    }


async def record_platform_event(tenant_id, actor, action, summary, details=None):
    await platform_db.subscription_audit_events.insert_one({
        "_id": new_id(),
        "tenant_id": tenant_id,
        "actor": actor["username"],
        "action": action,
        "summary": summary,
        "details": details or {},
        "created_at": now_iso(),
    })


@api.post("/platform/tenants/{tid}/support-session")
async def start_platform_support_session(tid: str, u=Depends(require_super)):
    tenant = await platform_db.tenants.find_one({"_id": tid}, {"_id": 1, "name": 1})
    if not tenant:
        raise HTTPException(404, "Customer business not found.")
    token, session_id, expires_at = make_support_token(u["username"], tid)
    await platform_db.platform_support_sessions.insert_one({
        "_id": session_id,
        "username": u["username"],
        "tenant_id": tid,
        "active": True,
        "created_at": now_iso(),
        "expires_at": expires_at,
    })
    try:
        await record_platform_event(
            tid, u, "support.session.started",
            f"Started full customer support for {tenant.get('name', tid)}.",
            {"session_id": session_id, "expires_at": expires_at.isoformat()},
        )
    except Exception:
        await platform_db.platform_support_sessions.update_one(
            {"_id": session_id}, {"$set": {"active": False}},
        )
        raise
    return {
        "token": token,
        "session_id": session_id,
        "tenant_id": tid,
        "tenant_name": tenant.get("name", ""),
        "expires_at": expires_at.isoformat(),
    }


@api.post("/platform/support-session/end")
async def end_platform_support_session(u=Depends(require_platform_support)):
    await record_platform_event(
        u["tenant_id"],
        {"username": u["platform_actor"]},
        "support.session.ended",
        "Ended full customer support session.",
        {"session_id": u["support_session_id"]},
    )
    await platform_db.platform_support_sessions.update_one(
        {"_id": u["support_session_id"], "active": True},
        {"$set": {"active": False, "ended_at": now_iso()}},
    )
    return {"ok": True}


@api.get("/platform/tenants/{tid}/history")
async def tenant_subscription_history(tid: str, u=Depends(require_super)):
    if not await platform_db.tenants.find_one({"_id": tid}, {"_id": 1}):
        raise HTTPException(404, "Business not found.")
    return sers(await platform_db.subscription_audit_events.find(
        {"tenant_id": tid},
    ).sort("created_at", -1).to_list(100))


@api.get("/platform/activity")
async def platform_activity(u=Depends(require_super)):
    events = await platform_db.subscription_audit_events.find().sort(
        "created_at", -1,
    ).to_list(100)
    tenant_ids = {event["tenant_id"] for event in events if event.get("tenant_id")}
    tenants = {
        row["_id"]: row.get("name", row["_id"])
        for row in await platform_db.tenants.find(
            {"_id": {"$in": list(tenant_ids)}},
            {"name": 1},
        ).to_list(100)
    } if tenant_ids else {}
    return [{**ser(event), "tenant_name": (
                "Platform" if not event.get("tenant_id")
                else tenants.get(event["tenant_id"], "Deleted business")
            )}
            for event in events]


def _validate_subscription_plan(body):
    name = body.name.strip()
    if not name or len(name) > 80:
        raise HTTPException(400, "Plan name must be between 1 and 80 characters.")
    for label, amount in (("Monthly", body.monthly_price), ("Annual", body.annual_price)):
        if amount is not None and (not math.isfinite(amount) or amount < 0):
            raise HTTPException(400, f"{label} price must be a non-negative number.")
    access = validate_admin_access(body.access)
    return {
        "name": name,
        "name_key": name.casefold(),
        "description": (body.description or "").strip(),
        "monthly_price": body.monthly_price,
        "annual_price": body.annual_price,
        "access": access,
    }


async def _ensure_plan_name_available(name_key, exclude_id=None):
    plans = await platform_db.subscription_plans.find({}, {"name": 1}).to_list(200)
    if any(row["_id"] != exclude_id and row.get("name", "").casefold() == name_key
           for row in plans):
        raise HTTPException(409, "A subscription plan with this name already exists.")


@api.post("/platform/plans")
async def create_subscription_plan(body: SubscriptionPlanIn, u=Depends(require_super)):
    values = _validate_subscription_plan(body)
    await _ensure_plan_name_available(values["name_key"])
    plan_id = new_id()
    record = {
        "_id": plan_id,
        **values,
        "active": True,
        "created_at": now_iso(),
        "created_by": u["username"],
    }
    await platform_db.subscription_plans.insert_one(record)
    await record_platform_event(
        None, u, "plan.created", f"Created subscription plan {values['name']}.",
        {"plan_id": plan_id},
    )
    return ser(record)


@api.put("/platform/plans/{plan_id}")
async def update_subscription_plan(
    plan_id: str, body: SubscriptionPlanIn, u=Depends(require_super),
):
    existing = await platform_db.subscription_plans.find_one({"_id": plan_id})
    if not existing:
        raise HTTPException(404, "Subscription plan not found.")
    values = _validate_subscription_plan(body)
    await _ensure_plan_name_available(values["name_key"], plan_id)
    await platform_db.subscription_plans.update_one(
        {"_id": plan_id}, {"$set": {**values, "updated_at": now_iso(),
                                    "updated_by": u["username"]}},
    )
    await record_platform_event(
        None, u, "plan.updated", f"Updated subscription plan {values['name']}.",
        {"plan_id": plan_id},
    )
    return ser(await platform_db.subscription_plans.find_one({"_id": plan_id}))


@api.delete("/platform/plans/{plan_id}")
async def delete_subscription_plan(plan_id: str, u=Depends(require_super)):
    existing = await platform_db.subscription_plans.find_one({"_id": plan_id})
    if not existing:
        raise HTTPException(404, "Subscription plan not found.")
    assigned = await platform_db.tenants.count_documents({"plan_id": plan_id})
    if assigned:
        raise HTTPException(409, "This plan is assigned to customers. Reassign them before deleting it.")
    await platform_db.subscription_plans.delete_one({"_id": plan_id})
    await record_platform_event(
        None, u, "plan.deleted", f"Deleted subscription plan {existing['name']}.",
        {"plan_id": plan_id},
    )
    return {"ok": True}


@api.post("/platform/tenants")
async def create_tenant(body: TenantIn, u=Depends(require_super)):
    from datetime import date, timedelta
    username = body.owner_username.strip().lower()
    if await platform_db.users.find_one({"_id": username}):
        raise HTTPException(400, "This login username is already taken")
    plan = None
    if body.plan_id:
        plan = await platform_db.subscription_plans.find_one({"_id": body.plan_id, "active": True})
        if not plan:
            raise HTTPException(400, "Select an active subscription plan.")
    base = tenant_key(body.name, body.owner_name)
    tid, n = base, 2
    while await platform_db.tenants.find_one({"_id": tid}):
        tid, n = tenant_key(body.name, body.owner_name, n), n + 1
    dbn = tenant_db_name(tid)
    created_at = now_iso()
    creator = {
        "created_by_id": str(u.get("_id") or u["username"]),
        "created_by_login": u["username"],
        "created_by_name": u.get("name", ""),
        "created_by_role": u.get("actor_role") or u.get("role", ""),
        "created_at": created_at,
    }
    tenant_record = {
        "_id": tid, "name": body.name.strip(), "owner_name": body.owner_name.strip(),
        "owner_username": username, "email": (body.email or "").strip(),
        "mobile": body.mobile, "city": body.city, "state": body.state,
        "plan": plan["name"] if plan else body.plan, "license_status": "Active",
        "license_start": date.today().isoformat(),
        "license_expiry": (date.today() + timedelta(days=int(body.license_days or 365))).isoformat(),
        **creator, "db_name": dbn,
    }
    if plan:
        tenant_record.update({
            "plan_id": plan["_id"],
            "subscription_access": dict(plan["access"]),
            "subscription_monthly_price": plan.get("monthly_price"),
            "subscription_annual_price": plan.get("annual_price"),
            "features": subscription_features(plan["access"]),
            "subscription_updated_at": created_at,
            "subscription_updated_by": u["username"],
        })
    await platform_db.tenants.insert_one(tenant_record)
    await platform_db.users.insert_one({
        "_id": username, "name": body.owner_name.strip(), "password": hash_pw(body.owner_password),
        "role": "owner", "tenant_id": tid, "active": True,
        "admin_access": dict(ADMIN_ACCESS_DENIED), **creator,
    })
    tdb = tenant_db(tid)
    company = dict(DEFAULT_SETTINGS["company"])
    company["name"] = body.name.strip()
    company["city"] = body.city or ""
    company["state"] = body.state or ""
    await tdb.settings.insert_one({
        **DEFAULT_SETTINGS, "company": company, "base_locations": [], "routes": [],
    })
    await record_platform_event(
        tid, u, "licence.created", f"Created customer licence for {body.name.strip()}.",
        {"plan_id": tenant_record.get("plan_id"), "plan": tenant_record["plan"]},
    )
    return {"id": tid, "db_name": dbn, "ok": True}


@api.put("/platform/tenants/{tid}")
async def update_tenant(tid: str, payload: dict, u=Depends(require_super)):
    existing = await platform_db.tenants.find_one({"_id": tid})
    if not existing:
        raise HTTPException(404, "Business not found.")
    allowed = {k: v for k, v in payload.items()
               if k in ("name", "owner_name", "mobile", "city", "state", "plan",
                        "license_status", "license_expiry", "notes", "features", "custom_requests")}
    await platform_db.tenants.update_one({"_id": tid}, {"$set": allowed})
    t = await platform_db.tenants.find_one({"_id": tid})
    if "license_status" in allowed and existing.get("license_status") != allowed["license_status"]:
        await record_platform_event(
            tid, u, "licence.status",
            f"Licence status changed from {existing.get('license_status', 'Unknown')} "
            f"to {allowed['license_status']}.",
            {"from": existing.get("license_status"), "to": allowed["license_status"]},
        )
    return ser(t)


@api.put("/platform/tenants/{tid}/subscription")
async def update_tenant_subscription(
    tid: str, body: TenantSubscriptionIn, u=Depends(require_super),
):
    tenant = await platform_db.tenants.find_one({"_id": tid})
    if not tenant:
        raise HTTPException(404, "Business not found.")
    if body.plan_id and not await platform_db.subscription_plans.find_one({"_id": body.plan_id}):
        raise HTTPException(400, "Subscription plan not found.")
    plan_name = body.plan.strip()
    if not plan_name or len(plan_name) > 80:
        raise HTTPException(400, "Plan name must be between 1 and 80 characters.")
    for label, amount in (("Monthly", body.monthly_price), ("Annual", body.annual_price)):
        if amount is not None and (not math.isfinite(amount) or amount < 0):
            raise HTTPException(400, f"{label} price must be a non-negative number.")
    access = validate_admin_access(body.access)
    previous_access = tenant.get("subscription_access") or {}
    previous_snapshot = {
        "plan_id": tenant.get("plan_id"),
        "plan": tenant.get("plan"),
        "monthly_price": tenant.get("subscription_monthly_price"),
        "annual_price": tenant.get("subscription_annual_price"),
        "license_expiry": tenant.get("license_expiry"),
        "access": previous_access,
    }
    now = now_iso()
    await platform_db.tenants.update_one(
        {"_id": tid},
        {"$set": {
            "plan_id": body.plan_id,
            "plan": plan_name,
            "subscription_access": access,
            "subscription_monthly_price": body.monthly_price,
            "subscription_annual_price": body.annual_price,
            "features": subscription_features(access),
            "license_expiry": body.license_expiry or "",
            "custom_requests": (body.custom_requests or "").strip(),
            "subscription_updated_at": now,
            "subscription_updated_by": u["username"],
        }},
    )
    admins = await platform_db.users.find(
        {"tenant_id": tid, "role": "owner"}, {"admin_access": 1},
    ).to_list(500)
    admins_clamped = 0
    for admin in admins:
        grants = normalize_admin_access(admin.get("admin_access"))
        capped = {key: grants[key] and access[key] for key in ADMIN_ACCESS_DEFAULTS}
        if capped != grants:
            admins_clamped += 1
        await platform_db.users.update_one(
            {"_id": admin["_id"], "tenant_id": tid, "role": "owner"},
            {"$set": {"admin_access": capped}},
        )
    changed_sections = [
        key for key in ADMIN_ACCESS_DEFAULTS if previous_access.get(key) != access[key]
    ]
    await record_platform_event(
        tid, u, "subscription.updated",
        f"Updated subscription to {plan_name}; licence expires {body.license_expiry or 'without an expiry date'}.",
        {
            "before": previous_snapshot,
            "after": {
                "plan_id": body.plan_id,
                "plan": plan_name,
                "monthly_price": body.monthly_price,
                "annual_price": body.annual_price,
                "license_expiry": body.license_expiry or "",
                "access": access,
            },
            "changed_sections": changed_sections,
            "admins_clamped": admins_clamped,
        },
    )
    return ser(await platform_db.tenants.find_one({"_id": tid}))


@api.put("/platform/tenants/{tid}/admins/{username}/access")
async def update_tenant_admin_access(
    tid: str, username: str, payload: dict, u=Depends(require_super),
):
    tenant = await platform_db.tenants.find_one({"_id": tid})
    if not tenant:
        raise HTTPException(404, "Business not found")
    admin = await platform_db.users.find_one({
        "_id": username.strip().lower(), "tenant_id": tid, "role": "owner",
    })
    if not admin:
        raise HTTPException(404, "Business admin not found")
    access = validate_admin_access(payload.get("admin_access"))
    previous_access = normalize_admin_access(admin.get("admin_access"))
    subscription_access = tenant.get("subscription_access")
    if isinstance(subscription_access, dict):
        unavailable_by_plan = [
            key for key, enabled in access.items()
            if enabled and subscription_access.get(key) is not True
        ]
        if unavailable_by_plan:
            raise HTTPException(
                400,
                "This section is not included in the customer subscription: "
                + ", ".join(unavailable_by_plan),
            )
    features = {**DEFAULT_FEATURES, **(tenant.get("features") or {})}
    unavailable = [
        access_key for access_key, feature_key in {
            "industrial_trips": "trips", "industrial_lrs": "trips",
            "industrial_vehicles": "vehicles", "industrial_parties": "parties",
            "industrial_team": "team", "industrial_finance": "finance",
            "industrial_reports": "reports", "industrial_tracking": "tracking",
        }.items()
        if access[access_key] and features.get(feature_key) is False
    ]
    if unavailable:
        raise HTTPException(
            400,
            "Enable the licensed module before granting admin access: "
            + ", ".join(unavailable),
        )
    await platform_db.users.update_one(
        {"_id": admin["_id"], "tenant_id": tid, "role": "owner"},
        {"$set": {"admin_access": access}},
    )
    changed_sections = [
        key for key in ADMIN_ACCESS_DEFAULTS if previous_access[key] != access[key]
    ]
    await record_platform_event(
        tid, u, "admin.access",
        f"Updated access for @{admin['_id']}.",
        {
            "username": admin["_id"],
            "before": previous_access,
            "after": access,
            "changed_sections": changed_sections,
        },
    )
    return {"ok": True, "tenant_id": tid, "username": admin["_id"],
            "admin_access": access}


@api.post("/platform/tenants/{tid}/reset-password")
async def reset_tenant_password(tid: str, payload: dict, u=Depends(require_super)):
    t = await platform_db.tenants.find_one({"_id": tid})
    if not t:
        raise HTTPException(404, "Business not found")
    pw = (payload.get("password") or "").strip()
    if len(pw) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    await platform_db.users.update_one({"_id": t["owner_username"]}, {"$set": {"password": hash_pw(pw)}})
    await record_platform_event(
        tid, u, "admin.password_reset", f"Reset the owner password for @{t['owner_username']}.",
        {"username": t["owner_username"]},
    )
    return {"ok": True}


# ------------------------------------------------------------------ alerts
def days_to(d):
    from datetime import date
    try:
        y, m, dd = [int(x) for x in d.split("-")]
        return (date(y, m, dd) - date.today()).days
    except Exception:
        return None


DOC_TYPES = ["rc", "insurance", "permit", "fitness", "puc"]


@api.get("/alerts")
async def alerts(u=Depends(current_user)):
    out = {"vehicle_docs": [], "driver_licence": [], "overdue": [], "pending_expenses": [],
           "driver_advances": [], "employee_advances": []}
    for v in await db.vehicles.find({"archived": {"$ne": True}}).to_list(500):
        docs = v.get("documents") or {}
        for dt_ in DOC_TYPES:
            exp = (docs.get(dt_) or {}).get("expiry")
            if not exp:
                continue
            n = days_to(exp)
            if n is not None and n <= 45:
                out["vehicle_docs"].append({"id": v["_id"], "vehicle_no": v["vehicle_no"],
                                            "doc": dt_.upper(), "expiry": exp, "days": n,
                                            "state": "Expired" if n < 0 else "Expiring Soon"})
    for d in await db.drivers.find({"archived": {"$ne": True}}).to_list(500):
        exp = d.get("licence_expiry")
        if exp:
            n = days_to(exp)
            if n is not None and n <= 45:
                out["driver_licence"].append({"id": d["_id"], "name": d["name"], "expiry": exp,
                                              "days": n, "state": "Expired" if n < 0 else "Expiring Soon"})
    rec = await receivables_rows()
    out["overdue"] = [r for r in rec if r["status"] == "Overdue"][:20]
    out["pending_receivables"] = rec[:20]
    dbal = await L.balances("driver")
    drivers = {d["_id"]: d for d in await db.drivers.find().to_list(500)}
    out["driver_advances"] = sorted([
        {"id": k, "name": drivers.get(k, {}).get("name", "-"), "amount": b["balance"]}
        for k, b in dbal.items() if b["balance"] > 0.5], key=lambda r: -r["amount"])
    ebal = await L.balances("employee")
    team = {d["_id"]: d for d in await db.team.find().to_list(500)}
    out["employee_advances"] = sorted([
        {"id": k, "name": team.get(k, {}).get("name", "-"), "amount": b["balance"]}
        for k, b in ebal.items() if b["balance"] > 0.5], key=lambda r: -r["amount"])
    if not has_admin_access(u, "industrial_vehicles"):
        out["vehicle_docs"] = []
    if not has_admin_access(u, "industrial_team"):
        out["driver_licence"] = []
        out["driver_advances"] = []
        out["employee_advances"] = []
    if not has_admin_access(u, "industrial_finance"):
        out["overdue"] = []
        out["pending_receivables"] = []
        out["driver_advances"] = []
        out["employee_advances"] = []
    return out


# ------------------------------------------------------------------ dashboard
@api.get("/dashboard")
async def dashboard(u=Depends(current_user)):
    t = today()
    trips_today = sers(await db.trips.find({"start_date": t}).sort("created_at", -1).to_list(100))
    can_trips = has_admin_access(u, "industrial_trips")
    can_lrs = has_admin_access(u, "industrial_lrs")
    can_vehicles = has_admin_access(u, "industrial_vehicles")
    can_team = has_admin_access(u, "industrial_team")
    can_finance = has_admin_access(u, "industrial_finance")
    if not can_finance:
        for row in trips_today:
            row.pop("trip_amount", None)
            row.pop("expected_collection", None)
    active = await db.trips.count_documents({"status": {"$in": ACTIVE_TRIP}})
    completed_today = await db.trips.count_documents({"status": "Completed", "start_date": t})
    veh_total = await db.vehicles.count_documents({"archived": {"$ne": True}})
    veh_on_trip = await db.vehicles.count_documents({"archived": {"$ne": True}, "status": "On Trip"})
    veh_avail = await db.vehicles.count_documents({"archived": {"$ne": True}, "status": "Available"})
    fin = await finance_summary(u) if can_finance else {}
    al = await alerts(u)
    dw = await L.deewanji_cash()
    team_rows = {x["_id"]: x for x in await db.team.find({"archived": {"$ne": True}}).to_list(200)}
    coll_today = await db.receipts.find({"cancelled": False, "date": t}).to_list(500) if can_finance else []
    dw_today = round(sum(r["amount"] for r in coll_today if r.get("collected_by_type") == "deewanji"), 2)
    return {
        "trips": {"today": len(trips_today) if can_trips else 0,
                  "active": active if can_trips else 0,
                  "completed_today": completed_today if can_trips else 0,
                  "total": await db.trips.count_documents({}) if can_trips else 0},
        "vehicles": {"total": veh_total if can_vehicles else 0,
                     "available": veh_avail if can_vehicles else 0,
                     "on_trip": veh_on_trip if can_vehicles else 0,
                     "maintenance": await db.vehicles.count_documents({"status": "Maintenance", "archived": {"$ne": True}}) if can_vehicles else 0},
        "people": {"drivers": await db.drivers.count_documents({"archived": {"$ne": True}}) if can_team else 0,
                   "team": await db.team.count_documents({"archived": {"$ne": True}}) if can_team else 0},
        "money": fin,
        "collections": {"today": round(sum(r["amount"] for r in coll_today), 2) if can_finance else 0,
                        "deewanji_today": dw_today,
                        "cash_with_deewanji": round(sum(dw.values()), 2) if can_finance else 0,
                        "by_deewanji": [{"id": k, "name": team_rows.get(k, {}).get("name", "-"),
                                         "amount": round(v, 2)} for k, v in dw.items() if v] if can_finance else []},
        "alerts": {"vehicle_docs": len(al["vehicle_docs"]), "driver_licence": len(al["driver_licence"]),
                   "overdue": len(al["overdue"]), "pending_payments": len(al["pending_receivables"]),
                   "driver_advances": round(sum(x["amount"] for x in al["driver_advances"]), 2),
                   "employee_advances": round(sum(x["amount"] for x in al["employee_advances"]), 2)},
        "lists": {
            "trips_today": trips_today[:8] if can_trips else [],
            "recent_collections": sers(await db.receipts.find({"cancelled": False}).sort("created_at", -1).to_list(6)) if can_finance else [],
            "recent_payments": sers(await db.payments.find({"cancelled": False}).sort("created_at", -1).to_list(6)) if can_finance else [],
            "recent_expenses": sers(await db.expenses.find({
                "cancelled": False, "site_id": {"$exists": False},
            }).sort("created_at", -1).to_list(6)) if can_finance else [],
            "pending_receivables": al["pending_receivables"][:8] if can_finance else [],
        },
        "pending_lrs": await db.lrs.count_documents({"cancelled": False, "payment_status": {"$in": ["Pending", "Partial"]}}) if can_lrs else 0,
        "total_lrs": await db.lrs.count_documents({"cancelled": False}) if can_lrs else 0,
    }


# ------------------------------------------------------------------ global search
@api.get("/search")
async def search(q: str, u=Depends(current_user)):
    if not q or len(q) < 2:
        return []
    rx = {"$regex": q, "$options": "i"}
    out = []
    if has_admin_access(u, "industrial_vehicles"):
        for v in await db.vehicles.find({"vehicle_no": rx, "archived": {"$ne": True}}).limit(5).to_list(5):
            out.append({"type": "Vehicle", "title": v["vehicle_no"],
                        "subtitle": f"{v.get('vehicle_type','')} {v.get('status','')}",
                        "link": f"/vehicles/{v['_id']}"})
    if has_admin_access(u, "industrial_team"):
        for d in await db.drivers.find({"$or": [{"name": rx}, {"mobile": rx}], "archived": {"$ne": True}}).limit(5).to_list(5):
            out.append({"type": "Driver", "title": d["name"], "subtitle": d.get("mobile", ""),
                        "link": f"/drivers/{d['_id']}"})
    if has_admin_access(u, "industrial_parties"):
        for p in await db.parties.find({"$or": [{"name": rx}, {"mobile": rx}], "archived": {"$ne": True}}).limit(5).to_list(5):
            out.append({"type": "Party", "title": p["name"], "subtitle": p.get("mobile", ""),
                        "link": f"/parties/{p['_id']}"})
    if has_admin_access(u, "industrial_trips"):
        for t in await db.trips.find({"$or": [{"trip_no": rx}, {"vehicle_no": rx}]}).limit(5).to_list(5):
            out.append({"type": "Trip", "title": t["trip_no"],
                        "subtitle": f"{t['from_name']} > {t['to_name']} · {t['status']}",
                        "link": f"/trips/{t['_id']}"})
    if has_admin_access(u, "industrial_lrs"):
        for l in await db.lrs.find({"$or": [{"lr_no": rx}, {"sender.name": rx}, {"vehicle_no": rx}]}).limit(5).to_list(5):
            subtitle = (f"{(l.get('sender') or {}).get('name','')} · Rs {l.get('freight',0):,.0f}"
                        if has_admin_access(u, "industrial_finance")
                        else (l.get("sender") or {}).get("name", ""))
            out.append({"type": "LR", "title": l["lr_no"], "subtitle": subtitle,
                        "link": f"/lrs/{l['_id']}"})
    return out


# ------------------------------------------------------------------ reports
@api.get("/reports/{name}")
async def report(name: str, frm: Optional[str] = None, to: Optional[str] = None,
                 q: Optional[str] = None, entity_id: Optional[str] = None,
                 u=Depends(current_user)):
    frm = frm or "2000-01-01"
    to = to or "2999-12-31"
    rng = {"$gte": frm, "$lte": to}

    def cols(*c):
        return [{"key": k, "label": lbl, "type": ty} for k, lbl, ty in c]

    if name == "trips":
        rows = await list_trips(q=q, frm=frm, to=to, limit=2000, u=u)
        return {"columns": cols(("start_date", "Date", "date"), ("trip_no", "Trip No", "t"),
                                ("mode", "Type", "t"), ("from_name", "From", "t"), ("to_name", "To", "t"),
                                ("vehicle_no", "Vehicle", "t"), ("driver_name", "Driver", "t"),
                                ("party_name", "Party", "t"), ("trip_amount", "Amount", "money"),
                                ("status", "Status", "badge")), "rows": rows,
                "totals": {"trip_amount": round(sum(r["trip_amount"] for r in rows), 2)}}
    if name == "lrs":
        rows = await list_lrs(q=q, frm=frm, to=to, limit=2000, u=u)
        for r in rows:
            r["sender_name"] = (r.get("sender") or {}).get("name", "")
            r["receiver_name"] = (r.get("receiver") or {}).get("name", "")
        return {"columns": cols(("date", "Date", "date"), ("lr_no", "LR No", "t"),
                                ("sender_name", "Sender", "t"), ("receiver_name", "Receiver", "t"),
                                ("from_name", "From", "t"), ("to_name", "To", "t"),
                                ("vehicle_no", "Vehicle", "t"), ("freight", "Freight", "money"),
                                ("received", "Received", "money"), ("outstanding", "Outstanding", "money"),
                                ("payment_status", "Status", "badge")), "rows": rows,
                "totals": {"freight": round(sum(r["freight"] for r in rows), 2),
                           "received": round(sum(r["received"] for r in rows), 2),
                           "outstanding": round(sum(r["outstanding"] for r in rows), 2)}}
    if name == "vehicles":
        vehicles = sers(await db.vehicles.find({"archived": {"$ne": True}}).to_list(500))
        rows = []
        for v in vehicles:
            trips = await db.trips.count_documents({"vehicle_id": v["id"], "start_date": rng})
            fu = await sum_coll("fuel", {"vehicle_id": v["id"], "date": rng})
            ex = await sum_coll("expenses", {"vehicle_id": v["id"], "date": rng})
            rows.append({**v, "trips": trips, "fuel": fu, "expense": ex, "total_cost": round(fu + ex, 2)})
        return {"columns": cols(("vehicle_no", "Vehicle", "t"), ("vehicle_type", "Type", "t"),
                                ("status", "Status", "badge"), ("trips", "Trips", "t"),
                                ("fuel", "Fuel", "money"), ("expense", "Expenses", "money"),
                                ("total_cost", "Total Cost", "money")), "rows": rows,
                "totals": {"fuel": round(sum(r["fuel"] for r in rows), 2),
                           "expense": round(sum(r["expense"] for r in rows), 2)}}
    if name == "drivers":
        drivers = sers(await db.drivers.find({"archived": {"$ne": True}}).to_list(500))
        bal = await L.balances("driver")
        rows = []
        for d in drivers:
            rows.append({**d, "trips": await db.trips.count_documents({"driver_id": d["id"], "start_date": rng}),
                         "advance": bal.get(d["id"], {}).get("balance", 0)})
        return {"columns": cols(("name", "Driver", "t"), ("mobile", "Mobile", "t"),
                                ("licence_no", "Licence", "t"), ("licence_expiry", "Licence Expiry", "date"),
                                ("status", "Status", "badge"), ("trips", "Trips", "t"),
                                ("advance", "Outstanding Advance", "money")), "rows": rows,
                "totals": {"advance": round(sum(r["advance"] for r in rows), 2)}}
    if name == "receivables":
        d = await finance_receivables(u)
        return {"columns": cols(("party", "Party", "t"), ("mobile", "Mobile", "t"),
                                ("total", "Total Billed", "money"), ("received", "Received", "money"),
                                ("outstanding", "Outstanding", "money"), ("due_date", "Due Date", "date"),
                                ("age", "Days Overdue", "t"), ("bucket", "Aging", "t"),
                                ("status", "Status", "badge")), "rows": d["rows"],
                "totals": {"outstanding": d["total"]}}
    if name == "payables":
        d = await finance_payables(u)
        return {"columns": cols(("name", "Name", "t"), ("type", "Type", "t"),
                                ("total", "Total", "money"), ("paid", "Paid", "money"),
                                ("outstanding", "Outstanding", "money"), ("status", "Status", "badge")),
                "rows": d["rows"], "totals": {"outstanding": d["total"]}}
    if name in ("collections", "deewanji"):
        rows = await list_receipts(frm=frm, to=to, q=q, limit=3000, u=u)
        if name == "deewanji":
            rows = [r for r in rows if r.get("collected_by_type") == "deewanji"]
        return {"columns": cols(("date", "Date", "date"), ("party_name", "Party", "t"),
                                ("lr_no", "LR", "t"), ("amount", "Amount", "money"),
                                ("mode", "Mode", "t"), ("deewanji_name", "Collected By", "t"),
                                ("reference", "Reference", "t")), "rows": rows,
                "totals": {"amount": round(sum(r["amount"] for r in rows), 2)}}
    if name == "expenses":
        rows = await list_expenses(frm=frm, to=to, q=q, limit=3000, u=u)
        return {"columns": cols(("date", "Date", "date"), ("category", "Category", "t"),
                                ("vehicle_no", "Vehicle", "t"), ("trip_no", "Trip", "t"),
                                ("vendor", "Vendor", "t"), ("mode", "Mode", "t"),
                                ("amount", "Amount", "money"), ("remarks", "Remarks", "t")),
                "rows": rows, "totals": {"amount": round(sum(r["amount"] for r in rows), 2)}}
    if name == "fuel":
        rows = await list_fuel(frm=frm, to=to, q=q, limit=3000, u=u)
        return {"columns": cols(("date", "Date", "date"), ("vehicle_no", "Vehicle", "t"),
                                ("pump_name", "Fuel Pump", "t"), ("quantity", "Litres", "t"),
                                ("rate", "Rate", "money"), ("amount", "Amount", "money"),
                                ("odometer", "Odometer", "t"), ("mode", "Mode", "t")),
                "rows": rows, "totals": {"amount": round(sum(r["amount"] for r in rows), 2),
                                         "quantity": round(sum(r["quantity"] for r in rows), 2)}}
    if name == "driver_advances":
        rows = await list_advances(entity_type="driver", frm=frm, to=to, limit=3000, u=u)
        return {"columns": cols(("date", "Date", "date"), ("entity_name", "Driver", "t"),
                                ("kind", "Type", "t"), ("amount", "Amount", "money"),
                                ("mode", "Mode", "t"), ("remarks", "Remarks", "t")),
                "rows": rows, "totals": {"amount": round(sum(r["amount"] for r in rows), 2)}}
    if name == "employee_ledger":
        rows = await list_advances(entity_type="employee", frm=frm, to=to, limit=3000, u=u)
        return {"columns": cols(("date", "Date", "date"), ("entity_name", "Team Member", "t"),
                                ("kind", "Type", "t"), ("amount", "Amount", "money"),
                                ("mode", "Mode", "t"), ("remarks", "Remarks", "t")),
                "rows": rows, "totals": {"amount": round(sum(r["amount"] for r in rows), 2)}}
    if name == "tpl":
        rows = await list_tpl(frm=frm, to=to, q=q, u=u)
        return {"columns": cols(("date", "Date", "date"), ("party_name", "Customer", "t"),
                                ("partner_name", "Partner", "t"), ("from_name", "From", "t"),
                                ("to_name", "To", "t"), ("customer_amount", "Customer Amt", "money"),
                                ("partner_amount", "Partner Amt", "money"),
                                ("expenses", "Expenses", "money"), ("margin", "Margin", "money")),
                "rows": rows, "totals": {"customer_amount": round(sum(r["customer_amount"] for r in rows), 2),
                                         "partner_amount": round(sum(r["partner_amount"] for r in rows), 2),
                                         "margin": round(sum(r["margin"] for r in rows), 2)}}
    if name == "cashflow":
        d = await finance_cashbook(frm=frm, to=to, u=u)
        rows = [{**r, "money_in": r["amount"] if r["direction"] == "in" else 0,
                 "money_out": r["amount"] if r["direction"] == "out" else 0} for r in d["rows"]]
        return {"columns": cols(("date", "Date", "date"), ("description", "Description", "t"),
                                ("account", "Account", "t"), ("mode", "Mode", "t"),
                                ("money_in", "Money In", "money"), ("money_out", "Money Out", "money")),
                "rows": rows, "totals": {"money_in": round(sum(r["money_in"] for r in rows), 2),
                                         "money_out": round(sum(r["money_out"] for r in rows), 2)}}
    if name == "party_ledger":
        if not entity_id:
            bal = await L.balances("party")
            parties = sers(await db.parties.find({"archived": {"$ne": True}}).to_list(3000))
            rows = [{**p, "billed": bal.get(p["id"], {}).get("debit", 0),
                     "received": bal.get(p["id"], {}).get("credit", 0),
                     "outstanding": bal.get(p["id"], {}).get("balance", 0)} for p in parties]
            return {"columns": cols(("name", "Party", "t"), ("mobile", "Mobile", "t"),
                                    ("city", "City", "t"), ("billed", "Total Billed", "money"),
                                    ("received", "Received", "money"), ("outstanding", "Outstanding", "money")),
                    "rows": rows, "totals": {"outstanding": round(sum(r["outstanding"] for r in rows), 2)}}
        rows, bal = await L.statement("party", entity_id, frm, to)
        return {"columns": cols(("date", "Date", "date"), ("description", "Description", "t"),
                                ("debit", "Debit", "money"), ("credit", "Credit", "money"),
                                ("balance", "Balance", "money")), "rows": rows,
                "totals": {"balance": bal}}
    raise HTTPException(404, "Unknown report")


app.include_router(api)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
