"""Backend tests for new Fleet Manager features: trip profit, LR stats, tracking,
platform super admin & multi-tenant data isolation."""
import os
import time
import pytest
import requests

def _read_env():
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    raise RuntimeError("REACT_APP_BACKEND_URL not found")


BASE = (os.environ.get("REACT_APP_BACKEND_URL") or _read_env()).rstrip("/")
API = BASE + "/api"


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    return r


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def owner_token():
    r = _login("owner", "owner123")
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def super_token():
    r = _login("superadmin", "super123")
    assert r.status_code == 200, r.text
    return r.json()["token"]


# ----------------------- auth
def test_owner_login_role():
    r = _login("owner", "owner123")
    assert r.status_code == 200
    j = r.json()
    assert j["user"]["role"] == "owner"
    assert j["user"]["tenant_id"]


def test_super_login_role():
    r = _login("superadmin", "super123")
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "superadmin"


def test_bad_login():
    r = _login("owner", "wrong")
    assert r.status_code == 401


# ----------------------- trip profit
def test_trips_have_profit(owner_token):
    r = requests.get(f"{API}/trips", headers=_hdr(owner_token), timeout=30)
    assert r.status_code == 200
    trips = r.json()
    assert len(trips) > 0
    t = next((x for x in trips if x["trip_no"] == "TRP1001"), trips[0])
    for k in ("earning", "trip_cost", "profit"):
        assert k in t
    if t["trip_no"] == "TRP1001":
        assert t["earning"] == 24000
        assert t["trip_cost"] == 800
        assert t["profit"] == 23200


def test_trip_detail_profit_block(owner_token):
    r = requests.get(f"{API}/trips", headers=_hdr(owner_token), timeout=30)
    tid = next(x["id"] for x in r.json() if x["trip_no"] == "TRP1001")
    r = requests.get(f"{API}/trips/{tid}", headers=_hdr(owner_token), timeout=30)
    assert r.status_code == 200
    p = r.json().get("profit")
    assert p and p["earning"] == 24000 and p["profit"] == 23200
    assert p["diesel"] + p["expenses"] == p["total_cost"]


def test_edit_trip_persists(owner_token):
    r = requests.get(f"{API}/trips", headers=_hdr(owner_token), timeout=30)
    trips = r.json()
    # pick a trip that's not TRP1001 to avoid breaking profit assertion
    candidates = [x for x in trips if x["trip_no"] != "TRP1001"]
    tid = candidates[0]["id"] if candidates else trips[0]["id"]
    orig = requests.get(f"{API}/trips/{tid}", headers=_hdr(owner_token)).json()
    new_amt = float(orig.get("trip_amount") or 0) + 111
    r = requests.put(f"{API}/trips/{tid}", headers=_hdr(owner_token),
                     json={"trip_amount": new_amt, "remarks": "edited-by-test"})
    assert r.status_code == 200, r.text
    # verify
    got = requests.get(f"{API}/trips/{tid}", headers=_hdr(owner_token)).json()
    assert abs(got["trip_amount"] - new_amt) < 0.01
    assert got["remarks"] == "edited-by-test"
    assert got["trip_no"] == orig["trip_no"]  # not a new trip


# ----------------------- LR stats
def test_lr_stats(owner_token):
    r = requests.get(f"{API}/lr-stats?days=90", headers=_hdr(owner_token), timeout=30)
    assert r.status_code == 200
    j = r.json()
    for k in ("total", "status", "freight", "received", "outstanding", "trend", "top_senders"):
        assert k in j
    assert isinstance(j["trend"], list) and len(j["trend"]) == 90


