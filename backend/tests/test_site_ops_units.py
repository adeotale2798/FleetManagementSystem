import asyncio
import csv
import io
from decimal import Decimal
from types import SimpleNamespace

import pytest
from bson.decimal128 import Decimal128
from fastapi import HTTPException
from openpyxl import load_workbook
from pydantic import ValidationError

import site_ops


def _ledger_csv(site_id="site-1", trip_id="trip-1", business_id="business-1"):
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(["#FLEET_MANAGER_TRIP_LEDGER", site_ops.LEDGER_TEMPLATE_VERSION])
    writer.writerow([
        f"business_id={business_id}", f"site_id={site_id}", f"trip_id={trip_id}",
    ])
    writer.writerow(site_ops.LEDGER_COLUMNS)
    writer.writerow([
        "lr-1", "NGPLR27092026-01", trip_id, site_id, "Receiver",
        "Food grains", "100.00", "10.00", "0.00", "", "", "ref,\ncontinued",
    ])
    return output.getvalue().encode("utf-8")


def test_creation_metadata_records_login_identity_and_role():
    metadata = site_ops._creator_metadata({
        "username": "manager-login", "name": "Manager Name", "role": "site_manager",
    })

    assert metadata == {
        "created_by": "manager-login",
        "created_by_id": "manager-login",
        "created_by_login": "manager-login",
        "created_by_name": "Manager Name",
        "created_by_role": "site_manager",
        "created_at": metadata["created_at"],
    }
    assert metadata["created_at"]
    assert site_ops._entry_by(metadata) == "M-Manager"
    assert site_ops._entry_by({
        "created_by_name": "Owner Name", "created_by_role": "owner",
    }) == "A-Owner"
    assert site_ops._entry_by({
        "created_by_name": "Platform Owner", "created_by_role": "platform_support",
    }) == "P-Platform"
    assert site_ops._ledger_hindi_text("AUTO") == "ऑटो"
    assert site_ops._ledger_hindi_text("Cement bag") == "सीमेंट बोरा"
    assert site_ops._ledger_hindi_text("gadi bhada") == "गाड़ी भाड़ा"
    assert site_ops._ledger_hindi_text("gaadi bhaada") == "गाड़ी भाड़ा"
    assert site_ops._ledger_hindi_text("गाड़ी bhada") == "गाड़ी भाड़ा"
    assert site_ops._ledger_hindi_text("vehicle rent") == "गाड़ी भाड़ा"
    assert "created_by_id" not in site_ops._doc_for_user(
        {"_id": "trip-1", **metadata}, {"role": "site_manager"},
    )
    assert site_ops._doc_for_user(
        {"_id": "trip-1", **metadata}, {"role": "owner"},
    )["created_by_id"] == "manager-login"
    charge_metadata = site_ops._charge_editor_metadata({
        "username": "manager-login", "name": "Manager Name", "role": "site_manager",
    })
    manager_record = site_ops._doc_for_user(
        {"_id": "lr-1", **charge_metadata}, {"role": "site_manager"},
    )
    owner_record = site_ops._doc_for_user(
        {"_id": "lr-1", **charge_metadata}, {"role": "owner"},
    )
    assert not set(site_ops.CHARGE_EDITOR_FIELDS).intersection(manager_record)
    assert owner_record["charge_updated_by_login"] == "manager-login"
    assert site_ops._charge_editor_marker(charge_metadata) == "M"
    assert site_ops._charge_editor_marker({"charge_updated_by_role": "owner"}) == "A"


def test_audit_events_record_login_id_and_are_owner_only(monkeypatch):
    writes = []

    class AuditEvents:
        async def update_one(self, query, update, upsert):
            writes.append((query, update, upsert))

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_audit_events=AuditEvents()))
    monkeypatch.setattr(site_ops, "new_id", lambda: "audit-1")
    monkeypatch.setattr(site_ops, "now_iso", lambda: "2026-09-29T12:00:00+00:00")
    asyncio.run(site_ops._audit(
        {"_id": "site-1", "business_id": "business-1"},
        {"username": "manager-login", "name": "Manager Name", "role": "site_manager"},
        "trip.created", "trip", "trip-1",
    ))

    assert writes[0][1]["$setOnInsert"] == {
        "business_id": "business-1", "site_id": "site-1",
        "actor_id": "manager-login", "actor_username": "manager-login",
        "actor_name": "Manager Name", "actor_role": "site_manager",
        "action": "trip.created", "target_type": "trip", "target_id": "trip-1",
        "old_values": {}, "new_values": {}, "reason": "",
        "created_at": "2026-09-29T12:00:00+00:00",
    }
    with pytest.raises(HTTPException) as error:
        asyncio.run(site_ops.list_site_audit("site-1", u={"role": "site_manager"}))
    assert error.value.status_code == 403


def test_closing_a_trip_updates_only_that_open_trip_and_audits_once(monkeypatch):
    update_calls = []
    audit_calls = []
    trip_states = iter([
        {"_id": "trip-1", "business_id": "business-1", "site_id": "site-1", "status": "open"},
        {"_id": "trip-1", "business_id": "business-1", "site_id": "site-1", "status": "closed"},
    ])

    class Trips:
        async def update_one(self, query, update):
            update_calls.append((query, update))
            return SimpleNamespace(modified_count=1)

    async def site_for_user(site_id, user, permission=None):
        return {"_id": site_id, "business_id": "business-1"}

    async def get_trip(_site, _trip_id):
        return next(trip_states)

    async def audit(*args, **kwargs):
        audit_calls.append((args, kwargs))

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_trips=Trips()))
    monkeypatch.setattr(site_ops, "_site_for_user", site_for_user)
    monkeypatch.setattr(site_ops, "_trip", get_trip)
    monkeypatch.setattr(site_ops, "_audit", audit)
    monkeypatch.setattr(site_ops, "now_iso", lambda: "2026-09-29T12:00:00+00:00")

    with pytest.raises(HTTPException) as error:
        asyncio.run(site_ops.close_site_trip(
            "site-1", "trip-1", {"username": "manager", "role": "site_manager"},
        ))
    assert error.value.status_code == 403
    assert not update_calls

    result = asyncio.run(site_ops.close_site_trip(
        "site-1", "trip-1", {"username": "owner", "role": "owner"},
    ))

    assert result["status"] == "closed"
    assert update_calls == [(
        {"business_id": "business-1", "site_id": "site-1", "_id": "trip-1", "status": "open"},
        {"$set": {
            "status": "closed", "closed_by": "owner",
            "closed_at": "2026-09-29T12:00:00+00:00",
            "updated_at": "2026-09-29T12:00:00+00:00",
        }},
    )]
    assert len(audit_calls) == 1


def test_manager_can_edit_vehicle_and_driver_on_closed_unreconciled_trip(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {
        "_id": "trip-1", "business_id": "business-1", "site_id": "site-1",
        "status": "closed", "truck_no": "", "driver_name": "",
    }
    updates = []
    audits = []

    class Trips:
        async def update_one(self, query, update):
            updates.append((query, update))
            trip.update(update["$set"])
            return SimpleNamespace(matched_count=1)

    async def get_trip(_site, _trip_id):
        return trip

    async def trip_master_values(*_args, **_kwargs):
        return {}

    async def record_audit(*args, **kwargs):
        audits.append((args, kwargs))

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_trips=Trips()))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", get_trip)
    monkeypatch.setattr(site_ops, "_trip_master_values", trip_master_values)
    monkeypatch.setattr(site_ops, "_audit", record_audit)
    monkeypatch.setattr(site_ops, "now_iso", lambda: "2026-09-29T12:00:00+00:00")

    result = asyncio.run(site_ops.update_site_trip(
        "site-1", "trip-1",
        site_ops.TripUpdate(truck_no="MH 31 AB 1234", driver_name="Ramesh"),
        {"role": "site_manager", "username": "manager"},
    ))

    assert result["truck_no"] == "MH 31 AB 1234"
    assert result["driver_name"] == "Ramesh"
    assert updates[0][0]["status"] == "closed"
    assert updates[0][0]["ledger_completed_at"] == {"$exists": False}
    assert audits[0][0][2] == "trip.updated"


def test_owner_can_delete_only_empty_site_trip(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {
        "_id": "trip-1", "trip_ref": "NGP29092026-01",
        "operating_date": "2026-09-29",
    }
    deleted_queries = []
    audit_calls = []

    class EmptyCollection:
        async def count_documents(self, query):
            return 0

    class Trips(EmptyCollection):
        async def delete_one(self, query):
            deleted_queries.append(query)
            return SimpleNamespace(deleted_count=1)

    async def audit(*args, **kwargs):
        audit_calls.append((args, kwargs))

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(
        site_lrs=EmptyCollection(), site_payments=EmptyCollection(),
        expenses=EmptyCollection(), ledger=EmptyCollection(),
        cashbook=EmptyCollection(), site_ledger_imports=EmptyCollection(),
        site_trips=Trips(),
    ))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_audit", audit)

    result = asyncio.run(site_ops.delete_site_trip(
        "site-1", "trip-1", {"role": "owner", "username": "owner"},
    ))

    assert result == {"deleted": True, "id": "trip-1"}
    assert deleted_queries == [{
        "business_id": "business-1", "site_id": "site-1", "_id": "trip-1",
    }]
    assert audit_calls[0][0][2:5] == ("trip.deleted", "trip", "trip-1")


def test_owner_can_archive_trip_when_all_receipts_are_void_and_preserve_history(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {"_id": "trip-1", "trip_ref": "NGP29092026-01"}
    linked_count_calls = []
    updates = []
    audits = []

    class AllVoidReceipts:
        async def count_documents(self, query):
            assert query["trip_id"] == "trip-1"
            return 2

        async def find_one(self, query, _projection):
            assert query["voided"] == {"$ne": True}
            return None

    class Trips:
        async def update_one(self, query, update):
            updates.append((query, update))
            return SimpleNamespace(matched_count=1)

    class LinkedHistory:
        async def count_documents(self, query):
            linked_count_calls.append(query)
            return 1

    async def audit(*args, **kwargs):
        audits.append((args, kwargs))

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(
        site_lrs=AllVoidReceipts(), site_payments=LinkedHistory(),
        expenses=LinkedHistory(), ledger=LinkedHistory(),
        cashbook=LinkedHistory(), site_ledger_imports=LinkedHistory(),
        site_trips=Trips(),
    ))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_audit", audit)
    monkeypatch.setattr(site_ops, "now_iso", lambda: "2026-09-29T12:00:00+00:00")

    result = asyncio.run(site_ops.delete_site_trip(
        "site-1", "trip-1", {"role": "owner", "username": "owner"},
    ))

    assert result == {"deleted": True, "archived": True, "id": "trip-1"}
    assert updates[0][0] == {
        "business_id": "business-1", "site_id": "site-1", "_id": "trip-1",
        "archived_at": {"$exists": False},
    }
    assert updates[0][1]["$set"] == {
        "archived_at": "2026-09-29T12:00:00+00:00",
        "archived_by": "owner", "updated_at": "2026-09-29T12:00:00+00:00",
    }
    assert linked_count_calls == []
    assert audits[0][0][2:5] == ("trip.archived", "trip", "trip-1")
    assert audits[0][1]["new"]["voided_receipt_count"] == 2


def test_trip_delete_rejects_active_receipts_and_non_owners(monkeypatch):
    class ActiveReceipts:
        async def count_documents(self, _query):
            return 1

        async def find_one(self, query, _projection):
            assert query["voided"] == {"$ne": True}
            return {"_id": "lr-active"}

    class EmptyCollection:
        async def count_documents(self, _query):
            return 0

    class Trips:
        async def delete_one(self, _query):
            raise AssertionError("A trip with an active receipt must not be deleted")

        async def update_one(self, _query, _update):
            raise AssertionError("A trip with an active receipt must not be archived")

    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {"_id": "trip-1"}
    monkeypatch.setattr(site_ops, "db", SimpleNamespace(
        site_lrs=ActiveReceipts(), site_payments=EmptyCollection(),
        expenses=EmptyCollection(), ledger=EmptyCollection(),
        cashbook=EmptyCollection(), site_ledger_imports=EmptyCollection(),
        site_trips=Trips(),
    ))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))

    with pytest.raises(HTTPException) as linked_error:
        asyncio.run(site_ops.delete_site_trip(
            "site-1", "trip-1", {"role": "owner", "username": "owner"},
        ))
    assert linked_error.value.status_code == 409
    assert "active receipts" in linked_error.value.detail

    with pytest.raises(HTTPException) as permission_error:
        asyncio.run(site_ops.delete_site_trip(
            "site-1", "trip-1", {"role": "site_manager", "username": "manager"},
        ))
    assert permission_error.value.status_code == 403


def test_archived_trips_are_not_returned_by_normal_trip_listing(monkeypatch):
    captured = []

    class Cursor:
        def sort(self, *_args):
            return self

        def skip(self, _offset):
            return self

        def limit(self, _limit):
            return self

        async def to_list(self, _limit):
            return []

    class Trips:
        async def count_documents(self, query):
            captured.append(query)
            return 0

        def find(self, query):
            captured.append(query)
            return Cursor()

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_trips=Trips()))
    monkeypatch.setattr(
        site_ops, "_site_for_user",
        _async_value({"_id": "site-1", "business_id": "business-1"}),
    )

    result = asyncio.run(site_ops.list_site_trips(
        "site-1", u={"role": "owner", "username": "owner"},
    ))

    assert result["rows"] == []
    assert result["total"] == 0
    assert all(query["archived_at"] == {"$exists": False} for query in captured)


def test_trip_details_remain_locked_during_ledger_completion(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {
        "_id": "trip-1", "business_id": "business-1", "site_id": "site-1",
        "status": "closed", "ledger_completion_started_at": "2026-09-29T12:00:00+00:00",
    }
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))

    with pytest.raises(HTTPException) as error:
        asyncio.run(site_ops.update_site_trip(
            "site-1", "trip-1", site_ops.TripUpdate(truck_no="MH 31 AB 1234"),
            {"role": "site_manager", "username": "manager"},
        ))

    assert error.value.status_code == 409
    assert "ledger is being completed" in error.value.detail


def test_new_manager_login_keeps_owner_creator_metadata(monkeypatch):
    inserted = []

    class Users:
        async def find_one(self, _query):
            return None

        async def insert_one(self, user):
            inserted.append(user)

    class Sites:
        async def update_one(self, *_args, **_kwargs):
            return None

    async def site_for_user(*_args, **_kwargs):
        return {"_id": "site-1", "business_id": "business-1", "manager_username": None}

    async def replace_access(*_args):
        return None

    monkeypatch.setattr(site_ops, "_owner", lambda _user: None)
    monkeypatch.setattr(site_ops, "_site_for_user", site_for_user)
    monkeypatch.setattr(site_ops, "_tenant_id", lambda _user: "business-1")
    monkeypatch.setattr(site_ops, "_replace_manager_access", replace_access)
    monkeypatch.setattr(site_ops, "_audit", lambda *_args, **_kwargs: asyncio.sleep(0))
    monkeypatch.setattr(site_ops, "hash_manager_pw", lambda _password: "hashed")
    monkeypatch.setattr(site_ops, "platform_db", SimpleNamespace(users=Users()))
    monkeypatch.setattr(site_ops, "db", SimpleNamespace(sites=Sites(), team=SimpleNamespace()))

    result = asyncio.run(site_ops.assign_site_manager(
        "site-1",
        site_ops.ManagerAssignment(name="Manager", username="manager-new", password="secret"),
        {"username": "owner-login", "name": "Business Owner", "role": "owner"},
    ))

    assert result["username"] == "manager-new"
    assert inserted[0]["created_by_id"] == "owner-login"
    assert inserted[0]["created_by_login"] == "owner-login"
    assert inserted[0]["created_by_role"] == "owner"
    assert inserted[0]["created_at"]
    assert inserted[0]["password"] == "hashed"
    assert "password" not in result


