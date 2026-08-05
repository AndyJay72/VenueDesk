"""
Generates demo.mp4 from live VenueDesk screenshots.
8 scenes: Title → 6 feature screens → CTA  (~52 seconds)
"""

from PIL import Image, ImageDraw, ImageFont
import numpy as np
import imageio.v3 as iio
import os

# ── constants ────────────────────────────────────────────────────────────────
W, H, FPS = 1280, 720, 30
FADE       = 0.45          # seconds fade-in / fade-out per scene
SS_DIR     = os.path.join(os.path.dirname(__file__), 'screenshots')
OUT        = os.path.join(os.path.dirname(__file__), 'demo.mp4')
FFMPEG     = ('/Library/Frameworks/Python.framework/Versions/3.14/lib/'
              'python3.14/site-packages/imageio_ffmpeg/binaries/'
              'ffmpeg-macos-aarch64-v7.1')

# ── colours ──────────────────────────────────────────────────────────────────
BG      = (15,  23,  42)
SLATE   = (30,  41,  59)
INDIGO  = (99, 102, 241)
IND_DIM = (38,  39,  96)
GREEN   = (16, 185, 129)
GREEN_B = (6,   60,  42)
WHITE   = (255,255,255)
GREY    = (148,163,184)
MUTED   = (71,  85, 105)
BLACK   = (0,    0,   0)

# ── fonts ─────────────────────────────────────────────────────────────────────
SF   = '/System/Library/Fonts/SFNS.ttf'
MONO = '/System/Library/Fonts/SFNSMono.ttf'
def fnt(n): return ImageFont.truetype(SF,   n)
def mno(n): return ImageFont.truetype(MONO, n)

