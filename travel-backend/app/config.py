"""Бүх тохиргоог .env файлаас уншина. Кодонд хаяг, нууц үг бичихгүй."""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} утга .env файлд алга. .env.example-ийг харна уу.")
    return value


@dataclass(frozen=True)
class Settings:
    database_url: str
    allowed_origins: list[str]
    model_path: str  # Prompt 6-д загвар ачаалахад ашиглана
    jwt_secret: str
    jwt_expire_minutes: int


settings = Settings(
    database_url=_required("DATABASE_URL"),
    allowed_origins=[o.strip() for o in _required("ALLOWED_ORIGINS").split(",") if o.strip()],
    model_path=_required("MODEL_PATH"),
    jwt_secret=_required("JWT_SECRET"),
    jwt_expire_minutes=int(os.getenv("JWT_EXPIRE_MINUTES", "60")),
)

if len(settings.jwt_secret) < 32 or settings.jwt_secret == "CHANGE_ME":
    raise RuntimeError("JWT_SECRET хэт богино эсвэл солигдоогүй байна (32+ тэмдэгт).")
