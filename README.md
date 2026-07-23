# Etienne Kainz — Engineering Portfolio

Static portfolio for Etienne Kainz, Mechanical Engineering at TU Wien.

## Structure

- `index.html` — one-page portfolio with sections 01–07
- `drawings.html` — 12-figure technical drawing register
- `aerial.html` — 21-photograph aerial archive
- `quantum-field.js` — scroll-linked binary probability field
- `elastic-wave.js` — interactive FIG. 0.2 coupled elastic-wave lattice
- `main.js` — loading sequence, navigation, motion, filtering, overlays, and lightboxes
- `project-data.js` — project case-file content and original media mapping
- `styles.css` — site-wide black/white editorial design system
- `assets/` — original images and PDFs, with paths unchanged

## Run locally

Serve the folder over HTTP:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy to GitHub Pages

The repository has no build step. Publish from the repository root and keep
`.nojekyll`. All local paths are relative, so the site works on a custom domain
or a GitHub project-page subpath.

The motion layer loads GSAP, ScrollTrigger, Lenis, and Three.js from pinned CDN
versions. Native scrolling remains available if a CDN is unavailable.
`prefers-reduced-motion` uses a static field and static elastic-wave state.