# ── helpers ───────────────────────────────────────────────────────────────────
def center_x(d, y, text, font, fill, alpha=255):
    bb  = d.textbbox((0,0), text, font=font)
    tw  = bb[2]-bb[0]
    d.text(((W-tw)//2, y), text, font=font, fill=(*fill, alpha) if len(fill)==3 else fill)

def wrap_draw(d, x, y, text, font, fill, max_w, lh=None):
    lh  = lh or (d.textbbox((0,0),'A',font=font)[3]+6)
    buf = ImageDraw.Draw(Image.new('RGB',(1,1)))
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur+' '+w).strip()
        if buf.textbbox((0,0),t,font=font)[2] <= max_w: cur = t
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    for l in lines:
        d.text((x,y), l, font=font, fill=fill)
        y += lh
    return y

def pill(d, x, y, text, bg, fg, f, pad=(14,8)):
    bb = d.textbbox((0,0),text,font=f)
    tw,th = bb[2]-bb[0], bb[3]-bb[1]
    r = th//2+pad[1]
    d.rounded_rectangle([x,y,x+tw+pad[0]*2,y+th+pad[1]*2], radius=r, fill=bg)
    d.text((x+pad[0],y+pad[1]), text, font=f, fill=fg)
    return tw+pad[0]*2

def nav_bar(d):
    d.rectangle([0,0,W,60], fill=SLATE)
    d.rectangle([0,58,W,60], fill=(*INDIGO,100))
    d.rounded_rectangle([24,12,56,48], radius=8, fill=INDIGO)
    d.text((32,16), '⌂', font=fnt(20), fill=WHITE)
    d.text((64,18), 'Venue', font=fnt(20), fill=WHITE)
    bb = d.textbbox((0,0),'Venue',font=fnt(20))
    d.text((64+bb[2]-bb[0],18), 'Desk', font=fnt(20), fill=INDIGO)

def accent_bar(d):
    d.rectangle([0,60,5,H], fill=INDIGO)

# ── screenshot loader ─────────────────────────────────────────────────────────
_ss_cache = {}
def load_ss(filename):
    if filename not in _ss_cache:
        path = os.path.join(SS_DIR, filename)
        img  = Image.open(path).convert('RGB')
        # scale to fill width; preserve top (nav bar with logo must stay visible)
        sw, sh = img.size
        scale  = max(W/sw, H/sh)
        nw, nh = int(sw*scale), int(sh*scale)
        img    = img.resize((nw,nh), Image.LANCZOS)
        # crop: centre horizontally, but always start from top vertically
        cx = (nw-W)//2
        img = img.crop((cx, 0, cx+W, H))
        _ss_cache[filename] = img
    return _ss_cache[filename].copy()

# ── overlay gradient ──────────────────────────────────────────────────────────
GRAD_H  = 260   # height of bottom overlay gradient
SOLID_H = 160   # solid dark band at very bottom

def gradient_overlay(img, title, desc, text_alpha=1.0):
    """Composite a high-contrast bottom overlay with title + description."""
    overlay = Image.new('RGBA', (W,H), (0,0,0,0))
    od      = ImageDraw.Draw(overlay)

    # solid near-black band at bottom
    od.rectangle([0, H-SOLID_H, W, H], fill=(8,12,26,245))

    # gradient fade above the solid band
    for i in range(GRAD_H-SOLID_H):
        a = int(230 * (i/(GRAD_H-SOLID_H))**1.4)
        od.rectangle([0, H-GRAD_H+i, W, H-GRAD_H+i+1], fill=(8,12,26,a))

    # indigo rule at the top of the solid band
    rule_y = H-SOLID_H
    od.rectangle([0, rule_y, W, rule_y+4], fill=(*INDIGO, int(255*text_alpha)))

    ta = int(255*text_alpha)
    # title — large white bold text
    od.text((56, rule_y+16), title, font=fnt(40), fill=(*WHITE, ta))
    # description — lighter grey, wrapped
    wrap_draw(od, 56, rule_y+68, desc, fnt(21), (*GREY, ta), W-112, lh=30)

    base = img.convert('RGBA')
    return Image.alpha_composite(base, overlay).convert('RGB')

# ── scene builders ────────────────────────────────────────────────────────────
def build_title():
    img = Image.new('RGB',(W,H),BG)
    # radial glow
    glow = Image.new('RGBA',(W,H),(0,0,0,0))
    gd   = ImageDraw.Draw(glow)
    for r in range(320,0,-8):
        a = int(22*(1-r/320))
        gd.ellipse([W-r-40,-r+120,W+r-40,r+120], fill=(*INDIGO,a))
    img = Image.alpha_composite(img.convert('RGBA'), glow).convert('RGB')
    d   = ImageDraw.Draw(img)
    nav_bar(d); accent_bar(d)
    center_x(d, 200, 'VenueDesk', fnt(78), WHITE)
    center_x(d, 296, 'Room Booking CRM for Community Venues', fnt(26), GREY)
    items = ['✓  No double bookings','✓  Free setup included','✓  UK-based support']
    gap   = 20
    tmp   = ImageDraw.Draw(Image.new('RGB',(1,1)))
    f16   = fnt(16)
    widths= [tmp.textbbox((0,0),t,font=f16)[2]+28 for t in items]
    x     = (W-sum(widths)-gap*(len(items)-1))//2
    for t,w in zip(items,widths):
        pill(d,x,378,t,IND_DIM,INDIGO,f16); x+=w+gap
    center_x(d, 460, 'venuedesk.co.uk', fnt(17), MUTED)
    return img

def build_screenshot(filename, title, desc, text_alpha=1.0):
    img = load_ss(filename)
    return gradient_overlay(img, title, desc, text_alpha)

def build_cta():
    img = Image.new('RGB',(W,H),BG)
    glow= Image.new('RGBA',(W,H),(0,0,0,0))
    gd  = ImageDraw.Draw(glow)
    for r in range(320,0,-10):
        a = int(18*(1-r/320))
        gd.ellipse([W//2-r,H//2-r,W//2+r,H//2+r],fill=(*INDIGO,a))
    img = Image.alpha_composite(img.convert('RGBA'),glow).convert('RGB')
    d   = ImageDraw.Draw(img)
    nav_bar(d); accent_bar(d)
    center_x(d, 185, 'Ready to fill your rooms?', fnt(52), WHITE)
    center_x(d, 258, 'Book a free 30-minute demo — no commitment, no credit card.', fnt(22), GREY)
    bx1,by1,bx2,by2 = 400,325,880,390
    d.rounded_rectangle([bx1,by1,bx2,by2], radius=14, fill=INDIGO)
    center_x(d, by1+16, 'Book a Free Demo', fnt(26), WHITE)
    center_x(d, 415, 'sunita.sooryia@venuedesk.co.uk', fnt(19), GREY)
    center_x(d, 450, 'venuedesk.co.uk', fnt(16), MUTED)
    return img

# ── scene list ────────────────────────────────────────────────────────────────
# (type, duration_secs, *args)
SCENES = [
    ('title', 9),
    ('screenshot', 11, 'dashboard.png', 'Real-time Dashboard',
        'Revenue, pending requests and upcoming bookings — everything you need at a glance.'),
    ('screenshot', 12, 'calendar.png', 'Visual Booking Calendar',
        'See every room, every day. Colour-coded by room and status with month, week and day views.'),
    ('screenshot', 12, 'calendar-walkin.png', 'Quick Booking from the Calendar',
        'Click any available date on the calendar to open the Quick Booking drawer — fill details, check availability and confirm in seconds.'),
    ('screenshot', 13, 'recurring.png', 'Recurring Bookings',
        'Manage weekly and monthly recurring series. Cancel individual sessions or the entire series.'),
    ('screenshot', 13, 'customers.png', 'Customer CRM',
        'Full profiles with booking history, payment records, notes and staff interaction logs.'),
    ('screenshot', 14, 'accounts.png', 'Payments & Accounts',
        'Track outstanding balances, record payments and keep your accounts reconciled effortlessly.'),
    ('screenshot', 13, 'enquiry-form.png', 'Online Booking Requests',
        'Customers check live availability and submit enquiries — straight into your dashboard inbox.'),
    ('screenshot', 11, 'admin-config.png', 'Full Admin Control',
        'Configure rooms, pricing grids, cancellation policies, staff logins and payment settings.'),
    ('cta', 11),
]

# ── frame generation ──────────────────────────────────────────────────────────
def render_scene_frame(scene, t_in, dur):
    """Render one frame at time t_in within the scene (0 ≤ t_in < dur)."""
    # fade brightness: 0→1 in first FADE seconds, 1→0 in last FADE seconds
    if t_in < FADE:
        brightness = t_in / FADE
    elif t_in > dur - FADE:
        brightness = (dur - t_in) / FADE
    else:
        brightness = 1.0
    brightness = max(0.0, min(1.0, brightness))

    stype = scene[0]

    if stype == 'title':
        img = build_title()
    elif stype == 'cta':
        img = build_cta()
    else:   # screenshot
        _, _, filename, title, desc = scene
        # text slides in after 1.5s
        text_alpha = max(0.0, min(1.0, (t_in - 1.5) / 0.6)) if t_in > 1.5 else 0.0
        if t_in > dur - FADE - 0.3:
            text_alpha = 0.0   # fade text with scene
        img = build_screenshot(filename, title, desc, text_alpha)

    if brightness < 1.0:
        arr = np.array(img, dtype=np.float32) * brightness
        img = Image.fromarray(arr.astype(np.uint8))

    return np.array(img)

# ── main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    all_frames = []
    for scene in SCENES:
        dur   = scene[1]
        n     = int(dur * FPS)
        print(f"  Rendering {scene[0]}: {dur}s ({n} frames) …")
        for fi in range(n):
            all_frames.append(render_scene_frame(scene, fi/FPS, dur))

    total_secs = sum(s[1] for s in SCENES)
    print(f"\nEncoding {len(all_frames)} frames ({total_secs}s) → {OUT} …")

    import subprocess, shutil
    tmp = OUT + '.tmp.mp4'
    cmd = [
        FFMPEG, '-y',
        '-f','rawvideo','-vcodec','rawvideo',
        '-s',f'{W}x{H}','-pix_fmt','rgb24','-r',str(FPS),'-i','pipe:0',
        '-an',
        '-vcodec','libx264','-profile:v','baseline','-level','3.1',
        '-pix_fmt','yuv420p','-crf','21','-movflags','+faststart',
        tmp
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    for frame in all_frames:
        proc.stdin.write(frame.tobytes())
    proc.stdin.close()
    proc.wait()
    if proc.returncode != 0:
        print(proc.stderr.read().decode())
        raise RuntimeError('ffmpeg failed')
    shutil.move(tmp, OUT)
    print(f"Done — {os.path.getsize(OUT)//1024:,} KB")
