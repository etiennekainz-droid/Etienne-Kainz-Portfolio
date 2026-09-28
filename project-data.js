(function () {
  "use strict";

  window.PORTFOLIO_PROJECTS = {
    "scissor-lift": {
      no: "2.2",
      title: "Scissor Lift Table",
      status: "Complete",
      meta: ["PTC Creo Parametric 12", "Machine design", "FKM verification"],
      line: "350 kg machine-design assembly with catalogue integration, ISO fits, production drawings, and FKM structural verification.",
      images: [
        ["assets/projects/scissor-lift/sl-06.jpg", "Assembly — raised position", 1800, 1176],
        ["assets/projects/scissor-lift/sl-01.jpg", "Assembly — lowered position", 2000, 1262],
        ["assets/projects/scissor-lift/sl-02.jpg", "Undercarriage and drive", 1948, 1541],
        ["assets/projects/scissor-lift/sl-03.jpg", "CAD detail / joint study", 1273, 1800],
        ["assets/projects/scissor-lift/sl-04.jpg", "CAD detail / guide system", 1800, 1273],
        ["assets/projects/scissor-lift/sl-05.jpg", "CAD detail / platform interface", 2000, 1414],
        ["assets/projects/scissor-lift/sl-07.jpg", "Assembly view", 1800, 1163],
        ["assets/projects/scissor-lift/sl-08.jpg", "Assembly view / structure", 1800, 1325],
        ["assets/projects/scissor-lift/sl-09.jpg", "Spindle detail drawing — Tr 28×5", 1800, 1350],
        ["assets/projects/scissor-lift/sl-10.jpg", "Bearing housing — datum setup", 1280, 1280],
        ["assets/projects/scissor-lift/sl-11.jpg", "Castor mount — detail", 1280, 1280],
        ["assets/projects/scissor-lift/sl-12.jpg", "Flange — reference check", 1280, 1280]
      ]
    },
    "aerospace-platform": {
      no: "2.3",
      title: "Small High-Agility Aerospace Platform",
      status: "In progress",
      meta: ["Fusion 360", "Concept design", "Aerodynamic braking"],
      line: "A compact flight platform and testbed for a high-authority, control-surface-based braking concept.",
      images: [
        ["assets/projects/aerospace/photo.jpg", "TMR-L concept — flight render", 1023, 610],
        ["assets/projects/aerospace/collage.jpg", "Render set — flight and CAD views", 1600, 1488],
        ["assets/projects/aerospace/cad-01.jpg", "CAD model — working grid 01", 2000, 1084],
        ["assets/projects/aerospace/cad-02.jpg", "CAD model — working grid 02", 1600, 896],
        ["assets/projects/aerospace/cad-03.jpg", "CAD model — working grid 03", 1772, 1096],
        ["assets/projects/aerospace/cad-04.jpg", "CAD model — aft configuration", 2000, 1412],
        ["assets/projects/aerospace/render-front.jpg", "Forward fuselage — detail render", 1148, 1148],
        ["assets/projects/aerospace/flight.jpg", "Flight render — powered phase", 1600, 1600]
      ]
    },
    "vtol-study": {
      no: "2.4",
      title: "Propulsion Architecture Trade Study — Small VTOL ISR UAV",
      status: "Complete",
      meta: ["Trade study", "CFD", "Quad-rotor vs. tilt-rotor"],
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
    "aim174b": {
      no: "2.5",
      title: "AIM-174B Missile — CAD",
      status: "Complete",
      meta: ["Surface modelling", "CFD surface mesh", "3-D printed scale model"],
      line: "A watertight airframe reconstruction from public dimensions, prepared for external-flow meshing and scale printing.",
      images: [
        ["assets/projects/aim174b/model-photo.jpg", "3-D printed scale model with reference notebook", 1280, 1280],
        ["assets/projects/aim174b/title-page.jpg", "Design study — title sheet", 1238, 1580],
        ["assets/projects/aim174b/aim-01.jpg", "Frontal view — fin arrangement", 1056, 1062],
        ["assets/projects/aim174b/aim-02.jpg", "Aft view — nozzle and control surfaces", 1350, 1398],
        ["assets/projects/aim174b/aim-03.jpg", "Isometric view — full airframe", 1534, 1072],
        ["assets/projects/aim174b/aim-04.jpg", "Strake detail", 1600, 925],
        ["assets/projects/aim174b/mesh.png", "Surface mesh — full airframe", 938, 640],
        ["assets/projects/aim174b/render-01.jpg", "Airframe render — side view", 1280, 592],
        ["assets/projects/aim174b/render-02.jpg", "Surface detail render", 1185, 1185],
        ["assets/projects/aim174b/render-03.jpg", "Fin detail render", 1177, 1177]
      ]
    },
    "rocket-sim": {
      no: "2.6",
      title: "Two-Stage Rocket Simulation",
      status: "Complete",
      meta: ["Python", "NumPy · Matplotlib", "Flight dynamics"],
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
      no: "2.7",
      title: "Introduction to Rocket Design",
      status: "Complete",
      meta: ["Presentation", "TU Wien", "Thrust chamber geometry"],
      line: "A lecture-format study of thrust chamber geometry, nozzle contours, turbopump assemblies, and first-principles sizing.",
      images: [
        ["assets/projects/rocket-design/presentation.jpg", "Presentation — TU Wien", 2060, 1170],
        ["assets/projects/rocket-design/nozzle-geometry.png", "Nozzle geometry — thrust chamber design", 652, 652],
        ["assets/projects/rocket-design/turbopump.png", "Turbopump assembly", 628, 628],
        ["assets/projects/rocket-design/calculations.png", "Throat and exit diameter — calculations", 436, 436]
      ]
    },
    "rod-end": {
      no: "2.1",
      title: "Rod End M14 — Reverse Engineering",
      status: "Complete",
      meta: ["Fusion 360", "Caliper measurement · DIN 862", "ISO 2768-mK drawing"],
      line: "A series rod end with M14×2 male thread (DIN ISO 12240-4, series K) measured against catalogue values, " +
        "fixed in a dimensioned hand sketch with a Ø14 H7 bore, and rebuilt as a Fusion 360 solid model with a derived technical drawing.",
      images: [
        ["assets/projects/rod-end/project-sheet.jpg", "Project sheet — the full process on one A4 page (DE)", 2400, 3395],
        ["assets/projects/rod-end/part.jpg", "Series part — rod end M14×2 with spherical plain bearing", 1500, 2000],
        ["assets/projects/rod-end/measurement.jpg", "Caliper measurement and dimensioned hand sketch", 1500, 2000],
        ["assets/projects/rod-end/cad-iso.jpg", "Solid model — Fusion 360, isometric view", 1556, 1070],
        ["assets/projects/rod-end/cad-front.jpg", "Solid model — front view", 906, 1392],
        ["assets/projects/rod-end/drawing.jpg", "Technical drawing — three views, partial section, ISO 2768-mK, scale 1:1", 3000, 2090]
      ]
    }
  };

  window.PORTFOLIO_LIGHTBOX_GROUPS = {
    "cert-quantum": [
      ["assets/certs/cu-boulder.png", "University of Colorado Boulder"],
      ["assets/certs/fig-quantum.png", "Quantum Mechanics for Engineers — |ψ|² course figure"]
    ],
    "cert-math": [
      ["assets/certs/hkust.jpg", "The Hong Kong University of Science and Technology"],
      ["assets/certs/fig-math.jpg", "Mathematics for Engineers — linear algebra course figure"]
    ],
    "cert-oilgas": [
      ["assets/certs/duke.jpg", "Duke Nicholas School of the Environment"],
      ["assets/certs/fig-oilgas.jpg", "Oil & Gas Operations and Markets — offshore operations"]
    ]
  };
})();
