"""Захиалгын CRUD + төлөв солих (PATCH /bookings/{id}/status)."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from psycopg import errors
from pydantic import BaseModel, Field

from app.db import get_conn
from app.security import require_admin

# Үйлчлүүлэгчийн нэр, төлбөр агуулдаг тул бүх зам админ эрх шаардана
router = APIRouter(tags=["bookings"], dependencies=[Depends(require_admin)])

Status = Literal["pending", "confirmed", "cancelled"]

BOOKING_SELECT = """
    SELECT b.booking_id, b.tour_id, t.name AS tour_name,
           b.customer_id, c.full_name AS customer_name,
           b.people, b.booked_at, b.status,
           (SELECT coalesce(sum(p.amount), 0) FROM payments p WHERE p.booking_id = b.booking_id) AS paid_amount
    FROM bookings b
    JOIN tours t     ON t.tour_id     = b.tour_id
    JOIN customers c ON c.customer_id = b.customer_id
"""


class BookingIn(BaseModel):
    tour_id: int
    customer_id: int
    people: int = Field(gt=0, le=100)
    booked_at: date | None = None  # хоосон бол өнөөдөр
    status: Status = "pending"


class StatusIn(BaseModel):
    status: Status


def _fetch(conn, booking_id: int) -> dict:
    row = conn.execute(BOOKING_SELECT + " WHERE b.booking_id = %s", (booking_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Захиалга олдсонгүй")
    return row


def _bad_ref() -> HTTPException:
    return HTTPException(status_code=400, detail="Сонгосон аялал эсвэл үйлчлүүлэгч олдсонгүй")


@router.get("/bookings")
def list_bookings(
    status: Status | None = None,
    limit: int = Query(50, ge=1, le=500),
):
    """Сүүлийн захиалгууд (шинэ нь дээрээ). ?status=pending гэвэл зөвхөн тэр төлөвтэй."""
    where, params = "", []
    if status:
        where, params = " WHERE b.status = %s", [status]
    with get_conn() as conn:
        return conn.execute(
            BOOKING_SELECT + where + " ORDER BY b.booking_id DESC LIMIT %s", (*params, limit)
        ).fetchall()


@router.post("/bookings", status_code=201)
def create_booking(body: BookingIn):
    with get_conn() as conn:
        try:
            new_id = conn.execute(
                """
                INSERT INTO bookings (tour_id, customer_id, people, booked_at, status)
                VALUES (%(tour_id)s, %(customer_id)s, %(people)s,
                        coalesce(%(booked_at)s, CURRENT_DATE), %(status)s)
                RETURNING booking_id
                """,
                body.model_dump(),
            ).fetchone()["booking_id"]
        except errors.ForeignKeyViolation:
            raise _bad_ref()
        return _fetch(conn, new_id)


@router.put("/bookings/{booking_id}")
def update_booking(booking_id: int, body: BookingIn):
    with get_conn() as conn:
        try:
            updated = conn.execute(
                """
                UPDATE bookings
                SET tour_id = %(tour_id)s, customer_id = %(customer_id)s, people = %(people)s,
                    booked_at = coalesce(%(booked_at)s, booked_at), status = %(status)s
                WHERE booking_id = %(booking_id)s
                RETURNING booking_id
                """,
                {**body.model_dump(), "booking_id": booking_id},
            ).fetchone()
        except errors.ForeignKeyViolation:
            raise _bad_ref()
        if updated is None:
            raise HTTPException(status_code=404, detail="Захиалга олдсонгүй")
        return _fetch(conn, booking_id)


@router.patch("/bookings/{booking_id}/status")
def set_booking_status(booking_id: int, body: StatusIn):
    """Зөвхөн төлөв солих: pending → confirmed / cancelled."""
    with get_conn() as conn:
        updated = conn.execute(
            "UPDATE bookings SET status = %s WHERE booking_id = %s RETURNING booking_id",
            (body.status, booking_id),
        ).fetchone()
        if updated is None:
            raise HTTPException(status_code=404, detail="Захиалга олдсонгүй")
        return _fetch(conn, booking_id)


@router.delete("/bookings/{booking_id}", status_code=204)
def delete_booking(booking_id: int):
    with get_conn() as conn:
        booking = _fetch(conn, booking_id)
        if booking["paid_amount"] > 0:
            raise HTTPException(
                status_code=409,
                detail="Энэ захиалгад төлбөр бүртгэлтэй тул устгах боломжгүй. Оронд нь «цуцалсан» төлөвт оруулна уу.",
            )
        try:
            conn.execute("DELETE FROM bookings WHERE booking_id = %s", (booking_id,))
        except errors.ForeignKeyViolation:
            raise HTTPException(status_code=409, detail="Энэ захиалгад төлбөр бүртгэлтэй тул устгах боломжгүй.")
    return Response(status_code=204)
