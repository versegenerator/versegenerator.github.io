# Versgenerator

Pick a Bible verse, pick a mountain photo, export a styled verse-card image.

Private demo project — no build step, no backend. Plain static HTML/CSS/JS
served as-is (works locally and via GitHub Pages).

## Run locally

```
python3 serve.py 8080
```

(Plain `python3 -m http.server` works too, but its caching makes edits
appear stale during development - `serve.py` disables that.)

Then open http://localhost:8080.

## Data

- `data/schlachter2000.json` — vendored from
  [afknapping/Schlachter2000-json](https://github.com/afknapping/Schlachter2000-json),
  licensed for use here. Required attribution ("Version Schlachter 2000 ©
  Genfer Bibelgesellschaft") is drawn onto every card that uses it — see
  `SCHLACHTER_ATTRIBUTION` in `js/bible.js`.
- `data/kjv.json` — vendored from
  [farskipper/kjv](https://github.com/farskipper/kjv) (public domain).
- `data/mountain/`, `data/water/` — local photo folders (no API, no key).
  Each source's `manifest.json` lists its image files; run
  `python3 build-manifests.py` after adding or removing photos.
