"""Background RVC TTS Server for Roxy.

Converts streamed chat text to speech using Edge-TTS as the base voice
and converts the output through the local RoxyMigurdia RVC model on GPU.
"""

import asyncio
import base64
import json
import os
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
import queue
import re
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# PyTorch 2.6+ defaults weights_only=True which breaks Fairseq/Hubert checkpoint loading.
# Monkeypatch torch.load before importing fairseq / rvc_python.
import torch

_orig_torch_load = torch.load


def _patched_torch_load(*args, **kwargs):
    kwargs.setdefault("weights_only", False)
    return _orig_torch_load(*args, **kwargs)


torch.load = _patched_torch_load

from rvc_python.infer import RVCInference
import sounddevice as sd
import soundfile as sf
import edge_tts
import deepl
from deep_translator import GoogleTranslator

# Paths
def find_model_dirs() -> list[Path]:
    dirs: list[Path] = []
    env_user_dir = os.environ.get("ROXY_TTS_USER_MODELS_DIR", "").strip()
    if env_user_dir:
        p = Path(env_user_dir)
        if p.exists() and p.is_dir() and p not in dirs:
            dirs.append(p)
    env_dir = os.environ.get("ROXY_TTS_MODEL_DIR", "").strip()
    if env_dir:
        p = Path(env_dir)
        if p.exists() and p.is_dir() and p not in dirs:
            dirs.append(p)
    candidates = [
        Path(__file__).resolve().parent.parent / "RoxyMigurdia",
        Path(__file__).resolve().parent / "RoxyMigurdia",
        Path.cwd() / "RoxyMigurdia",
        Path(sys.executable).parent / "resources" / "RoxyMigurdia",
    ]
    for c in candidates:
        if c.exists() and c.is_dir() and c not in dirs:
            dirs.append(c)
    return dirs if dirs else [candidates[0]]


def find_model_dir() -> Path:
    return find_model_dirs()[0]


MODEL_DIRS = find_model_dirs()
MODEL_DIR = MODEL_DIRS[0]


def get_all_models() -> list[str]:
    models: list[str] = []
    for d in find_model_dirs():
        for f in sorted(d.glob("*.pth")):
            if f.name not in models:
                models.append(f.name)
    return models


def get_all_indexes() -> list[str]:
    indexes: list[str] = []
    for d in find_model_dirs():
        for f in sorted(d.glob("*.index")):
            if f.name not in indexes:
                indexes.append(f.name)
    return indexes


def resolve_model_file(filename: str, ext: str = "") -> Path | None:
    p = Path(filename)
    if p.is_absolute() and p.exists():
        return p
    for d in find_model_dirs():
        target = d / filename
        if ext and not target.suffix:
            target = target.with_suffix(ext)
        if target.exists():
            return target
        if ext:
            matches = list(d.glob(f"*{filename}*{ext}"))
            if matches:
                return matches[0]
    return None


MODEL_PATH = Path(
    os.environ.get(
        "ROXY_TTS_MODEL",
        str(MODEL_DIR / "roxy_e660_s4620.pth")
        if (MODEL_DIR / "roxy_e660_s4620.pth").exists()
        else str(MODEL_DIR / "RoxyMigurdia.pth"),
    )
)
INDEX_PATH = Path(
    os.environ.get(
        "ROXY_TTS_INDEX",
        str(MODEL_DIR / "added_IVF346_Flat_nprobe_1_roxy_v2.index")
        if (MODEL_DIR / "added_IVF346_Flat_nprobe_1_roxy_v2.index").exists()
        else str(
            MODEL_DIR / "added_IVF432_Flat_nprobe_1_RoxyMigurdia_v2.index"
        ),
    )
)

DEFAULT_PORT = int(os.environ.get("ROXY_TTS_PORT", "5050"))
DEFAULT_VOICE = os.environ.get("ROXY_BASE_VOICE", "en-US-JennyNeural")
DEFAULT_PITCH = int(os.environ.get("ROXY_TTS_PITCH", "0"))
DEFAULT_RATE = os.environ.get("ROXY_TTS_RATE", "+15%")
# Set translation target: 'ja' (Japanese), 'es', 'zh-CN', or 'none' to disable
DEFAULT_TARGET_LANG = os.environ.get("ROXY_TRANSLATE_LANG", "ja")
# DeepL Free API key (e.g. "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx")
DEEPL_API_KEY = os.environ.get("DEEPL_API_KEY", "")

