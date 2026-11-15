"""Аюулгүй байдлын шалгалт: өөрчлөлт хийдэг бүх зам токенгүй бол 401 буцаах ёстой.

Сантай холбогдохгүйгээр ажиллана — require_admin нь сан руу орохоос ӨМНӨ татгалздаг.
Ажиллуулах: .venv/bin/python -m pytest -q
"""

from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.security import require_admin

client = TestClient(app)  # lifespan ажиллуулахгүй (with биш) — сан шаардлагагүй

# Нэвтрэхгүйгээр дуудаж болох цорын ганц өөрчлөлт хийдэг зам
PUBLIC_WRITE = {("POST", "/login")}

# Заавал хамгаалагдсан байх ёстой GET замууд
PROTECTED_GET = {"/admin/stats", "/customers", "/guides", "/bookings", "/predict-demand", "/demand/tours"}


def _routes():
    for r in app.routes:
        for m in getattr(r, "methods", ()):
            if m not in ("HEAD", "OPTIONS"):
                yield m, r.path, r


def _has_require_admin(route) -> bool:
    return any(d.call is require_admin for d in route.dependant.dependencies)


def test_every_write_route_uses_require_admin():
    missing = [
        f"{m} {p}" for m, p, r in _routes()
        if m != "GET" and (m, p) not in PUBLIC_WRITE and not _has_require_admin(r)
    ]
    assert not missing, f"require_admin-гүй зам: {missing}"


def test_sensitive_get_routes_use_require_admin():
    missing = [p for m, p, r in _routes() if m == "GET" and p in PROTECTED_GET and not _has_require_admin(r)]
    assert not missing, f"require_admin-гүй зам: {missing}"


def test_expected_routes_exist():
    have = {(m, p) for m, p, _ in _routes()}
    for res in ("tours", "bookings", "customers", "guides"):
        assert ("POST", f"/{res}") in have
        assert ("PUT", f"/{res}/{{{res[:-1]}_id}}") in have
        assert ("DELETE", f"/{res}/{{{res[:-1]}_id}}") in have
    assert ("PATCH", "/bookings/{booking_id}/status") in have
    assert ("GET", "/admin/stats") in have


def _token(**overrides):
    now = datetime.now(timezone.utc)
    payload = {"sub": "1", "email": "a@b.mn", "role": "admin", "iat": now, "exp": now + timedelta(minutes=5)}
    payload.update(overrides)
    payload = {k: v for k, v in payload.items() if v is not None}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


BAD_HEADERS = {
    "толгойгүй": {},
    "Bearer-гүй": {"Authorization": _token()},
    "Basic төрөл": {"Authorization": "Basic YWRtaW46YWRtaW4="},
    "хог токен": {"Authorization": "Bearer abc.def.ghi"},
    "хуурамч түлхүүр": {"Authorization": "Bearer " + jwt.encode(
        {"sub": "1", "role": "admin", "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
        "x" * 40, algorithm="HS256")},
    "хугацаа дууссан": {"Authorization": "Bearer " + _token(exp=datetime.now(timezone.utc) - timedelta(minutes=1))},
    "exp-гүй": {"Authorization": "Bearer " + _token(exp=None)},
    "admin биш": {"Authorization": "Bearer " + _token(role="user")},
    "alg=none": {"Authorization": "Bearer " + jwt.encode(
        {"sub": "1", "role": "admin", "exp": 9999999999}, None, algorithm="none")},
}

CALLS = [
    ("POST", "/tours"), ("PUT", "/tours/1"), ("DELETE", "/tours/1"),
    ("POST", "/bookings"), ("PUT", "/bookings/1"), ("DELETE", "/bookings/1"),
    ("PATCH", "/bookings/1/status"),
    ("POST", "/customers"), ("PUT", "/customers/1"), ("DELETE", "/customers/1"),
    ("POST", "/guides"), ("PUT", "/guides/1"), ("DELETE", "/guides/1"),
    ("GET", "/admin/stats"), ("GET", "/customers"), ("GET", "/bookings"),
]


@pytest.mark.parametrize("method,path", CALLS)
@pytest.mark.parametrize("case", BAD_HEADERS)
def test_bad_token_gets_401(method, path, case):
    res = client.request(method, path, headers=BAD_HEADERS[case], json={})
    assert res.status_code == 401, f"{case}: {method} {path} → {res.status_code}"
    assert res.headers.get("www-authenticate") == "Bearer"
