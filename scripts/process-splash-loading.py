"""Convert IMG_9098.MP4 into animated splash-loading.gif + .webp with top/bottom black fades."""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

import imageio_ffmpeg
from PIL import Image

SRC = Path(r'C:\Users\mihey\Downloads\IMG_9098.MP4')
OUT_DIR = Path(r'E:\AZAROV-GiftBot\public')
OUT_GIF = OUT_DIR / 'splash-loading.gif'
OUT_WEBP = OUT_DIR / 'splash-loading.webp'

# Match previous splash pixel sizes
GIF_SIZE = (280, 371)
WEBP_SIZE = (360, 477)
TARGET_FPS = 12
MAX_DURATION_SEC = 3.5  # keep splash light
FADE_RATIO = 0.24


def crop_to_aspect(im: Image.Image, aspect: float) -> Image.Image:
    w, h = im.size
    cur = w / h
    if cur > aspect:
        nw = int(h * aspect)
        left = max(0, (w - nw) // 2)
        return im.crop((left, 0, left + nw, h))
    nh = int(w / aspect)
    top = max(0, (h - nh) // 3)
    if top + nh > h:
        top = h - nh
    return im.crop((0, top, w, top + nh))


def apply_vertical_fade(im: Image.Image, fade_ratio: float = FADE_RATIO) -> Image.Image:
    im = im.convert('RGBA')
    w, h = im.size
    fade_h = max(1, int(h * fade_ratio))
    overlay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = overlay.load()
    denom = fade_h - 1 if fade_h > 1 else 1
    for y in range(fade_h):
        t = 1 - (y / denom)
        alpha = int(255 * (t * t * (3 - 2 * t)))
        for x in range(w):
            px[x, y] = (0, 0, 0, alpha)
            px[x, h - 1 - y] = (0, 0, 0, alpha)
    return Image.alpha_composite(im, overlay)


def process_frame(path: Path, size: tuple[int, int], aspect: float) -> Image.Image:
    base = Image.open(path).convert('RGB')
    cropped = crop_to_aspect(base, aspect)
    resized = cropped.resize(size, Image.Resampling.LANCZOS)
    faded = apply_vertical_fade(resized)
    # Composite onto black for GIF/WebP safety
    canvas = Image.new('RGBA', size, (0, 0, 0, 255))
    return Image.alpha_composite(canvas, faded)


def extract_frames(ffmpeg: str, work: Path) -> list[Path]:
    pattern = str(work / 'frame_%04d.png')
    cmd = [
        ffmpeg,
        '-y',
        '-i',
        str(SRC),
        '-t',
        str(MAX_DURATION_SEC),
        '-vf',
        f'fps={TARGET_FPS}',
        pattern,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    frames = sorted(work.glob('frame_*.png'))
    if not frames:
        raise RuntimeError('no frames extracted from MP4')
    return frames


def save_gif(frames: list[Image.Image], path: Path, duration_ms: int) -> None:
    # Convert to palette frames for smaller animated GIF
    converted = []
    for fr in frames:
        rgb = Image.new('RGB', fr.size, (0, 0, 0))
        rgb.paste(fr, mask=fr.split()[-1])
        converted.append(rgb.convert('P', palette=Image.Palette.ADAPTIVE, colors=128))
    converted[0].save(
        path,
        save_all=True,
        append_images=converted[1:],
        duration=duration_ms,
        loop=0,
        optimize=False,
        disposal=2,
    )


def save_webp(frames: list[Image.Image], path: Path, duration_ms: int) -> None:
    frames[0].save(
        path,
        format='WEBP',
        save_all=True,
        append_images=frames[1:],
        duration=duration_ms,
        loop=0,
        quality=78,
        method=4,
    )


def main() -> None:
    if not SRC.exists():
        raise FileNotFoundError(SRC)

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    aspect = GIF_SIZE[0] / GIF_SIZE[1]
    duration_ms = int(1000 / TARGET_FPS)

    with tempfile.TemporaryDirectory(prefix='splash-frames-') as tmp:
        work = Path(tmp)
        raw_frames = extract_frames(ffmpeg, work)
        print(f'extracted {len(raw_frames)} frames')

        gif_frames = [process_frame(p, GIF_SIZE, aspect) for p in raw_frames]
        webp_frames = [process_frame(p, WEBP_SIZE, aspect) for p in raw_frames]

        save_gif(gif_frames, OUT_GIF, duration_ms)
        save_webp(webp_frames, OUT_WEBP, duration_ms)

    for out in (OUT_GIF, OUT_WEBP):
        probe = Image.open(out)
        n = getattr(probe, 'n_frames', 1)
        print(f'wrote {out} size={probe.size} frames={n} bytes={os.path.getsize(out)}')


if __name__ == '__main__':
    main()
