"""Generate the 5 pitch deck hero images for the Antler / fundraise deck.

Different design intent than the blog illustrations: the blog images
were New-York-Times editorial (painterly, atmospheric, reading speed
slow). Pitch deck images are infographic-forward: bigger geometric
forms, higher contrast, generous negative space for slide text to
overlay, fewer painterly artifacts. Same palette so a viewer who saw
the blog and the deck reads them as the same brand.

Design references for solid infographics (synthesized from research):
  - One idea per slide. The image should support ONE claim.
  - Big bold geometry. Pitch decks read at 8 feet on a projector.
  - Generous negative space (40-50%) so titles + supporting copy
    can overlay without competing.
  - Limited palette (4 colors max). Same hex codes as the blog.
  - No tiny details. Distinct silhouettes that read instantly.

Run:
  OPENROUTER_API_KEY=... python3 scripts/gen_deck_images.py
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

MODEL = "google/gemini-3.1-flash-image-preview"
FALLBACK_MODEL = "google/gemini-2.5-flash-image-preview"
ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"

DECK_DIR = Path(__file__).resolve().parent.parent / "manthan-ui" / "public" / "deck"

# Pitch-deck style anchor. Same palette as the blog but bolder, more
# infographic-forward, more negative space for slide text overlay.
STYLE_ANCHOR = """
VISUAL STYLE - HARD CONSTRAINT - PASTE VERBATIM

Genre: Modern editorial infographic for a B2B SaaS pitch deck.
Inspired by Pentagram and Bloomberg Businessweek-style covers.
Bold geometric forms, clean edges, generous negative space, designed
to read at 8 feet on a conference room projector.

Color palette (hex, no substitutions):
  primary deep navy   #0F1626  (50% of frame, usually background)
  warm bone           #EFEEE6  (30% of frame, the main subject form)
  amber accent        #C97B2A  (15%, used on the central moral subject)
  cool teal           #4B6B6A  (5%, used as a single counterpoint)
  no pure black, no pure white, no gradients spanning more than 2 of these

Lighting: directional, single off-frame source at upper-right.
Subjects cast soft long shadows toward lower-left at roughly 35 degrees.
No flat shadowless rendering.

Composition: leave the upper-right 30 percent of the frame as clean
negative space so a slide title can overlay without competing with the
image. Subject occupies the lower-left two thirds. Eye-level
perspective. Never center-framed.

Texture: subtle paper grain throughout, light visible brush texture on
the subject forms only. No photographic realism. No 3D render. No
painterly softness so heavy it looks dreamy. The look is "designed,"
not "illustrated."

Mood: confident, considered, quietly ambitious. Not aggressive. Not
whimsical.

Hard nos: no text in the frame, no readable typography, no logos, no
brand marks, no charts or graph lines, no UI screens or interface
mockups, no people's faces, no hands, no watermarks, no borders, no
shapes resembling letters of the alphabet.

