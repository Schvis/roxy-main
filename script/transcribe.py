"""Standalone and reusable Speech-to-Text (STT) transcriber for Roxy."""

import argparse
import json
import os
import sys
import tempfile
import warnings
from typing import Optional

# Suppress Hugging Face symlink and unauthenticated warnings on Windows
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
warnings.filterwarnings("ignore")

_model_cache = {}


def _create_faster_whisper(model_size: str):
    from faster_whisper import WhisperModel
    import torch

    # Check if CUDA is available and actually works with CTranslate2
    if torch.cuda.is_available():
        try:
            m = WhisperModel(model_size, device="cuda", compute_type="float16")
            import ctranslate2
            import numpy as np

            dummy = np.zeros((1, 80, 3000), dtype=np.float32)
            m.model.encode(ctranslate2.StorageView.from_array(dummy))
            return m
        except Exception as e:
            print(
                f"[STT] CUDA inference unavailable ({e}), falling back to CPU int8",
                file=sys.stderr,
            )

    return WhisperModel(model_size, device="cpu", compute_type="int8")


def get_whisper_model(model_size: str = "base"):
    if model_size in _model_cache:
        return _model_cache[model_size]

    try:
        model = _create_faster_whisper(model_size)
        _model_cache[model_size] = ("faster-whisper", model)
        return _model_cache[model_size]
    except ImportError:
        pass

    try:
        import whisper
        import torch

        device = "cuda" if torch.cuda.is_available() else "cpu"
        try:
            model = whisper.load_model(model_size, device=device)
        except Exception:
            model = whisper.load_model(model_size, device="cpu")
        _model_cache[model_size] = ("openai-whisper", model)
        return _model_cache[model_size]
    except ImportError:
        raise RuntimeError(
            "No STT engine found. Please install faster-whisper or openai-whisper."
        )


def transcribe_file(
    audio_path: str,
    model_size: str = "base",
    language: Optional[str] = None,
    task: Optional[str] = None,
    initial_prompt: Optional[str] = None,
    beam_size: int = 5,
) -> str:
    kind, model = get_whisper_model(model_size)
    lang = (
        language.lower().strip()
        if language and language.strip() and language.lower().strip() != "auto"
        else None
    )

    effective_task = task or "transcribe"
    prompt = (
        initial_prompt.strip()
        if initial_prompt and initial_prompt.strip()
        else None
    )

    try:
        if kind == "faster-whisper":
            segments, _ = model.transcribe(
                audio_path,
                language=lang,
                task=effective_task,
                initial_prompt=prompt,
                beam_size=beam_size,
                vad_filter=True,
                condition_on_previous_text=False,
                repetition_penalty=1.2,
                no_repeat_ngram_size=3,
                compression_ratio_threshold=2.4,
                no_speech_threshold=0.6,
            )
            return " ".join([s.text.strip() for s in segments if s.text.strip()])
        elif kind == "openai-whisper":
            result = model.transcribe(
                audio_path,
                language=lang,
                task=effective_task,
                initial_prompt=prompt,
                beam_size=beam_size,
                condition_on_previous_text=False,
                compression_ratio_threshold=2.4,
                no_speech_threshold=0.6,
            )
            return result.get("text", "").strip()
    except Exception as e:
        if kind == "faster-whisper":
            from faster_whisper import WhisperModel

            cpu_model = WhisperModel(
                model_size, device="cpu", compute_type="int8"
            )
            _model_cache[model_size] = ("faster-whisper", cpu_model)
            segments, _ = cpu_model.transcribe(
                audio_path,
                language=lang,
                task=effective_task,
                initial_prompt=prompt,
                beam_size=beam_size,
                vad_filter=True,
                condition_on_previous_text=False,
                repetition_penalty=1.2,
                no_repeat_ngram_size=3,
                compression_ratio_threshold=2.4,
                no_speech_threshold=0.6,
            )
            return " ".join([s.text.strip() for s in segments if s.text.strip()])
        raise e
    return ""