LANG_TO_VOICE = {
    "ja": "ja-JP-NanamiNeural",
    "zh": "zh-CN-XiaoxiaoNeural",
    "ko": "ko-KR-SunHiNeural",
    "es": "es-ES-ElviraNeural",
    "fr": "fr-FR-DeniseNeural",
    "de": "de-DE-KatjaNeural",
    "en": "en-US-JennyNeural",
}

DEEPL_LANG_MAP = {
    "ja": "JA",
    "zh": "ZH",
    "zh-cn": "ZH",
    "ko": "KO",
    "es": "ES",
    "fr": "FR",
    "de": "DE",
    "en": "EN-US",
}

deepl_translator: deepl.Translator | None = None
if DEEPL_API_KEY.strip():
    try:
        deepl_translator = deepl.Translator(DEEPL_API_KEY.strip())
        print("[TTS] DeepL Free translator enabled.")
    except Exception as err:
        print(f"[TTS] DeepL init error: {err}", file=sys.stderr)

_deepl_clients: dict[str, deepl.Translator] = {}


def get_deepl_translator(key: str) -> deepl.Translator | None:
    clean = key.strip()
    if not clean:
        return deepl_translator
    if clean not in _deepl_clients:
        try:
            _deepl_clients[clean] = deepl.Translator(clean)
        except Exception as e:
            print(f"[TTS] DeepL client init error: {e}", file=sys.stderr)
            return None
    return _deepl_clients.get(clean)


task_queue: queue.Queue = queue.Queue()
stop_flag = threading.Event()
current_lock = threading.Lock()


def translate_text(
    text: str, target_lang: str, api_key: str = ""
) -> tuple[str, str | None]:
    """Translate text if target_lang is set. Returns (translated_text, auto_voice)."""
    if not target_lang or target_lang.lower() in ("none", "off", "false", "no", "en"):
        return text, LANG_TO_VOICE.get(target_lang.lower() if target_lang else "", None)

    lang_lower = target_lang.lower()
    auto_voice = LANG_TO_VOICE.get(lang_lower)

    # 1. Prefer DeepL if API key is provided
    client = get_deepl_translator(api_key)
    if client:
        try:
            target_code = DEEPL_LANG_MAP.get(lang_lower, target_lang.upper())
            res = client.translate_text(text, target_lang=target_code)
            return str(res.text), auto_voice
        except Exception as e:
            print(
                f"[TTS] DeepL error: {e}, falling back to GoogleTranslator",
                file=sys.stderr,
            )

    # 2. Fallback to GoogleTranslator
    try:
        translated = GoogleTranslator(source="auto", target=target_lang).translate(
            text
        )
        return translated, auto_voice
    except Exception as e:
        print(f"[TTS] Translation error: {e}", file=sys.stderr)
        return text, None


def format_rate(rate_val: str | int | float) -> str:
    """Format speed rate for edge-tts e.g. '+20%' or '-10%'."""
    s = str(rate_val).strip()
    if s.endswith("%"):
        if not s.startswith(("+", "-")):
            s = f"+{s}"
        return s
    try:
        val = float(s)
        if 0 < val <= 3.0 and val != 1.0:
            pct = int((val - 1.0) * 100)
            return f"+{pct}%" if pct >= 0 else f"{pct}%"
        pct = int(val)
        return f"+{pct}%" if pct >= 0 else f"{pct}%"
    except ValueError:
        return "+0%"


def clean_text_for_tts(text: str) -> str:
    """Strip markdown, code blocks, links, and noise that sounds bad in TTS."""
    if not text:
        return ""
    # Strip markdown code blocks
    text = re.sub(r"```[\s\S]*?```", " ", text)
    # Strip inline code formatting
    text = re.sub(r"`([^`]+)`", r"\1", text)
    # Strip markdown links, keep label: [foo](url) -> foo
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    # Strip standalone URLs
    text = re.sub(r"https?://\S+", " ", text)
    # Strip markdown emphasis symbols
    text = re.sub(r"[*_~#]+", " ", text)
    # Collapse multiple whitespaces
    text = re.sub(r"\s+", " ", text).strip()
    return text