# ----------------------- tracking
def test_tracking_not_connected(owner_token):
    r = requests.get(f"{API}/tracking/live", headers=_hdr(owner_token), timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert j["configured"] is False
    assert "help" in j


# ----------------------- dashboard monthly
def test_dashboard_monthly(owner_token):
    r = requests.get(f"{API}/dashboard/monthly?months=6", headers=_hdr(owner_token), timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert len(j["series"]) == 6
    assert "top_parties" in j and "totals" in j


# ----------------------- LR listing (WhatsApp share uses LR data)
def test_lr_get_with_freight(owner_token):
    r = requests.get(f"{API}/lrs", headers=_hdr(owner_token), timeout=30)
    assert r.status_code == 200
    lrs = r.json()
    if lrs:
        lid = lrs[0]["id"]
        r = requests.get(f"{API}/lrs/{lid}", headers=_hdr(owner_token))
        assert r.status_code == 200
        d = r.json()
        assert "lr_no" in d and "freight" in d
        assert d["company"]["name"] == "New Naidu Transport"


# ----------------------- platform super admin
def test_platform_access_blocked_for_owner(owner_token):
    r = requests.get(f"{API}/platform/summary", headers=_hdr(owner_token), timeout=30)
    assert r.status_code == 403


def test_platform_summary(super_token):
    r = requests.get(f"{API}/platform/summary", headers=_hdr(super_token), timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert "tenants" in j and "totals" in j
    assert j["totals"]["licenses"] >= 1


NEW_TENANT = {}


def test_create_tenant_and_isolation(super_token, owner_token):
    ts = int(time.time())
    payload = {
        "name": f"TEST Roadlines {ts}",
        "owner_name": "Test Owner",
        "owner_username": f"testown{ts}",
        "owner_password": "test12345",
        "email": "test-owner@example.com",
        "mobile": "9999999999", "city": "TestCity", "state": "TS",
        "plan": "Business", "license_days": 30,
    }
    r = requests.post(f"{API}/platform/tenants", headers=_hdr(super_token), json=payload)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    tenant_rows = requests.get(
        f"{API}/platform/tenants", headers=_hdr(super_token), timeout=30,
    ).json()
    assert next(row for row in tenant_rows if row["id"] == tid)["email"] == payload["email"]
    NEW_TENANT["id"] = tid
    NEW_TENANT["username"] = payload["owner_username"]
    NEW_TENANT["password"] = payload["owner_password"]
    NEW_TENANT["name"] = payload["name"]

    # login as new owner
    r = _login(payload["owner_username"], payload["owner_password"])
    assert r.status_code == 200, r.text
    new_tok = r.json()["token"]
    assert r.json()["user"]["tenant_name"] == payload["name"]

    # Their app should be EMPTY
    trips = requests.get(f"{API}/trips", headers=_hdr(new_tok)).json()
    assert trips == [] or len(trips) == 0
    lrs = requests.get(f"{API}/lrs", headers=_hdr(new_tok)).json()
    assert lrs == []
    vehicles = requests.get(f"{API}/masters/vehicles", headers=_hdr(new_tok)).json()
    assert vehicles == []

    # settings has correct company name
    s = requests.get(f"{API}/settings", headers=_hdr(new_tok)).json()
    assert s["company"]["name"] == payload["name"]

    # Cross-tenant access: try to fetch a naidu trip using new-tenant token → 404
    naidu_trips = requests.get(f"{API}/trips", headers=_hdr(owner_token)).json()
    if naidu_trips:
        naidu_tid = naidu_trips[0]["id"]
        r = requests.get(f"{API}/trips/{naidu_tid}", headers=_hdr(new_tok))
        assert r.status_code == 404, f"ISOLATION LEAK: got {r.status_code} {r.text}"


def test_suspend_and_reactivate(super_token):
    tid = NEW_TENANT["id"]
    r = requests.put(f"{API}/platform/tenants/{tid}", headers=_hdr(super_token),
                     json={"license_status": "Suspended"})
    assert r.status_code == 200
    # login should be blocked
    r = _login(NEW_TENANT["username"], NEW_TENANT["password"])
    assert r.status_code == 403
    # reactivate
    r = requests.put(f"{API}/platform/tenants/{tid}", headers=_hdr(super_token),
                     json={"license_status": "Active"})
    assert r.status_code == 200
    r = _login(NEW_TENANT["username"], NEW_TENANT["password"])
    assert r.status_code == 200


def test_reset_password(super_token):
    tid = NEW_TENANT["id"]
    new_pw = "newpass123"
    r = requests.post(f"{API}/platform/tenants/{tid}/reset-password",
                      headers=_hdr(super_token), json={"password": new_pw})
    assert r.status_code == 200
    # old pw fails
    assert _login(NEW_TENANT["username"], NEW_TENANT["password"]).status_code == 401
    # new pw works
    assert _login(NEW_TENANT["username"], new_pw).status_code == 200
    NEW_TENANT["password"] = new_pw


def test_platform_endpoint_blocked_for_new_owner():
    tok = _login(NEW_TENANT["username"], NEW_TENANT["password"]).json()["token"]
    r = requests.get(f"{API}/platform/summary", headers=_hdr(tok))
    assert r.status_code == 403