def test_new_manager_accepts_admin_id_and_generates_password_when_omitted(monkeypatch):
    inserted = []

    class Users:
        async def find_one(self, _query):
            return None

        async def insert_one(self, user):
            inserted.append(user)

    class Sites:
        async def update_one(self, *_args, **_kwargs):
            return None

    async def site_for_user(*_args, **_kwargs):
        return {"_id": "site-1", "business_id": "business-1", "manager_username": None}

    async def replace_access(*_args):
        return None

    monkeypatch.setattr(site_ops, "_owner", lambda _user: None)
    monkeypatch.setattr(site_ops, "_site_for_user", site_for_user)
    monkeypatch.setattr(site_ops, "_tenant_id", lambda _user: "business-1")
    monkeypatch.setattr(site_ops, "_replace_manager_access", replace_access)
    monkeypatch.setattr(site_ops, "_audit", lambda *_args, **_kwargs: asyncio.sleep(0))
    monkeypatch.setattr(site_ops, "hash_manager_pw", lambda _password: "hashed")
    monkeypatch.setattr(site_ops.secrets, "token_urlsafe", lambda _length: "auto-generated-password")
    monkeypatch.setattr(site_ops, "platform_db", SimpleNamespace(users=Users()))
    monkeypatch.setattr(site_ops, "db", SimpleNamespace(sites=Sites(), team=SimpleNamespace()))

    result = asyncio.run(site_ops.assign_site_manager(
        "site-1",
        site_ops.ManagerAssignment(name="Saoji Naidu", username="Saoji Ngp"),
        {"username": "owner-login", "name": "Business Owner", "role": "owner"},
    ))

    assert result["username"] == "saoji ngp"
    assert result["name"] == "Saoji Naidu"
    assert result["temporary_password"] == "auto-generated-password"
    assert inserted[0]["name"] == "Saoji Naidu"
    assert inserted[0]["password"] == "hashed"


def test_manager_password_models_accept_short_and_long_nonempty_passwords():
    short_password = site_ops.ManagerAssignment(
        name="Manager One", username="manager-one", password="x",
    )
    long_password = site_ops.ManagerPasswordReset(password="x" * 500)

    assert short_password.password == "x"
    assert long_password.password == "x" * 500


def test_trip_resources_are_available_to_managers_who_can_create_trips(monkeypatch):
    class Cursor:
        def __init__(self, rows):
            self.rows = rows

        def sort(self, *_args):
            return self

        async def to_list(self, _limit):
            return self.rows

    class Resources:
        def __init__(self, rows):
            self.rows = rows
            self.query = None

        def find(self, query, _projection):
            self.query = query
            return Cursor(self.rows)

    vehicles = Resources([{
        "_id": "vehicle-1", "vehicle_no": "MH31AB1234",
        "vehicle_type": "Truck", "status": "Active",
    }])
    drivers = Resources([{"_id": "driver-1", "name": "Driver One", "mobile": "123"}])

    async def site_for_user(site_id, _user):
        assert site_id == "site-1"
        return {"_id": site_id, "business_id": "business-1"}

    monkeypatch.setattr(site_ops, "_site_for_user", site_for_user)
    monkeypatch.setattr(site_ops, "db", SimpleNamespace(vehicles=vehicles, drivers=drivers))
    user = {
        "role": "site_manager", "site_permissions": {"site-1": ["trips:create"]},
        "site_ids": ["site-1"],
    }

    result = asyncio.run(site_ops.list_site_trip_resources("site-1", user))

    assert result == {
        "vehicles": [{
            "id": "vehicle-1", "vehicle_no": "MH31AB1234",
            "vehicle_type": "Truck", "status": "Active",
        }],
        "drivers": [{"id": "driver-1", "name": "Driver One"}],
    }


def test_trip_resources_reject_managers_without_read_or_create_permission(monkeypatch):
    async def site_for_user(site_id, _user):
        return {"_id": site_id, "business_id": "business-1"}

    monkeypatch.setattr(site_ops, "_site_for_user", site_for_user)
    with pytest.raises(HTTPException) as error:
        asyncio.run(site_ops.list_site_trip_resources(
            "site-1", {"role": "site_manager", "site_permissions": {"site-1": ["lrs:read"]}},
        ))

    assert error.value.status_code == 403


def test_daily_ledger_export_includes_all_site_day_trips_and_financials(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1", "name": "North", "code": "N"}
    trips = [
        {"_id": "trip-1", "sequence": 1, "trip_ref": "N-001", "truck_no": "TRUCK-1", "driver_name": "Driver 1"},
        {"_id": "trip-2", "sequence": 2, "trip_ref": "N-002", "truck_no": "TRUCK-2", "driver_name": "Driver 2"},
    ]
    lrs = [
        {
            "_id": "lr-1", "trip_id": "trip-1", "sequence": 1, "lr_ref": "N-LR-1",
            "sender_name": "Sender", "receiver_name": "Receiver", "receiver_identifier": "",
            "goods_type": "Grain", "containers": [{"type": "Bag", "quantity": 3}],
            "total_quantity": 3, "rent": Decimal("100.00"), "hamali": Decimal("10.00"),
        },
        {
            "_id": "lr-2", "trip_id": "trip-2", "sequence": 1, "lr_ref": "N-LR-2",
            "sender_name": "Sender 2", "receiver_name": "Receiver 2", "receiver_identifier": "",
            "goods_type": "Steel", "containers": [{"type": "Box", "quantity": 1}],
            "total_quantity": 1, "rent": Decimal("50.00"), "hamali": Decimal("5.00"),
        },
    ]

    class Cursor:
        def __init__(self, rows):
            self.rows = rows

        def sort(self, *_args):
            return self

        def limit(self, _limit):
            return self

        async def to_list(self, _limit):
            return self.rows

    class Collection:
        def __init__(self, rows):
            self.rows = rows
            self.queries = []

        def find(self, query):
            self.queries.append(query)
            return Cursor(self.rows)

    trips_collection = Collection(trips)
    lrs_collection = Collection(lrs)
    payments_collection = Collection([{
        "lr_id": "lr-1", "amount": Decimal("25.00"), "date": "2026-09-27",
        "method": "Cash", "kind": "payment", "reference": "receipt-1",
        "posting_status": "posted",
    }])

    async def get_site(site_id, user):
        assert site_id == "site-1"
        assert user["site_permissions"]["site-1"] == ["ledger:export"]
        return site

    monkeypatch.setattr(site_ops, "_site_for_user", get_site)
    monkeypatch.setattr(site_ops, "db", SimpleNamespace(
        site_trips=trips_collection, site_lrs=lrs_collection,
        site_payments=payments_collection,
    ))

    response = asyncio.run(site_ops.export_site_daily_ledger(
        "site-1", "2026-09-27",
        {"role": "site_manager", "site_permissions": {"site-1": ["ledger:export"]}},
    ))
    rows = list(csv.DictReader(io.StringIO(bytes(response.body).decode("utf-8-sig"))))

    assert [row["trip_ref"] for row in rows] == ["N-001", "N-002"]
    assert [row["lr_ref"] for row in rows] == ["N-LR-1", "N-LR-2"]
    assert rows[0]["bhada_collected_inr"] == "25.00"
    assert rows[0]["bhada_outstanding_inr"] == "77.00"
    assert rows[0]["payment_details"] == "2026-09-27 Cash payment 25.00 receipt-1"
    assert trips_collection.queries[0]["operating_date"] == "2026-09-27"
    assert lrs_collection.queries[0]["trip_id"] == {"$in": ["trip-1", "trip-2"]}
    assert payments_collection.queries[0]["business_id"] == "business-1"


def test_daily_ledger_export_requires_explicit_manager_permission(monkeypatch):
    async def get_site(_site_id, _user):
        return {"_id": "site-1", "business_id": "business-1"}

    monkeypatch.setattr(site_ops, "_site_for_user", get_site)

    with pytest.raises(HTTPException) as error:
        asyncio.run(site_ops.export_site_daily_ledger(
            "site-1", "2026-09-27",
            {"role": "site_manager", "site_permissions": {"site-1": ["trips:read", "lrs:read"]}},
        ))

    assert error.value.status_code == 403


def test_ledger_parser_accepts_versioned_scope_and_quoted_newlines():
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {"_id": "trip-1"}

    rows = site_ops._parse_ledger_csv(_ledger_csv(), site, trip)

    assert len(rows) == 1
    assert rows[0]["source"]["lr_id"] == "lr-1"
    assert rows[0]["source"]["transaction_reference"] == "ref,\ncontinued"


@pytest.mark.parametrize(
    ("site_id", "trip_id", "business_id"),
    [("other-site", "trip-1", "business-1"),
     ("site-1", "other-trip", "business-1"),
     ("site-1", "trip-1", "other-business")],
)
def test_ledger_parser_rejects_foreign_scope(site_id, trip_id, business_id):
    with pytest.raises(HTTPException) as error:
        site_ops._parse_ledger_csv(
            _ledger_csv(site_id, trip_id, business_id),
            {"_id": "site-1", "business_id": "business-1"},
            {"_id": "trip-1"},
        )

    assert error.value.status_code == 422


def test_amounts_are_decimal_and_reject_more_than_two_places():
    assert site_ops._decimal("12.30", "Bhada") == Decimal("12.30")
    with pytest.raises(HTTPException):
        site_ops._decimal("12.345", "Bhada")

def test_blank_per_goods_charges_default_to_zero_and_keep_optional_decimals():
    row = site_ops.GoodsRow(
        type="Cement", quantity=1, rent="", hamali="12.50",
    )

    assert row.rent == Decimal("0.00")
    assert row.hamali == Decimal("12.50")


@pytest.mark.parametrize("phone", ["123456789", "12345678901", "+911234567890", "12345 67890"])
def test_optional_phone_rejects_values_other_than_ten_digits(phone):
    with pytest.raises(HTTPException) as error:
        site_ops._optional_phone(phone, "Receiver phone")
    assert error.value.status_code == 422


def test_optional_phone_accepts_exactly_ten_digits_and_empty_values():
    assert site_ops._optional_phone("9876543210", "Receiver phone") == "9876543210"
    assert site_ops._optional_phone("", "Receiver phone") is None


def test_booking_trip_can_be_created_without_vehicle_or_driver():
    trip = site_ops.TripCreate(operating_date="2026-09-29", truck_no="", driver_name="")
    assert trip.truck_no == ""
    assert trip.driver_name == ""


def test_site_receipt_controls_keep_fee_configurable_and_validate_display_options():
    default_config = site_ops._site_config_with_receipt_controls({})
    assert default_config["receipt_controls"] == {
        "hindi_conversion_enabled": True, "receipt_language": "hindi",
        "receipt_print_size": "default",
        "sender_address_enabled": True, "receiver_address_enabled": True,
        "receiver_phone_enabled": True,
        "receipt_fee": "2.00", "overdue_after_days": 30,
    }
    updated_config = site_ops._site_config_with_receipt_controls(
        {"receipt_controls": {
            "receipt_fee": "5.00", "receipt_language": "english",
            "receipt_print_size": "80mm",
            "sender_address_enabled": False,
        }},
        {"branding": {"name": "Garage"}},
    )
    assert updated_config["branding"]["name"] == "Garage"
    assert updated_config["receipt_controls"] == {
        "hindi_conversion_enabled": True, "receipt_language": "english",
        "receipt_print_size": "80mm",
        "sender_address_enabled": False, "receiver_address_enabled": True,
        "receiver_phone_enabled": True,
        "receipt_fee": "5.00", "overdue_after_days": 30,
    }
    with pytest.raises(ValidationError):
        site_ops._site_config_with_receipt_controls({
            "receipt_controls": {"receipt_fee": "-1"},
        })
    with pytest.raises(ValidationError):
        site_ops._site_config_with_receipt_controls({
            "receipt_controls": {"receipt_language": "marathi"},
        })
    with pytest.raises(ValidationError):
        site_ops._site_config_with_receipt_controls({
            "receipt_controls": {"receipt_print_size": "100mm"},
        })
    with pytest.raises(ValidationError):
        site_ops._site_config_with_receipt_controls({
            "receipt_controls": {"overdue_after_days": 0},
        })


def test_booking_receipt_visibility_is_tenant_wide_and_migrates_legacy_site_flags():
    old_sites = [
        {"config": {"receipt_controls": {
            "sender_address_enabled": False, "receiver_address_enabled": False,
        }}},
        {"config": {"receipt_controls": {
            "sender_address_enabled": True, "receiver_address_enabled": False,
            "receiver_phone_enabled": False,
        }}},
    ]
    assert site_ops._booking_receipt_visibility(None, old_sites) == {
        "sender_address_enabled": False,
        "receiver_address_enabled": False,
        "receiver_phone_enabled": False,
    }
    assert site_ops._booking_receipt_visibility(
        {"controls": {
            "sender_address_enabled": True,
            "receiver_address_enabled": False,
            "receiver_phone_enabled": True,
        }},
        old_sites,
    ) == {
        "sender_address_enabled": True,
        "receiver_address_enabled": False,
        "receiver_phone_enabled": True,
    }


def test_booking_receipt_visibility_endpoints_share_saved_values_with_managers(monkeypatch):
    class Cursor:
        def __init__(self, rows):
            self.rows = rows

        async def to_list(self, _limit):
            return self.rows

    class Sites:
        def find(self, _query, _projection):
            return Cursor([
                {"config": {"receipt_controls": {
                    "sender_address_enabled": False,
                    "receiver_address_enabled": False,
                    "receiver_phone_enabled": False,
                }}},
                {"config": {"receipt_controls": {
                    "sender_address_enabled": True,
                    "receiver_address_enabled": True,
                    "receiver_phone_enabled": True,
                }}},
            ])

    class Settings:
        record = None

        async def find_one(self, _query):
            return self.record

        async def update_one(self, _query, update, upsert):
            assert upsert is True
            self.record = {"_id": "booking_receipt_visibility", **update["$set"]}

    settings = Settings()
    monkeypatch.setattr(site_ops, "db", SimpleNamespace(settings=settings, sites=Sites()))
    manager = {"role": "site_manager", "tenant_id": "business-1"}
    owner = {"role": "owner", "tenant_id": "business-1"}

    legacy = asyncio.run(site_ops.read_booking_receipt_visibility(manager))
    assert legacy == {
        "sender_address_enabled": False,
        "receiver_address_enabled": False,
        "receiver_phone_enabled": False,
    }
    saved = asyncio.run(site_ops.update_booking_receipt_visibility(
        site_ops.BookingReceiptVisibility(
            sender_address_enabled=False,
            receiver_address_enabled=True,
            receiver_phone_enabled=False,
        ),
        owner,
    ))
    assert saved == {
        "sender_address_enabled": False,
        "receiver_address_enabled": True,
        "receiver_phone_enabled": False,
    }
    assert asyncio.run(site_ops.read_booking_receipt_visibility(manager)) == saved

    with pytest.raises(HTTPException) as error:
        asyncio.run(site_ops.update_booking_receipt_visibility(
            site_ops.BookingReceiptVisibility(), manager,
        ))
    assert error.value.status_code == 403


def test_booking_receipt_accepts_multiple_hindi_goods_rows_and_preserves_legacy_fields():
    receipt = site_ops.LRCreate(
        sender_name="Ramesh", sender_name_hindi="रमेश",
        receiver_name="Suresh", receiver_name_hindi="सुरेश",
        sender_address="Sender Road", receiver_address="Receiver Road",
        receipt_date="2026-09-29",
        goods_rows=[
            {
                "type": "Cement", "type_hindi": "सीमेंट", "description": "Cement bags",
                "description_hindi": "सीमेंट की बोरियाँ", "quantity": 2,
            },
            {"type": "Food Grains", "type_hindi": "अनाज", "quantity": 3},
        ],
        rent="100.25", hamali="10.50",
    )
    assert receipt.goods_type == "Cement"
    assert receipt.containers[0].type_hindi == "सीमेंट"
    assert receipt.containers[0].description_hindi == "सीमेंट की बोरियाँ"
    assert receipt.containers[1].type == "Food Grains"
    assert receipt.rent + receipt.hamali == Decimal("110.75")


def test_site_lr_creation_stores_receipt_creation_time(monkeypatch):
    site = {
        "_id": "site-1", "business_id": "business-1", "code": "NGP",
        "config": {"receipt_controls": {
            "hindi_conversion_enabled": False, "receipt_fee": "5.00",
        }},
    }
    trip = {
        "_id": "trip-1", "status": "open", "trip_ref": "NGP29092026-01",
        "operating_date": "2026-09-29", "timezone": "Asia/Kolkata",
    }
    timestamp = "2026-09-29T16:50:00+00:00"
    inserted = []

    class SiteLRs:
        async def insert_one(self, document):
            inserted.append(document.copy())

    receiver = {
        "_id": "receiver-1", "name": "Suresh", "normalized_name": "suresh",
        "label": "Suresh", "identifier": "",
    }
    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_lrs=SiteLRs()))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_receiver_for_lr", _async_value(receiver))
    monkeypatch.setattr(site_ops, "_party_for_receiver", _async_value("party-1"))
    monkeypatch.setattr(site_ops, "_next_sequence", _async_value(1))
    monkeypatch.setattr(site_ops, "new_id", lambda: "lr-1")
    monkeypatch.setattr(site_ops, "_creator_metadata", lambda _user: {
        "created_by": "manager", "created_by_id": "manager",
        "created_by_login": "manager", "created_by_name": "Manager",
        "created_by_role": "site_manager", "created_at": timestamp,
    })
    monkeypatch.setattr(site_ops, "_finish_site_lr_creation", _async_value(None))
    monkeypatch.setattr(site_ops, "_lr_rows", _async_value([{"id": "lr-1"}]))

    asyncio.run(site_ops.create_site_lr(
        "site-1", "trip-1",
        site_ops.LRCreate(
            receiver_name="Suresh", sender_address="Main Road",
            sender_address_hindi="मेन रोड",
            goods_rows=[{
                "type": "Cement", "quantity": 1, "description": "Bags",
                "description_hindi": "बोरियाँ", "rent": "", "hamali": "",
            }],
        ),
        {"role": "site_manager", "username": "manager"},
    ))

    assert inserted[0]["created_at"] == timestamp
    assert inserted[0]["receipt_created_at"] == timestamp
    assert inserted[0]["receipt_fee"] == Decimal128("5.00")
    assert inserted[0]["sender_address_hindi"] == "मेन रोड"
    assert inserted[0]["goods_rows"][0]["description_hindi"] == "बोरियाँ"
    assert inserted[0]["goods_rows"][0]["rent"] == Decimal128("0.00")
    assert inserted[0]["goods_rows"][0]["hamali"] == Decimal128("0.00")


