from PIL import Image
import os

src = r'C:\Users\mihey\.cursor\projects\e-AZAROV-GiftBot\assets\c__Users_mihey_AppData_Roaming_Cursor_User_workspaceStorage_3b7df88006a91bedb626ed03e953c3a1_images_IMG_9098__1___2_-c23a8b13-4d6f-4156-a08e-56c3f1059cc9.jpg'
out_gif = r'E:\AZAROV-GiftBot\public\splash-loading.gif'
out_webp = r'E:\AZAROV-GiftBot\public\splash-loading.webp'

GIF_SIZE = (280, 371)
WEBP_SIZE = (360, 477)


def crop_to_aspect(im: Image.Image, aspect: float) -> Image.Image:
    w, h = im.size
    cur = w / h
    if cur > aspect:
        nw = int(h * aspect)
        left = (w - nw) // 2
        return im.crop((left, 0, left + nw, h))
    nh = int(w / aspect)
    top = max(0, (h - nh) // 3)
    if top + nh > h:
        top = h - nh
    return im.crop((0, top, w, top + nh))


def apply_vertical_fade(im: Image.Image, fade_ratio: float = 0.24) -> Image.Image:
    im = im.convert('RGBA')
    w, h = im.size
    fade_h = max(1, int(h * fade_ratio))
    overlay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = overlay.load()
    for y in range(fade_h):
        t = 1 - (y / (fade_h - 1 if fade_h > 1 else 1))
        alpha = int(255 * (t * t * (3 - 2 * t)))
        for x in range(w):
            px[x, y] = (0, 0, 0, alpha)
            px[x, h - 1 - y] = (0, 0, 0, alpha)
    return Image.alpha_composite(im, overlay)


base = Image.open(src).convert('RGB')
aspect = GIF_SIZE[0] / GIF_SIZE[1]
cropped = crop_to_aspect(base, aspect)

gif_im = apply_vertical_fade(cropped.resize(GIF_SIZE, Image.Resampling.LANCZOS))
webp_im = apply_vertical_fade(cropped.resize(WEBP_SIZE, Image.Resampling.LANCZOS))

gif_rgb = Image.new('RGB', gif_im.size, (0, 0, 0))
gif_rgb.paste(gif_im, mask=gif_im.split()[-1])
gif_rgb.save(out_gif, format='GIF', optimize=True)
webp_im.save(out_webp, format='WEBP', quality=86, method=6)

print('wrote', out_gif, os.path.getsize(out_gif), Image.open(out_gif).size)
print('wrote', out_webp, os.path.getsize(out_webp), Image.open(out_webp).size)
