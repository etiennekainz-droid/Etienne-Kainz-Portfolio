(function () {
  "use strict";

  window.PORTFOLIO_PROJECTS = {
    "scissor-lift": {
      no: "2.1",
      title: "Scissor Lift Table",
      status: "Complete",
      meta: ["PTC Creo Parametric 12", "Machine design", "FKM verification"],
      line: "350 kg machine-design assembly with catalogue integration, ISO fits, production drawings, and FKM structural verification.",
      images: [
        ["assets/projects/scissor-lift/sl-06.jpg", "Assembly — raised position"],
        ["assets/projects/scissor-lift/sl-01.jpg", "Assembly — lowered position"],
        ["assets/projects/scissor-lift/sl-02.jpg", "Undercarriage and drive"],
        ["assets/projects/scissor-lift/sl-03.jpg", "CAD detail / joint study"],
        ["assets/projects/scissor-lift/sl-04.jpg", "CAD detail / guide system"],
        ["assets/projects/scissor-lift/sl-05.jpg", "CAD detail / platform interface"],
        ["assets/projects/scissor-lift/sl-07.jpg", "Assembly view"],
        ["assets/projects/scissor-lift/sl-08.jpg", "Assembly view / structure"],
        ["assets/projects/scissor-lift/sl-09.jpg", "Spindle detail drawing — Tr 28×5"],
        ["assets/projects/scissor-lift/sl-10.jpg", "Bearing housing — datum setup"],
        ["assets/projects/scissor-lift/sl-11.jpg", "Castor mount — detail"],
        ["assets/projects/scissor-lift/sl-12.jpg", "Flange — reference check"]
      ]
    },
    "aerospace-platform": {
      no: "2.2",
      title: "Small High-Agility Aerospace Platform",
      status: "In progress",
      meta: ["Fusion 360", "Concept design", "Aerodynamic braking"],
      line: "A compact flight platform and testbed for a high-authority, control-surface-based braking concept.",
      images: [
        ["assets/projects/aerospace/photo.jpg", "TMR-L concept — flight render"],
        ["assets/projects/aerospace/collage.png", "Render set — flight and CAD views"],
        ["assets/projects/aerospace/cad-01.png", "CAD model — working grid 01"],
        ["assets/projects/aerospace/cad-02.png", "CAD model — working grid 02"],
        ["assets/projects/aerospace/cad-03.png", "CAD model — working grid 03"],
        ["assets/projects/aerospace/cad-04.png", "CAD model — aft configuration"],
        ["assets/projects/aerospace/render-front.png", "Forward fuselage — detail render"],
        ["assets/projects/aerospace/flight.png", "Flight render — powered phase"]
      ]
    },
    "vtol-study": {
      no: "2.3",
      title: "Propulsion Architecture Trade Study — Small VTOL ISR UAV",
      status: "Complete",
      meta: ["Trade study", "CFD", "Quad-rotor vs. tilt-rotor"],
      line: "Candidate propulsion architectures compared for a small vertical-takeoff ISR platform.",
      docs: [
        ["assets/docs/vtol-propulsion-architecture.pdf", "VTOL propulsion architecture"],
        ["assets/docs/vtol-isr-propulsion.pdf", "Propulsion architecture — VTOL ISR"],
        ["assets/docs/vtol-trade-study-outline.pdf", "Trade-study outline"]
      ],
      images: [
        ["assets/projects/vtol/uav-render.png", "VTOL ISR UAV — reference configuration"],
        ["assets/projects/vtol/arch-quad.png", "System architecture — quad-rotor"],
        ["assets/projects/vtol/arch-tilt.png", "System architecture — tilt-rotor"],
        ["assets/projects/vtol/isr-field.jpg", "ISR mission context — field imagery"],
        ["assets/projects/vtol/ref-tilt.jpg", "Tilt-rotor reference"],
        ["assets/projects/vtol/ref-flight.jpg", "VTOL transition-flight reference"]
      ]
    },
    "aim174b": {
      no: "2.4",
      title: "AIM-174B Missile — CAD",
      status: "Complete",
      meta: ["SOLIDWORKS", "Surface modelling", "3-D printed scale model"],
      line: "A watertight airframe reconstruction from public dimensions, prepared for external-flow meshing and scale printing.",
      images: [
        ["assets/projects/aim174b/model-photo.jpg", "3-D printed scale model with reference notebook"],
        ["assets/projects/aim174b/title-page.png", "Design study — title sheet"],
        ["assets/projects/aim174b/aim-01.png", "Frontal view — fin arrangement"],
        ["assets/projects/aim174b/aim-02.png", "Aft view — nozzle and control surfaces"],
        ["assets/projects/aim174b/aim-03.png", "Isometric view — full airframe"],
        ["assets/projects/aim174b/aim-04.png", "Strake detail"],
        ["assets/projects/aim174b/mesh.png", "Surface mesh — full airframe"],
        ["assets/projects/aim174b/render-01.png", "Airframe render — side view"],
        ["assets/projects/aim174b/render-02.png", "Surface detail render"],
        ["assets/projects/aim174b/render-03.png", "Fin detail render"],
        ["assets/projects/aim174b/render-04.png", "Aft render — control surfaces"]
      ]
    },
    "rocket-sim": {
      no: "2.5",
      title: "Two-Stage Rocket Simulation",
      status: "Complete",
      meta: ["Python", "NumPy · Matplotlib", "Flight dynamics"],
      line: "Numerical ascent model with thrust, drag, mass variation, staging logic, and dynamic-pressure-gated ignition.",
      docs: [
        ["assets/docs/two-stage-rocket-simulation.pdf", "Two-stage rocket simulation"]
      ],
      images: [
        ["assets/projects/rocket-sim/results.png", "Results — trajectory and staging"],
        ["assets/projects/rocket-sim/physics.png", "Physics and parameters"],
        ["assets/projects/rocket-sim/code.png", "Simulation source — Python"]
      ]
    },
    "rocket-design": {
      no: "2.6",
      title: "Introduction to Rocket Design",
      status: "Complete",
      meta: ["Presentation", "TU Wien", "Thrust chamber geometry"],
      line: "A lecture-format study of thrust chamber geometry, nozzle contours, turbopump assemblies, and first-principles sizing.",
      images: [
        ["assets/projects/rocket-design/photo.jpg", "Presentation — TU Wien"],
        ["assets/projects/rocket-design/nozzle-geometry.png", "Nozzle geometry — thrust chamber design"],
        ["assets/projects/rocket-design/turbopump.png", "Turbopump assembly"],
        ["assets/projects/rocket-design/calculations.png", "Throat and exit diameter — calculations"]
      ]
    }
  };

  window.PORTFOLIO_LIGHTBOX_GROUPS = {
    "cert-quantum": [
      ["assets/certs/cu-boulder.png", "University of Colorado Boulder"],
      ["assets/certs/fig-quantum.png", "Quantum Mechanics for Engineers — |ψ|² course figure"]
    ],
    "cert-solidworks": [
      ["assets/certs/solidworks.png", "Dassault Systèmes"],
      ["assets/certs/fig-solidworks.png", "SOLIDWORKS Foundations — assembly environment"]
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