def test_booking_receipt_requires_at_least_one_nonempty_goods_row():
    with pytest.raises(ValidationError):
        site_ops.LRCreate(
            sender_name="Ramesh", receiver_name="Suresh",
            goods_rows=[], rent="0", hamali="0",
        )


def test_document_serializer_preserves_top_level_identifier():
    document = {"_id": "stable-record-id", "site_id": "site-1", "nested": {"_id": "internal"}}

    result = site_ops._doc(document)

    assert result["id"] == "stable-record-id"
    assert "_id" not in result
    assert "_id" not in result["nested"]


def test_site_identity_rejects_duplicate_name_or_location(monkeypatch):
    class Sites:
        def find(self, _query):
            return self

        async def to_list(self, _limit):
            return [
                {"_id": "site-1", "name": "North  Depot", "location": "Main Road"},
                {"_id": "site-2", "name": "South Depot", "location": "Market Square"},
            ]

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(sites=Sites()))

    with pytest.raises(HTTPException) as name_error:
        asyncio.run(site_ops._ensure_unique_site_identity(
            "business-1", " north depot ", "Another Road",
        ))
    assert name_error.value.status_code == 409
    assert "name" in name_error.value.detail

    with pytest.raises(HTTPException) as location_error:
        asyncio.run(site_ops._ensure_unique_site_identity(
            "business-1", "New Depot", "market  square",
        ))
    assert location_error.value.status_code == 409
    assert "location" in location_error.value.detail

    asyncio.run(site_ops._ensure_unique_site_identity(
        "business-1", "North Depot", "Main Road", exclude_site_id="site-1",
    ))


def test_reassigning_existing_manager_hashes_supplied_password(monkeypatch):
    existing = {
        "_id": "manager-1", "tenant_id": "business-1", "role": "site_manager",
        "password": "old-hash",
    }
    updates = []
    audits = []

    class Users:
        async def find_one(self, _query):
            return existing

        async def update_one(self, query, update):
            updates.append((query, update))

    class Sites:
        async def update_one(self, *_args, **_kwargs):
            return None

    class Team:
        async def find_one(self, query):
            if query["_id"] == "team-1":
                return {"_id": "team-1", "name": "Manager One", "role": "Manager"}
            return None

    async def replace_access(*_args):
        return None

    async def site_for_user(*_args):
        return resolved_site

    async def audit(*args, **kwargs):
        audits.append((args, kwargs))

    resolved_site = {
        "_id": "site-1", "business_id": "business-1",
        "manager_username": "manager-1",
    }
    monkeypatch.setattr(site_ops, "_owner", lambda _user: None)
    monkeypatch.setattr(site_ops, "_site_for_user", site_for_user)
    monkeypatch.setattr(site_ops, "_tenant_id", lambda _user: "business-1")
    monkeypatch.setattr(site_ops, "_replace_manager_access", replace_access)
    monkeypatch.setattr(site_ops, "_audit", audit)
    monkeypatch.setattr(site_ops, "hash_manager_pw", lambda _password: "bcrypt-hash")
    monkeypatch.setattr(site_ops, "platform_db", SimpleNamespace(users=Users()))
    monkeypatch.setattr(site_ops, "db", SimpleNamespace(sites=Sites(), team=Team()))

    password = "new-manager-password"
    result = asyncio.run(site_ops.assign_site_manager(
        "site-1",
        site_ops.ManagerAssignment(
            name="Manager One", username="manager-1", password=password,
            team_member_id="team-1",
        ),
        {"role": "owner", "tenant_id": "business-1"},
    ))

    assert updates[0][1]["$set"]["password"] == "bcrypt-hash"
    assert updates[0][1]["$set"]["team_member_id"] == "team-1"
    assert password not in repr(updates)
    assert "password" not in result
    assert any(args[2] == "manager.password_reset" for args, _kwargs in audits)


def test_manager_register_never_returns_password_fields(monkeypatch):
    class ManagerCursor:
        def sort(self, *_args):
            return self

        async def to_list(self, _limit):
            return [{
                "_id": "manager-1", "name": "Manager One", "active": True,
                "tenant_id": "business-1", "role": "site_manager",
                "password": "bcrypt-hash", "team_member_id": "team-1", "site_ids": ["site-1"],
                "site_permissions": {"site-1": ["trips:read"]},
            }]

    class Users:
        def find(self, _query):
            return ManagerCursor()

    monkeypatch.setattr(site_ops, "_owner", lambda _user: None)
    monkeypatch.setattr(site_ops, "_tenant_id", lambda _user: "business-1")
    monkeypatch.setattr(site_ops, "platform_db", SimpleNamespace(users=Users()))

    result = asyncio.run(site_ops.list_site_managers({"role": "owner", "tenant_id": "business-1"}))

    assert result == [{
        "username": "manager-1", "name": "Manager One", "active": True,
        "team_member_id": "team-1",
        "site_ids": ["site-1"], "site_permissions": {"site-1": ["trips:read"]},
    }]
    assert "password" not in result[0]


def test_platform_booking_support_remains_available_when_customer_has_settings_access(monkeypatch):
    tenant = {"_id": "tenant-1", "subscription_access": None, "features": {}}

    class Tenants:
        async def find_one(self, query):
            assert query == {"_id": "tenant-1"}
            return tenant

    tenant_switches = []
    monkeypatch.setattr(site_ops, "platform_db", SimpleNamespace(
        tenants=Tenants(),
    ))
    monkeypatch.setattr(site_ops, "set_tenant", tenant_switches.append)

    support_user = asyncio.run(site_ops._platform_booking_support_user(
        "tenant-1", {"username": "platform-owner", "role": "superadmin"},
    ))

    assert tenant_switches == ["tenant-1"]
    assert support_user["role"] == "superadmin"
    assert support_user["actor_role"] == "platform_support"
    assert support_user["_platform_support"] is True


def test_platform_booking_support_is_tenant_scoped_when_subscription_blocks_owner_access(
    monkeypatch,
):
    tenant = {
        "_id": "tenant-1",
        "subscription_access": {"booking_settings": False},
        "features": {},
    }

    class Users:
        def find(self, _query, _projection):
            class Cursor:
                async def to_list(self, _limit):
                    return [{
                        "_id": "owner-1",
                        "admin_access": {"booking_settings": True},
                    }]

            return Cursor()

    class Tenants:
        async def find_one(self, _query):
            return tenant

    tenant_switches = []
    monkeypatch.setattr(site_ops, "platform_db", SimpleNamespace(
        tenants=Tenants(), users=Users(),
    ))
    monkeypatch.setattr(site_ops, "set_tenant", tenant_switches.append)

    support_user = asyncio.run(site_ops._platform_booking_support_user(
        "tenant-1",
        {"username": "platform-owner", "name": "Platform Owner", "role": "superadmin"},
    ))

    assert tenant_switches == ["tenant-1"]
    assert support_user == {
        "_id": "platform-owner",
        "username": "platform-owner",
        "name": "Platform Owner",
        "role": "superadmin",
        "actor_role": "platform_support",
        "tenant_id": "tenant-1",
        "_platform_support": True,
    }


def test_platform_booking_site_listing_delegates_only_with_support_identity(monkeypatch):
    calls = []
    support_user = {
        "username": "platform-owner", "tenant_id": "tenant-1",
        "role": "superadmin", "_platform_support": True,
    }

    async def support_identity(tenant_id, platform_user):
        calls.append(("support", tenant_id, platform_user["username"]))
        return support_user

    async def list_sites(u):
        calls.append(("list", u))
        return [{"id": "site-1"}]

    monkeypatch.setattr(site_ops, "_platform_booking_support_user", support_identity)
    monkeypatch.setattr(site_ops, "list_sites", list_sites)

    result = asyncio.run(site_ops.platform_booking_sites(
        "tenant-1", {"username": "platform-owner"},
    ))

    assert result == [{"id": "site-1"}]
    assert calls == [
        ("support", "tenant-1", "platform-owner"),
        ("list", support_user),
    ]


def test_activity_by_date_combines_trip_and_lr_counts_and_fills_gaps():
    activity = site_ops._activity_by_date(
        "2026-09-25",
        "2026-09-27",
        [{"_id": "2026-09-25", "count": 2}, {"_id": "2026-09-27", "count": 1}],
        [{"_id": "2026-09-26", "count": 3}],
    )

    assert activity == [
        {"date": "2026-09-25", "total_trips": 2, "total_lrs": 0},
        {"date": "2026-09-26", "total_trips": 0, "total_lrs": 3},
        {"date": "2026-09-27", "total_trips": 1, "total_lrs": 0},
    ]


def test_payment_status_uses_amount_due_and_actual_paid_amount():
    assert site_ops._payment_status(None, Decimal("0.00")) == "unpriced"
    assert site_ops._payment_status(Decimal("100.00"), Decimal("0.00")) == "unpaid"
    assert site_ops._payment_status(Decimal("100.00"), Decimal("35.00")) == "partial"
    assert site_ops._payment_status(Decimal("100.00"), Decimal("100.00")) == "paid"


def test_booking_lr_report_query_is_tenant_and_site_scoped_and_escapes_search():
    query = site_ops._system_lr_report_query(
        "business-1", ["site-1", "site-2"], "2026-09-01", "2026-09-30", "A.*",
    )

    assert query["business_id"] == "business-1"
    assert query["site_id"] == {"$in": ["site-1", "site-2"]}
    assert query["operating_date"] == {"$gte": "2026-09-01", "$lte": "2026-09-30"}
    assert query["$or"][0]["lr_ref"] == {"$regex": r"A\.\*", "$options": "i"}


def test_reversal_index_excludes_non_reversal_payments_and_migrates_sparse_index(monkeypatch):
    class Collection:
        def __init__(self):
            self.indexes = []
            self.existing_indexes = {}
            self.dropped_indexes = []

        async def create_index(self, keys, **options):
            self.indexes.append((keys, options))

        async def index_information(self):
            return self.existing_indexes

        async def drop_index(self, name):
            self.dropped_indexes.append(name)

    class Database:
        def __init__(self):
            self.collections = {}

        def __getattr__(self, name):
            return self.collections.setdefault(name, Collection())

    database = Database()
    database.site_payments.existing_indexes["site_payment_reversal_unique"] = {
        "unique": True,
        "sparse": True,
    }
    monkeypatch.setattr(site_ops, "db", database)
    monkeypatch.setattr(site_ops, "current_db_name", lambda: "test-tenant")
    monkeypatch.setattr(site_ops, "_indexed_databases", set())
    monkeypatch.setattr(site_ops, "_index_lock", asyncio.Lock())

    asyncio.run(site_ops.initialize_site_storage())

    indexes = database.site_payments.indexes
    reversal_index = next(
        options for _, options in indexes
        if options.get("name") == "site_payment_reversal_unique"
    )
    assert reversal_index["unique"] is True
    assert reversal_index["partialFilterExpression"] == {
        "kind": "reversal",
        "reversal_of": {"$exists": True},
    }
    assert database.site_payments.dropped_indexes == ["site_payment_reversal_unique"]
    expense_index = next(
        options for _, options in database.expenses.indexes
        if options.get("name") == "site_trip_expense_idempotency_unique"
    )
    assert expense_index["unique"] is True
    assert expense_index["partialFilterExpression"] == {
        "idempotency_key": {"$exists": True},
    }
    posting_index = next(
        options for _, options in database.cashbook.indexes
        if options.get("name") == "site_trip_expense_posting_unique"
    )
    assert posting_index["unique"] is True
    assert posting_index["partialFilterExpression"]["$and"][1] == {
        "ref_type": "site_trip_expense",
    }


