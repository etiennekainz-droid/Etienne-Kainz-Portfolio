# Etienne Kainz — Engineering Portfolio

Static portfolio for Etienne Kainz, Mechanical Engineering at TU Wien.

## Structure

- `index.html` — the home page: one screen, no scroll. Name, photo, short
  bio, the four categories and contact.
- `projects.html` — the seven projects; `project.html?p=<key>` shows one
  project (text at the top, pictures below), rendered from `project-data.js`.
- `drawings.html`, `aerial.html`, `certifications.html` — the other
  categories, same layout: a short intro, then the pictures.
- `field.js` — the background. One WebGL point cloud on black: fine dust in
  three depth layers, seeded past every edge, carried by slow currents (the
  curl of an evolving stream function whose coordinates are folded by a
  second wave field, so eddies stretch and wrap around each other) that
  swell and ease. Near dots shift with the pointer and with scrolling, and
  the cursor presses the dust aside. Moving the cursor (or a finger) cuts it
  like a blade through a soft solid: a thin crack opens along the stroke
  with a crack-tip (square-root) opening profile, the blade drags the grains
  along and they spring back, the crack zips shut about a second behind a
  blade that keeps moving, and once it stops the rest closes from both tips
  inward. Every closed stretch leaves a hairline weld seam that fades. The cracks are painted
  each frame into a fine grid texture (signed distance to the crack,
  opening, seam, drag) that the vertex shader samples. Clicks and page
  changes send a ring through the dust.
- `site.js` — menu, page changes (internal links swap `<main>` in place so the
  background never restarts), pictures revealing as they scroll in, project
  pages, and the lightbox.
- `site.css` — all styles. Type is Geist / Geist Mono, self-hosted in
  `assets/fonts/` (SIL Open Font License, `assets/fonts/OFL.txt`).
- `project-data.js` — project text, tags and image lists.
- `assets/` — images, fonts and project PDFs.

## Run locally

Serve the folder over HTTP (page changes use `fetch`):

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy to GitHub Pages

No build step and no external dependencies. Publish from the repository root
and keep `.nojekyll`. All paths are relative.

`prefers-reduced-motion` slows the field almost to a stop and turns off the
page transitions; without WebGL the background is plain black.
