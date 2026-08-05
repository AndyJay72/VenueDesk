"""
1. Applies professional audio processing to each recorded scene.
2. Recalculates video scene durations to fit actual recording lengths.
3. Regenerates demo.mp4 with new timings + processed human voiceover.
4. Optionally mixes in a music bed (drop music.* into ~/Downloads/voiceover/).
"""

import subprocess, os, shutil, re, math

FFMPEG  = ('/Library/Frameworks/Python.framework/Versions/3.14/lib/'
           'python3.14/site-packages/imageio_ffmpeg/binaries/'
           'ffmpeg-macos-aarch64-v7.1')
VO_DIR  = os.path.expanduser('~/Downloads/voiceover')
TMP     = '/tmp/vd_vo'
BASE    = os.path.dirname(__file__)
VIDEO   = os.path.join(BASE, 'demo.mp4')

os.makedirs(TMP, exist_ok=True)

# ── helpers ───────────────────────────────────────────────────────────────────
def ffmpeg(*args, **kw):
    return subprocess.run([FFMPEG, *args], capture_output=True, check=True, **kw)

def get_dur(path):
    r = subprocess.run([FFMPEG, '-i', path], capture_output=True, text=True)
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', r.stderr)
    return (int(m.group(1))*3600 + int(m.group(2))*60 + float(m.group(3))) if m else 0.0

LEAD_PAD  = 1.2   # silence before speech (seconds)
TRAIL_PAD = 1.4   # silence after speech
MUSIC_VOL = 0.08  # music bed level: 0.08 ≈ -22 dB (raise to 0.12 if too quiet)

# ── scene metadata (must stay in sync with make_demo_video.py) ────────────────
SCENE_TYPES = [
    'title', 'screenshot', 'screenshot', 'screenshot', 'screenshot',
    'screenshot', 'screenshot', 'screenshot', 'screenshot', 'cta'
]

# ── step 1: process each recording ───────────────────────────────────────────
print("── Step 1: Processing recordings ──────────────────────────────────")
raw_durs   = []
proc_files = []

for i in range(1, 11):
    # Accept any capitalisation and common audio extensions
    src = None
    for name in [f'Scene {i}', f'scene {i}']:
        for ext in ['.m4a', '.mp3', '.wav', '.aac', '.ogg']:
            candidate = os.path.join(VO_DIR, name + ext)
            if os.path.exists(candidate):
                src = candidate
                break
        if src:
            break
    if not src:
        raise FileNotFoundError(f'No audio file found for Scene {i} in {VO_DIR}')
    proc = f'{TMP}/scene_{i:02d}_proc.wav'

    raw_dur = get_dur(src)
    raw_durs.append(raw_dur)
    print(f"  Scene {i}: {raw_dur:.2f}s raw")

    # Minimal processing — keeps the recording natural:
    #  highpass=80Hz  — remove low-end rumble without touching the voice
    #  loudnorm       — normalise to -14 LUFS (web/broadcast standard)
    ffmpeg('-y', '-i', src,
           '-af', 'highpass=f=80,loudnorm=I=-14:TP=-1.5:LRA=11',
           '-ar', '44100', '-ac', '2',
           proc)
    proc_files.append(proc)
    print(f"  Scene {i}: processed ✓")

# ── step 2: calculate new scene durations ─────────────────────────────────────
print("\n── Step 2: Calculating scene durations ─────────────────────────────")
scene_durs = []
for i, raw_dur in enumerate(raw_durs):
    # Total scene = lead pad + speech + trail pad, rounded up to whole second
    total = math.ceil(LEAD_PAD + raw_dur + TRAIL_PAD)
    scene_durs.append(total)
    print(f"  Scene {i+1}: {raw_dur:.2f}s speech → {total}s scene")

total_secs = sum(scene_durs)
print(f"\n  Total video duration: {total_secs}s ({total_secs//60}m {total_secs%60}s)")

# ── step 3: pad each processed audio to its scene duration ────────────────────
print("\n── Step 3: Padding audio to scene durations ────────────────────────")
padded_files = []
for i, (proc, raw_dur, scene_dur) in enumerate(zip(proc_files, raw_durs, scene_durs)):
    pad_end  = scene_dur - LEAD_PAD - raw_dur
    pad_end  = max(0.0, pad_end)
    padded   = f'{TMP}/scene_{i+1:02d}_padded.wav'

    ffmpeg('-y',
           '-f','lavfi','-i',
           f'aevalsrc=0:channel_layout=stereo:sample_rate=44100:duration={LEAD_PAD}',
           '-i', proc,
           '-f','lavfi','-i',
           f'aevalsrc=0:channel_layout=stereo:sample_rate=44100:duration={pad_end}',
           '-filter_complex','[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]',
           '-map','[out]',
           '-ar','44100','-ac','2','-t',str(scene_dur),
           padded)
    padded_files.append(padded)
    print(f"  Scene {i+1}: padded to {scene_dur}s ✓")