def test_invalid_payment_balance_is_marked_rejected(monkeypatch):
    class SiteLRs:
        async def update_one(self, *_args, **_kwargs):
            return SimpleNamespace(modified_count=0)

        async def find_one(self, *_args, **_kwargs):
            return {"paid_total": Decimal("100.00"), "payment_effect_ids": []}

    class SitePayments:
        def __init__(self):
            self.update = None

        async def update_one(self, query, update):
            self.update = (query, update)

    payments = SitePayments()
    monkeypatch.setattr(
        site_ops, "db",
        SimpleNamespace(site_lrs=SiteLRs(), site_payments=payments),
    )
    site = {"_id": "site-1", "business_id": "business-1"}
    payment = {
        "_id": "payment-1", "lr_id": "lr-1", "trip_id": "trip-1",
        "amount": site_ops.Decimal128(Decimal("1.00")), "kind": "payment",
    }

    with pytest.raises(HTTPException) as error:
        asyncio.run(site_ops._apply_payment_balance(payment, site))

    assert error.value.status_code == 409
    assert payments.update[0] == {"_id": "payment-1", "posting_status": "pending"}
    assert payments.update[1]["$set"]["posting_status"] == "rejected"


def test_payment_balance_limit_includes_receipt_fee(monkeypatch):
    class SiteLRs:
        def __init__(self):
            self.query = None
            self.update = None

        async def update_one(self, query, update):
            self.query = query
            self.update = update
            return SimpleNamespace(modified_count=1)

    lrs = SiteLRs()
    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_lrs=lrs))
    site = {"_id": "site-1", "business_id": "business-1"}
    payment = {
        "_id": "payment-1", "lr_id": "lr-1", "trip_id": "trip-1",
        "amount": site_ops.Decimal128(Decimal("82.00")), "kind": "payment",
    }

    asyncio.run(site_ops._apply_payment_balance(payment, site))

    paid_limit = lrs.query["$expr"]["$lte"]
    assert paid_limit[1] == {"$add": [
        "$rent",
        {"$ifNull": ["$receipt_fee", site_ops.Decimal128(Decimal("2.00"))]},
    ]}


@pytest.mark.parametrize("value", ["=SUM(A1:A2)", "+cmd", "-1+2", "@import", "\tformula"])
def test_csv_export_neutralizes_formula_prefixes(value):
    assert site_ops._safe_csv_text(value).startswith("'")


def test_csv_export_neutralizes_formula_after_whitespace():
    assert site_ops._safe_csv_text("  \t=SUM(A1:A2)") == "'  \t=SUM(A1:A2)"


def test_xlsx_ledger_is_a_formatted_workbook_and_neutralizes_formula_text():
    response = site_ops._xlsx_response(
        "garage-ledger.xlsx", "Mama Transport", "2026-09-29 to 2026-09-29",
        [
            ("Ledger", ("LR", "Total rent", "Sender"), [
                ("LR-1", Decimal("125.50"), "=HYPERLINK(\"bad\")"),
            ], (24, 16, 30)),
            ("Goods details", ("LR", "Description"), [("LR-1", "Food bags")], (24, 40)),
        ],
    )

    workbook = load_workbook(io.BytesIO(response.body), data_only=False)

    assert response.media_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert workbook.sheetnames == ["Ledger", "Goods details"]
    sheet = workbook["Ledger"]
    assert sheet["A1"].value == "Mama Transport"
    assert sheet["A5"].value == "LR-1"
    assert sheet["B5"].value == 125.5
    assert sheet["C5"].value == "'=HYPERLINK(\"bad\")"
    assert sheet.freeze_panes == "A5"
    assert sheet.auto_filter.ref == "A4:C5"
    assert workbook["Goods details"]["B5"].value == "Food bags"


def test_site_ledger_xlsx_omits_addresses_and_exports_hindi_ledger_values(monkeypatch):
    lr = {
        "_id": "lr-1", "business_id": "business-1", "site_id": "site-1",
        "trip_id": "trip-1", "lr_ref": "NGPLR29092026-01", "receipt_date": "2026-09-29",
        "sender_name": "Sender", "sender_name_hindi": "भेजने वाला", "sender_address": "Hidden sender address",
        "receiver_name": "Receiver", "receiver_name_hindi": "प्राप्तकर्ता",
        "receiver_address": "Hidden receiver address", "rent": Decimal("100.00"),
        "hamali": Decimal("10.00"), "charge_updated_by_role": "site_manager",
        "created_by_name": "Saoji", "created_by_role": "site_manager",
        "goods_rows": [{
            "type": "Hardware", "type_hindi": "हार्डवेयर",
            "description": "Tools", "quantity": 2,
        }, {
            "type": "Cement bag", "type_hindi": "सीमेंट बोरी", "quantity": 10,
        }, {
            "type": "Grain box", "type_hindi": "अनाज डिब्बा", "quantity": 30,
        }],
    }
    voided_lr = {
        **lr, "_id": "lr-voided", "lr_ref": "NGPLR29092026-VOID",
        "rent": Decimal("500.00"), "hamali": Decimal("50.00"),
        "receipt_fee": Decimal("10.00"), "voided": True, "goods_rows": [],
    }
    captured_query = {}

    class LRCursor:
        def sort(self, *_args):
            return self

        def limit(self, *_args):
            return self

        async def to_list(self, _limit):
            return [lr, voided_lr]

    class LRs:
        def find(self, query):
            captured_query.update(query)
            return LRCursor()

    class Trips:
        async def find_one(self, _query):
            return {"_id": "trip-1", "trip_ref": "NGP29092026-01"}

    async def site_for_user(*_args):
        return {"_id": "site-1", "business_id": "business-1", "code": "NGP", "name": "Garage"}

    monkeypatch.setattr(site_ops, "_site_for_user", site_for_user)
    monkeypatch.setattr(site_ops, "_can_read_site_finances", lambda *_args: True)
    monkeypatch.setattr(site_ops, "_payments_by_lr", _async_value({"lr-1": Decimal("0.00")}))
    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_lrs=LRs(), site_trips=Trips()))

    response = asyncio.run(site_ops.export_site_ledger_xlsx(
        "site-1", "2026-09-29", "2026-09-29", "trip-1",
        {"username": "owner", "role": "owner"},
    ))

    workbook = load_workbook(io.BytesIO(response.body), data_only=True)
    sheet = workbook["बही"]
    headers = [sheet.cell(4, column).value for column in range(1, sheet.max_column + 1)]
    assert headers == [
        "दिनांक", "रसीद नंबर", "भेजने वाला", "प्राप्तकर्ता", "माल एवं मात्रा",
        "कुल मात्रा", "भाड़ा", "हमाली", "रसीद शुल्क", "कुल रकम", "Amount paid",
    ]
    assert sheet["A2"].value == "Trip number: NGP29092026-01"
    assert sheet["C5"].value == "भेजने वाला"
    assert sheet["D5"].value == "प्राप्तकर्ता"
    assert sheet["E5"].value == "२ - हार्डवेयर/औज़ार, १० - सीमेंट बोरी, ३० - अनाज डिब्बा"
    assert sheet["F5"].value == 42
    assert sheet["G5"].value == 100
    assert sheet["H5"].value == 10
    assert sheet["I5"].value == 2
    assert sheet["J5"].value == 112
    assert sheet["K5"].value is None
    assert sheet["G7"].value == 100
    assert sheet["H7"].value == 10
    assert sheet["I7"].value == 2
    assert sheet["J7"].value == "Grand total: ₹112.00"
    assert captured_query["trip_id"] == "trip-1"
    all_values = "\n".join(
        str(value) for row in sheet.iter_rows(values_only=True) for value in row
    )
    assert "Hidden sender address" not in all_values
    assert "Hidden receiver address" not in all_values
    assert workbook.sheetnames == ["बही"]

    selected_response = asyncio.run(site_ops.export_site_ledger_xlsx(
        "site-1", "2026-09-29", "2026-09-29", "trip-1",
        {"username": "owner", "role": "owner"},
        columns="receipt,senderAddress,receiverPhone,goods,quantity,bhada,amountPaid",
    ))
    selected_sheet = load_workbook(
        io.BytesIO(selected_response.body), data_only=True,
    )["बही"]
    selected_headers = [
        selected_sheet.cell(4, column).value
        for column in range(1, selected_sheet.max_column + 1)
    ]
    assert selected_headers == [
        "रसीद नंबर", "भेजने वाले का पता", "प्राप्तकर्ता का फ़ोन",
        "माल एवं मात्रा", "कुल मात्रा", "भाड़ा", "Amount paid",
    ]
    assert selected_sheet["D5"].value == "२ - हार्डवेयर/औज़ार, १० - सीमेंट बोरी, ३० - अनाज डिब्बा"
    assert selected_sheet["E5"].value == 42
    assert selected_sheet["F5"].value == 100


def test_lr_models_accept_contact_phones():
    created = site_ops.LRCreate(
        sender_name="Sender", sender_phone="+1 555-0100",
        receiver_name="Receiver", receiver_phone="555-0200",
        goods_type="Goods", containers=[site_ops.ContainerLine(type="Box", quantity=1)],
    )
    updated = site_ops.LRUpdate(sender_phone="555-0300", receiver_phone="555-0400")

    assert created.sender_phone == "+1 555-0100"
    assert created.receiver_phone == "555-0200"
    assert updated.sender_phone == "555-0300"
    assert updated.receiver_phone == "555-0400"


def test_lr_models_allow_optional_sender_and_goods_descriptions():
    created = site_ops.LRCreate(
        sender_name="", receiver_name="Receiver",
        goods_rows=[{
            "type": "Food grains", "type_hindi": "अनाज",
            "description": "Two sacks", "description_hindi": "दो बोरियाँ", "quantity": 2,
        }],
        city="Nagpur",
    )
    updated = site_ops.LRUpdate(
        sender_name="", city="Wadi",
        goods_rows=[{
            "type": "Rice", "type_hindi": "चावल",
            "description": "Broken rice bags", "description_hindi": "टूटे चावल के बोरे",
            "quantity": 1,
        }],
    )

    assert created.sender_name == ""
    assert created.city == "Nagpur"
    assert created.containers[0].description == "Two sacks"
    assert created.containers[0].description_hindi == "दो बोरियाँ"
    assert updated.sender_name == ""
    assert updated.city == "Wadi"
    assert updated.containers[0].description == "Broken rice bags"
    assert updated.containers[0].description_hindi == "टूटे चावल के बोरे"


def test_hindi_quantity_digits_are_localized():
    assert site_ops._hindi_digits(1234567890) == "१२३४५६७८९०"


def test_receiver_party_phone_is_not_overwritten_when_request_omits_it(monkeypatch):
    class Parties:
        def __init__(self):
            self.update_calls = []

        async def find_one(self, _query):
            return {"_id": "party-1", "mobile": "existing-mobile"}

        async def update_one(self, query, update):
            self.update_calls.append((query, update))

    parties = Parties()
    monkeypatch.setattr(site_ops, "db", SimpleNamespace(parties=parties))
    site = {"_id": "site-1", "business_id": "business-1"}
    identity = {"_id": "receiver-1"}

    result = asyncio.run(site_ops._party_for_receiver(site, identity))

    assert result == "party-1"
    assert parties.update_calls == []


def test_receiver_party_phone_updates_when_a_phone_is_supplied(monkeypatch):
    class Parties:
        def __init__(self):
            self.update_calls = []

        async def find_one(self, _query):
            return {"_id": "party-1", "mobile": "old-mobile"}

        async def update_one(self, query, update):
            self.update_calls.append((query, update))

    parties = Parties()
    monkeypatch.setattr(site_ops, "db", SimpleNamespace(parties=parties))

    result = asyncio.run(site_ops._party_for_receiver(
        {"_id": "site-1", "business_id": "business-1"},
        {"_id": "receiver-1"}, "555-0100",
    ))

    assert result == "party-1"
    assert parties.update_calls[0][1] == {"$set": {"mobile": "555-0100"}}


def test_lr_rows_return_persisted_contact_phones(monkeypatch):
    monkeypatch.setattr(
        site_ops, "_payments_by_lr", _async_value({"lr-1": Decimal("0.00")}),
    )
    lr = {
        "_id": "lr-1", "sender_phone": "555-0100",
        "receiver_phone": "555-0200", "rent": None,
    }

    result = asyncio.run(site_ops._lr_rows(
        {"_id": "site-1", "business_id": "business-1"}, "trip-1", [lr],
    ))[0]

    assert result["sender_phone"] == "555-0100"
    assert result["receiver_phone"] == "555-0200"


@pytest.mark.parametrize("requested_phone", [None, "9876503000"])
def test_lr_update_persists_phone_and_preserves_party_mobile_when_omitted(
    monkeypatch, requested_phone,
):
    site = {"_id": "site-1", "business_id": "business-1"}
    lr = {
        "_id": "lr-1", "party_id": "party-1", "trip_id": "trip-1",
        "sender_name": "Sender", "sender_phone": "555-0100",
        "receiver_phone": "555-0200", "rent": None, "hamali": None,
    }

    class SiteLRs:
        def __init__(self):
            self.update = None

        async def update_one(self, query, update):
            self.update = (query, update)
            lr.update(update["$set"])

    class Parties:
        def __init__(self):
            self.mobile = "555-0200"
            self.updates = []

        async def update_one(self, query, update):
            self.updates.append((query, update))
            self.mobile = update["$set"]["mobile"]

    lrs = SiteLRs()
    parties = Parties()
    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_lrs=lrs, parties=parties))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value({"status": "open"}))
    monkeypatch.setattr(site_ops, "_lr", _async_value(lr))
    monkeypatch.setattr(site_ops, "_audit", _async_value(None))
    monkeypatch.setattr(site_ops, "_lr_rows", _async_value([lr]))
    body = site_ops.LRUpdate(
        sender_name="Edited Sender", receiver_phone=requested_phone,
    ) if requested_phone else site_ops.LRUpdate(sender_name="Edited Sender")

    result = asyncio.run(site_ops.update_site_lr(
        "site-1", "trip-1", "lr-1", body, {"role": "owner"},
    ))

    assert result["receiver_phone"] == (requested_phone or "555-0200")
    assert parties.mobile == (requested_phone or "555-0200")
    assert bool(parties.updates) is bool(requested_phone)
    if requested_phone:
        assert lrs.update is not None
        assert lrs.update[1]["$set"]["receiver_phone"] == requested_phone


