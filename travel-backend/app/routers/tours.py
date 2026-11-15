"""Аяллын CRUD: жагсаалт, нэмэх, засах, устгах."""

from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import errors
from pydantic import BaseModel, Field, StringConstraints

from app.db import get_conn
from app.security import require_admin

router = APIRouter(tags=["tours"])

# Аялал бүрийг хөтөчийн нэр, захиалгын тоотой нь хамт авах SQL
TOUR_SELECT = """
    SELECT t.tour_id, t.name, t.destination, t.days, t.price, t.start_date,
           t.guide_id, g.full_name AS guide_name,
           (SELECT count(*) FROM bookings b WHERE b.tour_id = t.tour_id) AS booking_count
    FROM tours t
    LEFT JOIN guides g ON g.guide_id = t.guide_id
"""


class TourIn(BaseModel):
    """Нэмэх/засах үед ирэх өгөгдөл. Сангийн хязгаартай ижил шалгалт."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    destination: Annotated[str, StringConstraints(strip_whitespace=True, max_length=50)] | None = None
    days: int = Field(gt=0, le=365)
    price: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    start_date: date | None = None
    guide_id: int | None = None


def _fetch_tour(conn, tour_id: int) -> dict:
    row = conn.execute(TOUR_SELECT + " WHERE t.tour_id = %s", (tour_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Аялал олдсонгүй")
    return row


def _bad_guide() -> HTTPException:
    return HTTPException(status_code=400, detail="Сонгосон хөтөч олдсонгүй")


@router.get("/tours")
def list_tours():
    """Бүх аялал — шинэ нэмэгдсэн нь хамгийн дээр."""
    with get_conn() as conn:
        return conn.execute(TOUR_SELECT + " ORDER BY t.tour_id DESC").fetchall()


@router.post("/tours", status_code=201)
def create_tour(body: TourIn, _admin: dict = Depends(require_admin)):
    with get_conn() as conn:
        try:
            new_id = conn.execute(
                """
                INSERT INTO tours (name, destination, days, price, start_date, guide_id)
                VALUES (%(name)s, %(destination)s, %(days)s, %(price)s, %(start_date)s, %(guide_id)s)
                RETURNING tour_id
                """,
                body.model_dump(),
            ).fetchone()["tour_id"]
        except errors.ForeignKeyViolation:
            raise _bad_guide()
        return _fetch_tour(conn, new_id)


@router.put("/tours/{tour_id}")
def update_tour(tour_id: int, body: TourIn, _admin: dict = Depends(require_admin)):
    with get_conn() as conn:
        try:
            updated = conn.execute(
                """
                UPDATE tours
                SET name = %(name)s, destination = %(destination)s, days = %(days)s,
                    price = %(price)s, start_date = %(start_date)s, guide_id = %(guide_id)s
                WHERE tour_id = %(tour_id)s
                RETURNING tour_id
                """,
                {**body.model_dump(), "tour_id": tour_id},
            ).fetchone()
        except errors.ForeignKeyViolation:
            raise _bad_guide()
        if updated is None:
            raise HTTPException(status_code=404, detail="Аялал олдсонгүй")
        return _fetch_tour(conn, tour_id)


@router.delete("/tours/{tour_id}", status_code=204)
def delete_tour(tour_id: int, _admin: dict = Depends(require_admin)):
    with get_conn() as conn:
        tour = _fetch_tour(conn, tour_id)
        if tour["booking_count"] > 0:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Энэ аялалд {tour['booking_count']} захиалга бүртгэлтэй тул устгах боломжгүй. "
                    "Эхлээд захиалгуудыг нь өөр аялал руу шилжүүлэх эсвэл цуцлана уу."
                ),
            )
        try:
            conn.execute("DELETE FROM tours WHERE tour_id = %s", (tour_id,))
        except errors.ForeignKeyViolation:
            # Шалгасны дараа хэн нэгэн захиалга нэмсэн тохиолдол
            raise HTTPException(status_code=409, detail="Энэ аялалд захиалга байгаа тул устгах боломжгүй.")
    return Response(status_code=204)