# ── step 4: concatenate into one track ───────────────────────────────────────
print("\n── Step 4: Concatenating audio ─────────────────────────────────────")
concat_list = f'{TMP}/concat.txt'
with open(concat_list, 'w') as f:
    for p in padded_files: f.write(f"file '{p}'\n")

full_audio = f'{TMP}/voiceover_final.wav'
ffmpeg('-y','-f','concat','-safe','0','-i',concat_list,
       '-ar','44100','-ac','2', full_audio)
print(f"  Full track: {get_dur(full_audio):.2f}s")

# ── step 5: regenerate video with new scene durations ────────────────────────
print("\n── Step 5: Regenerating video with new scene durations ─────────────")

# Patch scene durations in make_demo_video.py and run it
script_path = os.path.join(BASE, 'make_demo_video.py')
with open(script_path) as f:
    src_code = f.read()

# Build new SCENES list
scene_descs = [
    ("'title'",       None, None, None),
    ("'screenshot'", "'dashboard.png'",    "'Real-time Dashboard'",
     "'Revenue, pending requests and upcoming bookings — everything you need at a glance.'"),
    ("'screenshot'", "'calendar.png'",     "'Visual Booking Calendar'",
     "'See every room, every day. Colour-coded by room and status with month, week and day views.'"),
    ("'screenshot'", "'calendar-walkin.png'", "'Quick Booking from the Calendar'",
     "'Click any available date on the calendar to open the Quick Booking drawer — fill details, check availability and confirm in seconds.'"),
    ("'screenshot'", "'recurring.png'",    "'Recurring Bookings'",
     "'Manage weekly and monthly recurring series. Cancel individual sessions or the entire series.'"),
    ("'screenshot'", "'customers.png'",    "'Customer CRM'",
     "'Full profiles with booking history, payment records, notes and staff interaction logs.'"),
    ("'screenshot'", "'accounts.png'",     "'Payments & Accounts'",
     "'Track outstanding balances, record payments and keep your accounts reconciled effortlessly.'"),
    ("'screenshot'", "'enquiry-form.png'", "'Online Booking Requests'",
     "'Customers check live availability and submit enquiries — straight into your dashboard inbox.'"),
    ("'screenshot'", "'admin-config.png'", "'Full Admin Control'",
     "'Configure rooms, pricing grids, cancellation policies, staff logins and payment settings.'"),
    ("'cta'",         None, None, None),
]

lines = ['SCENES = [']
for (stype, fn, title, desc), dur in zip(scene_descs, scene_durs):
    if fn is None:
        lines.append(f"    ({stype}, {dur}),")
    else:
        lines.append(f"    ({stype}, {dur}, {fn}, {title},")
        lines.append(f"        {desc}),")
lines.append(']')
new_scenes_block = '\n'.join(lines)

# Replace SCENES block in script
new_src = re.sub(r'SCENES = \[.*?\]', new_scenes_block, src_code, flags=re.DOTALL)
with open(script_path, 'w') as f:
    f.write(new_src)

print("  Updated make_demo_video.py with new scene durations")
result = subprocess.run(['python3', script_path], capture_output=False)
if result.returncode != 0:
    raise RuntimeError("Video generation failed")

# ── step 6: mix voiceover into video ─────────────────────────────────────────
print("\n── Step 6: Mixing voiceover into video ─────────────────────────────")
tmp_out = VIDEO + '.tmp.mp4'
subprocess.run([
    FFMPEG, '-y',
    '-i', VIDEO,
    '-i', full_audio,
    '-c:v','copy',
    '-c:a','aac','-b:a','128k',
    '-shortest',
    tmp_out
], check=True, capture_output=True)
shutil.move(tmp_out, VIDEO)

# ── step 7: mix in music bed (optional) ──────────────────────────────────────
music_src = None
for ext in ['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac']:
    candidate = os.path.join(VO_DIR, 'music' + ext)
    if os.path.exists(candidate):
        music_src = candidate
        break

if music_src:
    print(f"\n── Step 7: Mixing music bed ─────────────────────────────────────────")
    print(f"  Source: {os.path.basename(music_src)}  volume={MUSIC_VOL} (~{round(20*math.log10(MUSIC_VOL))}dB)")
    tmp_out = VIDEO + '.music.mp4'
    subprocess.run([
        FFMPEG, '-y',
        '-i', VIDEO,
        '-stream_loop', '-1', '-i', music_src,
        '-filter_complex',
            f'[1:a]volume={MUSIC_VOL}[bed];[0:a][bed]amix=inputs=2:duration=first[aout]',
        '-map', '0:v',
        '-map', '[aout]',
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '128k',
        tmp_out
    ], check=True, capture_output=True)
    shutil.move(tmp_out, VIDEO)
    print(f"  Music bed mixed ✓")
else:
    print(f"\n  (No music bed — drop music.mp3 into {VO_DIR} to enable)")

print(f"\nAll done — {os.path.getsize(VIDEO)//1024:,} KB → {VIDEO}")
