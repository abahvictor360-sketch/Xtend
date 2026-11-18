"""The staff video guide's voice-over (used by scripts/make-staff-video.ts).

Reads [{"id": ..., "say": ...}] on stdin and writes <out>/<id>.wav for each
line that has words, with the Kokoro voice model in <voice dir>:
kokoro.onnx (kokoro-v1.0.int8.onnx) and voices.bin (voices-v1.0.bin), from
github.com/thewh1teagle/kokoro-onnx releases. Needs `pip install kokoro-onnx
soundfile`. Runs on this computer: no words are sent anywhere.

    python -I scripts/staff-video-voice.py <voice dir> <out dir> < scenes.json
"""
import json
import os
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

VOICE = os.environ.get('XTEND_VOICE', 'af_heart')
SPEED = float(os.environ.get('XTEND_VOICE_SPEED', '0.9'))


def main() -> None:
    voice_dir, out = sys.argv[1], sys.argv[2]
    kokoro = Kokoro(os.path.join(voice_dir, 'kokoro.onnx'), os.path.join(voice_dir, 'voices.bin'))
    lang = 'en-gb' if VOICE.startswith('b') else 'en-us'
    for scene in json.load(sys.stdin):
        words = (scene.get('say') or '').strip()
        if not words:
            continue
        samples, rate = kokoro.create(words, voice=VOICE, speed=SPEED, lang=lang)
        sf.write(os.path.join(out, f"{scene['id']}.wav"), samples, rate)
        print(scene['id'], end=' ', flush=True)
    print()


if __name__ == '__main__':
    main()
