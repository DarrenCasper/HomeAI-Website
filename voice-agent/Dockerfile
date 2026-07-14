FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Piper voice model baked in at build time so the container is
# self-contained at runtime, same principle as loading both models once at
# startup in main.py rather than per-request. Override PIPER_VOICE to bake
# a different voice in (see https://rhasspy.github.io/piper-samples/ for
# the full catalog of "lang_region-name-quality" ids).
ARG PIPER_VOICE=en_US-lessac-medium
RUN python -m piper.download_voices ${PIPER_VOICE} --download-dir /models
ENV PIPER_VOICE_PATH=/models/${PIPER_VOICE}.onnx

# faster-whisper downloads its own model from Hugging Face on first load
# (cached under /root/.cache) rather than at build time - unlike the Piper
# voice above there's no separate download step for it, so the very first
# /transcribe after a fresh container start is slower than the rest.

COPY . .

EXPOSE 8002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
