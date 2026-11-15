from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

from app.config import settings
from app.db import get_conn, pool
from app import ml
from app.routers import bookings, customers, demand, guides, tours
from app.security import create_access_token, require_admin, verify_password


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open(wait=False)  # Сан унтарсан байсан ч апп асна; /health үүнийг мэдээлнэ
    ml.load_model()
    yield
    pool.close()


app = FastAPI(title="Travel API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(tours.router)
app.include_router(bookings.router)
app.include_router(customers.router)
app.include_router(guides.router)
app.include_router(demand.router)


@app.get("/health")
def health():
    try:
        with pool.connection(timeout=3) as conn:
            conn.execute("SELECT 1")
    except Exception:
        raise HTTPException(status_code=503, detail={"status": "error", "database": "unreachable"})
    return {"status": "ok", "database": "ok"}


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)  # bcrypt 72 байтаас урт уншдаггүй


@app.post("/login")
def login(body: LoginRequest):
    with get_conn() as conn:
        admin = conn.execute(
            "SELECT admin_id, email, password_hash FROM admins WHERE lower(email) = lower(%s)",
            (body.email,),
        ).fetchone()

    # Имэйл буруу, нууц үг буруу — хоёуланд нь ижил хариу (аль нь буруу гэдгийг хэлэхгүй)
    if not verify_password(body.password, admin["password_hash"] if admin else None):
        raise HTTPException(
            status_code=401,
            detail="Имэйл эсвэл нууц үг буруу байна",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {
        "access_token": create_access_token(admin["admin_id"], admin["email"]),
        "token_type": "bearer",
        "expires_in": settings.jwt_expire_minutes * 60,
    }


@app.get("/admin/stats")
def admin_stats(_admin: dict = Depends(require_admin)):
    """Хяналтын самбарын тоонууд + сүүлийн 5 батлагдаагүй захиалга."""
    with get_conn() as conn:
        counts = conn.execute(
            """
            SELECT
                (SELECT count(*) FROM tours)                             AS tours,
                (SELECT count(*) FROM bookings)                          AS bookings,
                (SELECT count(*) FROM bookings WHERE status = 'pending') AS pending_bookings,
                (SELECT coalesce(sum(amount), 0) FROM payments)          AS revenue
            """
        ).fetchone()
        latest_pending = conn.execute(
            """
            SELECT b.booking_id, b.booked_at, b.people,
                   c.full_name AS customer_name, t.name AS tour_name
            FROM bookings b
            JOIN customers c ON c.customer_id = b.customer_id
            JOIN tours t     ON t.tour_id     = b.tour_id
            WHERE b.status = 'pending'
            ORDER BY b.booked_at DESC, b.booking_id DESC
            LIMIT 5
            """
        ).fetchall()

    return {**counts, "latest_pending": latest_pending}
