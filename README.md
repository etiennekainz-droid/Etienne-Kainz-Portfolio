# Etienne Kainz — Engineering Portfolio

Static portfolio for Etienne Kainz, Mechanical Engineering at TU Wien.

## Structure

- `index.html` — the home page: one screen, no scroll. Name, photo, short
  bio, the four categories and contact.
- `projects.html` — the seven projects; `project.html?p=<key>` shows one
  project (text at the top, pictures below), rendered from `project-data.js`.
- `drawings.html`, `aerial.html`, `certifications.html` — the other
  categories, same layout: a short intro, then the pictures.
- `field.js` — the background. One WebGL point cloud on black: fine dust over
  the whole screen and the K mark as a denser cloud that frays into it. The
  pointer cuts through both: a coarse grid of spring-dampers holds a wake and
  a cut (opening amplitude plus signed distance to the cut line), sampled by
  every particle in the vertex shader, so a fast stroke splits the dots along
  its path and the cut heals. Page changes scatter the K and let it re-form.
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
page transitions; without WebGL the page shows the K mark as a faint still.
