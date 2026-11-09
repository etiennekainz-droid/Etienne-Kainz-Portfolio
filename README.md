# Etienne Kainz — Portfolio

Static portfolio for Etienne Kainz, Mechanical Engineering at TU Wien.

## Structure

- `index.html` — the home page: one screen, no scroll. Name, photo, short
  bio, the four categories and contact.
- `projects.html` — the projects; `project.html?p=<key>` shows one
  project (text at the top, pictures below), rendered from `project-data.js`.
- `drawings.html`, `aerial.html`, `certifications.html` — the other
  categories, same layout: a short intro, then the pictures. The Drawings +
  Misc and Aerial Photography pages show exactly what is in the matching media
  folders, in a shuffled order that keeps pictures of the same kind, project
  or format apart and puts tall pictures in the narrow slots.
- `field.js` — the background: a night sky in WebGL, drawn additively on
  black and laid out anew on every visit. Most of its stars are very fine and
  far away and follow a map: one broad band along a diagonal, like the Milky
  Way, swelling into a bulge, bunched into star clouds and cut by dark
  streaks, lanes, threads and clouds that run with it. The same map is drawn
  once more as a faint glow, so the dark lanes stand against it. In the sky
  are a few globular clusters, a small spiral galaxy seen at a slant, two
  remoter ones and two nebulae. The other stars lie at every distance in
  front of it: the view drifts slowly sideways, so near stars pass faster
  than far ones, and the same parallax answers the pointer and scrolling.
  Every star is a small gaussian spot, so it glides between pixels instead of
  snapping, and twinkles at its own pace; the few brightest carry a fine
  cross of spikes. Nothing is drawn at the pointer: where it (or a finger)
  moves, the stars near it are carried a few px along and swing back. Clicks
  and page changes send a ring through the sky.
- `site.js` — menu, page changes (internal links swap `<main>` in place so the
  background never restarts), pictures revealing as they scroll in, the home
  page's preview cards, project pages, and the lightbox. Pointing at a
  category on the home page deals six of its pictures out of the label as a
  loose pile (springs per card, tilting into their motion). A category opens
  in two steps: the first click or tap holds its pile, the second (on the
  label, a card or the hint under the pile) opens the page.
- `site.css` — all styles. Type is Geist / Geist Mono, self-hosted in
  `assets/fonts/` (SIL Open Font License, `assets/fonts/OFL.txt`).
- `project-data.js` — project text, tags and image lists.
- `assets/` — images, fonts and project PDFs. `assets/thumbs/` holds the
  preview cards, six hand-picked pictures per category listed in
  `tools/thumbs.py`; rebuild them with `python3 tools/thumbs.py` (needs Pillow)
  and bump `DECK_VERSION` in `site.js`.

## Visits

GoatCounter (no cookies) counts visits per day, pages, referrers and countries
at https://eckainz.goatcounter.com. Every page loads its `count.js`; `site.js`
counts the in-place page changes too. Localhost is never counted. To keep your
own visits out, open `https://etiennekainz.com/#toggle-goatcounter` once in
each browser you use.

## Run locally

Serve the folder over HTTP (page changes use `fetch`):

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy to GitHub Pages

No build step and no external dependencies. Publish from the repository root
and keep `.nojekyll`. All paths are relative.

`prefers-reduced-motion` slows the sky almost to a stop and turns off the
sway, the rings and the page transitions; without WebGL the background is
plain black.
