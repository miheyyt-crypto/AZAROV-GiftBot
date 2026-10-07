#!/usr/bin/env python3
"""Long-lived Silero CIS TTS helper. One request at a time. stdin/stdout JSON lines."""
from __future__ import annotations

import argparse
import json
import os
import re
import resource
import sys
import traceback
import wave
from pathlib import Path

import numpy as np
import torch

GAP_MS = 180


def peak_rss_kb() -> int:
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)


def pcm_from_audio(audio) -> np.ndarray:
    tensor = audio.detach().cpu() if hasattr(audio, "detach") else torch.as_tensor(audio)
    if tensor.ndim > 1:
        tensor = tensor.squeeze()
    return (tensor.numpy() * 32767.0).clip(-32767, 32767).astype(np.int16)


def write_wav(path: Path, pcm: np.ndarray, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())


def split_chunks(text: str, max_chars: int = 180) -> list[str]:
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", text.strip()) if p.strip()]
    if not parts:
        parts = [text.strip()]
    out: list[str] = []
    for part in parts:
        rest = part
        while len(rest) > max_chars:
            cut = rest.rfind(" ", 0, max_chars)
            if cut < 40:
                cut = max_chars
            out.append(rest[:cut].strip())
            rest = rest[cut:].strip()
        if rest:
            out.append(rest)
    return out or [text]


class Engine:
    def __init__(self, model_path: str, speaker: str, sample_rate: int, threads: int) -> None:
        torch.set_num_threads(max(1, threads))
        self.sample_rate = sample_rate
        self.speaker = speaker
        self.model = torch.package.PackageImporter(model_path).load_pickle(
            "tts_models", "model"
        )
        self.model.to(torch.device("cpu"))
        if speaker not in [str(s) for s in self.model.speakers]:
            raise RuntimeError(f"unknown silero speaker {speaker}")
        try:
            from silero_stress import load_accentor

            self.accentor = load_accentor(lang="ru")
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"silero-stress unavailable: {exc}") from exc

    def synth(self, text: str, output: str) -> dict:
        stressed = self.accentor(text)
        chunks = split_chunks(stressed)
        pcm_parts: list[np.ndarray] = []
        gap = np.zeros(int(self.sample_rate * GAP_MS / 1000), dtype=np.int16)
        with torch.inference_mode():
            for i, chunk in enumerate(chunks):
                if i:
                    pcm_parts.append(gap)
                audio = self.model.apply_tts(
                    text=chunk, speaker=self.speaker, sample_rate=self.sample_rate
                )
                pcm_parts.append(pcm_from_audio(audio))
        pcm = np.concatenate(pcm_parts) if pcm_parts else np.zeros(0, dtype=np.int16)
        write_wav(Path(output), pcm, self.sample_rate)
        duration_ms = int(round(len(pcm) / self.sample_rate * 1000)) if len(pcm) else 1
        return {
            "ok": True,
            "duration_ms": max(1, duration_ms),
            "peak_rss_kb": peak_rss_kb(),
            "chunks": len(chunks),
        }


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def with_id(payload: dict, req_id: object) -> dict:
    if isinstance(req_id, int):
        payload["id"] = req_id
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--speaker", default="ru_roman")
    parser.add_argument("--sample-rate", type=int, default=48000)
    parser.add_argument("--threads", type=int, default=1)
    args = parser.parse_args()
    try:
        engine = Engine(args.model, args.speaker, args.sample_rate, args.threads)
    except Exception as exc:  # noqa: BLE001
        emit({"ok": False, "error": str(exc), "event": "init"})
        return 1
    emit({"ok": True, "event": "ready", "speaker": args.speaker, "peak_rss_kb": peak_rss_kb()})
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            emit({"ok": False, "error": f"bad json: {exc}"})
            continue
        req_id = req.get("id")
        cmd = req.get("cmd")
        if cmd == "ping":
            emit(with_id({"ok": True, "event": "pong", "peak_rss_kb": peak_rss_kb()}, req_id))
            continue
        if cmd == "stop":
            emit(with_id({"ok": True, "event": "bye"}, req_id))
            return 0
        if cmd != "synth":
            emit(with_id({"ok": False, "error": f"unknown cmd {cmd}"}, req_id))
            continue
        text = req.get("text")
        output = req.get("output")
        if not isinstance(text, str) or not isinstance(output, str):
            emit(with_id({"ok": False, "error": "text and output required"}, req_id))
            continue
        try:
            emit(with_id(engine.synth(text, output), req_id))
        except Exception as exc:  # noqa: BLE001
            emit(
                with_id(
                    {
                        "ok": False,
                        "error": str(exc),
                        "trace": traceback.format_exc()[-500:],
                        "peak_rss_kb": peak_rss_kb(),
                    },
                    req_id,
                )
            )
    return 0


if __name__ == "__main__":
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")
    try:
        os.nice(15)
    except OSError:
        pass
    raise SystemExit(main())
