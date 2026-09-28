# Etienne Kainz — Engineering Portfolio

Static portfolio for Etienne Kainz, Mechanical Engineering at TU Wien.

## Structure

- `index.html` — one-page portfolio with sections 01–06
- `drawings.html` — 15-figure drawings and miscellaneous studies register
- `aerial.html` — 21-photograph aerial archive
- `flow-field.js` — the background: a live engineering test section rendered
  on a glyph grid. Particle mechanisms (fan stage, gear train, wing section,
  exploded shaft, terrain survey, gyroscope, ground-station dish, and a
  thrust chamber that ignites during the opening scroll) move like the real
  hardware; a Navier–Stokes smoke solver runs on the same grid with the
  mechanisms as moving boundaries; glyphs follow detected edges and fade
  hidden lines through a per-cell depth buffer; a drafting layer adds
  chain-line axes, live dimensions, leaders, balloons, a sweeping section
  cut, and live engineering plots (Cp, chamber pressure, mesh stiffness,
  beam pattern, terrain profile). The same file is both the page-side host
  and the engine: the host measures the document and forwards scroll,
  pointer and layout, while the engine renders inside a Web Worker on an
  OffscreenCanvas, so the simulation never competes with scrolling for the
  main thread. Browsers without OffscreenCanvas (or `file://` pages) run
  the engine in the page instead; `?field=inline` forces that path
- `main.js` — loading sequence, navigation, motion, filtering, overlays, and
  lightboxes; also the scroll governor, which adds weight to forward
  scrolling when a visitor gets ahead of the moment the field is showing
- `project-data.js` — project case-file content and original media mapping
- `styles.css` — site-wide black/white editorial design system; content
  panels are drawn as drafting sheets (knockout paper, registration marks,
  sheet tags) so they read as part of the same drawing as the field
- `assets/` — original images and PDFs, with paths unchanged

## Run locally

Serve the folder over HTTP (the field's worker needs an HTTP origin):

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy to GitHub Pages

The repository has no build step. Publish from the repository root and keep
`.nojekyll`. All local paths are relative, so the site works on a custom domain
or a GitHub project-page subpath.

The motion layer loads GSAP, ScrollTrigger, and Lenis from pinned CDN versions. Native scrolling remains available if a CDN is unavailable.
`prefers-reduced-motion` shows a single still frame of the field (no solver).
