import asyncio
import hashlib

import db
import server
from starlette.responses import Response


def test_tenant_keys_fit_mongo_database_name_limit(monkeypatch):
    monkeypatch.setattr(db, "BASE_DB", "fleet_db")

    tenant_id = db.tenant_key("A" * 60, "B" * 60)
    duplicate_id = db.tenant_key("A" * 60, "B" * 60, collision_index=2)
    legacy_oversized_id = "Naidu_Transport_HGT_NGP_NaiduJi_2"
    legacy_db_name = db.tenant_db_name(legacy_oversized_id)

    assert tenant_id != duplicate_id
    assert len(db.tenant_db_name(tenant_id).encode("utf-8")) <= db.MAX_MONGO_DATABASE_NAME_BYTES
    assert len(db.tenant_db_name(duplicate_id).encode("utf-8")) <= db.MAX_MONGO_DATABASE_NAME_BYTES
    assert len(legacy_db_name.encode("utf-8")) <= 38
    assert legacy_db_name != f"fleet_db_{legacy_oversized_id}"
    assert db.tenant_db_name("short_tenant") == "fleet_db_short_tenant"


def test_tenant_db_name_shortens_old_ids_deterministically(monkeypatch):
    monkeypatch.setattr(db, "BASE_DB", "fleet_db")
    tenant_id = "Naidu_Transport_HGT_NGP_NaiduJi_2"
    prefix = tenant_id.encode("utf-8")[:20].decode("utf-8").rstrip("_")
    digest = hashlib.sha256(tenant_id.encode()).hexdigest()[:8]

    assert db.tenant_db_name(tenant_id) == f"fleet_db_{prefix}_{digest}"


def test_tenant_stats_reads_counts_concurrently(monkeypatch):
    expected_counts = {"trips": 4, "lrs": 5, "vehicles": 2, "parties": 3, "drivers": 1}
    started = set()
    all_counts_started = asyncio.Event()

    class Collection:
        def __init__(self, name):
            self.name = name

        async def count_documents(self, _query):
            started.add(self.name)
            if started == set(expected_counts):
                all_counts_started.set()
            await asyncio.wait_for(all_counts_started.wait(), timeout=0.5)
            return expected_counts[self.name]

        async def find_one(self, sort):
            assert sort == [("created_at", -1)]
            return {"created_at": "2026-10-10T00:00:00+00:00"}

        def aggregate(self, _pipeline):
            async def rows():
                yield {"t": 125.127}

            return rows()

    class TenantDatabase:
        def __getitem__(self, name):
            return Collection(name)

        def __getattr__(self, name):
            return Collection(name)

    monkeypatch.setattr(server, "tenant_db", lambda _tenant_id: TenantDatabase())

    result = asyncio.run(server.tenant_stats("tenant-1"))

    assert {key: result[key] for key in expected_counts} == expected_counts
    assert result["revenue"] == 125.13
    assert result["last_activity"] == "2026-10-10T00:00:00+00:00"


def test_platform_support_session_is_recorded_before_token_is_returned(monkeypatch):
    inserts = []
    events = []

    class Tenants:
        async def find_one(self, query, _projection):
            assert query == {"_id": "tenant-1"}
            return {"_id": "tenant-1", "name": "Customer One"}

    class Sessions:
        async def insert_one(self, session):
            inserts.append(session)

    monkeypatch.setattr(server, "platform_db", type("PlatformDB", (), {
        "tenants": Tenants(),
        "platform_support_sessions": Sessions(),
    })())

    async def record_event(tenant_id, actor, action, summary, details):
        events.append((tenant_id, actor, action, summary, details))

    monkeypatch.setattr(server, "record_platform_event", record_event)
    result = asyncio.run(server.start_platform_support_session(
        "tenant-1", {"username": "platform", "name": "Platform Owner"},
    ))

    assert result["tenant_id"] == "tenant-1"
    assert result["tenant_name"] == "Customer One"
    assert inserts[0]["username"] == "platform"
    assert inserts[0]["tenant_id"] == "tenant-1"
    assert inserts[0]["active"] is True
    assert events[0][2] == "support.session.started"
    assert events[0][4]["session_id"] == result["session_id"]


def test_successful_support_writes_are_logged_with_client_and_actor(monkeypatch):
    events = []

    class Events:
        async def insert_one(self, event):
            events.append(event)

    class Request:
        method = "PUT"
        url = type("URL", (), {"path": "/api/settings"})()
        headers = {}
        state = type("State", (), {
            "reference_id": "request-1",
            "platform_support": {
                "tenant_id": "tenant-1",
                "actor": "platform",
                "session_id": "support-session-1",
            },
        })()

    async def call_next(_request):
        return Response(status_code=200)

    async def record_revision(_request):
        return 2

    monkeypatch.setattr(server, "platform_db", type("PlatformDB", (), {
        "subscription_audit_events": Events(),
    })())
    monkeypatch.setattr(server, "_record_data_revision", record_revision)

    response = asyncio.run(server.log_failures(Request(), call_next))

    assert response.headers["X-Data-Revision"] == "2"
    assert events[0]["tenant_id"] == "tenant-1"
    assert events[0]["actor"] == "platform"
    assert events[0]["action"] == "support.data.write"
    assert events[0]["details"] == {
        "session_id": "support-session-1",
        "method": "PUT",
        "path": "/api/settings",
        "status_code": 200,
    }