def test_owner_can_edit_a_paid_receipt_without_receiver_correction_reason(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {"_id": "trip-1", "status": "open", "operating_date": "2026-09-27"}
    lr = {
        "_id": "lr-1", "party_id": "party-1", "trip_id": "trip-1",
        "lr_ref": "N-LR-1", "operating_date": "2026-09-27",
        "sender_name": "Old sender", "receiver_name": "Receiver",
        "receiver_identifier": "", "rent": Decimal128("100.00"),
        "hamali": Decimal128("0.00"), "reconciled": False,
    }

    class SiteLRs:
        def find(self, _query):
            return Cursor()

        async def update_one(self, _query, update):
            lr.update(update["$set"])

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_lrs=SiteLRs()))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_lr", _async_value(lr))
    monkeypatch.setattr(site_ops, "_lr_rows", _async_value([lr]))
    monkeypatch.setattr(site_ops, "_audit", _async_value(None))

    result = asyncio.run(site_ops.update_site_lr(
        "site-1", "trip-1", "lr-1",
        site_ops.LRUpdate(
            sender_name="Updated sender", receiver_name="Receiver",
            idempotency_key="edit-request-1",
        ),
        {"role": "owner", "username": "admin"},
    ))

    assert result["sender_name"] == "Updated sender"
    assert result["receiver_name"] == "Receiver"
    assert lr["sender_name"] == "Updated sender"


def test_locked_trip_ledger_rejects_receipt_edits_even_for_owner(monkeypatch):
    monkeypatch.setattr(
        site_ops, "_site_for_user",
        _async_value({"_id": "site-1", "business_id": "business-1"}),
    )
    monkeypatch.setattr(site_ops, "_trip", _async_value({
        "_id": "trip-1", "status": "open",
        "ledger_completed_at": "2026-09-29T12:00:00+00:00",
    }))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(site_ops.update_site_lr(
            "site-1", "trip-1", "lr-1",
            site_ops.LRUpdate(sender_name="Updated sender"),
            {"role": "owner", "username": "admin"},
        ))

    assert exc.value.status_code == 409
    assert "ledger" in str(exc.value.detail).lower()


def test_lr_receiver_and_first_bhada_save_posts_financial_event_to_new_party(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {"status": "open", "operating_date": "2026-09-27"}
    lr = {
        "_id": "lr-1", "party_id": "party-old", "trip_id": "trip-1",
        "lr_ref": "N-LR-1", "operating_date": "2026-09-27",
        "receiver_name": "Old Receiver", "receiver_label": "Old Receiver",
        "receiver_identifier": "", "receiver_identity_id": "receiver-old",
        "receiver_normalized": "old receiver", "receiver_phone": "",
        "rent": None, "hamali": None, "reconciled": False,
    }
    financial_events = []

    class SiteLRs:
        def find(self, _query):
            return Cursor()

        async def update_one(self, _query, update):
            lr.update(update["$set"])

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_lrs=SiteLRs()))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_lr", _async_value(lr))
    monkeypatch.setattr(site_ops, "_payments_by_lr", _async_value({"lr-1": Decimal("0.00")}))
    monkeypatch.setattr(site_ops, "_receiver_for_lr", _async_value({
        "_id": "receiver-new", "name": "New Receiver",
        "normalized_name": "new receiver", "label": "New Receiver", "identifier": "",
    }))
    monkeypatch.setattr(site_ops, "_party_for_receiver", _async_value("party-new"))
    monkeypatch.setattr(site_ops, "_audit", _async_value(None))
    monkeypatch.setattr(site_ops, "_lr_rows", _async_value([lr]))

    async def record_financial_event(*args, **_kwargs):
        financial_events.append(args)

    monkeypatch.setattr(site_ops, "_financial_event", record_financial_event)
    result = asyncio.run(site_ops.update_site_lr(
        "site-1", "trip-1", "lr-1",
        site_ops.LRUpdate(
            receiver_name="New Receiver", rent=Decimal("120.00"),
            idempotency_key="rent-correction-1",
        ),
        {"role": "site_manager", "username": "manager",
         "site_permissions": {"site-1": ["lrs:update"]}},
    ))

    assert result["party_id"] == "party-new"
    assert lr["party_id"] == "party-new"
    assert lr["charge_updated_by_role"] == "site_manager"
    assert site_ops._charge_editor_marker(lr) == "M"
    assert financial_events[0][2] == "party-new"
    assert financial_events[0][5] == Decimal("120.00")


def test_owner_can_correct_receiver_after_payments_without_a_correction_reason(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {"_id": "trip-1", "status": "closed", "operating_date": "2026-09-27"}
    lr = {
        "_id": "lr-1", "party_id": "party-old", "trip_id": "trip-1",
        "lr_ref": "N-LR-1", "operating_date": "2026-09-27",
        "receiver_name": "Old Receiver", "receiver_label": "Old Receiver",
        "receiver_identifier": "", "receiver_identity_id": "receiver-old",
        "receiver_normalized": "old receiver", "receiver_phone": "",
        "rent": Decimal128("100.00"), "hamali": Decimal128("0.00"),
        "reconciled": True, "updated_at": "version-1",
    }
    events = []
    audit = []

    class SiteLRs:
        async def update_one(self, _query, update):
            lr.update(update["$set"])
            return SimpleNamespace(matched_count=1)

    async def receiver_for_lr(*args):
        assert args[5] == "different"
        return {
            "_id": "receiver-new", "name": "New Receiver",
            "normalized_name": "new receiver", "label": "New Receiver",
            "identifier": "",
        }

    async def financial_event(*args, **kwargs):
        events.append((args, kwargs))

    async def record_audit(*_args, **kwargs):
        audit.append(kwargs)

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_lrs=SiteLRs()))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_lr", _async_value(lr))
    monkeypatch.setattr(site_ops, "_payments_by_lr", _async_value({"lr-1": Decimal("40.00")}))
    monkeypatch.setattr(site_ops, "_receiver_for_lr", receiver_for_lr)
    monkeypatch.setattr(site_ops, "_party_for_receiver", _async_value("party-new"))
    monkeypatch.setattr(site_ops, "_financial_event", financial_event)
    monkeypatch.setattr(site_ops, "_audit", record_audit)
    monkeypatch.setattr(site_ops, "_lr_rows", _async_value([lr]))

    result = asyncio.run(site_ops.update_site_lr(
        "site-1", "trip-1", "lr-1",
        site_ops.LRUpdate(
            receiver_name="New Receiver", idempotency_key="receiver-correction-1",
            expected_updated_at="version-1",
        ),
        {"role": "owner", "username": "admin"},
    ))

    assert result["receiver_name"] == "New Receiver"
    assert result["party_id"] == "party-new"
    assert [event[0][5] for event in events] == [Decimal("-60.00"), Decimal("60.00")]
    assert [event[0][2] for event in events] == ["party-old", "party-new"]
    assert audit[0].get("reason") is None


def test_owner_can_void_a_charged_lr_in_a_closed_trip_with_reason(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {"status": "closed", "operating_date": "2026-09-27"}
    lr = {
        "_id": "lr-1", "party_id": "party-1", "trip_id": "trip-1",
        "lr_ref": "N-LR-1", "operating_date": "2026-09-27",
        "rent": Decimal128("100.00"), "hamali": Decimal128("10.00"),
        "reconciled": True,
    }
    adjustments = []

    class SiteLRs:
        async def update_one(self, _query, update):
            lr.update(update["$set"])

    async def financial_event(*args, **_kwargs):
        adjustments.append(args)

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_lrs=SiteLRs()))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_lr", _async_value(lr))
    monkeypatch.setattr(site_ops, "_payments_by_lr", _async_value({"lr-1": Decimal("0.00")}))
    monkeypatch.setattr(site_ops, "_financial_event", financial_event)
    monkeypatch.setattr(site_ops, "_audit", _async_value(None))

    result = asyncio.run(site_ops.void_site_lr(
        "site-1", "trip-1", "lr-1",
        site_ops.VoidReceipt(reason="Duplicate receipt created by mistake"),
        {"role": "owner", "username": "admin"},
    ))

    assert result["voided"] is True
    assert lr["voided"] is True
    assert adjustments[0][5] == Decimal("-100.00")


def test_owner_can_restore_voided_receipt_and_repost_its_financial_history(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {"_id": "trip-1", "status": "closed", "operating_date": "2026-09-27"}
    lr = {
        "_id": "lr-1", "party_id": "party-1", "trip_id": "trip-1",
        "lr_ref": "N-LR-1", "operating_date": "2026-09-27",
        "rent": Decimal128("100.00"), "voided": True, "void_cycle": 1,
        "void_reason": "Duplicate receipt",
    }
    reversal_payment = {
        "_id": "payment-reversal-1", "amount": Decimal128("25.00"),
        "date": "2026-09-27", "method": "Cash", "reference": "LR payment",
    }
    restored_payments = []
    financial_events = []

    class Cursor:
        def sort(self, *_args):
            return self

        def to_list(self, _count):
            async def rows():
                return [reversal_payment]
            return rows()

    class SiteLRs:
        async def update_one(self, _query, update):
            lr.update(update["$set"])

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(
        site_lrs=SiteLRs(), site_payments=SimpleNamespace(find=lambda _query: Cursor()),
    ))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_lr", _async_value(lr))

    async def record_payment(*args, **kwargs):
        restored_payments.append((args, kwargs))
        return {"_id": "restored-payment-1"}

    async def financial_event(*args, **kwargs):
        financial_events.append((args, kwargs))

    monkeypatch.setattr(site_ops, "_record_lr_payment", record_payment)
    monkeypatch.setattr(site_ops, "_financial_event", financial_event)
    monkeypatch.setattr(site_ops, "_audit", _async_value(None))

    result = asyncio.run(site_ops.unvoid_site_lr(
        "site-1", "trip-1", "lr-1",
        site_ops.RestoreReceipt(
            reason="Void was entered by mistake", idempotency_key="restore-request-1",
        ),
        {"role": "owner", "username": "admin"},
    ))

    assert result == {"id": "lr-1", "voided": False, "restored_payments": 1}
    assert lr["voided"] is False
    assert restored_payments[0][0][3] == Decimal("25.00")
    assert restored_payments[0][1]["source"] == "receipt_unvoid"
    assert financial_events[0][0][5] == Decimal("100.00")


def test_site_manager_cannot_restore_a_voided_receipt():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(site_ops.unvoid_site_lr(
            "site-1", "trip-1", "lr-1",
            site_ops.RestoreReceipt(
                reason="Void was entered by mistake", idempotency_key="restore-request-1",
            ),
            {"role": "site_manager", "username": "manager"},
        ))

    assert exc.value.status_code == 403


def test_owner_ledger_settlement_records_full_remaining_bhada_as_cash(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {"_id": "trip-1", "status": "open", "operating_date": "2026-09-29"}
    lr = {
        "_id": "lr-1", "party_id": "party-1", "trip_id": "trip-1",
        "lr_ref": "N-LR-1", "operating_date": "2026-09-29",
        "goods_type": "Cement", "goods_type_hindi": "सीमेंट",
        "rent": Decimal128("100.00"),
    }
    payments = []
    audit = []

    class SitePayments:
        async def update_one(self, query, update):
            payments.append((query, update))

    class SiteLRs:
        async def update_one(self, _query, update):
            lr.update(update["$set"])

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(
        site_payments=SitePayments(), site_lrs=SiteLRs(),
    ))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_lr", _async_value(lr))
    monkeypatch.setattr(site_ops, "_payments_by_lr", _async_value({"lr-1": Decimal("20.00")}))
    monkeypatch.setattr(site_ops, "_now_at_site", lambda _site: ("2026-09-29", None))

    async def record_payment(*args, **kwargs):
        payments.append((args, kwargs))
        return {"_id": "new-settlement"}

    async def record_audit(*args, **kwargs):
        audit.append((args, kwargs))

    monkeypatch.setattr(site_ops, "_record_lr_payment", record_payment)
    monkeypatch.setattr(site_ops, "_audit", record_audit)

    result = asyncio.run(site_ops.update_site_lr_settlement(
        "site-1", "trip-1", "lr-1",
        site_ops.BookingSettlementUpdate(received=True, idempotency_key="settle-request-1"),
        {"role": "owner", "username": "owner"},
    ))

    assert result["received"] is True
    assert payments[0][0][3] == Decimal("82.00")
    assert payments[0][0][4:6] == ("2026-09-29", "Cash")
    assert payments[0][1]["source"] == "booking_settlement"
    assert payments[1][1]["$set"]["source"] == "booking_settlement"
    assert audit[0][0][2] == "lr.settlement_marked_received"
    assert lr["booking_ledger_paid"] is True


def test_completing_trip_ledger_posts_outstanding_bhada_and_locks_trip(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {"_id": "trip-1", "status": "open", "operating_date": "2026-09-29"}
    lr = {
        "_id": "lr-1", "trip_id": "trip-1", "party_id": "party-1",
        "lr_ref": "N-LR-1", "rent": Decimal128("100.00"), "voided": False,
    }
    paid = {"lr-1": Decimal("20.00")}
    payments = []
    recorded_payments = []
    audit = []

    class Cursor:
        def sort(self, *_args):
            return self

        def limit(self, *_args):
            return self

        def to_list(self, _count):
            async def rows():
                return [lr]
            return rows()

    class SiteTrips:
        async def update_one(self, _query, update):
            trip.update(update["$set"])

    class SiteLRs:
        def find(self, _query):
            return Cursor()

        async def update_one(self, _query, update):
            lr.update(update["$set"])

    class SitePayments:
        async def update_one(self, query, update):
            payments.append((query, update))

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(
        site_lrs=SiteLRs(),
        site_trips=SiteTrips(), site_payments=SitePayments(),
    ))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_payments_by_lr", _async_value(paid))
    monkeypatch.setattr(site_ops, "_now_at_site", lambda _site: ("2026-09-29", None))
    monkeypatch.setattr(site_ops, "now_iso", lambda: "2026-09-29T12:00:00+00:00")
    monkeypatch.setattr(site_ops, "_audit", _async_value(None))

    async def record_payment(*args, **kwargs):
        payments.append((args, kwargs))
        recorded_payments.append((args, kwargs))
        paid[args[2]["_id"]] += args[3]
        return {"_id": "completion-payment"}

    async def record_audit(*args, **kwargs):
        audit.append((args, kwargs))

    monkeypatch.setattr(site_ops, "_record_lr_payment", record_payment)
    monkeypatch.setattr(site_ops, "_audit", record_audit)

    result = asyncio.run(site_ops.complete_site_trip_ledger(
        "site-1", "trip-1", {"role": "owner", "username": "admin"},
    ))

    assert result["ledger_completed"] is True
    assert trip["ledger_completed_by"] == "admin"
    assert lr["booking_ledger_paid"] is True
    assert paid["lr-1"] == Decimal("102.00")
    posted = recorded_payments[0]
    assert posted[0][3] == Decimal("82.00")
    assert posted[1]["source"] == "booking_settlement"
    assert audit[0][0][2] == "trip.ledger_completed"


