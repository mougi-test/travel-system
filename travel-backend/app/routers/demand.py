"""Эрэлт таамаглал: нэг утгаар таамаглах + хамгийн их захиалгатай аяллууд."""

from fastapi import APIRouter, Depends, HTTPException, Query

from app import ml
from app.db import get_conn
from app.security import require_admin

router = APIRouter(tags=["demand"], dependencies=[Depends(require_admin)])


def _require_model():
    if not ml.is_ready():
        raise HTTPException(status_code=503, detail="Таамаглалын загвар ачаалагдаагүй байна")


@router.get("/predict-demand")
def predict_demand(
    price_per_day: float = Query(ge=0, le=100_000_000, description="Өдрийн үнэ (₮)"),
    guide_experience: float = Query(ge=0, le=80, description="Хөтчийн туршлага (жил)"),
    days: int = Query(gt=0, le=365, description="Аяллын хоног"),
):
    _require_model()
    return {
        "price_per_day": price_per_day,
        "guide_experience": guide_experience,
        "days": days,
        "predicted_demand": ml.predict_one(price_per_day, guide_experience, days),
    }


@router.get("/demand/tours")
def demand_tours(limit: int = Query(10, ge=1, le=50)):
    """Хамгийн их захиалгатай аяллууд: бодит захиалгын тоо ба загварын таамаглал."""
    _require_model()
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT t.tour_id, t.name, t.destination, t.days, t.price,
                   round(t.price / t.days, 2)  AS price_per_day,
                   g.full_name                 AS guide_name,
                   g.experience_years          AS guide_experience,
                   count(b.booking_id)         AS actual_bookings
            FROM tours t
            JOIN bookings b    ON b.tour_id  = t.tour_id
            LEFT JOIN guides g ON g.guide_id = t.guide_id
            GROUP BY t.tour_id, g.guide_id
            ORDER BY actual_bookings DESC, t.tour_id
            LIMIT %s
            """,
            (limit,),
        ).fetchall()

    # Хөтөчгүй аялалд туршлага байхгүй тул таамаглахгүй (null)
    ready = [r for r in rows if r["guide_experience"] is not None and r["price_per_day"] is not None]
    preds = ml.predict_many([
        {"price_per_day": r["price_per_day"], "guide_experience": r["guide_experience"], "days": r["days"]}
        for r in ready
    ])
    by_id = {r["tour_id"]: p for r, p in zip(ready, preds)}
    return [{**r, "predicted_demand": by_id.get(r["tour_id"])} for r in rows]
