FROM python:3.11-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATABASE_PATH=/data/transcriptions.db \
    WHISPER_MODEL=small \
    WHISPER_COMPUTE_TYPE=int8

COPY requirements.txt requirements-whisper.txt ./
RUN pip install --no-cache-dir -r requirements-whisper.txt
COPY app.py .
COPY static ./static
RUN mkdir -p /data
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