def test_owner_can_undo_ledger_completion_without_changing_settlements(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    completed_at = "2026-09-29T12:00:00+00:00"
    trip = {
        "_id": "trip-1", "ledger_completed_at": completed_at,
        "ledger_completed_by": "owner", "ledger_completion_started_at": completed_at,
        "ledger_completion_started_by": "owner", "ledger_completion_date": "2026-09-29",
    }
    lr = {
        "_id": "lr-1", "trip_id": "trip-1", "lr_ref": "NGP-LR-1",
        "rent": Decimal128("100.00"), "receipt_fee": Decimal128("2.00"),
        "voided": False,
    }
    existing_payments = [{"_id": "settlement-1", "amount": Decimal128("102.00")}]
    updates = []
    audits = []

    class Trips:
        async def update_one(self, query, update):
            updates.append((query, update))
            trip.update(update.get("$set", {}))
            for key in update.get("$unset", {}):
                trip.pop(key, None)
            return SimpleNamespace(matched_count=1)

    class LRs:
        def find(self, _query):
            class Cursor:
                def sort(self, *_args):
                    return self

                def limit(self, _limit):
                    return self

                def to_list(self, _limit):
                    async def rows():
                        return [lr]
                    return rows()
            return Cursor()

        async def update_one(self, _query, update):
            lr.update(update["$set"])

    class Payments:
        async def update_one(self, *_args, **_kwargs):
            raise AssertionError("Re-completion must not post duplicate settlements")

    async def audit(*args, **kwargs):
        audits.append((args, kwargs))

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(
        site_trips=Trips(), site_lrs=LRs(), site_payments=Payments(),
    ))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_audit", audit)
    monkeypatch.setattr(
        site_ops, "_payments_by_lr",
        _async_value({"lr-1": Decimal("102.00")}),
    )
    monkeypatch.setattr(
        site_ops, "_record_lr_payment",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("Re-completion must not create another payment"),
        ),
    )
    monkeypatch.setattr(site_ops, "_now_at_site", lambda _site: ("2026-09-29", None))
    monkeypatch.setattr(site_ops, "now_iso", lambda: "2026-09-29T12:00:00+00:00")

    result = asyncio.run(site_ops.uncomplete_site_trip_ledger(
        "site-1", "trip-1", {"role": "owner", "username": "owner"},
    ))

    assert result == {"id": "trip-1", "ledger_completed": False}
    assert updates == [(
        {
            "business_id": "business-1", "site_id": "site-1", "_id": "trip-1",
            "ledger_completed_at": completed_at,
        },
        {"$unset": {
            "ledger_completed_at": "", "ledger_completed_by": "",
            "ledger_completion_started_at": "", "ledger_completion_started_by": "",
            "ledger_completion_date": "",
        }},
    )]
    assert audits[0][0][2:5] == (
        "trip.ledger_completion_undone", "trip", "trip-1",
    )
    assert audits[0][1]["new"]["settlements_retained"] is True

    completed_again = asyncio.run(site_ops.complete_site_trip_ledger(
        "site-1", "trip-1", {"role": "owner", "username": "owner"},
    ))
    assert completed_again["ledger_completed"] is True
    assert trip["ledger_completed_by"] == "owner"
    assert lr["booking_ledger_paid"] is True
    assert existing_payments == [{
        "_id": "settlement-1", "amount": Decimal128("102.00"),
    }]
    assert [call[0][2] for call in audits] == [
        "trip.ledger_completion_undone", "trip.ledger_completed",
    ]


def test_only_owner_can_undo_ledger_completion(monkeypatch):
    with pytest.raises(HTTPException) as error:
        asyncio.run(site_ops.uncomplete_site_trip_ledger(
            "site-1", "trip-1", {"role": "site_manager", "username": "manager"},
        ))

    assert error.value.status_code == 403


def test_undo_ledger_completion_rejects_incomplete_or_concurrently_changed_trip(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    user = {"role": "owner", "username": "owner"}
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))

    monkeypatch.setattr(site_ops, "_trip", _async_value({"_id": "trip-1"}))
    with pytest.raises(HTTPException) as incomplete_error:
        asyncio.run(site_ops.uncomplete_site_trip_ledger("site-1", "trip-1", user))
    assert incomplete_error.value.status_code == 409
    assert "not completed" in incomplete_error.value.detail

    completed_at = "2026-09-29T12:00:00+00:00"
    monkeypatch.setattr(site_ops, "_trip", _async_value({
        "_id": "trip-1", "ledger_completed_at": completed_at,
    }))

    class ConcurrentTripUpdate:
        async def update_one(self, _query, _update):
            return SimpleNamespace(matched_count=0)

    monkeypatch.setattr(
        site_ops, "db", SimpleNamespace(site_trips=ConcurrentTripUpdate()),
    )
    with pytest.raises(HTTPException) as changed_error:
        asyncio.run(site_ops.uncomplete_site_trip_ledger("site-1", "trip-1", user))
    assert changed_error.value.status_code == 409
    assert "changed before it could be unlocked" in changed_error.value.detail


def test_owner_can_reverse_only_a_ledger_created_settlement(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {"_id": "trip-1", "status": "open", "operating_date": "2026-09-29"}
    lr = {
        "_id": "lr-1", "party_id": "party-1", "trip_id": "trip-1",
        "lr_ref": "N-LR-1", "operating_date": "2026-09-29",
        "rent": Decimal128("100.00"),
    }
    settlement = {
        "_id": "settlement-1", "amount": Decimal128("75.00"),
        "date": "2026-09-29", "method": "Cash", "reference": "Ledger tick",
    }
    captured = []

    class Cursor:
        def sort(self, *_args):
            return self

        def to_list(self, _count):
            async def rows():
                return [settlement]
            return rows()

    class SitePayments:
        def find(self, _query):
            return Cursor()

        async def find_one(self, _query):
            return None

    class SiteLRs:
        async def update_one(self, _query, update):
            lr.update(update["$set"])

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(
        site_payments=SitePayments(), site_lrs=SiteLRs(),
    ))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_lr", _async_value(lr))
    monkeypatch.setattr(site_ops, "_payments_by_lr", _async_value({"lr-1": Decimal("25.00")}))

    async def record_payment(*args, **kwargs):
        captured.append((args, kwargs))

    monkeypatch.setattr(site_ops, "_record_lr_payment", record_payment)
    monkeypatch.setattr(site_ops, "_audit", _async_value(None))

    result = asyncio.run(site_ops.update_site_lr_settlement(
        "site-1", "trip-1", "lr-1",
        site_ops.BookingSettlementUpdate(
            received=False, idempotency_key="undo-settle-1",
        ),
        {"role": "owner", "username": "owner"},
    ))

    assert captured[0][1]["kind"] == "reversal"
    assert captured[0][1]["reversal_of"] == "settlement-1"
    assert result["received"] is False
    assert result["paid_total"] == "25.00"
    assert result["outstanding"] == "77.00"
    assert lr["booking_ledger_paid"] is False


def test_lr_update_preserves_charges_when_editing_receipt_goods_without_finance_access(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {"_id": "trip-1", "status": "open", "operating_date": "2026-09-29"}
    lr = {
        "_id": "lr-1", "party_id": "party-1", "trip_id": "trip-1",
        "lr_ref": "N-LR-1", "operating_date": "2026-09-29",
        "rent": Decimal128("100.00"), "hamali": Decimal128("10.00"),
        "goods_rows": [{"type": "Box", "quantity": 1}],
        "containers": [{"type": "Box", "quantity": 1}],
    }

    class SiteLRs:
        async def update_one(self, _query, update):
            lr.update(update["$set"])
            return SimpleNamespace(matched_count=1)

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_lrs=SiteLRs()))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_lr", _async_value(lr))
    monkeypatch.setattr(site_ops, "_payments_by_lr", _async_value({"lr-1": Decimal("0.00")}))
    monkeypatch.setattr(site_ops, "_save_category", _async_value(None))
    monkeypatch.setattr(site_ops, "_audit", _async_value(None))
    monkeypatch.setattr(site_ops, "_lr_rows", _async_value([lr]))

    result = asyncio.run(site_ops.update_site_lr(
        "site-1", "trip-1", "lr-1",
        site_ops.LRUpdate(goods_rows=[{
            "type": "Crate", "quantity": 2, "description": "Large",
        }]),
        {"role": "site_manager", "username": "manager",
         "site_permissions": {"site-1": ["lrs:update"]}},
    ))

    assert result["goods_rows"][0]["type"] == "Crate"
    assert site_ops._decimal_value(result["rent"]) == Decimal("100.00")
    assert site_ops._decimal_value(result["hamali"]) == Decimal("10.00")

    with pytest.raises(HTTPException) as error:
        asyncio.run(site_ops.update_site_lr(
            "site-1", "trip-1", "lr-1",
            site_ops.LRUpdate(rent="101.00"),
            {"role": "site_manager", "username": "manager",
             "site_permissions": {"site-1": ["lrs:update"]}},
        ))
    assert error.value.status_code == 422
    assert "idempotency key" in error.value.detail


def test_lr_paid_tick_blocks_bhada_and_hamali_changes(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {"_id": "trip-1", "status": "open", "operating_date": "2026-09-29"}
    lr = {
        "_id": "lr-1", "trip_id": "trip-1", "lr_ref": "NGP-LR-1",
        "rent": Decimal128("100.00"), "hamali": Decimal128("10.00"),
        "booking_ledger_paid": True,
    }
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_lr", _async_value(lr))

    for changes in ({"rent": "101.00"}, {"hamali": "11.00"}):
        with pytest.raises(HTTPException) as error:
            asyncio.run(site_ops.update_site_lr(
                "site-1", "trip-1", "lr-1", site_ops.LRUpdate(**changes),
                {"role": "site_manager", "username": "manager",
                 "site_permissions": {"site-1": ["lrs:update"]}},
            ))
        assert error.value.status_code == 409
        assert "Untick Amount paid" in error.value.detail


def test_lr_update_calculates_receipt_totals_from_per_goods_charges(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {"status": "open", "operating_date": "2026-09-29"}
    lr = {
        "_id": "lr-1", "party_id": "party-1", "trip_id": "trip-1",
        "lr_ref": "N-LR-1", "operating_date": "2026-09-29",
        "rent": Decimal128("100.00"), "hamali": Decimal128("10.00"),
        "goods_rows": [{"type": "Cement", "quantity": 2, "rent": Decimal128("100.00"),
                        "hamali": Decimal128("10.00")}],
    }

    class SiteLRs:
        async def update_one(self, _query, update):
            lr.update(update["$set"])
            return SimpleNamespace(matched_count=1)

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_lrs=SiteLRs()))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_lr", _async_value(lr))
    monkeypatch.setattr(site_ops, "_payments_by_lr", _async_value({"lr-1": Decimal("0.00")}))
    monkeypatch.setattr(site_ops, "_save_category", _async_value(None))
    monkeypatch.setattr(site_ops, "_audit", _async_value(None))
    monkeypatch.setattr(site_ops, "_lr_rows", _async_value([lr]))

    result = asyncio.run(site_ops.update_site_lr(
        "site-1", "trip-1", "lr-1",
        site_ops.LRUpdate(
            goods_rows=[
                {
                    "type": "Cement", "quantity": 2, "description": "Bags",
                    "description_hindi": "बोरियाँ", "rent": "60.00", "hamali": "5.00",
                },
                {
                    "type": "Steel", "quantity": 1, "description": "Rods",
                    "description_hindi": "छड़ें", "rent": "40.00", "hamali": "3.00",
                },
            ],
            idempotency_key="goods-charge-edit-1",
        ),
        {"role": "site_manager", "username": "manager",
         "site_permissions": {"site-1": ["lrs:update"]}},
    ))

    assert site_ops._decimal_value(result["rent"]) == Decimal("100.00")
    assert site_ops._decimal_value(result["hamali"]) == Decimal("8.00")
    assert [site_ops._decimal_value(line["rent"]) for line in lr["goods_rows"]] == [
        Decimal("60.00"), Decimal("40.00"),
    ]
    assert [site_ops._decimal_value(line["hamali"]) for line in lr["goods_rows"]] == [
        Decimal("5.00"), Decimal("3.00"),
    ]
    assert lr["goods_rows"][0]["description_hindi"] == "बोरियाँ"
    assert lr["goods_rows"][1]["description_hindi"] == "छड़ें"


def test_booking_finance_uses_active_receipts_and_posted_bhada_payments(monkeypatch):
    site = {
        "_id": "site-1", "business_id": "business-1", "name": "Mama Garage",
        "code": "NGP", "config": {"receipt_controls": {"overdue_after_days": 5}},
    }
    receipts = [
        {
            "_id": "lr-1", "trip_id": "trip-1", "lr_ref": "NGP-LR-01",
            "operating_date": "2026-09-29", "receipt_date": "2026-09-29",
            "sender_name": "Sender", "receiver_name": "Receiver", "rent": Decimal("100.00"),
            "hamali": Decimal("10.00"), "receipt_fee": Decimal128("5.00"),
            "payment_next_contact_date": "2026-10-02",
            "payment_followup_outcome": "Called; promised transfer",
            "reconciled": True,
            "goods_rows": [{"type": "Cement", "quantity": 2}],
        },
        {
            "_id": "lr-2", "trip_id": "trip-2", "lr_ref": "NGP-LR-02",
            "operating_date": "2026-09-29", "receipt_date": "2026-09-29",
            "sender_name": "", "receiver_name": "Unreconciled", "rent": Decimal("50.00"),
            "hamali": Decimal("5.00"), "reconciled": False, "goods_rows": [],
        },
    ]

    class Cursor:
        def sort(self, *_args):
            return self

        def limit(self, _count):
            return self

        async def to_list(self, _count):
            return receipts

    class Payments:
        def aggregate(self, _pipeline):
            async def rows():
                yield {"_id": "lr-1", "paid": Decimal("40.00")}
            return rows()

    trips = {
        "trip-1": {"_id": "trip-1", "trip_ref": "NGP29092026-01"},
        "trip-2": {"_id": "trip-2", "trip_ref": "NGP29092026-02"},
    }

    class Trips:
        async def find_one(self, query):
            return trips.get(query["_id"])

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(
        site_lrs=SimpleNamespace(find=lambda _query: Cursor()),
        site_payments=Payments(), site_trips=Trips(),
    ))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_now_at_site", lambda _site: ("2026-09-29", None))

    result = asyncio.run(site_ops.site_booking_finance(
        "site-1", {"role": "owner", "username": "admin"},
    ))

    assert result["totals"] == {
        "receipt_count": 2, "pending_orders": 1, "unpriced_receipts": 0,
        "unpaid_receipts": 2, "recorded_bhada": "150.00",
        "recorded_receipt_fees": "7.00",
        "recorded_hamali": "15.00", "grand_total": "172.00",
        "collected_bhada": "40.00", "outstanding_bhada": "117.00",
        "collectible_outstanding_bhada": "65.00",
    }
    assert result["rows"][0]["trip_ref"] == "NGP29092026-01"
    assert result["overdue_after_days"] == 5
    assert result["rows"][0]["receipt_fee"] == "5.00"
    assert result["rows"][0]["total"] == "115.00"
    assert result["rows"][0]["outstanding"] == "65.00"
    assert result["rows"][0]["next_contact_date"] == "2026-10-02"
    assert result["rows"][0]["followup_outcome"] == "Called; promised transfer"
    assert result["receiver_balances"][0] == {
        "receiver_name": "Receiver", "receiver_label": "Receiver",
        "receipt_count": 1, "charges": "105.00", "collected": "40.00",
        "outstanding": "65.00",
    }


