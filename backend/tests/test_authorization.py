import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import auth


def test_password_hash_supports_long_inputs_and_legacy_bcrypt_hashes():
    password = "long-manager-password-" * 20
    hashed = auth.hash_manager_pw(password)

    assert hashed.startswith("bcrypt-sha256$")
    assert auth.verify_pw(password, hashed)
    assert not auth.verify_pw(f"{password}wrong", hashed)

    legacy_hash = auth.bcrypt.hashpw(b"legacy-password", auth.bcrypt.gensalt()).decode()
    assert auth.verify_pw("legacy-password", legacy_hash)


def test_seed_owner_normalizes_configured_usernames(monkeypatch):
    inserted_users = []
    tenant_updates = []

    class Users:
        async def find_one(self, query):
            return next(
                (user for user in inserted_users if user["_id"] == query["_id"]),
                None,
            )

        async def insert_one(self, user):
            inserted_users.append(user)

    class Tenants:
        async def find_one(self, _query):
            return {"_id": "naidu"}

        async def update_one(self, query, update):
            tenant_updates.append((query, update))

    monkeypatch.setattr(auth, "platform_db", SimpleNamespace(
        users=Users(), tenants=Tenants(),
    ))
    monkeypatch.setattr(auth, "hash_pw", lambda _password: "hashed")
    monkeypatch.setenv("OWNER_USERNAME", " PNaidu ")
    monkeypatch.setenv("OWNER_PASSWORD", "configured-password")
    monkeypatch.setenv("PLATFORM_USERNAME", "SuperAdmin")
    monkeypatch.setenv("PLATFORM_PASSWORD", "configured-platform-password")

    asyncio.run(auth.seed_owner())

    assert [user["_id"] for user in inserted_users] == [
        "superadmin", "pnaidu", "priyanshu",
    ]
    assert tenant_updates == [
        ({"_id": "naidu"}, {"$set": {"owner_username": "pnaidu"}}),
    ]


def test_upsert_user_rejects_case_normalized_username_conflict(monkeypatch):
    class Users:
        async def find_one(self, _query):
            return {"_id": "pnaidu", "role": "owner", "tenant_id": "different-tenant"}

    monkeypatch.setattr(auth, "platform_db", SimpleNamespace(users=Users()))

    with pytest.raises(RuntimeError, match="conflicts with an existing account"):
        asyncio.run(auth.upsert_user("PNaidu", "Owner", "password", "owner", "naidu"))


def test_business_api_requires_owner(monkeypatch):
    async def resolve_owner(_credentials):
        return {"role": "owner", "username": "owner"}

    monkeypatch.setattr(auth, "_resolve_principal", resolve_owner)

    assert asyncio.run(auth.current_user(SimpleNamespace()))["role"] == "owner"


@pytest.mark.parametrize("role", ["site_manager", "superadmin", "unknown"])
def test_business_api_rejects_non_owners(monkeypatch, role):
    async def resolve_user(_credentials):
        return {"role": role, "username": role}

    monkeypatch.setattr(auth, "_resolve_principal", resolve_user)

    with pytest.raises(HTTPException) as error:
        asyncio.run(auth.current_user(SimpleNamespace()))

    assert error.value.status_code == 403
    assert error.value.detail == "Business owner access only"


def test_site_operations_can_resolve_site_manager(monkeypatch):
    async def resolve_manager(_credentials):
        return {"role": "site_manager", "username": "manager"}

    monkeypatch.setattr(auth, "_resolve_principal", resolve_manager)

    assert asyncio.run(auth.site_user(SimpleNamespace()))["role"] == "site_manager"


def test_platform_guard_accepts_superadmin_without_business_access(monkeypatch):
    async def resolve_superadmin(_credentials):
        return {"role": "superadmin", "username": "platform"}

    monkeypatch.setattr(auth, "_resolve_principal", resolve_superadmin)

    assert asyncio.run(auth.require_super(SimpleNamespace()))["role"] == "superadmin"


def test_platform_guard_rejects_business_owner(monkeypatch):
    async def resolve_owner(_credentials):
        return {"role": "owner", "username": "owner"}

    monkeypatch.setattr(auth, "_resolve_principal", resolve_owner)

    with pytest.raises(HTTPException) as error:
        asyncio.run(auth.require_super(SimpleNamespace()))

    assert error.value.status_code == 403


def test_platform_support_token_resolves_to_full_tenant_scoped_owner(monkeypatch):
    token, session_id, _expires_at = auth.make_support_token("platform", "tenant-1")
    tenant_switches = []

    class Users:
        async def find_one(self, query):
            assert query == {"_id": "platform"}
            return {"_id": "platform", "role": "superadmin", "active": True}

    class Sessions:
        async def find_one(self, query):
            assert query == {
                "_id": session_id, "username": "platform",
                "tenant_id": "tenant-1", "active": True,
            }
            return {"_id": session_id}

    class Tenants:
        async def find_one(self, query):
            assert query == {"_id": "tenant-1"}
            return {"_id": "tenant-1", "name": "Customer One"}

    monkeypatch.setattr(auth, "platform_db", SimpleNamespace(
        users=Users(), platform_support_sessions=Sessions(), tenants=Tenants(),
    ))
    monkeypatch.setattr(auth, "set_tenant", tenant_switches.append)

    user = asyncio.run(auth._resolve_principal(SimpleNamespace(credentials=token)))

    assert tenant_switches == ["tenant-1"]
    assert user["role"] == "owner"
    assert user["tenant_id"] == "tenant-1"
    assert user["platform_support"] is True
    assert user["platform_actor"] == "platform"
    assert user["actor_role"] == "platform_support"
    assert all(user["admin_access"].values())
    assert user["tenant_access"] == user["admin_access"]


def test_platform_support_token_is_rejected_after_session_revocation(monkeypatch):
    token, _session_id, _expires_at = auth.make_support_token("platform", "tenant-1")

    class Users:
        async def find_one(self, _query):
            return {"_id": "platform", "role": "superadmin", "active": True}

    class Sessions:
        async def find_one(self, _query):
            return None

    monkeypatch.setattr(auth, "platform_db", SimpleNamespace(
        users=Users(), platform_support_sessions=Sessions(),
    ))

    with pytest.raises(HTTPException) as error:
        asyncio.run(auth._resolve_principal(SimpleNamespace(credentials=token)))

    assert error.value.status_code == 401
    assert "session has ended" in error.value.detail
