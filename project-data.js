(function () {
  "use strict";

  window.PORTFOLIO_PROJECTS = {
    "scissor-lift": {
      cover: "assets/projects/scissor-lift/render-below.webp",
      short: "350 kg lifting table, 30+ self-designed parts, strength verified to FKM and Roloff/Matek.",
      title: "Screw Jack Lifting Table",
      line: "A 350 kg lifting table with more than 30 self-designed parts: a Tr 28×5 trapezoidal spindle to DIN 103, " +
        "strength verification to the FKM guideline and Roloff/Matek, and assembly and detail drawings with ISO tolerances in PTC Creo 12.",
      images: [
        ["assets/projects/scissor-lift/render-below.webp", "Render — the lifting table from below", 1864, 1256],
        ["assets/projects/scissor-lift/render-three-quarter.webp", "Render — three-quarter view", 2000, 1351],
        ["assets/projects/scissor-lift/render-front.webp", "Render — front view, spindle nut under the platform", 2000, 1360],
        ["assets/projects/scissor-lift/render-side.webp", "Render — side view", 1604, 1080],
        ["assets/projects/scissor-lift/sl-04.jpg", "Assembly drawing — A0, 1:2, sections, details and parts list (DE)", 1800, 1273],
        ["assets/projects/scissor-lift/render-nut.webp", "Render — brass spindle nut seated between the cross tubes", 1346, 1136],
        ["assets/projects/scissor-lift/sl-03.jpg", "Strength verification — forces, Tr 28×5 spindle, buckling, bolts and welds (DE)", 1273, 1800],
        ["assets/projects/scissor-lift/render-pivot.webp", "Render — scissor pivot under the platform", 1866, 1254],
        ["assets/projects/scissor-lift/sl-05.jpg", "Spindle detail drawing — Tr 28×5", 2000, 1414],
        ["assets/projects/scissor-lift/render-plan.webp", "Render — straight-on view along the spindle", 1205, 1497],
        ["assets/projects/scissor-lift/sl-09.jpg", "The spindle drawing on screen", 1800, 1350],
        ["assets/projects/scissor-lift/render-castor.webp", "Render — castor mount, close-up", 2000, 1365],
        ["assets/projects/scissor-lift/sl-12.jpg", "Flange — reference check in Creo", 1280, 1280]
      ]
    },
    "countershaft": {
      cover: "assets/projects/countershaft/render-gears.webp",
      short: "Countershaft for a helical manual gearbox: four gears in module 3 on one 420 mm part in case-hardened 16MnCr5.",
      title: "Gearbox Countershaft VGW-0001",
      line: [
        "Countershaft for a manual gearbox with helical gears, modelled in Fusion 360. One 420 mm part in case-hardened 16MnCr5, 7.39 kg, " +
          "carries four gears in normal module 3: the 33-tooth constant-mesh gear, gears of 26 and 22 teeth at a 25° left-hand helix, " +
          "and a straight-cut 13-tooth pinion for first and reverse with a +0.25 profile shift.",
        "The A2 manufacturing drawing gives the full gear data at DIN 3961 quality 6, Ø30 k6 bearing seats at Ra 0.4, " +
          "DIN 509 undercuts, ISO 6411 centre holes and a DIN 471 circlip groove, toleranced to ISO 8015 and ISO 2768-mK."
      ],
      images: [
        ["assets/projects/countershaft/render-gears.webp", "Render — the helical gears and the straight-cut pinion", 2000, 1341],
        ["assets/projects/countershaft/drawing.webp?v=2", "Manufacturing drawing — A2, 1:1, sections, details and gear data (DE)", 3000, 2121],
        ["assets/projects/countershaft/render-iso.webp", "Render — the whole countershaft", 1733, 1038],
        ["assets/projects/countershaft/fusion-gears.webp", "Fusion 360 — helical gears and the straight-cut pinion", 2000, 1391],
        ["assets/projects/countershaft/render-end.webp", "Render — along the axis, the gears stepping down behind the journal", 1250, 1357],
        ["assets/projects/countershaft/fusion-journal.webp", "Fusion 360 — Ø30 k6 bearing journal with centre hole", 2000, 1391],
        ["assets/projects/countershaft/render-side.webp", "Render — side view", 2000, 1421],
        ["assets/projects/countershaft/mesh.webp", "Mesh view — gear Z1 selected", 2000, 1353],
        ["assets/projects/countershaft/render-length.webp", "Render — full length, 420 mm", 2000, 1071]
      ]
    },
    "vtol-study": {
      cover: "assets/projects/vtol/uav-render.png",
      short: "Quad-rotor and tilt-rotor architectures evaluated for a small ISR UAV.",
      title: "Propulsion Architecture Trade Study — Small VTOL ISR UAV",
      line: "Candidate propulsion architectures compared for a small vertical-takeoff ISR platform.",
      docs: [
        ["assets/docs/vtol-propulsion-architecture.pdf", "VTOL propulsion architecture"],
        ["assets/docs/vtol-isr-propulsion.pdf", "Propulsion architecture — VTOL ISR"]
      ],
      images: [
        ["assets/projects/vtol/uav-render.png", "VTOL ISR UAV — reference configuration", 1280, 719],
        ["assets/projects/vtol/arch-quad.png", "System architecture — quad-rotor", 1762, 1042],
        ["assets/projects/vtol/arch-tilt.png", "System architecture — tilt-rotor", 1678, 1042],
        ["assets/projects/vtol/isr-field.jpg", "ISR mission context — field imagery", 1070, 672],
        ["assets/projects/vtol/ref-tilt.jpg", "Tilt-rotor reference", 2000, 1334],
        ["assets/projects/vtol/ref-flight.jpg", "VTOL transition-flight reference", 680, 454]
      ]
    },
    "rocket-sim": {
      cover: "assets/projects/rocket-sim/results.png",
      short: "Python ascent model with drag, mass variation, staging, and q-gating.",
      title: "Two-Stage Rocket Simulation",
      line: "Numerical ascent model with thrust, drag, mass variation, staging logic, and dynamic-pressure-gated ignition.",
      docs: [
        ["assets/docs/two-stage-rocket-simulation.pdf", "Two-stage rocket simulation"]
      ],
      images: [
        ["assets/projects/rocket-sim/results.png", "Results — trajectory and staging", 1800, 1271],
        ["assets/projects/rocket-sim/physics.png", "Physics and parameters", 1162, 1652],
        ["assets/projects/rocket-sim/code.png", "Simulation source — Python", 1216, 683]
      ]
    },
    "rocket-design": {
      cover: "assets/projects/rocket-design/presentation.jpg",
      short: "Thrust chamber geometry, nozzle sizing, and turbopump fundamentals.",
      title: "Introduction to Rocket Design",
      line: "A lecture-format study of thrust chamber geometry, nozzle contours, turbopump assemblies, and first-principles sizing.",
      images: [
        ["assets/projects/rocket-design/presentation.jpg", "Presentation — TU Wien", 2060, 1170],
        ["assets/projects/rocket-design/nozzle-geometry.png", "Nozzle geometry — thrust chamber design", 652, 652],
        ["assets/projects/rocket-design/turbopump.png", "Turbopump assembly", 628, 628],
        ["assets/projects/rocket-design/calculations.png", "Throat and exit diameter — calculations", 436, 436]
      ]
    },
    "rod-end": {
      cover: "assets/projects/rod-end/render-iso.webp",
      short: "Series part measured, sketched by hand, and rebuilt in Fusion 360 with a derived drawing.",
      title: "Rod End M14 — Reverse Engineering",
      line: "A series rod end with M14×2 male thread (DIN ISO 12240-4, series K) measured against catalogue values, " +
        "fixed in a dimensioned hand sketch with a Ø14 H7 bore, and rebuilt in Fusion 360: C45 housing, brass bearing shell " +
        "and hardened 100Cr6 ball with about 16° of tilt, rendered and set out in an assembly drawing at 2:1.",
      images: [
        ["assets/projects/rod-end/render-iso.webp", "Render — rod end M14×2, isometric view", 1699, 1147],
        ["assets/drawings/rod-end-drawing.webp?v=2", "Assembly drawing, 2:1 — housing, brass bearing shell, hardened ball, parts list (DE)", 3000, 2121],
        ["assets/projects/rod-end/part.jpg", "Series part — rod end M14×2 with spherical plain bearing", 1500, 2000],
        ["assets/projects/rod-end/measurement.jpg", "Hand drawing, caliper and the series part", 1500, 2000],
        ["assets/drawings/dwg-15.jpg", "Dimensioned hand drawing with partial section and shaded sketches", 2089, 1170],
        ["assets/projects/rod-end/render-bearing.webp", "Render — spherical plain bearing, close-up", 1868, 1392],
        ["assets/projects/rod-end/render-top.webp", "Render — top view", 960, 1519],
        ["assets/projects/rod-end/render-side.webp", "Render — side view, bearing and M14×2 thread", 2000, 891]
      ]
    },
    "night-light": {
      cover: "assets/projects/nc-01/back-lit.webp",
      short: "Wall-mounted red night light: 12 LEDs, LiPo cell, USB-C, 45 mm square. Drawings ready for manufacture.",
      title: "Night Light NC-01",
      line: "Wall-mounted night light for getting up at night without switching on the room lights. " +
        "Pressing the front switches twelve red 625 nm LEDs, which shine through four diffusers onto the wall. " +
        "45 × 45 × 13.3 mm, 23.7 g. The 300 mAh LiPo cell is sized for about one year per charge and is charged over USB-C; 12 parts, snap-fit button, four thread-forming screws.",
      images: [
        ["assets/projects/nc-01/drawing-1.webp", "Assembly drawing, sheet 1 — sections A–A and B–B, details X, Y, Z, parts list (DE)", 3000, 2121],
        ["assets/projects/nc-01/drawing-2.webp", "Assembly drawing, sheet 2 — exploded view and isometric quarter section (DE)", 3000, 2121],
        ["assets/projects/nc-01/back-lit.webp", "Back — LEDs on, VHB adhesive pad", 1414, 752],
        ["assets/projects/nc-01/wall-glow.webp", "Visualisation — on the wall, LEDs on", 2000, 1209],
        ["assets/projects/nc-01/front.webp", "Front — the whole face is the button", 2000, 1210],
        ["assets/projects/nc-01/side.webp", "Side — 13.3 mm deep", 2000, 1064],
        ["assets/projects/nc-01/back.webp", "Back cover — red diffusers and screws", 2000, 1157],
        ["assets/projects/nc-01/back-studio.webp", "Back, straight on", 2000, 1064],
        ["assets/projects/nc-01/corner.webp", "Corner — countersunk screw and diffuser", 2000, 1064],
        ["assets/projects/nc-01/usb-c.webp", "USB-C charging port", 2000, 1064],
        ["assets/projects/nc-01/housing.webp", "Housing, PC/ABS", 2000, 1064],
        ["assets/projects/nc-01/split.webp", "Section — housing, button and back cover", 2000, 1213],
        ["assets/projects/nc-01/section-dark.webp", "Section, side view", 2000, 1064],
        ["assets/projects/nc-01/internals.webp", "Internals — LiPo cell, LED flex ring and diffusers", 2000, 1064],
        ["assets/projects/nc-01/pcb.webp", "Main board, 0.8 mm FR4", 2000, 1064],
        ["assets/projects/nc-01/cad-model.webp", "Fusion 360 — the assembly, 12 parts", 2000, 1393],
        ["assets/projects/nc-01/cad-internals.webp", "Fusion 360 — main board and USB-C with the button hidden", 2000, 1401],
        ["assets/projects/nc-01/cad-housing.webp", "Fusion 360 — housing", 2000, 1439],
        ["assets/projects/nc-01/cad-screw.webp", "Fusion 360 — screw boss in the back cover", 2000, 1392]
      ]
    }
  };

  // Display order on the list and for previous / next.
  window.PORTFOLIO_PROJECT_ORDER = [
    "night-light", "countershaft", "rod-end", "scissor-lift", "vtol-study", "rocket-sim", "rocket-design"
  ];
})();