def test_booking_finance_is_restricted_to_business_owners():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(site_ops.site_booking_finance(
            "site-1", {"role": "site_manager", "username": "manager"},
        ))

    assert exc.value.status_code == 403


def test_owner_followup_saves_next_contact_and_outcome_and_audits_changes(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {"_id": "trip-1"}
    lr = {
        "_id": "lr-1", "payment_promised_date": "2026-10-01",
        "payment_followup_note": "Call again",
    }
    saved = []
    audits = []

    class SiteLRs:
        async def update_one(self, query, update):
            saved.append((query, update))

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_lrs=SiteLRs()))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_lr", _async_value(lr))

    async def audit(*args, **kwargs):
        audits.append((args, kwargs))

    monkeypatch.setattr(site_ops, "_audit", audit)
    result = asyncio.run(site_ops.update_site_lr_followup(
        "site-1", "trip-1", "lr-1",
        site_ops.BookingFollowupUpdate(
            promised_date="2026-10-03", note="  Call   again ",
            next_contact_date="2026-10-04", outcome="  No   answer ",
        ),
        {"role": "owner", "username": "owner"},
    ))

    expected = {
        "payment_promised_date": "2026-10-03",
        "payment_followup_note": "Call again",
        "payment_next_contact_date": "2026-10-04",
        "payment_followup_outcome": "No answer",
    }
    assert saved[0][1]["$set"] | {"updated_at": None} == expected | {"updated_at": None}
    assert result == {
        "id": "lr-1", "promised_date": "2026-10-03", "note": "Call again",
        "next_contact_date": "2026-10-04", "outcome": "No answer",
        "updated_at": saved[0][1]["$set"]["updated_at"],
    }
    assert audits[0][1]["old"] == {
        "payment_promised_date": "2026-10-01", "payment_followup_note": "Call again",
        "payment_next_contact_date": "", "payment_followup_outcome": "",
    }
    assert audits[0][1]["new"] == expected


def _report_fixtures():
    site = {"_id": "site-1", "business_id": "business-1", "code": "ST"}
    trip = {
        "_id": "trip-1", "trip_ref": "STT-001", "operating_date": "2026-09-27",
    }
    lrs = [
        {
            "_id": "lr-1", "lr_ref": "STLR-001", "receiver_identity_id": "receiver-1",
            "receiver_label": "Receiver One", "receiver_name": "Receiver One",
            "receiver_identifier": "", "sender_name": "Sender One",
            "goods_type": "Same Goods", "containers": [
                {"type": "Box", "quantity": 2}, {"type": "Bag", "quantity": 3},
            ],
            "total_quantity": 5, "rent": Decimal("100.00"),
            "hamali": Decimal("10.00"),
        },
        {
            "_id": "lr-2", "lr_ref": "STLR-002", "receiver_identity_id": "receiver-2",
            "receiver_label": "Receiver Two", "receiver_name": "Receiver Two",
            "receiver_identifier": "", "sender_name": "Sender Two",
            "goods_type": "Same Goods", "containers": [
                {"type": "Box", "quantity": 4},
            ],
            "total_quantity": 4, "rent": Decimal("200.00"),
            "hamali": Decimal("20.00"),
        },
    ]
    return site, trip, lrs


def _export_csv(monkeypatch, section, lrs=None):
    site, trip, fixture_lrs = _report_fixtures()
    lrs = fixture_lrs if lrs is None else lrs
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_trip_ledger_rows", _async_value((lrs, {})))
    monkeypatch.setattr(
        site_ops, "_payments_by_lr",
        _async_value({"lr-1": Decimal("25.00"), "lr-2": Decimal("50.00")}),
    )
    response = asyncio.run(
        site_ops.export_site_ledger("site-1", "trip-1", section, {"role": "owner"})
    )
    rows = list(csv.reader(io.StringIO(bytes(response.body).decode("utf-8-sig"), newline="")))
    return rows


def _async_value(value):
    async def return_value(*_args, **_kwargs):
        return value
    return return_value


@pytest.mark.parametrize(
    ("section", "expected_header"),
    [
        ("goods", [
            "business_id", "site_id", "trip_id", "goods_type", "container_quantities",
            "parcel_quantity_units", "lr_references", "receiver_count",
            "bhada_recorded_inr", "hamali_recorded_inr", "bhada_collected_inr",
            "bhada_outstanding_inr",
        ]),
        ("goods-details", [
            "business_id", "site_id", "trip_id", "trip_ref", "operating_date",
            "lr_id", "lr_ref", "receiver_label", "receiver_name", "receiver_identifier",
            "sender_name", "goods_type", "container_type", "container_quantity_units",
            "lr_parcel_quantity_units", "lr_financial_totals_row",
            "lr_bhada_recorded_inr", "lr_hamali_recorded_inr",
            "lr_bhada_collected_inr", "lr_bhada_outstanding_inr",
        ]),
        ("receivers", [
            "business_id", "site_id", "trip_id", "receiver_label", "receiver_name",
            "lr_references", "goods_types", "container_quantities", "parcel_quantity_units",
            "bhada_recorded_inr", "hamali_recorded_inr", "bhada_collected_inr",
            "bhada_outstanding_inr", "payment_details",
        ]),
        ("summary", [
            "business_id", "site_id", "trip_id", "trip_ref", "site_code",
            "operating_date", "lr_count", "parcel_quantity_units", "bhada_recorded_inr",
            "bhada_collected_inr", "bhada_outstanding_inr", "hamali_recorded_inr",
        ]),
    ],
)
def test_trip_report_variants_are_headers_first_and_scoped(
    monkeypatch, section, expected_header,
):
    rows = _export_csv(monkeypatch, section)

    assert rows[0] == expected_header
    assert rows[1][0:3] == ["business-1", "site-1", "trip-1"]


def test_goods_reports_keep_receivers_distinct_without_repeating_financials(monkeypatch):
    aggregate = _export_csv(monkeypatch, "goods")
    assert aggregate[0][7] == "receiver_count"
    assert aggregate[1][7] == "2"
    assert aggregate[1][4:7] == ["Bag x 3; Box x 6", "9", "STLR-001; STLR-002"]

    detailed = _export_csv(monkeypatch, "goods-details")
    header = detailed[0]
    receiver_column = header.index("receiver_name")
    lr_id_column = header.index("lr_id")
    totals_row_column = header.index("lr_financial_totals_row")
    rent_column = header.index("lr_bhada_recorded_inr")
    assert {row[receiver_column] for row in detailed[1:]} == {"Receiver One", "Receiver Two"}
    assert len(detailed[1:]) == 3
    assert [row[totals_row_column] for row in detailed[1:]] == ["true", "false", "true"]
    assert [row[rent_column] for row in detailed[1:]] == ["100.00", "", "200.00"]
    assert [row[lr_id_column] for row in detailed[1:]] == ["lr-1", "lr-1", "lr-2"]

    compatible_detail_alias = _export_csv(monkeypatch, "goods-detail")
    assert compatible_detail_alias[0] == detailed[0]
    assert compatible_detail_alias[1:] == detailed[1:]


def test_report_exports_neutralize_formula_injection(monkeypatch):
    site, trip, lrs = _report_fixtures()
    lrs[0]["receiver_name"] = " \t=HYPERLINK(\"https://evil.invalid\")"
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_trip_ledger_rows", _async_value((lrs, {})))
    monkeypatch.setattr(
        site_ops, "_payments_by_lr",
        _async_value({"lr-1": Decimal("25.00"), "lr-2": Decimal("50.00")}),
    )

    rows = asyncio.run(site_ops.export_site_ledger(
        "site-1", "trip-1", "goods-details", {"role": "owner"},
    ))
    parsed = list(csv.reader(io.StringIO(bytes(rows.body).decode("utf-8-sig"), newline="")))
    receiver_column = parsed[0].index("receiver_name")

    assert parsed[1][receiver_column] == "' \t=HYPERLINK(\"https://evil.invalid\")"


def test_every_import_template_keeps_versioned_header_and_parser_contract(monkeypatch):
    rows = _export_csv(monkeypatch, "import-template")

    assert rows[0] == ["#FLEET_MANAGER_TRIP_LEDGER", site_ops.LEDGER_TEMPLATE_VERSION]
    assert rows[1] == [
        "business_id=business-1", "site_id=site-1", "trip_id=trip-1",
    ]
    assert rows[2] == list(site_ops.LEDGER_COLUMNS)
    parsed = site_ops._parse_ledger_csv(
        ("\ufeff" + "\r\n".join(",".join(row) for row in rows)).encode("utf-8"),
        {"_id": "site-1", "business_id": "business-1"},
        {"_id": "trip-1"},
    )
    assert [row["source"]["lr_id"] for row in parsed] == ["lr-1", "lr-2"]


def test_site_trip_expense_post_is_idempotent_and_audited(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {
        "_id": "trip-1", "trip_ref": "ST27092026-01", "truck_no": "TRUCK-1",
        "driver_name": "Driver One", "vehicle_id": None, "driver_id": None,
    }

    class Expenses:
        def __init__(self):
            self.documents = {}
            self.created_count = 0

        async def find_one_and_update(self, query, update, **_kwargs):
            key = query["idempotency_key"]
            if key not in self.documents:
                self.documents[key] = update["$setOnInsert"]
                self.created_count += 1
            return self.documents[key].copy()

    expenses = Expenses()
    audit_events = []
    posting_calls = []
    response = {"expenses": [{"id": "expense-1"}], "total_amount": "25.00", "total": 1}
    monkeypatch.setattr(site_ops, "db", SimpleNamespace(
        settings=SimpleNamespace(find_one=_async_value({
            "expense_categories": ["Toll"], "payment_modes": ["Cash"],
        })),
        expenses=expenses,
    ))
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value(trip))
    monkeypatch.setattr(site_ops, "_ensure_site_trip_expense_posted", _async_record(posting_calls))
    monkeypatch.setattr(site_ops, "_site_trip_expense_response", _async_value(response))
    monkeypatch.setattr(site_ops, "_audit", _async_capture(audit_events))

    body = site_ops.SiteTripExpenseCreate(
        description="Toll plaza", category="Toll", amount=Decimal("25.00"),
        date="2026-09-27", payment_method="Cash", payee="Highway Toll",
        idempotency_key="toll-expense-1",
    )
    first = asyncio.run(site_ops.create_site_trip_expense(
        "site-1", "trip-1", body, {"role": "owner", "username": "owner"},
    ))
    second = asyncio.run(site_ops.create_site_trip_expense(
        "site-1", "trip-1", body, {"role": "owner", "username": "owner"},
    ))

    assert first == second == response
    assert expenses.created_count == 1
    assert len(posting_calls) == 2
    saved = expenses.documents["toll-expense-1"]
    assert saved["amount"] == 25.0
    assert saved["business_id"] == "business-1"
    assert saved["site_id"] == "site-1"
    assert saved["trip_id"] == "trip-1"
    assert saved["remarks"] == "Toll plaza"
    assert saved["mode"] == "Cash"
    assert audit_events[0]["event_id"] == audit_events[1]["event_id"]

    conflicting_body = body.model_copy(update={"amount": Decimal("30.00")})
    with pytest.raises(HTTPException) as error:
        asyncio.run(site_ops.create_site_trip_expense(
            "site-1", "trip-1", conflicting_body,
            {"role": "owner", "username": "owner"},
        ))
    assert error.value.status_code == 409
    assert expenses.created_count == 1


def test_site_trip_expense_uses_scoped_cashbook_and_driver_ledger_postings(monkeypatch):
    class ExistingRows:
        async def find_one(self, _query):
            return None

    cash_calls = []
    ledger_calls = []
    monkeypatch.setattr(
        site_ops, "db",
        SimpleNamespace(cashbook=ExistingRows(), ledger=ExistingRows()),
    )
    monkeypatch.setattr(site_ops.L, "cash", _async_capture_call(cash_calls))
    monkeypatch.setattr(site_ops.L, "post", _async_capture_call(ledger_calls))
    site = {"_id": "site-1", "business_id": "business-1"}
    expense = {
        "_id": "expense-1", "category": "Driver Advance", "driver_id": "driver-1",
        "amount": 12.5, "date": "2026-09-27", "mode": "Bank",
        "vehicle_no": "TRUCK-1", "driver_name": "Driver One",
        "trip_no": "ST-001", "remarks": "Advance",
    }

    asyncio.run(site_ops._post_site_trip_expense(site, expense))

    assert cash_calls == [(
        ("bank", "out", 12.5, "2026-09-27",
         "Driver Advance expense - TRUCK-1 (trip ST-001: Advance)",
         "site_trip_expense", "expense-1"),
        {"mode": "Bank", "site_id": "site-1", "business_id": "business-1"},
    )]
    assert ledger_calls == [(
        ("driver", "driver-1", "2026-09-27", "Advance given (expense entry)"),
        {
            "debit": 12.5, "ref_type": "site_trip_expense", "ref_id": "expense-1",
            "site_id": "site-1", "business_id": "business-1",
        },
    )]


def test_site_trip_expense_get_requires_finance_read(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value({"_id": "trip-1"}))
    monkeypatch.setattr(
        site_ops, "_site_trip_expense_response",
        _async_value({"expenses": [], "total_amount": "0.00", "total": 0}),
    )

    with pytest.raises(HTTPException) as error:
        asyncio.run(site_ops.list_site_trip_expenses(
            "site-1", "trip-1",
            {"role": "site_manager", "site_permissions": {"site-1": ["trips:read"]}},
        ))
    assert error.value.status_code == 403

    result = asyncio.run(site_ops.list_site_trip_expenses(
        "site-1", "trip-1", {"role": "owner"},
    ))
    assert result == {"expenses": [], "total_amount": "0.00", "total": 0}


def test_trip_expense_response_includes_tenant_configured_options(monkeypatch):
    class Settings:
        async def find_one(self, query):
            assert query == {"_id": "settings"}
            return {
                "expense_categories": ["Fuel", "Toll"],
                "payment_modes": ["Cash", "UPI"],
            }

    async def no_expenses(_site, _trip_id, _user=None):
        return [], Decimal("0.00"), 0

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(settings=Settings()))
    monkeypatch.setattr(site_ops, "_trip_expense_rows", no_expenses)

    result = asyncio.run(site_ops._site_trip_expense_response(
        {"_id": "site-1", "business_id": "business-1"}, "trip-1",
    ))

    assert result["expense_categories"] == ["Fuel", "Toll"]
    assert result["payment_modes"] == ["Cash", "UPI"]
    assert result["total_amount"] == "0.00"


