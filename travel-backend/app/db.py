"""PostgreSQL холболтын сан (pool). Мөр бүр dict хэлбэрээр ирнэ."""

from contextlib import contextmanager

import psycopg
from fastapi import HTTPException
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.config import settings

pool = ConnectionPool(
    conninfo=settings.database_url,
    kwargs={"row_factory": dict_row},
    min_size=1,
    max_size=10,
    open=False,  # Апп асахад (lifespan) нээнэ
)


@contextmanager
def get_conn():
    """Сангийн холболт авна. Алдаагүй бол автоматаар commit, алдаа гарвал rollback.

    Санд холбогдож чадахгүй үед 503 буцаана. Бусад сангийн алдааг (жишээ нь
    ForeignKeyViolation) дуудсан код өөрөө барьж, ойлгомжтой мессеж өгнө.
    """
    try:
        with pool.connection(timeout=5) as conn:
            yield conn
    except (psycopg.OperationalError, TimeoutError):
        raise HTTPException(status_code=503, detail="Өгөгдлийн сантай холбогдож чадсангүй")