class RvcTtsEngine:
    def __init__(self):
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        print(f"[TTS] Initializing RVC on device: {self.device}")
        self.rvc = RVCInference(device=self.device)

        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Model file not found: {MODEL_PATH}")

        index_str = str(INDEX_PATH) if INDEX_PATH.exists() else ""
        print(f"[TTS] Loading model {MODEL_PATH.name}...")
        self.rvc.load_model(str(MODEL_PATH), version="v2", index_path=index_str)
        self.rvc.set_params(
            f0up_key=DEFAULT_PITCH,
            f0method="rmvpe",
            index_rate=0.75,
        )
        self.current_model = MODEL_PATH.name
        self.current_index = INDEX_PATH.name if INDEX_PATH.exists() else ""
        print("[TTS] RVC model ready.")

    def load_voice_model(
        self, model_name: str | None = None, index_name: str | None = None
    ) -> bool:
        if model_name:
            target_model = resolve_model_file(model_name, ".pth")
            if not target_model:
                return False
        else:
            curr = getattr(self, "current_model", MODEL_PATH.name)
            target_model = resolve_model_file(curr, ".pth") or (MODEL_DIR / curr)

        # Determine index path
        if index_name is not None:
            raw_idx = index_name.strip()
            if raw_idx.lower() in ("none", "off"):
                matched_index = ""
                self.current_index = ""
            elif raw_idx.lower() in ("auto", ""):
                stem = target_model.stem.lower()
                matched_index = ""
                for d in find_model_dirs():
                    for idx in sorted(d.glob("*.index")):
                        if stem in idx.name.lower() or "roxy" in idx.name.lower():
                            matched_index = str(idx)
                            break
                    if matched_index:
                        break
                self.current_index = Path(matched_index).name if matched_index else ""
            else:
                found_idx = resolve_model_file(raw_idx, ".index")
                matched_index = str(found_idx) if found_idx else ""
                self.current_index = Path(matched_index).name if matched_index else ""
        else:
            # Preserve current index or find matching
            current_idx_file = (
                resolve_model_file(getattr(self, "current_index", ""), ".index")
                if getattr(self, "current_index", "")
                else None
            )
            if current_idx_file:
                matched_index = str(current_idx_file)
            else:
                stem = target_model.stem.lower()
                matched_index = ""
                for d in find_model_dirs():
                    for idx in sorted(d.glob("*.index")):
                        if stem in idx.name.lower() or "roxy" in idx.name.lower():
                            matched_index = str(idx)
                            break
                    if matched_index:
                        break
                self.current_index = Path(matched_index).name if matched_index else ""

        print(
            f"[TTS] Hot-reloading voice model {target_model.name} (index: {self.current_index or 'none'})..."
        )
        self.rvc.load_model(str(target_model), version="v2", index_path=matched_index)
        self.rvc.set_params(
            f0up_key=DEFAULT_PITCH,
            f0method="rmvpe",
            index_rate=0.75,
        )
        self.current_model = target_model.name
        print(f"[TTS] Voice model {target_model.name} ready with index {self.current_index or 'none'}.")
        return True

    async def _edge_tts(self, text: str, out_path: str, rate: str, voice: str):
        selected_voice = voice if voice else DEFAULT_VOICE
        comm = edge_tts.Communicate(
            text, selected_voice, rate=format_rate(rate)
        )
        await comm.save(out_path)

    def convert_and_play(
        self,
        text: str,
        rate: str = DEFAULT_RATE,
        voice: str = DEFAULT_VOICE,
        ready_event: threading.Event | None = None,
        api_key: str = "",
        target_lang: str | None = None,
    ):
        cleaned = clean_text_for_tts(text)
        if not cleaned or len(cleaned.strip()) < 2:
            if ready_event:
                ready_event.set()
            return

        effective_lang = (
            target_lang if target_lang is not None else DEFAULT_TARGET_LANG
        )
        if effective_lang and effective_lang.lower() not in (
            "none",
            "off",
            "no",
            "en",
        ):
            translated, auto_voice = translate_text(
                cleaned, effective_lang, api_key=api_key
            )
            if auto_voice and voice == DEFAULT_VOICE:
                voice = auto_voice
            if translated:
                print(f"[TTS] Translated ({effective_lang}) -> {translated}")
                cleaned = translated
        elif effective_lang and effective_lang.lower() == "en":
            auto_voice = LANG_TO_VOICE.get("en")
            if auto_voice and voice == DEFAULT_VOICE:
                voice = auto_voice

        with tempfile.TemporaryDirectory() as tmpdir:
            base_wav = os.path.join(tmpdir, "base.wav")
            rvc_wav = os.path.join(tmpdir, "rvc.wav")

            try:
                # 1. Base TTS
                asyncio.run(self._edge_tts(cleaned, base_wav, rate, voice))
            except Exception as e:
                print(f"[TTS] Base TTS error: {e}", file=sys.stderr)
                if ready_event:
                    ready_event.set()
                return

            if stop_flag.is_set():
                if ready_event:
                    ready_event.set()
                return

            try:
                # 2. RVC Voice Conversion
                self.rvc.infer_file(base_wav, rvc_wav)
            except Exception as e:
                print(f"[TTS] RVC inference error: {e}", file=sys.stderr)
                if ready_event:
                    ready_event.set()
                return

            if stop_flag.is_set():
                if ready_event:
                    ready_event.set()
                return

            try:
                # 3. Play audio
                data, fs = sf.read(rvc_wav)
                duration = len(data) / float(fs) if fs > 0 else 0.0
                sd.play(data, fs)

                # Audio playback has started! Signal readiness to caller with audio duration.
                if ready_event:
                    ready_event.duration = duration
                    ready_event.set()

                # Wait until finished or stopped
                while True:
                    if stop_flag.is_set():
                        sd.stop()
                        break
                    stream = sd.get_stream()
                    if stream is None or not stream.active:
                        break
                    time.sleep(0.04)
            except Exception as e:
                print(f"[TTS] Audio playback error: {e}", file=sys.stderr)
                if ready_event:
                    ready_event.duration = 0.0
                    ready_event.set()