def test_authorized_site_trip_expense_get_returns_finance_options(monkeypatch):
    response = {
        "expenses": [], "total_amount": "0.00", "total": 0,
        "expense_categories": ["Fuel", "Toll"],
        "payment_modes": ["Cash", "UPI"],
    }
    monkeypatch.setattr(
        site_ops, "_site_for_user",
        _async_value({"_id": "site-1", "business_id": "business-1"}),
    )
    monkeypatch.setattr(site_ops, "_trip", _async_value({"_id": "trip-1"}))
    monkeypatch.setattr(site_ops, "_site_trip_expense_response", _async_value(response))
    manager = {
        "role": "site_manager",
        "site_permissions": {"site-1": ["finance:read"]},
    }

    result = asyncio.run(site_ops.list_site_trip_expenses("site-1", "trip-1", manager))

    assert result["expense_categories"] == ["Fuel", "Toll"]
    assert result["payment_modes"] == ["Cash", "UPI"]


def _async_record(calls):
    async def record(*args):
        value = args[-1]
        calls.append(value.copy())
        value["posting_status"] = "posted"
        return value
    return record


def _async_capture(calls):
    async def capture(*args, **kwargs):
        calls.append({"args": args, **kwargs})
    return capture


def _async_capture_call(calls):
    async def capture(*args, **kwargs):
        calls.append((args, kwargs))
    return capture


def test_site_trip_expense_model_requires_idempotency_and_contract_fields():
    expense = site_ops.SiteTripExpenseCreate(
        description="Toll road",
        category="Toll",
        amount=Decimal("45.00"),
        date="2026-09-27",
        payment_method="UPI",
        payee="Toll booth",
        idempotency_key="expense-request-1",
    )

    assert expense.amount == Decimal("45.00")
    assert expense.payment_method == "UPI"
    with pytest.raises(Exception):
        site_ops.SiteTripExpenseCreate.model_validate({
            "description": "Toll road", "category": "Toll", "amount": "45.00",
            "date": "2026-09-27", "payment_method": "UPI",
        })

    legacy_names = site_ops.SiteTripExpenseCreate.model_validate({
        "remarks": "Toll road", "category": "Toll", "amount": Decimal("45.00"),
        "date": "2026-09-27", "mode": "UPI", "vendor": "Toll booth",
        "idempotency_key": "expense-request-2",
    })
    assert legacy_names.description == "Toll road"
    assert legacy_names.payment_method == "UPI"
    assert legacy_names.payee == "Toll booth"


def test_site_trip_expense_is_accounted_once_and_audited(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    trip = {
        "_id": "trip-1", "trip_ref": "ST-001", "truck_no": "TRK-1",
        "driver_name": "Assigned Driver", "driver_id": "driver-1",
    }
    user = {
        "role": "site_manager", "username": "manager", "name": "Site Manager",
        "site_permissions": {"site-1": ["finance:read", "finance:update"]},
    }

    class Cursor:
        def __init__(self, rows):
            self.rows = rows

        def sort(self, *_args):
            return self

        def to_list(self, limit):
            return asyncio.sleep(0, result=self.rows[:limit])

    class Expenses:
        def __init__(self):
            self.rows = {}

        async def find_one_and_update(self, query, update, **_kwargs):
            key = (query["business_id"], query["site_id"], query["trip_id"], query["idempotency_key"])
            if key not in self.rows:
                self.rows[key] = update["$setOnInsert"].copy()
            return self.rows[key].copy()

        async def find_one(self, query):
            return next((row.copy() for row in self.rows.values()
                         if all(row.get(key) == value for key, value in query.items())), None)

        async def update_one(self, query, update):
            row = next((row for row in self.rows.values()
                        if all(row.get(key) == value for key, value in query.items()
                               if key not in ("posting_status", "$or"))), None)
            if row is None:
                return SimpleNamespace(modified_count=0)
            if "posting_status" in query:
                expected = query["posting_status"]
                allowed = expected.get("$in", []) if isinstance(expected, dict) else [expected]
                if row.get("posting_status") not in allowed:
                    conditions = query.get("$or", [])
                    if not any(
                        row.get("posting_status") == condition.get("posting_status")
                        or (
                            isinstance(condition.get("posting_status"), dict)
                            and row.get("posting_status") in condition["posting_status"].get("$in", [])
                        )
                        for condition in conditions
                    ):
                        return SimpleNamespace(modified_count=0)
            elif "$or" in query and not any(
                row.get("posting_status") in condition.get("posting_status", {}).get("$in", [])
                for condition in query["$or"]
            ):
                return SimpleNamespace(modified_count=0)
            row.update(update.get("$set", {}))
            for key in update.get("$unset", {}):
                row.pop(key, None)
            return SimpleNamespace(modified_count=1)

        def find(self, query):
            rows = [row.copy() for row in self.rows.values()
                    if all(row.get(key) == value for key, value in query.items())]
            return Cursor(rows)

        def aggregate(self, pipeline):
            query = pipeline[0]["$match"]
            rows = [row for row in self.rows.values()
                    if all(row.get(key) == value for key, value in query.items())]
            return Cursor([{
                "_id": None, "total": sum((Decimal(str(row["amount"])) for row in rows), Decimal("0")),
                "count": len(rows),
            }] if rows else [])

    class Records:
        def __init__(self):
            self.rows = []

        async def find_one(self, query):
            return next((row for row in self.rows
                         if all(row.get(key) == value for key, value in query.items())), None)

    class Settings:
        async def find_one(self, _query):
            return {
                "expense_categories": ["Fuel", "Toll", "Driver Advance"],
                "payment_modes": ["Cash", "UPI", "Bank", "Cheque", "Other"],
            }

    expenses = Expenses()
    cashbook = Records()
    ledger = Records()
    audit_events = []
    database = SimpleNamespace(
        expenses=expenses, cashbook=cashbook, ledger=ledger, settings=Settings(),
    )
    monkeypatch.setattr(site_ops, "db", database)

    async def site_for_user(*_args, **_kwargs):
        return site

    async def trip_for_site(*_args, **_kwargs):
        return trip

    async def audit(*_args, event_id=None, **_kwargs):
        audit_events.append(event_id)

    cash_calls = []
    ledger_calls = []

    async def post_cash(account, direction, amount, dt, description, ref_type, ref_id, **kwargs):
        cash_calls.append((account, direction, amount, ref_type, ref_id, kwargs))
        cashbook.rows.append({
            "business_id": kwargs["business_id"], "site_id": kwargs["site_id"],
            "ref_type": ref_type, "ref_id": ref_id,
        })

    async def post_ledger(entity_type, entity_id, dt, description, **kwargs):
        ledger_calls.append((entity_type, entity_id, kwargs))
        ledger.rows.append({
            "business_id": kwargs["business_id"], "site_id": kwargs["site_id"],
            "ref_type": kwargs["ref_type"], "ref_id": kwargs["ref_id"],
            "entity_type": entity_type, "entity_id": entity_id,
        })

    monkeypatch.setattr(site_ops, "_site_for_user", site_for_user)
    monkeypatch.setattr(site_ops, "_trip", trip_for_site)
    monkeypatch.setattr(site_ops, "_audit", audit)
    monkeypatch.setattr(site_ops.L, "cash", post_cash)
    monkeypatch.setattr(site_ops.L, "post", post_ledger)
    ids = iter(["expense-1", "expense-2"])
    monkeypatch.setattr(site_ops, "new_id", lambda: next(ids))
    request = site_ops.SiteTripExpenseCreate(
        description="Advance for trip", category="Driver Advance", amount=Decimal("125.50"),
        date="2026-09-27", payment_method="Cash", payee="Assigned Driver",
        idempotency_key="trip-expense-request-1",
    )

    first = asyncio.run(site_ops.create_site_trip_expense("site-1", "trip-1", request, user))
    repeated = asyncio.run(site_ops.create_site_trip_expense("site-1", "trip-1", request, user))

    assert len(first["expenses"]) == 1
    assert first["total_amount"] == "125.50"
    assert repeated["total_amount"] == "125.50"
    assert "created_by_id" not in first["expenses"][0]
    stored_expense = next(iter(expenses.rows.values()))
    assert stored_expense["created_by_id"] == "manager"
    assert stored_expense["created_by_login"] == "manager"
    assert stored_expense["created_at"]
    assert first["expenses"][0]["driver_id"] == "driver-1"
    assert first["expenses"][0]["driver_name"] == "Assigned Driver"
    assert first["expenses"][0]["posting_status"] == "posted"
    assert cash_calls[0][:4] == ("cash", "out", 125.5, "site_trip_expense")
    assert len(cash_calls) == 1
    assert len(ledger_calls) == 1
    assert ledger_calls[0][:2] == ("driver", "driver-1")
    assert audit_events == ["site-trip-expense-created:expense-1"] * 2


def test_site_trip_expense_rejects_idempotency_key_reuse_for_different_details(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    stored = {
        "_id": "expense-1", "business_id": "business-1", "site_id": "site-1",
        "trip_id": "trip-1", "idempotency_key": "same-request-key",
        "request_fingerprint": "original", "posting_status": "posted",
    }

    class Expenses:
        async def find_one_and_update(self, *_args, **_kwargs):
            return stored

    class Settings:
        async def find_one(self, _query):
            return {
                "expense_categories": ["Toll"],
                "payment_modes": ["Cash"],
            }

    monkeypatch.setattr(
        site_ops, "db", SimpleNamespace(expenses=Expenses(), settings=Settings()),
    )
    monkeypatch.setattr(site_ops, "_site_for_user", _async_value(site))
    monkeypatch.setattr(site_ops, "_trip", _async_value({"_id": "trip-1"}))
    request = site_ops.SiteTripExpenseCreate(
        description="Different toll amount", category="Toll", amount=Decimal("10"),
        date="2026-09-27", payment_method="Cash", idempotency_key="same-request-key",
    )

    with pytest.raises(HTTPException) as error:
        asyncio.run(site_ops.create_site_trip_expense(
            "site-1", "trip-1", request, {"role": "owner", "username": "owner"},
        ))

    assert error.value.status_code == 409


def test_site_trip_expense_retry_recovers_cash_post_without_duplicate(monkeypatch):
    site = {"_id": "site-1", "business_id": "business-1"}
    expense = {
        "_id": "expense-1", "business_id": "business-1", "site_id": "site-1",
        "trip_id": "trip-1", "idempotency_key": "request-key",
        "posting_status": "failed", "category": "Toll", "driver_id": None,
    }
    cash_row = {
        "business_id": "business-1", "site_id": "site-1",
        "ref_type": "site_trip_expense", "ref_id": "expense-1",
    }

    class Expenses:
        async def update_one(self, query, update):
            expected = query.get("posting_status")
            allowed = expected.get("$in", []) if isinstance(expected, dict) else [expected]
            conditions = query.get("$or", [])
            matches_stale_claim = any(
                expense.get("posting_status") == condition.get("posting_status")
                or (
                    isinstance(condition.get("posting_status"), dict)
                    and expense.get("posting_status") in condition["posting_status"].get("$in", [])
                )
                for condition in conditions
            )
            if (expected is not None and expense.get("posting_status") not in allowed
                    and not matches_stale_claim):
                return SimpleNamespace(modified_count=0)
            expense.update(update["$set"])
            for key in update.get("$unset", {}):
                expense.pop(key, None)
            return SimpleNamespace(modified_count=1)

        async def find_one(self, _query):
            return expense

    class Cashbook:
        async def find_one(self, query):
            return cash_row if all(cash_row.get(key) == value for key, value in query.items()) else None

    class Ledger:
        async def find_one(self, _query):
            return None

    monkeypatch.setattr(
        site_ops, "db",
        SimpleNamespace(expenses=Expenses(), cashbook=Cashbook(), ledger=Ledger()),
    )

    async def duplicate_post_is_a_bug(*_args, **_kwargs):
        raise AssertionError("Existing cashbook posting must be reused")

    monkeypatch.setattr(site_ops.L, "cash", duplicate_post_is_a_bug)
    result = asyncio.run(site_ops._ensure_site_trip_expense_posted(site, expense))

    assert result["posting_status"] == "posted"
    assert expense["posting_status"] == "posted"


def test_receivables_breakdown_uses_scoped_lrs_and_posted_net_payments(monkeypatch):
    receiver_row = {
        "_id": "receiver one", "lr_count": 3, "parcels": 7,
        "reconciled_rent": site_ops.Decimal128(Decimal("100.00")),
        "posted_payments": site_ops.Decimal128(Decimal("40.00")),
        "collectible_outstanding": site_ops.Decimal128(Decimal("60.00")),
        "unpaid_lrs": 1,
        "unreconciled_bhada": site_ops.Decimal128(Decimal("25.00")),
        "unreconciled_lrs": 1, "unpriced_lrs": 1,
    }
    goods_row = {**receiver_row, "_id": "Food grains"}
    site_row = {**receiver_row, "_id": "site-1"}
    captured = {}

    class SiteLRs:
        def aggregate(self, pipeline):
            captured["pipeline"] = pipeline
            return SimpleNamespace(to_list=lambda _limit: asyncio.sleep(0, result=[{
                "by_receiver": [receiver_row], "receiver_count": [{"count": 1}],
                "by_goods": [goods_row], "goods_count": [{"count": 1}],
                "by_site": [site_row],
            }]))

    monkeypatch.setattr(site_ops, "db", SimpleNamespace(site_lrs=SiteLRs()))
    query = {
        "business_id": "business-1", "site_id": {"$in": ["site-1"]},
        "operating_date": {"$gte": "2026-09-01", "$lte": "2026-09-30"},
        "trip_id": "trip-1",
    }

    result = asyncio.run(site_ops._receivables_breakdown(query))

    assert result["collectible_outstanding"] == "60.00"
    assert result["posted_payments"] == "40.00"
    assert result["unreconciled_bhada"] == "25.00"
    assert result["unreconciled_lrs"] == 1
    assert result["unpriced_lrs"] == 1
    assert result["by_receiver"]["rows"][0]["label"] == "receiver one"
    assert result["by_goods"]["rows"][0]["label"] == "Food grains"
    assert result["by_site"]["site-1"]["collectible_outstanding"] == "60.00"
    pipeline = captured["pipeline"]
    assert pipeline[0] == {"$match": query}
    lookup = pipeline[1]["$lookup"]
    assert lookup["from"] == "site_payments"
    payment_match = lookup["pipeline"][0]["$match"]["$expr"]["$and"]
    assert {"$eq": ["$posting_status", "posted"]} in payment_match
    assert {"$eq": ["$trip_id", "$$trip_id"]} in payment_match
    assert pipeline[-1]["$facet"]["by_receiver"][-1] == {"$limit": 200}
    metric_stage = pipeline[2]["$set"]
    assert metric_stage["_collectible_outstanding"]["$cond"][0] == {
        "$and": [{"$eq": ["$reconciled", True]}, {"$ne": ["$rent", None]}],
    }
    assert result["by_receiver"]["truncated"] is False
