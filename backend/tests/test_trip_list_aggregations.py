import asyncio
import inspect
from types import SimpleNamespace

import server
from fastapi.params import Query as QueryParameter


class _AsyncRows:
    def __init__(self, rows):
        self._rows = iter(rows)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._rows)
        except StopIteration:
            raise StopAsyncIteration


class _TripCursor:
    def __init__(self, rows):
        self.rows = rows
        self.limit = None
        self.sort_options = None

    def sort(self, *args):
        self.sort_options = args
        return self

    async def to_list(self, limit):
        self.limit = limit
        return self.rows[:limit]


class _Trips:
    def __init__(self, rows):
        self.cursor = _TripCursor(rows)
        self.query = None

    def find(self, query):
        self.query = query
        return self.cursor


class _AggregateCollection:
    def __init__(self, rows=()):
        self.rows = rows
        self.pipelines = []

    def aggregate(self, pipeline):
        self.pipelines.append(pipeline)
        return _AsyncRows(self.rows)


class _Database:
    def __init__(self, trips, lrs=None, expenses=None, fuel=None):
        self.trips = trips
        self.lrs = lrs or _AggregateCollection()
        self.expenses = expenses or _AggregateCollection()
        self.fuel = fuel or _AggregateCollection()

    def __getitem__(self, name):
        return getattr(self, name)


def test_list_trips_skips_all_aggregations_for_empty_page(monkeypatch):
    trips = _Trips([])
    lrs = _AggregateCollection()
    expenses = _AggregateCollection()
    fuel = _AggregateCollection()
    monkeypatch.setattr(server, "db", _Database(trips, lrs, expenses, fuel))

    result = asyncio.run(server.list_trips(limit=20, u=None))

    assert result == []
    assert lrs.pipelines == []
    assert expenses.pipelines == []
    assert fuel.pipelines == []


def test_list_trips_aggregates_only_returned_trip_ids_and_keeps_totals(monkeypatch):
    trips = _Trips([
        {"_id": "trip-1", "trip_amount": 50},
        {"_id": "trip-2", "trip_amount": 40},
    ])
    lrs = _AggregateCollection([{"_id": "trip-1", "n": 2, "f": 75.126}])
    expenses = _AggregateCollection([{"_id": "trip-1", "t": 10.25}])
    fuel = _AggregateCollection([{"_id": "trip-1", "t": 4.5}])
    monkeypatch.setattr(server, "db", _Database(trips, lrs, expenses, fuel))

    result = asyncio.run(server.list_trips(limit=2, u=None))

    expected_ids = ["trip-1", "trip-2"]
    for collection in (lrs, expenses, fuel):
        match = collection.pipelines[0][0]["$match"]
        assert match["trip_id"]["$in"] == expected_ids
        assert match["cancelled"] is False
    assert lrs.pipelines[0][0]["$match"] == {
        "cancelled": False, "trip_id": {"$in": expected_ids},
    }
    for collection in (expenses, fuel):
        assert collection.pipelines[0][0]["$match"]["trip_id"]["$nin"] == [None, ""]

    assert result == [
        {
            "id": "trip-1", "trip_amount": 50, "lr_count": 2,
            "earning": 75.13, "trip_cost": 14.75, "profit": 60.38,
        },
        {
            "id": "trip-2", "trip_amount": 40, "lr_count": 0,
            "earning": 40, "trip_cost": 0, "profit": 40,
        },
    ]


def test_list_trips_limit_is_bounded_without_changing_default():
    limit = inspect.signature(server.list_trips).parameters["limit"].default

    assert isinstance(limit, QueryParameter)
    assert limit.default == 300
    constraints = {type(item).__name__: item for item in limit.metadata}
    assert constraints["Ge"].ge == 1
    assert constraints["Le"].le == 500


def test_startup_indexes_trip_aggregation_keys(monkeypatch):
    class _IndexCollection:
        def __init__(self):
            self.indexes = []

        async def create_index(self, field, **options):
            self.indexes.append((field, options))

    class _IndexDatabase:
        def __init__(self):
            self.collections = {}

        def __getitem__(self, name):
            return self.collections.setdefault(name, _IndexCollection())

    database = _IndexDatabase()
    platform_database = SimpleNamespace(
        error_logs=_IndexCollection(),
        subscription_audit_events=_IndexCollection(),
    )

    async def _noop():
        return None

    monkeypatch.setattr(server, "db", database)
    monkeypatch.setattr(server, "platform_db", platform_database)
    monkeypatch.setattr(server, "seed_owner", _noop)
    monkeypatch.setattr(server, "seed_subscription_plans", _noop)
    monkeypatch.setattr(server, "get_settings", _noop)
    monkeypatch.setattr(server, "initialize_site_storage", _noop)

    asyncio.run(server.startup())

    for collection in ("lrs", "expenses", "fuel"):
        assert ("trip_id", {}) in database[collection].indexes
    assert ("expires_at", {
        "expireAfterSeconds": 0, "name": "error_logs_expiration",
    }) in platform_database.error_logs.indexes
