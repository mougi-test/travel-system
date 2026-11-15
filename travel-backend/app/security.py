"""Нууц үг шалгах (bcrypt), токен үүсгэх (JWT), админ эрх шалгах (require_admin)."""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings

ALGORITHM = "HS256"

# Имэйл олдоогүй үед ч bcrypt шалгалт хийж, хариуны хугацаагаар
# "ийм имэйл бий эсэх"-ийг таахаас сэргийлнэ.
_DUMMY_HASH = bcrypt.hashpw(b"dummy-password", bcrypt.gensalt())


def verify_password(password: str, password_hash: str | None) -> bool:
    hashed = password_hash.encode() if password_hash else _DUMMY_HASH
    try:
        ok = bcrypt.checkpw(password.encode(), hashed)
    except ValueError:  # Санд эвдэрсэн hash байвал
        return False
    return ok and password_hash is not None


def create_access_token(admin_id: int, email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(admin_id),
        "email": email,
        "role": "admin",
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


# ---------- require_admin: өөрчлөлт хийдэг бүх замд Depends-ээр холбоно ----------

_bearer = HTTPBearer(auto_error=False)  # Толгой байхгүй бол 403 биш, бид өөрсдөө 401 буцаана


def require_admin(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """`Authorization: Bearer <токен>` толгойд хүчинтэй админ токен байхгүй бол 401.

    Шалгадаг зүйл:
      - толгой байгаа, "Bearer" төрөлтэй
      - манай JWT_SECRET-ээр гарын үсэг зурсан (хуурамч биш)
      - зөвхөн HS256 алгоритм ("none" гэх мэт заль хүлээж авахгүй)
      - exp, sub заавал байх, хугацаа дуусаагүй
      - role == "admin"
    """
    unauthorized = HTTPException(
        status_code=401,
        detail="Нэвтрэх шаардлагатай",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if creds is None or creds.scheme.lower() != "bearer":
        raise unauthorized
    try:
        payload = jwt.decode(
            creds.credentials,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWTError:
        raise unauthorized
    if payload.get("role") != "admin":
        raise unauthorized
    return payload
