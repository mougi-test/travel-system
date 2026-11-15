"""Эрэлт таамаглах загвар (demand_model.joblib) ачаалах ба ашиглах."""

import logging
import warnings
from pathlib import Path

import joblib
import pandas as pd

from app.config import settings

log = logging.getLogger("uvicorn.error")

BASE_DIR = Path(__file__).resolve().parent.parent  # travel-backend/

# Colab-д сургахдаа ашигласан баганын нэр, дараалал — яг ижил байх ёстой
FEATURES = ["price_per_day", "guide_experience", "days"]

_model = None


def load_model() -> None:
    """Апп асахад нэг удаа ачаална. Файл байхгүй бол апп асна, таамаглал 503 буцаана."""
    global _model
    path = Path(settings.model_path)
    if not path.is_absolute():
        path = BASE_DIR / path
    if not path.exists():
        log.warning("Загварын файл олдсонгүй: %s", path)
        return
    with warnings.catch_warnings():
        # Colab (scikit-learn 1.6.1) ба энд суусан хувилбарын зөрүүний анхааруулга.
        # LinearRegression-д нөлөөгүй — tests/test_ml.py-д томьёогоор нь тулгаж шалгасан.
        warnings.filterwarnings("ignore", message=".*Trying to unpickle estimator.*")
        model = joblib.load(path)
    missing = set(FEATURES) - set(getattr(model, "feature_names_in_", FEATURES))
    if missing:
        raise RuntimeError(f"Загварын баганууд таарахгүй байна: {missing}")
    _model = model
    log.info("Эрэлтийн загвар ачааллаа: %s", path.name)


def is_ready() -> bool:
    return _model is not None


def predict_many(rows: list[dict]) -> list[float]:
    """rows: [{"price_per_day":…, "guide_experience":…, "days":…}, …]
    Буцаах: таамаг бүр сөрөг бол 0, 1 оронтой бутархай."""
    if not rows:
        return []
    df = pd.DataFrame(rows, columns=FEATURES).astype(float)
    return [round(max(0.0, float(v)), 1) for v in _model.predict(df)]


def predict_one(price_per_day: float, guide_experience: float, days: float) -> float:
    return predict_many(
        [{"price_per_day": price_per_day, "guide_experience": guide_experience, "days": days}]
    )[0]