Aspect ratio: 16:9 landscape, 1920x1080 final.
"""

# Five slides. Each name maps to a logical slide position in the deck.
SCENES: dict[str, dict[str, str]] = {
    "01-hero.webp": {
        "slide": "Cover / brand hero",
        "subject": (
            "A single bold coral-tree silhouette rises from the lower-"
            "third of the frame, rendered in warm bone color with thin "
            "amber light tracing the upward branches. The coral is "
            "stylized, geometric, more architectural than natural, with "
            "clean branching that suggests circulation, distribution, "
            "or signal flow. Behind it, the deep navy background is "
            "uniform and unbroken. The amber light along the branches "
            "is the moral subject; the coral form is the brand mark. "
            "Upper-right two-thirds of the frame are clean negative "
            "space for the title to overlay."
        ),
    },
    "02-problem.webp": {
        "slide": "The problem",
        "subject": (
            "A wide bone-colored desk surface extends across the lower "
            "half of the frame, painted with subtle grain. On the desk, "
            "seven small geometric envelope shapes are arranged in a "
            "loose horizontal line, each one a slightly different muted "
            "earth tone. One envelope on the far left glows softly with "
            "amber light from within, catching the only direct light in "
            "the frame. The other six envelopes sit in soft shadow, "
            "unopened, the same color but darker. A thin teal thread of "
            "light hangs above the row like a tally line being drawn. "
            "Upper-right thirty percent of the frame is clean negative "
            "space, deep navy, ready for slide title."
        ),
    },
    "03-solution.webp": {
        "slide": "The solution / what we built",
        "subject": (
            "Six muted ribbons of different earth-tone colors stream "
            "horizontally from the left edge of the frame, each one at "
            "a slightly different vertical height, all flowing toward a "
            "small architectural coral-tree structure on the left-third "
            "vertical line. Past the coral structure, the six ribbons "
            "merge into a single clean amber line of light that extends "
            "to the right edge of the frame, smooth and decisive. The "
            "ribbons before the coral are slightly frayed; the amber "
            "line after is clean. The coral structure is geometric and "
            "stylized, rendered in warm bone color with thin amber "
            "tracing. Upper-right third is clean negative space for "
            "slide title."
        ),
    },
    "04-moat.webp": {
        "slide": "Why we will win (token unit economics)",
        "subject": (
            "Two curves rise from the lower-left of the frame against a "
            "deep navy background. The lower curve is rendered as a "
            "clean amber line, gently arcing upward and to the right in "
            "a linear shape, controlled and steady. The upper curve is "
            "rendered as a frayed warm-bone-colored line, starting at "
            "the same origin point but rising sharply in a quadratic "
            "arc, growing increasingly chaotic as it climbs. The amber "
            "line stays compact and disciplined; the bone line balloons "
            "outward. A small cool teal dot marks the origin point "
            "where both lines begin. No axis labels, no numbers, no "
            "gridlines, just the two curves and their divergent shapes. "
            "Upper-right thirty percent of the frame is clean negative "
            "space, deep navy, for slide title."
        ),
    },
    "05-vision.webp": {
        "slide": "The vision / a hundred Manthans",
        "subject": (
            "A vast bone-colored plain stretches to a horizon two-thirds "
            "of the way up the frame. The sky above the horizon is a "
            "deep navy gradient, slightly lighter near the horizon. "
            "Along the horizon, twenty small amber lantern-like points "
            "of light are scattered at uneven intervals, suggesting "
            "distant signal-towers or torches, each one independent but "
            "part of a constellation. The plain in the foreground is "
            "mostly empty, with a single small coral-tree silhouette "
            "rendered at left-third, standing alone on the plain, its "
            "branches faintly traced with amber light, the first of the "
            "constellation. Long soft shadow stretches from the coral "
            "toward lower-left. Upper-right thirty percent of the frame "
            "is clean negative space for slide title."
        ),
    },
}


def post_json(url: str, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data, headers={**headers, "Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def extract_image_b64(resp: dict[str, Any]) -> str | None:
    choices = resp.get("choices") or []
    if not choices:
        return None
    msg = choices[0].get("message") or {}
    images = msg.get("images") or []
    for img in images:
        url = (img.get("image_url") or {}).get("url") or img.get("url")
        if isinstance(url, str) and url.startswith("data:image"):
            return url.split(",", 1)[1]
    content = msg.get("content")
    if isinstance(content, list):
        for part in content:
            if not isinstance(part, dict):
                continue
            url = (part.get("image_url") or {}).get("url") or part.get("url")
            if isinstance(url, str) and url.startswith("data:image"):
                return url.split(",", 1)[1]
    return None


def call_image_model(prompt: str, key: str) -> bytes:
    body = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "modalities": ["image", "text"],
    }
    try:
        resp = post_json(ENDPOINT, body, {"Authorization": f"Bearer {key}"})
    except urllib.error.HTTPError as e:
        if e.code == 404:
            sys.stderr.write(
                f"  primary {MODEL} 404'd, retrying with {FALLBACK_MODEL}\n"
            )
            body["model"] = FALLBACK_MODEL
            resp = post_json(ENDPOINT, body, {"Authorization": f"Bearer {key}"})
        else:
            raise
    b64 = extract_image_b64(resp)
    if not b64:
        sys.stderr.write(f"  no image: {json.dumps(resp)[:400]}\n")
        raise RuntimeError("no image returned")
    return base64.b64decode(b64)


def to_webp(png_bytes: bytes, out_path: Path, quality: int = 85) -> int:
    """Encode to WebP. Pitch deck images use higher quality (85) than
    the blog illustrations because they will be displayed at projector
    scale, where compression artifacts read as unprofessional."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_png = out_path.with_suffix(".tmp.png")
    tmp_png.write_bytes(png_bytes)
    cwebp = shutil.which("cwebp") or "/opt/homebrew/bin/cwebp"
    subprocess.check_call(
        [
            cwebp, "-q", str(quality), "-m", "6", "-mt",
            "-resize", "1920", "0",
            str(tmp_png), "-o", str(out_path),
        ],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    tmp_png.unlink(missing_ok=True)
    return out_path.stat().st_size


def main() -> int:
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        sys.stderr.write("OPENROUTER_API_KEY not set\n")
        return 1
    sys.stderr.write(
        "Generating 5 pitch deck hero images.\n"
        "Locked style anchor + per-slide subject prompts.\n"
        "Upper-right negative space reserved on every image for title overlay.\n\n"
    )
    total = 0
    for fname, spec in SCENES.items():
        out = DECK_DIR / fname
        if out.exists():
            sys.stderr.write(f"  skip  {fname} ({out.stat().st_size} bytes)\n")
            total += out.stat().st_size
            continue
        prompt = (
            f"{STYLE_ANCHOR.strip()}\n\n"
            f"SLIDE FOR THIS IMAGE: {spec['slide']}\n\n"
            f"SUBJECT FOR THIS IMAGE:\n{spec['subject'].strip()}\n\n"
            "Re-read the VISUAL STYLE block above. Match every constraint. "
            "Generate ONE image at 1920x1080. The upper-right 30 percent of "
            "the frame must be clean negative space so a slide title can "
            "overlay without competing. Do not place any subject elements "
            "in the upper-right region."
        )
        sys.stderr.write(f"  gen   {fname:30s} ({spec['slide']})\n")
        png = call_image_model(prompt, key)
        size = to_webp(png, out)
        total += size
        sys.stderr.write(f"        -> {size} bytes\n")
        time.sleep(0.4)
    sys.stderr.write(f"\nTotal: {total / 1024:.1f} KB across {len(SCENES)} files\n")
    sys.stderr.write(f"Output: {DECK_DIR}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
