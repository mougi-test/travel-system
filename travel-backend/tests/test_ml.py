"""Загвар зөв ачаалагдаж, Colab-ийн томьёотой ижил таамаглаж байгааг шалгана.

Ажиллуулах: .venv/bin/python -m pytest -q   (travel-backend хавтсаас)
"""

import numpy as np

from app import ml


def setup_module():
    ml.load_model()


def test_model_loaded_with_colab_columns():
    assert ml.is_ready()
    assert list(ml._model.feature_names_in_) == ml.FEATURES


def test_prediction_matches_linear_formula():
    m = ml._model
    x = np.array([150_000, 10, 6], dtype=float)
    expected = round(max(0.0, float(x @ m.coef_ + m.intercept_)), 1)
    assert ml.predict_one(*x) == expected


def test_negative_prediction_becomes_zero():
    assert ml.predict_one(10_000_000, 0, 30) == 0.0


def test_one_decimal():
    v = ml.predict_one(123_457, 7, 5)
    assert v == round(v, 1)