engine: RvcTtsEngine | None = None


def tts_worker_loop():
    global engine
    while True:
        try:
            item = task_queue.get()
            if item is None:
                break
            if stop_flag.is_set():
                task_queue.task_done()
                continue

            if isinstance(item, dict):
                text = item.get("text", "")
                rate = item.get("rate", DEFAULT_RATE)
                voice = item.get("voice", DEFAULT_VOICE)
                ready_event = item.get("ready_event")
                api_key = item.get("api_key", "")
                lang = item.get("lang", DEFAULT_TARGET_LANG)
            else:
                text = str(item)
                rate = DEFAULT_RATE
                voice = DEFAULT_VOICE
                ready_event = None
                api_key = ""
                lang = DEFAULT_TARGET_LANG

            with current_lock:
                if engine and not stop_flag.is_set():
                    engine.convert_and_play(
                        text, rate, voice, ready_event, api_key, target_lang=lang
                    )
                elif ready_event:
                    ready_event.set()

            task_queue.task_done()
        except Exception as err:
            print(f"[TTS] Worker loop error: {err}", file=sys.stderr)


class TtsHttpHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, data: dict):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._send_json(
                200,
                {
                    "status": "ok",
                    "model": engine.current_model
                    if engine and hasattr(engine, "current_model")
                    else MODEL_PATH.name,
                    "device": engine.device if engine else "unknown",
                    "queue_size": task_queue.qsize(),
                },
            )
        elif self.path == "/models":
            models = get_all_models()
            indexes = get_all_indexes()
            curr = (
                engine.current_model
                if engine and hasattr(engine, "current_model")
                else MODEL_PATH.name
            )
            curr_idx = (
                engine.current_index
                if engine and hasattr(engine, "current_index")
                else (INDEX_PATH.name if INDEX_PATH.exists() else "")
            )
            self._send_json(
                200,
                {
                    "models": models,
                    "current": curr,
                    "indexes": indexes,
                    "currentIndex": curr_idx,
                },
            )
        else:
            self._send_json(404, {"error": "Not Found"})

    def do_POST(self):
        if self.path in ("/model", "/index"):
            content_length = int(self.headers.get("Content-Length", 0))
            body_bytes = self.rfile.read(content_length)
            try:
                body = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                self._send_json(400, {"error": "Invalid JSON"})
                return

            model_name = body.get("model")
            index_name = body.get("index")

            if model_name is None and index_name is None:
                self._send_json(400, {"error": "Missing model or index parameter"})
                return

            if not engine:
                self._send_json(503, {"error": "Engine not initialized"})
                return

            try:
                ok = engine.load_voice_model(
                    model_name=model_name.strip() if model_name else None,
                    index_name=index_name.strip() if index_name is not None else None,
                )
                if ok:
                    self._send_json(
                        200,
                        {
                            "ok": True,
                            "model": engine.current_model,
                            "index": getattr(engine, "current_index", ""),
                        },
                    )
                else:
                    self._send_json(404, {"error": "Model or index not found"})
            except Exception as e:
                self._send_json(500, {"error": str(e)})

        elif self.path == "/speak":
            content_length = int(self.headers.get("Content-Length", 0))
            body_bytes = self.rfile.read(content_length)
            try:
                body = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                self._send_json(400, {"error": "Invalid JSON"})
                return

            text = body.get("text", "").strip()
            rate = body.get("rate", DEFAULT_RATE)
            voice = body.get("voice", DEFAULT_VOICE)
            api_key = body.get("api_key", "").strip()
            lang = body.get("lang") or body.get("target_lang") or DEFAULT_TARGET_LANG
            wait = body.get("wait", True)
            if text:
                stop_flag.clear()
                ready_event = threading.Event()
                task_queue.put(
                    {
                        "text": text,
                        "rate": rate,
                        "voice": voice,
                        "api_key": api_key,
                        "lang": lang,
                        "ready_event": ready_event,
                    }
                )
                if wait:
                    ready_event.wait(timeout=60.0)

                duration = getattr(ready_event, "duration", 0.0)
                self._send_json(
                    200,
                    {
                        "status": "ready",
                        "text": text,
                        "rate": rate,
                        "voice": voice,
                        "duration": duration,
                    },
                )
            else:
                self._send_json(200, {"status": "ignored", "reason": "empty"})

        elif self.path == "/stop":
            stop_flag.set()
            sd.stop()
            # Drain queue and unblock waiters
            while not task_queue.empty():
                try:
                    q_item = task_queue.get_nowait()
                    if isinstance(q_item, dict) and q_item.get("ready_event"):
                        q_item["ready_event"].set()
                    task_queue.task_done()
                except queue.Empty:
                    break
            # Reset stop flag after brief delay
            threading.Timer(0.1, stop_flag.clear).start()
            self._send_json(200, {"status": "stopped"})

        elif self.path == "/transcribe":
            content_length = int(self.headers.get("Content-Length", 0))
            body_bytes = self.rfile.read(content_length)
            content_type = self.headers.get("Content-Type", "")
            audio_bytes = b""
            model_size = "base"
            language = None
            task = None

            if "application/json" in content_type:
                try:
                    body = json.loads(body_bytes.decode("utf-8"))
                    audio_b64 = body.get("audio", "")
                    audio_bytes = base64.b64decode(audio_b64)
                    model_size = body.get("model", "base")
                    language = body.get("language")
                    task = body.get("task")
                    initial_prompt = body.get("initial_prompt")
                    beam_size = int(body.get("beam_size", 5))
                except Exception as e:
                    self._send_json(400, {"ok": False, "error": f"Invalid JSON / base64: {e}"})
                    return
            else:
                audio_bytes = body_bytes
                model_size = "base"
                language = None
                task = None
                initial_prompt = None
                beam_size = 5

            if not audio_bytes:
                self._send_json(400, {"ok": False, "error": "No audio data provided"})
                return

            try:
                from transcribe import transcribe_bytes
                text = transcribe_bytes(
                    audio_bytes,
                    model_size=model_size,
                    language=language,
                    task=task,
                    initial_prompt=initial_prompt,
                    beam_size=beam_size,
                )
                self._send_json(200, {"ok": True, "text": text})
            except Exception as e:
                print(f"[STT] Transcription error: {e}", file=sys.stderr)
                self._send_json(500, {"ok": False, "error": str(e)})

        else:
            self._send_json(404, {"error": "Not Found"})

    def log_message(self, format, *args):
        # Keep terminal output clean
        pass


def main():
    global engine
    engine = RvcTtsEngine()

    worker = threading.Thread(target=tts_worker_loop, daemon=True)
    worker.start()

    server = ThreadingHTTPServer(("127.0.0.1", DEFAULT_PORT), TtsHttpHandler)
    print(f"[TTS] Server listening on http://127.0.0.1:{DEFAULT_PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[TTS] Shutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