def transcribe_bytes(
    audio_bytes: bytes,
    model_size: str = "base",
    language: Optional[str] = None,
    task: Optional[str] = None,
    initial_prompt: Optional[str] = None,
    beam_size: int = 5,
) -> str:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name
    try:
        return transcribe_file(
            tmp_path,
            model_size=model_size,
            language=language,
            task=task,
            initial_prompt=initial_prompt,
            beam_size=beam_size,
        )
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


SUPPORTED_MODELS = [
    "tiny",
    "base",
    "small",
    "medium",
    "distil-large-v3",
    "large-v3",
]


def list_installed_models() -> list[str]:
    try:
        from faster_whisper import download_model

        installed = []
        for m in SUPPORTED_MODELS:
            try:
                download_model(m, local_files_only=True)
                installed.append(m)
            except Exception:
                pass
        return installed
    except Exception:
        return []


def download_model_with_progress(model_name: str):
    import huggingface_hub
    from faster_whisper.utils import _MODELS
    from tqdm.auto import tqdm

    repo_id = _MODELS.get(model_name)
    if not repo_id:
        if "/" in model_name:
            repo_id = model_name
        else:
            raise ValueError(f"Unknown model name: {model_name}")

    class JsonTqdm(tqdm):
        def __init__(self, *args, **kwargs):
            kwargs["file"] = open(os.devnull, "w")
            super().__init__(*args, **kwargs)

        def update(self, n=1):
            super().update(n)
            if self.total and self.total > 1000000:
                pct = round((self.n / self.total) * 100, 1)
                sys.stdout.write(
                    json.dumps(
                        {
                            "type": "progress",
                            "model": model_name,
                            "current": self.n,
                            "total": self.total,
                            "percent": pct,
                        }
                    )
                    + "\n"
                )
                sys.stdout.flush()

        def display(self, *args, **kwargs):
            pass

    allow_patterns = [
        "config.json",
        "preprocessor_config.json",
        "model.bin",
        "tokenizer.json",
        "vocabulary.*",
    ]

    huggingface_hub.snapshot_download(
        repo_id, allow_patterns=allow_patterns, tqdm_class=JsonTqdm
    )
    print(
        json.dumps({"type": "done", "model": model_name, "ok": True}),
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser(description="Transcribe audio file to text")
    parser.add_argument(
        "audio_path",
        nargs="?",
        default=None,
        help="Path to audio file (wav, mp3, webm, etc.)",
    )
    parser.add_argument(
        "--list-installed",
        action="store_true",
        help="List locally installed whisper models",
    )
    parser.add_argument(
        "--download-model",
        default=None,
        help="Download a model by name and report progress",
    )
    parser.add_argument(
        "--model",
        default="base",
        help="Model size: tiny, base, small, medium, large-v3",
    )
    parser.add_argument("--language", default=None, help="Language code or auto")
    parser.add_argument(
        "--task", default=None, help="Task: transcribe or translate"
    )
    parser.add_argument(
        "--initial-prompt",
        default=None,
        help="Initial prompt or vocabulary bias for Whisper decoder",
    )
    parser.add_argument(
        "--beam-size",
        type=int,
        default=5,
        help="Beam size (1 for fast greedy decoding, 5 for standard)",
    )
    args = parser.parse_args()

    if args.list_installed:
        try:
            installed = list_installed_models()
            print(json.dumps({"ok": True, "installed": installed}))
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}))
            sys.exit(1)
        return

    if args.download_model:
        try:
            download_model_with_progress(args.download_model)
        except Exception as e:
            print(json.dumps({"type": "error", "error": str(e)}), flush=True)
            sys.exit(1)
        return

    if not args.audio_path:
        parser.print_help(sys.stderr)
        sys.exit(1)

    try:
        text = transcribe_file(
            args.audio_path,
            model_size=args.model,
            language=args.language,
            task=args.task,
            initial_prompt=args.initial_prompt,
            beam_size=args.beam_size,
        )
        print(json.dumps({"ok": True, "text": text}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
