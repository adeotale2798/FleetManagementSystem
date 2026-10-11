import asyncio

import pytest
from fastapi import HTTPException, Request
from fastapi.dependencies.utils import get_dependant

from access_control import (
    ADMIN_ACCESS_DENIED,
    ADMIN_ACCESS_DEFAULTS,
    enforce_request_access,
    has_admin_access,
    normalize_admin_access,
    required_access,
    validate_admin_access,
)
import auth


def request_for(path, method="GET"):
    return Request({
        "type": "http",
        "method": method,
        "path": path,
        "query_string": b"",
        "headers": [],
        "scheme": "http",
        "server": ("test", 80),
        "client": ("test", 1),
    })


def test_existing_owner_without_saved_access_keeps_legacy_grants():
    assert normalize_admin_access(None) == ADMIN_ACCESS_DEFAULTS
    assert has_admin_access({"admin_access": None}, "booking")


def test_new_admin_defaults_to_no_access_until_platform_owner_grants_it():
    assert not any(ADMIN_ACCESS_DENIED.values())
    assert not has_admin_access({"admin_access": ADMIN_ACCESS_DENIED}, "booking")


def test_explicit_admin_access_is_strict_and_subscription_capped():
    user = {
        "admin_access": {"booking": True, "industrial_trips": True},
        "tenant_features": {"trips": False},
    }

    assert has_admin_access(user, "booking")
    assert not has_admin_access(user, "booking_finance")
    assert not has_admin_access(user, "industrial_trips")


def test_tenant_subscription_caps_even_legacy_admin_grants():
    user = {
        "admin_access": None,
        "tenant_access": {"booking": True, "booking_finance": False},
    }

    assert has_admin_access(user, "booking")
    assert not has_admin_access(user, "booking_finance")


@pytest.mark.parametrize(
    ("path", "method", "expected"),
    [
        ("/api/sites", "GET", (
            "booking", "booking_finance", "booking_audit", "booking_settings",
        )),
        ("/api/sites/site-1/trips/trip-1/lrs", "GET", ("booking",)),
        ("/api/sites/site-1/booking-finance", "GET", ("booking_finance",)),
        ("/api/sites/site-1/audit", "GET", ("booking_audit",)),
        ("/api/sites/managers", "GET", ("booking_settings",)),
        ("/api/trips", "GET", ("industrial_trips", "industrial_lrs")),
        ("/api/trips/trip-1", "GET", ("industrial_trips", "industrial_lrs")),
        ("/api/lrs", "GET", ("industrial_lrs",)),
        ("/api/lr-stats", "GET", ("industrial_lrs",)),
        ("/api/reports/finance", "GET", ("industrial_reports",)),
        ("/api/settings", "GET", ("industrial_settings", "industrial_trips")),
        ("/api/settings", "PUT", ("industrial_settings",)),
        ("/api/search", "GET", tuple(ADMIN_ACCESS_DEFAULTS)),
    ],
)
def test_request_route_maps_to_expected_admin_grant(path, method, expected):
    assert required_access(path, method) == expected


def test_owner_request_without_the_matching_grant_is_forbidden():
    request = request_for("/api/sites/site-1/audit")
    user = {"admin_access": {"booking": True, "booking_audit": False}}

    with pytest.raises(HTTPException) as error:
        asyncio.run(enforce_request_access(request, user))

    assert error.value.status_code == 403


def test_owner_request_with_a_matching_grant_is_allowed():
    request = request_for("/api/sites/site-1/booking-finance")
    user = {"admin_access": {"booking_finance": True}}

    asyncio.run(enforce_request_access(request, user))


def test_global_search_requires_at_least_one_explicit_platform_grant():
    request = request_for("/api/search")
    with pytest.raises(HTTPException) as error:
        asyncio.run(enforce_request_access(
            request, {"admin_access": ADMIN_ACCESS_DENIED},
        ))
    assert error.value.status_code == 403


def test_unmapped_business_api_fails_closed():
    with pytest.raises(HTTPException) as error:
        asyncio.run(enforce_request_access(
            request_for("/api/new-business-module"), {"admin_access": None},
        ))

    assert error.value.status_code == 403
    assert "No platform access rule" in error.value.detail


def test_fastapi_registers_the_request_parameter_on_owner_authorization():
    dependency = get_dependant(path="/api/unmapped-business-feature", call=auth.current_user)
    assert dependency.request_param_name == "request"


def test_admin_access_payload_must_be_complete_and_boolean():
    access = dict(ADMIN_ACCESS_DEFAULTS)
    assert validate_admin_access(access) == access

    with pytest.raises(HTTPException) as missing:
        validate_admin_access({"booking": True})
    assert missing.value.status_code == 400

    access["booking"] = "yes"
    with pytest.raises(HTTPException) as invalid:
        validate_admin_access(access)
    assert invalid.value.status_code == 400