def test_deleting_plan_records_name_in_audit_event(monkeypatch):
    deleted = []
    events = []

    class Plans:
        async def find_one(self, query):
            assert query == {"_id": "plan-1"}
            return {"_id": "plan-1", "name": "Booking Starter"}

        async def delete_one(self, query):
            deleted.append(query)

    class Tenants:
        async def count_documents(self, query):
            assert query == {"plan_id": "plan-1"}
            return 0

    monkeypatch.setattr(server, "platform_db", type("PlatformDB", (), {
        "subscription_plans": Plans(),
        "tenants": Tenants(),
    })())

    async def record_event(tenant_id, actor, action, summary, details):
        events.append((tenant_id, actor, action, summary, details))

    monkeypatch.setattr(server, "record_platform_event", record_event)
    result = asyncio.run(server.delete_subscription_plan(
        "plan-1", {"username": "platform"},
    ))

    assert result == {"ok": True}
    assert deleted == [{"_id": "plan-1"}]
    assert events == [(
        None, {"username": "platform"}, "plan.deleted",
        "Deleted subscription plan Booking Starter.", {"plan_id": "plan-1"},
    )]


def test_platform_activity_labels_plan_template_events_as_platform(monkeypatch):
    events = [
        {"_id": "event-platform", "tenant_id": None, "summary": "Created plan"},
        {"_id": "event-tenant", "tenant_id": "tenant-1", "summary": "Updated access"},
        {"_id": "event-deleted", "tenant_id": "deleted-tenant", "summary": "Old event"},
    ]
    tenant_query = []

    class Cursor:
        def __init__(self, rows):
            self.rows = rows

        def sort(self, *_args):
            return self

        async def to_list(self, _limit):
            return self.rows

    class AuditEvents:
        def find(self):
            return Cursor(events)

    class Tenants:
        def find(self, query, _projection):
            tenant_query.append(query)
            return Cursor([{"_id": "tenant-1", "name": "Customer One"}])

    monkeypatch.setattr(server, "platform_db", type("PlatformDB", (), {
        "subscription_audit_events": AuditEvents(),
        "tenants": Tenants(),
    })())

    result = asyncio.run(server.platform_activity({"username": "platform"}))

    assert [row["tenant_name"] for row in result] == [
        "Platform", "Customer One", "Deleted business",
    ]
    assert set(tenant_query[0]["_id"]["$in"]) == {"tenant-1", "deleted-tenant"}


def test_subscription_audit_counts_only_admins_whose_grants_were_reduced(monkeypatch):
    tenant = {
        "_id": "tenant-1",
        "plan": "Full",
        "subscription_access": dict(server.ADMIN_ACCESS_DEFAULTS),
    }
    full_access = {"_id": "admin-1", "admin_access": dict(server.ADMIN_ACCESS_DEFAULTS)}
    no_access = {
        "_id": "admin-2",
        "admin_access": dict(server.ADMIN_ACCESS_DENIED),
    }
    admin_updates = []
    events = []

    class Tenants:
        async def find_one(self, _query):
            return tenant

        async def update_one(self, _query, update):
            tenant.update(update["$set"])

    class AdminCursor:
        async def to_list(self, _limit):
            return [full_access, no_access]

    class Users:
        def find(self, _query, _projection):
            return AdminCursor()

        async def update_one(self, query, update):
            admin_updates.append((query, update))

    monkeypatch.setattr(server, "platform_db", type("PlatformDB", (), {
        "tenants": Tenants(),
        "users": Users(),
    })())
    monkeypatch.setattr(server, "now_iso", lambda: "2026-10-10T00:00:00+00:00")

    async def record_event(*args):
        events.append(args)

    monkeypatch.setattr(server, "record_platform_event", record_event)
    access = dict(server.ADMIN_ACCESS_DENIED)
    result = asyncio.run(server.update_tenant_subscription(
        "tenant-1",
        server.TenantSubscriptionIn(
            plan_id=None, plan="Custom", access=access,
            monthly_price=None, annual_price=None,
            license_expiry="2027-10-10", custom_requests="",
        ),
        {"username": "platform"},
    ))

    assert result["subscription_access"] == access
    assert len(admin_updates) == 2
    assert events[0][4]["admins_clamped"] == 1
