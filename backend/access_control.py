from fastapi import HTTPException, Request

ADMIN_ACCESS_DEFAULTS = {
    "booking": True,
    "booking_finance": True,
    "booking_audit": True,
    "booking_settings": True,
    "industrial_dashboard": True,
    "industrial_trips": True,
    "industrial_lrs": True,
    "industrial_vehicles": True,
    "industrial_parties": True,
    "industrial_team": True,
    "industrial_finance": True,
    "industrial_reports": True,
    "industrial_tracking": True,
    "industrial_settings": True,
}
ADMIN_ACCESS_DENIED = {key: False for key in ADMIN_ACCESS_DEFAULTS}

INDUSTRIAL_SUBSCRIPTION_FEATURES = {
    "industrial_trips": "trips",
    "industrial_lrs": "trips",
    "industrial_vehicles": "vehicles",
    "industrial_parties": "parties",
    "industrial_team": "team",
    "industrial_finance": "finance",
    "industrial_reports": "reports",
    "industrial_tracking": "tracking",
}


def normalize_admin_access(access):
    if not isinstance(access, dict):
        return dict(ADMIN_ACCESS_DEFAULTS)
    return {key: access.get(key) is True for key in ADMIN_ACCESS_DEFAULTS}


def validate_admin_access(access):
    if not isinstance(access, dict) or set(access) != set(ADMIN_ACCESS_DEFAULTS):
        raise HTTPException(400, "Access settings must include every supported permission.")
    if any(type(value) is not bool for value in access.values()):
        raise HTTPException(400, "Access settings must use true or false values.")
    return dict(access)


def has_admin_access(user, access_key):
    grants = user.get("admin_access")
    if grants is None:
        has_user_grant = True
    else:
        has_user_grant = grants.get(access_key) is True
    if not has_user_grant:
        return False
    tenant_access = user.get("tenant_access")
    if tenant_access is not None:
        if not isinstance(tenant_access, dict) or tenant_access.get(access_key) is not True:
            return False
    subscription_feature = INDUSTRIAL_SUBSCRIPTION_FEATURES.get(access_key)
    if subscription_feature and user.get("tenant_features", {}).get(subscription_feature) is False:
        return False
    return True


def required_access(path, method="GET", query=None):
    query = query or {}
    if path.startswith("/api/"):
        path = path[4:]
    if path in {"/me", "/auth/me", "/sync/revision"}:
        return ()

    if path == "/sites" or path.startswith("/sites/"):
        if "/audit" in path:
            return ("booking_audit",)
        if "/booking-finance" in path or "/followup" in path:
            return ("booking_finance",)
        if any(part in path for part in ("/payments", "/settlement", "/ledger/complete",
                                          "/ledger/uncomplete", "/expenses")):
            return ("booking_finance",)
        if path.startswith("/sites/migration/") or path.startswith("/sites/managers"):
            return ("booking_settings",)
        if path == "/sites" and method.upper() == "GET":
            return ("booking", "booking_finance", "booking_audit", "booking_settings")
        if path == "/sites" or path == "/booking/receipt-controls":
            return ("booking_settings",)
        if path.startswith("/sites/system-"):
            return ("booking",)
        if "/manager" in path or "/categories" in path:
            return ("booking_settings",)
        return ("booking",)
    if path == "/booking/receipt-controls":
        return ("booking_settings",)

    if path.startswith("/dashboard") or path == "/alerts":
        return ("industrial_dashboard",)
    if path.startswith("/trips"):
        if method.upper() == "GET":
            return ("industrial_trips", "industrial_lrs")
        return ("industrial_trips",)
    if path.startswith("/lrs"):
        return ("industrial_lrs",)
    if path == "/parties/suggest" and method.upper() == "GET":
        return ("industrial_parties", "industrial_lrs", "industrial_trips")
    if path == "/parties/suggest" or path.startswith("/profile/party"):
        return ("industrial_parties",)
    if path == "/lr-stats":
        return ("industrial_lrs",)
    if path.startswith("/reports"):
        return ("industrial_reports",)
    if path.startswith("/tracking"):
        return ("industrial_tracking",)
    if path == "/settings" and method.upper() == "GET":
        return ("industrial_settings", "industrial_trips")
    if path == "/settings":
        return ("industrial_settings",)
    if path.startswith("/masters/"):
        resource = path.split("/")[2]
        if resource in {"vehicles", "vehicle_types"}:
            if method.upper() == "GET":
                return ("industrial_vehicles", "industrial_trips")
            return ("industrial_vehicles",)
        if resource in {"parties"}:
            return ("industrial_parties",)
        if resource in {"drivers", "team", "employees"}:
            if resource == "drivers" and method.upper() == "GET":
                return ("industrial_team", "industrial_trips")
            return ("industrial_team",)
        if resource in {"fuel_pumps", "partners"}:
            return ("industrial_finance",)
        return ("industrial_settings",)
    if path.startswith("/profile/vehicle"):
        return ("industrial_vehicles",)
    if path.startswith("/profile/driver") or path.startswith("/profile/employee"):
        return ("industrial_team",)
    if path.startswith("/profile/fuel_pump") or path.startswith("/profile/partner"):
        return ("industrial_finance",)
    if path.startswith((
        "/finance", "/receipts", "/handovers", "/deewanji", "/expenses",
        "/fuel", "/payments", "/advances", "/tpl", "/ledger",
    )):
        return ("industrial_finance",)
    if path == "/search":
        return tuple(ADMIN_ACCESS_DEFAULTS)
    if path == "/upload":
        kind = query.get("kind", "misc")
        if kind in {"vehicle", "vehicle-photo"}:
            return ("industrial_vehicles",)
        if kind in {"driver", "employee", "team"}:
            return ("industrial_team",)
        if kind in {"party"}:
            return ("industrial_parties",)
        return ("industrial_settings",)
    return None


async def enforce_request_access(request: Request, user):
    access_keys = required_access(
        request.url.path, request.method, request.query_params,
    )
    if access_keys is None:
        raise HTTPException(403, "No platform access rule is configured for this feature.")
    if access_keys and not any(has_admin_access(user, key) for key in access_keys):
        raise HTTPException(403, "This feature is not enabled for your admin account.")
