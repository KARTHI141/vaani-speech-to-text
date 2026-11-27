# Vaani — Speech to Text

A lightweight transcription dashboard with live English/Hindi browser recognition, editable SQLite history, and an optional self-hosted [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper) audio transcription endpoint.

## Run locally

Requires Python 3.10+.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app:app --reload
```

Open <http://localhost:8000>. Microphone access requires localhost or HTTPS. Live recognition uses the browser's Web Speech API and works best in Chrome; browser support and recognition service availability vary.

To enable self-hosted audio transcription, also install `pip install -r requirements-whisper.txt`. The audio-upload route loads Faster-Whisper on demand and transcribes the recording on the server. It defaults to the `small` model on CPU with `int8`; the first transcription downloads model weights. Set `WHISPER_MODEL` (for example `base` or `medium`) and `WHISPER_COMPUTE_TYPE` to tune quality and resource usage. Audio uploads are limited to 25 MB. Without the optional model, live browser transcription and history still work.

## Features

- Live speech-to-text preview with English (India), Hindi, and English (US) browser recognition.
- Persistent transcription history stored in SQLite.
- Create, list, edit, and delete transcriptions via the dashboard and REST API.
- Recorded-audio transcription with a self-hosted open-source Whisper model.

## API

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/transcriptions` | List saved transcriptions |
| `POST` | `/api/transcriptions` | Save `{ "text": "...", "language": "en-IN" }` |
| `PATCH` | `/api/transcriptions/{id}` | Update `text` and/or `language` |
| `DELETE` | `/api/transcriptions/{id}` | Delete a transcription |
| `POST` | `/api/transcribe` | Multipart audio upload (`audio` field) via Faster-Whisper |

Set `DATABASE_PATH` to choose another SQLite file. The default database is `transcriptions.db` in the project directory.

## Deploy with Docker

```powershell
docker build -t vaani .
docker run --rm -p 8000:8000 -v vaani-data:/data vaani
```

For a cloud deployment, deploy the Docker image to a container platform and mount persistent storage at `/data` so the SQLite database survives restarts. For CPU/memory-constrained hosts, set `WHISPER_MODEL=base` or omit the optional Whisper dependency and use browser recognition.

## Notes

Live recognition is performed by the browser and depends on its speech-recognition implementation; the app does not send microphone audio to its own server during live capture. Uploaded recordings are processed by the self-hosted Whisper model and are not retained after transcription. This demo does not include authentication; add access controls before exposing private transcripts publicly.
