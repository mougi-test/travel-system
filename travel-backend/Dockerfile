# Travel API — AWS (ECS Fargate / App Runner / EC2) дээр ажиллуулах image
#
# Бүтээх:     docker build --platform linux/amd64 -t travel-backend .
# Ажиллуулах: docker run -p 8000:8000 --env-file .env travel-backend
#
# Нууц тохиргоо (DATABASE_URL, JWT_SECRET …) image-д ОРОХГҮЙ.
# AWS дээр Secrets Manager / Parameter Store-оос орчны хувьсагчаар өгнө.

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MODEL_PATH=models/demand_model.joblib \
    PORT=8000

WORKDIR /app

# Сангуудыг эхэлж суулгана — код өөрчлөгдөхөд энэ давхарга кэшээс ирнэ
COPY requirements.txt .
RUN pip install -r requirements.txt

# Аппын код ба загвар
COPY app ./app
COPY models ./models

# root эрхгүй хэрэглэгчээр ажиллуулна (халдлага гарвал хохирлыг багасгана)
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000

# Load balancer / ECS энэ шалгалтаар контейнер амьд эсэхийг мэднэ
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/health', timeout=4)" || exit 1

# --proxy-headers: AWS ALB-ийн ард жинхэнэ IP/https-ийг зөв таниулна
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
