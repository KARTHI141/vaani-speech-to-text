import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", BASE_DIR / "transcriptions.db"))
app = FastAPI(title="Procucev Speech to Text", version="1.0.0")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


class TranscriptionInput(BaseModel):
    text: str = Field(min_length=1, max_length=50_000)
    language: str = Field(default="auto", max_length=32)


class TranscriptionUpdate(BaseModel):
    text: Optional[str] = Field(default=None, min_length=1, max_length=50_000)
    language: Optional[str] = Field(default=None, max_length=32)


@contextmanager
def get_connection():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
    finally:
        connection.close()


def initialize_database():
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS transcriptions (
                id TEXT PRIMARY KEY,
                text TEXT NOT NULL,
                language TEXT NOT NULL DEFAULT 'auto',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.commit()


def row_to_dict(row):
    return dict(row) if row else None


@app.on_event("startup")
def startup():
    initialize_database()


@app.get("/")
def home():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/transcriptions")
def list_transcriptions():
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM transcriptions ORDER BY created_at DESC"
        ).fetchall()
    return [row_to_dict(row) for row in rows]


@app.post("/api/transcriptions", status_code=201)
def create_transcription(payload: TranscriptionInput):
    now = datetime.now(timezone.utc).isoformat()
    transcription = {
        "id": str(uuid4()),
        "text": payload.text.strip(),
        "language": payload.language.strip() or "auto",
        "created_at": now,
        "updated_at": now,
    }
    if not transcription["text"]:
        raise HTTPException(status_code=422, detail="Transcript cannot be blank")
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO transcriptions (id, text, language, created_at, updated_at)
            VALUES (:id, :text, :language, :created_at, :updated_at)
            """,
            transcription,
        )
        connection.commit()
    return transcription


@app.patch("/api/transcriptions/{transcription_id}")
def update_transcription(transcription_id: str, payload: TranscriptionUpdate):
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=422, detail="Provide text or language to update")
    if "text" in updates:
        updates["text"] = updates["text"].strip()
        if not updates["text"]:
            raise HTTPException(status_code=422, detail="Transcript cannot be blank")
    if "language" in updates:
        updates["language"] = updates["language"].strip() or "auto"
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    fields = ", ".join(f"{key} = :{key}" for key in updates)
    updates["id"] = transcription_id
    with get_connection() as connection:
        result = connection.execute(
            f"UPDATE transcriptions SET {fields} WHERE id = :id", updates
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Transcription not found")
        connection.commit()
        row = connection.execute(
            "SELECT * FROM transcriptions WHERE id = ?", (transcription_id,)
        ).fetchone()
    return row_to_dict(row)


@app.delete("/api/transcriptions/{transcription_id}", status_code=204)
def delete_transcription(transcription_id: str):
    with get_connection() as connection:
        result = connection.execute(
            "DELETE FROM transcriptions WHERE id = ?", (transcription_id,)
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Transcription not found")
        connection.commit()


@app.post("/api/transcribe", status_code=201)
async def transcribe_audio(audio: UploadFile = File(...)):
    if audio.content_type not in {
        "audio/webm",
        "audio/ogg",
        "audio/wav",
        "audio/mpeg",
        "audio/mp4",
        "audio/x-wav",
    }:
        raise HTTPException(status_code=415, detail="Unsupported audio format")
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio file is empty")
    if len(audio_bytes) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio file exceeds 25 MB")

    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise HTTPException(
            status_code=503,
            detail="Whisper is unavailable. Install the optional faster-whisper dependency.",
        ) from error

    import tempfile

    model_name = os.environ.get("WHISPER_MODEL", "small")
    compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
    model = WhisperModel(model_name, device="cpu", compute_type=compute_type)
    suffix = Path(audio.filename or "recording.webm").suffix or ".webm"
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as audio_file:
            audio_file.write(audio_bytes)
            temp_path = audio_file.name
        segments, info = model.transcribe(temp_path, language=None, beam_size=3)
        text = " ".join(segment.text.strip() for segment in segments).strip()
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"Audio transcription failed: {error}") from error
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

    if not text:
        raise HTTPException(status_code=422, detail="No speech was detected")
    return create_transcription(
        TranscriptionInput(text=text, language=info.language or "auto")
    )
