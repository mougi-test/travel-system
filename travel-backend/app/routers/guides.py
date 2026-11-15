"""Хөтчийн CRUD. Аялал (tours.py)-ын загвартай ижил бүтэцтэй."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import errors
from pydantic import BaseModel, Field, StringConstraints

from app.db import get_conn
from app.security import require_admin

router = APIRouter(tags=["guides"], dependencies=[Depends(require_admin)])

GUIDE_SELECT = """
    SELECT g.guide_id, g.full_name, g.language, g.experience_years,
           (SELECT count(*) FROM tours t WHERE t.guide_id = g.guide_id) AS tour_count
    FROM guides g
"""


class GuideIn(BaseModel):
    full_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    language: Annotated[str, StringConstraints(strip_whitespace=True, max_length=30)] | None = None
    experience_years: int | None = Field(default=None, ge=0, le=80)


def _fetch(conn, guide_id: int) -> dict:
    row = conn.execute(GUIDE_SELECT + " WHERE g.guide_id = %s", (guide_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Хөтөч олдсонгүй")
    return row


@router.get("/guides")
def list_guides():
    """Бүх хөтөч — шинэ нэмэгдсэн нь хамгийн дээр. Аяллын маягтын «Хөтөч» сонголтод ч ашиглана."""
    with get_conn() as conn:
        return conn.execute(GUIDE_SELECT + " ORDER BY g.guide_id DESC").fetchall()


@router.post("/guides", status_code=201)
def create_guide(body: GuideIn):
    with get_conn() as conn:
        new_id = conn.execute(
            """
            INSERT INTO guides (full_name, language, experience_years)
            VALUES (%(full_name)s, %(language)s, %(experience_years)s)
            RETURNING guide_id
            """,
            body.model_dump(),
        ).fetchone()["guide_id"]
        return _fetch(conn, new_id)


@router.put("/guides/{guide_id}")
def update_guide(guide_id: int, body: GuideIn):
    with get_conn() as conn:
        updated = conn.execute(
            """
            UPDATE guides
            SET full_name = %(full_name)s, language = %(language)s,
                experience_years = %(experience_years)s
            WHERE guide_id = %(guide_id)s
            RETURNING guide_id
            """,
            {**body.model_dump(), "guide_id": guide_id},
        ).fetchone()
        if updated is None:
            raise HTTPException(status_code=404, detail="Хөтөч олдсонгүй")
        return _fetch(conn, guide_id)


@router.delete("/guides/{guide_id}", status_code=204)
def delete_guide(guide_id: int):
    with get_conn() as conn:
        guide = _fetch(conn, guide_id)
        if guide["tour_count"] > 0:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Энэ хөтөч {guide['tour_count']} аялал хариуцаж байгаа тул устгах боломжгүй. "
                    "Эхлээд тэдгээр аялалд өөр хөтөч онооно уу."
                ),
            )
        try:
            conn.execute("DELETE FROM guides WHERE guide_id = %s", (guide_id,))
        except errors.ForeignKeyViolation:
            raise HTTPException(status_code=409, detail="Энэ хөтөч аялал хариуцаж байгаа тул устгах боломжгүй.")
    return Response(status_code=204)
