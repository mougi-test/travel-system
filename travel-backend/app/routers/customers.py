"""Үйлчлүүлэгчийн CRUD. Аялал (tours.py)-ын загвартай ижил бүтэцтэй."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import errors
from pydantic import BaseModel, EmailStr, StringConstraints

from app.db import get_conn
from app.security import require_admin

# Хувийн мэдээлэл (имэйл) тул бүх зам админ эрх шаардана
router = APIRouter(tags=["customers"], dependencies=[Depends(require_admin)])

CUSTOMER_SELECT = """
    SELECT c.customer_id, c.full_name, c.country, c.email,
           (SELECT count(*) FROM bookings b WHERE b.customer_id = c.customer_id) AS booking_count
    FROM customers c
"""


class CustomerIn(BaseModel):
    full_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    country: Annotated[str, StringConstraints(strip_whitespace=True, max_length=50)] | None = None
    email: Annotated[EmailStr, StringConstraints(max_length=100)] | None = None


def _fetch(conn, customer_id: int) -> dict:
    row = conn.execute(CUSTOMER_SELECT + " WHERE c.customer_id = %s", (customer_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Үйлчлүүлэгч олдсонгүй")
    return row


@router.get("/customers")
def list_customers():
    """Бүх үйлчлүүлэгч — шинэ нэмэгдсэн нь хамгийн дээр."""
    with get_conn() as conn:
        return conn.execute(CUSTOMER_SELECT + " ORDER BY c.customer_id DESC").fetchall()


@router.post("/customers", status_code=201)
def create_customer(body: CustomerIn):
    with get_conn() as conn:
        new_id = conn.execute(
            """
            INSERT INTO customers (full_name, country, email)
            VALUES (%(full_name)s, %(country)s, %(email)s)
            RETURNING customer_id
            """,
            body.model_dump(),
        ).fetchone()["customer_id"]
        return _fetch(conn, new_id)


@router.put("/customers/{customer_id}")
def update_customer(customer_id: int, body: CustomerIn):
    with get_conn() as conn:
        updated = conn.execute(
            """
            UPDATE customers
            SET full_name = %(full_name)s, country = %(country)s, email = %(email)s
            WHERE customer_id = %(customer_id)s
            RETURNING customer_id
            """,
            {**body.model_dump(), "customer_id": customer_id},
        ).fetchone()
        if updated is None:
            raise HTTPException(status_code=404, detail="Үйлчлүүлэгч олдсонгүй")
        return _fetch(conn, customer_id)


@router.delete("/customers/{customer_id}", status_code=204)
def delete_customer(customer_id: int):
    with get_conn() as conn:
        customer = _fetch(conn, customer_id)
        if customer["booking_count"] > 0:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Энэ үйлчлүүлэгч {customer['booking_count']} захиалгатай тул устгах боломжгүй. "
                    "Захиалгын түүх алдагдахаас сэргийлж хадгалж байна."
                ),
            )
        try:
            conn.execute("DELETE FROM customers WHERE customer_id = %s", (customer_id,))
        except errors.ForeignKeyViolation:
            # Шалгасны дараа хэн нэгэн захиалга нэмсэн тохиолдол
            raise HTTPException(status_code=409, detail="Энэ үйлчлүүлэгч захиалгатай тул устгах боломжгүй.")
    return Response(status_code=204)
