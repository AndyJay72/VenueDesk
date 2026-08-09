"""
Generates a voiceover narration track timed to each scene,
then mixes it into demo.mp4.
"""

import subprocess, os, shutil, struct

FFMPEG  = ('/Library/Frameworks/Python.framework/Versions/3.14/lib/'
           'python3.14/site-packages/imageio_ffmpeg/binaries/'
           'ffmpeg-macos-aarch64-v7.1')
VOICE   = 'en-GB-SoniaNeural'
RATE    = '-5%'        # slightly slower than default for clarity
TMP     = '/tmp/vd_audio'
BASE    = os.path.dirname(__file__)
VIDEO   = os.path.join(BASE, 'demo.mp4')
OUT     = os.path.join(BASE, 'demo.mp4')

os.makedirs(TMP, exist_ok=True)

# ── narration scripts (scene_duration_secs, text) ────────────────────────────
# Text is timed to leave ~1.5s of silence at start and end of each scene.
SCRIPTS = [
    (6,  "Welcome to VenueDesk — the simple room booking CRM "
         "built for community venues."),
    (10, "Your real-time dashboard gives you an instant overview "
         "of monthly revenue, pending requests, and upcoming bookings — "
         "all in one place."),
    (10, "The visual booking calendar shows every room at a glance, "
         "colour-coded by status, with month, week, and day views."),
    (10, "Take walk-in bookings in seconds. Enter the customer's details, "
         "select a room, date, and time — and the system handles the rest."),
    (10, "Manage weekly and monthly recurring series with ease. "
         "Cancel individual sessions or an entire series, "
         "with full payment tracking throughout."),
    (10, "Full customer profiles give you a complete picture — "
         "booking history, payment records, staff notes, "
         "and interaction logs, all in one view."),
    (10, "Track outstanding balances, record cash, card, and bank transfer "
         "payments, and keep your accounts reconciled — "
         "without a spreadsheet in sight."),
    (10, "Your public enquiry form lets customers check live availability "
         "and submit booking requests directly — "
         "appearing instantly in your dashboard."),
    (10, "Full admin control over your rooms, pricing grids, "
         "cancellation policies, staff logins, "
         "and Stripe payment settings."),
    (7,  "Ready to fill your rooms? "
         "Book a free 30-minute demo today — "
         "no commitment and no credit card required."),
]

assert sum(s[0] for s in SCRIPTS) == 93, "Scene total must be 93s"

def get_duration(path):
    """Return duration in seconds by parsing ffmpeg -i stderr."""
    import re
    r = subprocess.run([FFMPEG, '-i', path], capture_output=True, text=True)
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', r.stderr)
    if m:
        return int(m.group(1))*3600 + int(m.group(2))*60 + float(m.group(3))
    return 0.0

# ── generate each segment ─────────────────────────────────────────────────────
padded_wavs = []

for i, (dur, text) in enumerate(SCRIPTS):
    mp3  = f'{TMP}/seg_{i:02d}.mp3'
    raw  = f'{TMP}/seg_{i:02d}_raw.wav'
    pad  = f'{TMP}/seg_{i:02d}_pad.wav'

    # 1. generate speech via Microsoft neural TTS
    print(f"  [{i+1}/{len(SCRIPTS)}] Generating speech ({dur}s) …")
    import asyncio, edge_tts
    async def _gen(text, mp3):
        c = edge_tts.Communicate(text, VOICE, rate=RATE)
        await c.save(mp3)
    asyncio.run(_gen(text, mp3))

    # 2. convert to 44100 Hz stereo WAV
    subprocess.run([FFMPEG, '-y', '-i', mp3,
                    '-ar','44100','-ac','2', raw],
                   capture_output=True, check=True)

    # 3. measure speech duration
    speech_dur = get_duration(raw)
    print(f"       speech: {speech_dur:.2f}s  target: {dur}s")

    # 4. pad with silence to exactly match scene duration
    # Centre the speech: pad = (dur - speech_dur) / 2 each side
    pad_each = max(0, (dur - speech_dur) / 2)
    pad_start = max(pad_each, 0.8)   # at least 0.8s silence before speech
    pad_end   = max(0, dur - speech_dur - pad_start)

    subprocess.run([
        FFMPEG, '-y',
        '-f','lavfi','-i', f'aevalsrc=0:channel_layout=stereo:sample_rate=44100:duration={pad_start}',
        '-i', raw,
        '-f','lavfi','-i', f'aevalsrc=0:channel_layout=stereo:sample_rate=44100:duration={pad_end}',
        '-filter_complex','[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]',
        '-map','[out]',
        '-ar','44100','-ac','2','-t',str(dur),
        pad
    ], capture_output=True, check=True)

    padded_wavs.append(pad)
    print(f"       padded to {dur}s ✓")

# ── concatenate all segments ──────────────────────────────────────────────────
print("\nConcatenating segments …")
concat_list = f'{TMP}/concat.txt'
with open(concat_list, 'w') as f:
    for w in padded_wavs:
        f.write(f"file '{w}'\n")

full_audio = f'{TMP}/narration.wav'
subprocess.run([
    FFMPEG, '-y', '-f','concat','-safe','0','-i', concat_list,
    '-ar','44100','-ac','2', full_audio
], capture_output=True, check=True)

dur_check = get_duration(full_audio)
print(f"Full narration: {dur_check:.2f}s (expected 93s)")

# ── mix narration into video ──────────────────────────────────────────────────
print("Mixing audio into video …")
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

shutil.move(tmp_out, OUT)
print(f"Done — {os.path.getsize(OUT)//1024:,} KB  →  {OUT}")
