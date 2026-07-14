import io
import logging
import os
import wave

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from faster_whisper import WhisperModel
from piper import PiperVoice

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice-agent")

app = FastAPI()

# "base"/"small" per the brief - "small" is meaningfully more accurate for
# only a bit more CPU time; "base" is the safer default on genuinely modest
# hardware (this runs alongside browsing-agent's own dual-core-CPU box
# constraint - see browsing-agent/main.py). Override per-deployment.
WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "base")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
# int8 is the standard CPU-friendly quantization for faster-whisper - much
# faster than float32 with a small, usually-imperceptible accuracy cost.
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

# Baked into the Docker image at build time (see Dockerfile's
# `python -m piper.download_voices` step) so the container is self-contained
# at runtime - no network dependency on first request.
PIPER_VOICE_PATH = os.environ.get("PIPER_VOICE_PATH", "/models/en_US-lessac-medium.onnx")

# Both loaded once at startup, not per-request - faster-whisper's "base"/
# "small" models and a single Piper voice are small enough (a few hundred MB
# combined) to stay resident the whole process lifetime, unlike Ollama's
# keep_alive juggling for much larger chat models (see backend/src/utils/modelMode.js).
logger.info("Loading faster-whisper model '%s' (device=%s, compute_type=%s)...", WHISPER_MODEL_SIZE, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE)
whisper_model = WhisperModel(WHISPER_MODEL_SIZE, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE)

logger.info("Loading Piper voice from %s...", PIPER_VOICE_PATH)
piper_voice = PiperVoice.load(PIPER_VOICE_PATH)


class SpeakRequest(BaseModel):
    text: str


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    try:
        # faster-whisper accepts a file-like object directly (decodes via
        # PyAV under the hood, so this handles whatever container/codec a
        # browser's MediaRecorder produced - typically webm/opus - without
        # needing a separate ffmpeg binary in the image).
        segments, _info = whisper_model.transcribe(io.BytesIO(audio_bytes))
        text = "".join(segment.text for segment in segments).strip()
    except Exception:
        logger.exception("/transcribe failed")
        raise HTTPException(status_code=500, detail="Transcription failed")

    return {"text": text}


@app.post("/speak")
async def speak(req: SpeakRequest):
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    try:
        buffer = io.BytesIO()
        # synthesize_wav needs a real wave.Wave_write (it calls
        # setframerate/setsampwidth/setnchannels/writeframes on it) - a bare
        # BytesIO doesn't have those methods.
        with wave.open(buffer, "wb") as wav_file:
            piper_voice.synthesize_wav(req.text, wav_file)
        audio_bytes = buffer.getvalue()
    except Exception:
        logger.exception("/speak failed")
        raise HTTPException(status_code=500, detail="Speech synthesis failed")

    return Response(content=audio_bytes, media_type="audio/wav")
