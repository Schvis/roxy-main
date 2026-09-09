"""Automated installer and dependency setup for Roxy RVC TTS."""

import shutil
import subprocess
import sys


def run_cmd(cmd: list[str]) -> bool:
    print(f">> {' '.join(cmd)}")
    res = subprocess.run(cmd)
    return res.returncode == 0


def main():
    py_exe = sys.executable
    print(
        f"[Setup] Using Python: {py_exe} (v{sys.version_info.major}.{sys.version_info.minor})"
    )

    # 1. Base dependencies
    print("\n[1/5] Installing core audio and translation libraries...")
    run_cmd(
        [
            py_exe,
            "-m",
            "pip",
            "install",
            "edge-tts",
            "sounddevice",
            "soundfile",
            "requests",
            "deepl",
            "deep-translator",
            "tensorboardX",
        ]
    )

    # 2. PyTorch with CUDA
    print("\n[2/5] Checking PyTorch and CUDA...")
    need_torch = True
    try:
        import torch

        if torch.cuda.is_available():
            print(
                f"[Setup] PyTorch {torch.__version__} with CUDA is already active."
            )
            need_torch = False
    except ImportError:
        pass

    if need_torch:
        nvidia_smi = shutil.which("nvidia-smi")
        if nvidia_smi:
            print("[Setup] NVIDIA GPU detected. Installing PyTorch with CUDA...")
            ok = run_cmd(
                [
                    py_exe,
                    "-m",
                    "pip",
                    "install",
                    "--upgrade",
                    "torch",
                    "torchaudio",
                    "--index-url",
                    "https://download.pytorch.org/whl/cu130",
                ]
            )
            if not ok:
                run_cmd(
                    [
                        py_exe,
                        "-m",
                        "pip",
                        "install",
                        "--upgrade",
                        "torch",
                        "torchaudio",
                        "--index-url",
                        "https://download.pytorch.org/whl/cu124",
                    ]
                )
        else:
            print("[Setup] Installing CPU PyTorch...")
            run_cmd([py_exe, "-m", "pip", "install", "torch", "torchaudio"])

    # 3. Fairseq
    print("\n[3/5] Checking Fairseq...")
    try:
        import fairseq

        print("[Setup] Fairseq already installed.")
    except ImportError:
        run_cmd(
            [py_exe, "-m", "pip", "install", "fairseq==0.12.2", "--no-deps"]
        )

    # 4. Audio processing & science libraries
    print("\n[4/5] Installing audio processing dependencies...")
    run_cmd(
        [
            py_exe,
            "-m",
            "pip",
            "install",
            "bitarray",
            "cython",
            "hydra-core<1.1",
            "omegaconf<2.1",
            "regex",
            "sacrebleu",
            "tqdm",
            "faiss-cpu",
            "pyworld",
            "torchcrepe",
            "praat-parselmouth",
            "av",
            "ffmpeg-python",
            "scipy",
            "librosa",
        ]
    )

    # 5. rvc-python
    print("\n[5/5] Checking rvc-python...")
    try:
        from rvc_python.infer import RVCInference

        print("[Setup] rvc-python already installed.")
    except ImportError:
        run_cmd([py_exe, "-m", "pip", "install", "rvc-python", "--no-deps"])

    print("\n[Setup] Verifying environment...")
    try:
        import edge_tts, sounddevice, soundfile, deepl, deep_translator
        import torch
        from rvc_python.infer import RVCInference

        print("\n[Setup] SUCCESS! All TTS dependencies are ready.")
        return 0
    except Exception as e:
        print(f"\n[Setup] Verification error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
