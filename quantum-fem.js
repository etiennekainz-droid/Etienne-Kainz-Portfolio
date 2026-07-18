/*
  FIG. 0.1 — coupled quantum-dot finite-element field study.
  The field is a normalized reduced-order model sampled on a structured
  tetrahedral mesh. It visualizes the engineering workflow faithfully without
  claiming to be a production quantum solver.
*/
(function () {
  "use strict";

  var canvas = document.getElementById("quantumFemCanvas");
  var study = document.getElementById("quantumStudy");
  if (!canvas || !study) return;

  var statusNode = document.getElementById("quantumStatus");
  var hintNode = document.getElementById("quantumHint");
  var meshNode = document.getElementById("quantumMesh");
  var normNode = document.getElementById("quantumNorm");
  var rightNode = document.getElementById("quantumRight");
  var phaseNodes = Array.prototype.slice.call(document.querySelectorAll(".quantum-phases li"));
  var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var reducedMotion = motionQuery.matches;
  var lastUiKey = "";
  var lastFieldBroadcast = "free";
  var INTRO_SECONDS = 5.8;
  // P_R ≈ sin²(ΔE t / 2ℏ): 2π / ω gives a 7.0 s left→right→left cycle.
  var TUNNEL_OMEGA = 0.9;

  var phaseData = [
    {
      end: 0.18,
      status: "DOMAIN / DISCRETIZATION · Ω / ∂Ω",
      detail: "P1 TETRAHEDRA · TRUNCATED DOMAIN"
    },
    {
      end: 0.38,
      status: "GLOBAL ASSEMBLY · H = (ℏ²/2m*)K + Vₕ",
      detail: "ELEMENT MATRICES → GLOBAL H, M"
    },
    {
      end: 0.58,
      status: "GENERALIZED EIGENPROBLEM · Hφₙ = EₙMφₙ",
      detail: "φ₀ / φ₁ / φ₂ · ΔE = ℏω"
    },
    {
      end: 0.82,
      status: "COHERENT TUNNELLING · J = (ℏ/m*) Im(ψ*∇ψ)",
      detail: "SUPERPOSITION · PROBABILITY CURRENT"
    },
    {
      end: 1.01,
      status: "LOCAL h/2 REFINEMENT VIEW · MESH CHECK",
      detail: "REFINED DISCRETIZATION OVERLAY · REDUCED MODEL"
    }
  ];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mix(a, b, amount) {
    return a + (b - a) * amount;
  }

  function smooth(value) {
    value = clamp(value, 0, 1);
    return value * value * (3 - 2 * value);
  }

  function windowed(value, start, end) {
    return smooth((value - start) / Math.max(0.0001, end - start));
  }

  function pulseWindow(value, start, peak, end) {
    if (value <= start || value >= end) return 0;
    if (value < peak) return smooth((value - start) / (peak - start));
    return 1 - smooth((value - peak) / (end - peak));
  }

  function phaseIndex(progress) {
    for (var index = 0; index < phaseData.length; index += 1) {
      if (progress < phaseData[index].end) return index;
    }
    return phaseData.length - 1;
  }

  function autonomousProgress(time) {
    if (reducedMotion) return 0.9;
    return smooth(clamp(time / INTRO_SECONDS, 0, 1));
  }

  function seededRandom(seed) {
    var state = seed >>> 0;
    return function () {
      state += 0x6D2B79F5;
      var value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  /* A seeded event queue replaces a short repeated "video" cycle. Gate
     quenches, modal injections, weak measurements and residual-driven mesh
     refinement all receive different intervals, durations and locations. The
     deterministic seed keeps QA reproducible while the history never closes
     into a practical common period. */
  function createAutonomousController(seed) {
    var random = seededRandom(seed || 0x51A7E);
    var initialized = false;
    var events = {};

    function makeEvent(name, firstDelay, durationMin, durationMax, gapMin, gapMax) {
      events[name] = {
        name: name,
        start: INTRO_SECONDS + firstDelay,
        duration: mix(durationMin, durationMax, random()),
        durationMin: durationMin,
        durationMax: durationMax,
        gapMin: gapMin,
        gapMax: gapMax,
        x: mix(-1.65, 1.65, random()),
        z: mix(-0.7, 0.7, random()),
        outcome: random() < 0.5 ? -1 : 1,
        serial: 0
      };
    }

    function initialize() {
      if (initialized) return;
      initialized = true;
      makeEvent("gate", 0.35, 1.65, 2.55, 3.4, 6.4);
      makeEvent("refine", 0.75, 1.8, 3.2, 4.2, 7.5);
      makeEvent("surge", 1.25, 1.25, 2.15, 5.0, 8.7);
      makeEvent("excited", 2.1, 1.7, 2.8, 6.5, 11.0);
      makeEvent("measure", 3.6, 1.25, 2.05, 10.0, 17.0);
      makeEvent("caustic", 0.55, 2.5, 4.6, 2.8, 5.8);
    }

    function advanceEvent(event, time) {
      while (time > event.start + event.duration) {
        event.start += event.duration + mix(event.gapMin, event.gapMax, random());
        event.duration = mix(event.durationMin, event.durationMax, random());
        event.x = mix(-1.85, 1.85, random());
        event.z = mix(-0.82, 0.82, random());
        event.outcome = random() < 0.5 ? -1 : 1;
        event.serial += 1;
      }
      if (time < event.start || time > event.start + event.duration) return 0;
      var local = (time - event.start) / event.duration;
      return Math.pow(Math.sin(local * Math.PI), 1.45);
    }

    return {
      update: function (time, progress) {
        initialize();
        var controls = {
          gate: 0,
          excited: 0,
          surge: 0,
          measure: 0,
          refine: 0,
          caustic: 0,
          gateX: 0,
          focusX: 0,
          focusZ: 0,
          measurementOutcome: 1,
          eventSerial: 0,
          id: "free",
          status: "",
          detail: ""
        };
        if (reducedMotion || progress < 0.999) return controls;

        controls.gate = advanceEvent(events.gate, time);
        controls.refine = advanceEvent(events.refine, time);
        controls.surge = advanceEvent(events.surge, time);
        controls.excited = advanceEvent(events.excited, time);
        controls.measure = advanceEvent(events.measure, time);
        controls.caustic = advanceEvent(events.caustic, time);
        controls.gateX = events.gate.x;
        controls.focusX = controls.refine > controls.measure ? events.refine.x : events.measure.x;
        controls.focusZ = controls.refine > controls.measure ? events.refine.z : events.measure.z;
        controls.measurementOutcome = events.measure.outcome;
        controls.eventSerial = events.gate.serial + events.refine.serial * 7 +
          events.surge.serial * 17 + events.excited.serial * 31 + events.measure.serial * 47;

        var channels = [];
        if (controls.gate > 0.075) channels.push("δV");
        if (controls.excited > 0.075) channels.push("φ₂");
        if (controls.surge > 0.075) channels.push("J(t)");
        if (controls.measure > 0.075) channels.push("Mᶻ");
        if (controls.refine > 0.16) channels.push("h/2");
        if (!channels.length) return controls;

        var strongest = Math.max(
          controls.gate,
          controls.excited,
          controls.surge,
          controls.measure * 1.08,
          controls.refine * 0.82
        );
        if (channels.length > 1) {
          controls.id = "composite-" + channels.join("-");
          controls.status = "NONCOMMUTING SOLVER EVENT · " + channels.join(" + ");
          controls.detail = "STATE HISTORY + ADAPTIVE DISCRETIZATION → LIVE RESPONSE";
        } else if (strongest === controls.measure * 1.08) {
          controls.id = "measure-" + events.measure.serial;
          controls.status = "WEAK MEASUREMENT TRAJECTORY · Mᶻ";
          controls.detail = "CONDITIONAL σᶻ UPDATE · NORM-PRESERVING SINGLE TRAJECTORY";
        } else if (strongest === controls.gate) {
          controls.id = "gate-" + events.gate.serial;
          controls.status = "GATE QUENCH δV(t) · LOCAL DETUNING";
          controls.detail = "LOCAL POTENTIAL STEP → PHASE-SHEAR CAUSTIC";
        } else if (strongest === controls.excited) {
          controls.id = "excited-" + events.excited.serial;
          controls.status = "EXCITED-MODE INJECTION · φ₂ ADMIXTURE";
          controls.detail = "BRIEF BASIS-2 OCCUPATION → TRANSVERSE NODAL SHEET";
        } else if (strongest === controls.surge) {
          controls.id = "surge-" + events.surge.serial;
          controls.status = "BARRIER QUENCH · J(t) COUPLING PULSE";
          controls.detail = "TRANSIENT BARRIER NARROWING → CURRENT-TUBE SURGE";
        } else {
          controls.id = "refine-" + events.refine.serial;
          controls.status = "RESIDUAL ESTIMATOR · ADAPTIVE h/2 SWARM";
          controls.detail = "LOCAL ERROR INDICATOR ηₖ → MOVING REFINEMENT PATCH";
        }
        return controls;
      }
    };
  }

  /* Stateful two-level core in the localized-dot basis. The Bloch vector is
     advanced exactly for each piecewise-constant frame Hamiltonian via
     Rodrigues rotation under Ω = (-2J, 0, Δ). Gate/touch detuning therefore
     leaves phase history instead of merely changing a frame's appearance. */
  function createBlochEvolution() {
    var state = {
      x: 0,
      y: 0,
      z: 1,
      phase: 0,
      lastTime: 0,
      live: false
    };

    function resultFromState(coupling, controls) {
      var leftMagnitude = Math.sqrt(Math.max(0, (1 + state.z) * 0.5));
      var rightReal = 0;
      var rightImag = 0;
      if (leftMagnitude > 0.00001) {
        rightReal = state.x / (2 * leftMagnitude);
        rightImag = state.y / (2 * leftMagnitude);
      } else {
        rightReal = 1;
      }
      var cosPhase = Math.cos(state.phase);
      var sinPhase = Math.sin(state.phase);
      var leftReal = leftMagnitude * cosPhase;
      var leftImag = leftMagnitude * sinPhase;
      var rotatedRightReal = rightReal * cosPhase - rightImag * sinPhase;
      var rotatedRightImag = rightReal * sinPhase + rightImag * cosPhase;
      return {
        c0r: leftReal + rotatedRightReal,
        c0i: leftImag + rotatedRightImag,
        c1r: leftReal - rotatedRightReal,
        c1i: leftImag - rotatedRightImag,
        right: clamp((1 - state.z) * 0.5, 0, 1),
        signedCurrent: clamp(state.y * coupling / TUNNEL_OMEGA, -1.35, 1.35),
        current: clamp(Math.abs(state.y) * coupling / TUNNEL_OMEGA, 0, 1.35),
        controls: controls
      };
    }

    return {
      update: function (time, progress, controls, pointer) {
        var introTheta = windowed(progress, 0.58, 0.9) * Math.PI +
          (reducedMotion || progress <= 0.58 ? 0 : time * TUNNEL_OMEGA);
        if (progress < 0.999 || reducedMotion) {
          state.x = 0;
          state.y = Math.sin(introTheta);
          state.z = Math.cos(introTheta);
          state.phase = -introTheta * 0.5;
          state.lastTime = time;
          state.live = false;
          return {
            c0r: 1,
            c0i: 0,
            c1r: Math.cos(introTheta),
            c1i: -Math.sin(introTheta),
            right: clamp((1 - state.z) * 0.5, 0, 1),
            signedCurrent: Math.sin(introTheta),
            current: Math.abs(Math.sin(introTheta)),
            controls: controls
          };
        }

        if (!state.live) {
          state.x = 0;
          state.y = Math.sin(introTheta);
          state.z = Math.cos(introTheta);
          state.phase = -introTheta * 0.5;
          state.lastTime = time;
          state.live = true;
        }

        var deltaTime = clamp(time - state.lastTime, 0, 0.05);
        state.lastTime = time;
        var coupling = TUNNEL_OMEGA * (1 + controls.surge * 0.82);
        var gateBias = clamp(controls.gateX / 1.34, -1, 1);
        var detuning = controls.gate * gateBias * 1.46;
        if (pointer && pointer.strength > 0.002) {
          coupling *= 1 + pointer.strength * Math.exp(-pointer.x * pointer.x * 0.32) * 0.3;
          detuning += pointer.strength * clamp(pointer.x / 2.15, -1, 1) * 0.92;
        }
        var omegaX = -coupling;
        var omegaZ = detuning;
        var magnitude = Math.sqrt(omegaX * omegaX + omegaZ * omegaZ);
        if (deltaTime > 0 && magnitude > 0.00001) {
          var axisX = omegaX / magnitude;
          var axisZ = omegaZ / magnitude;
          var angle = magnitude * deltaTime;
          var cosAngle = Math.cos(angle);
          var sinAngle = Math.sin(angle);
          var dot = axisX * state.x + axisZ * state.z;
          var crossX = -axisZ * state.y;
          var crossY = axisZ * state.x - axisX * state.z;
          var crossZ = axisX * state.y;
          var nextX = state.x * cosAngle + crossX * sinAngle + axisX * dot * (1 - cosAngle);
          var nextY = state.y * cosAngle + crossY * sinAngle;
          var nextZ = state.z * cosAngle + crossZ * sinAngle + axisZ * dot * (1 - cosAngle);
          var norm = Math.sqrt(nextX * nextX + nextY * nextY + nextZ * nextZ) || 1;
          state.x = nextX / norm;
          state.y = nextY / norm;
          state.z = nextZ / norm;
          state.phase -= coupling * deltaTime * 0.5;
        }
        /* Conditional weak-measurement trajectory. This is not ensemble
           decoherence: one signed measurement record gradually localizes the
           pure state, then the Hamiltonian resumes from that updated state. */
        if (deltaTime > 0 && controls.measure > 0.0001) {
          var measurementStep = controls.measure * deltaTime * 0.72;
          var record = controls.measurementOutcome || 1;
          state.z += record * (1 - state.z * state.z) * measurementStep;
          state.x *= Math.max(0.92, 1 - controls.measure * deltaTime * 0.11);
          state.y *= Math.max(0.92, 1 - controls.measure * deltaTime * 0.11);
          var measuredNorm = Math.sqrt(
            state.x * state.x + state.y * state.y + state.z * state.z
          ) || 1;
          state.x /= measuredNorm;
          state.y /= measuredNorm;
          state.z /= measuredNorm;
          state.phase += record * controls.measure * deltaTime * 0.18;
        }
        return resultFromState(coupling, controls);
      }
    };
  }

  function setStudyActive(active) {
    if (document.body) document.body.classList.toggle("quantum-active", !!active);
  }

  function updateUi(progress, meta) {
    var index = phaseIndex(progress);
    var liveEvolution = progress >= 0.999;
    var perturbed = (meta.interaction || 0) > 0.035;
    var controlId = meta.controlId || "free";
    var controlActive = controlId !== "free";
    var timeTick = Math.floor((meta.time || 0) * 5);
    var key = index + ":" + (meta.refined ? 1 : 0) + ":" + timeTick + ":" +
      (perturbed ? 1 : 0) + ":" + controlId;
    if (key === lastUiKey) return;
    lastUiKey = key;

    var broadcastId = perturbed ? "touch" : controlId;
    if (liveEvolution && broadcastId !== "free" && broadcastId !== lastFieldBroadcast) {
      lastFieldBroadcast = broadcastId;
      window.dispatchEvent(new CustomEvent("ek:field-event", {
        detail: {
          source: "quantum",
          type: perturbed ? "touch" : controlId.split("-")[0],
          intensity: perturbed ? 0.68 : 0.92
        }
      }));
    } else if (!perturbed && !controlActive) {
      lastFieldBroadcast = "free";
    }

    if (statusNode) {
      statusNode.textContent = liveEvolution
        ? (perturbed
          ? "IMPULSIVE LOCAL POTENTIAL δV · PHASE RESPONSE"
          : (controlActive
            ? meta.controlStatus
            : "COHERENT TUNNELLING · FREE EVOLUTION"))
        : phaseData[index].status;
    }
    if (hintNode) {
      hintNode.textContent = liveEvolution
        ? ((perturbed
          ? "DECAYING PHASE IMPRINT · LOCAL ENERGY RINGS"
          : (controlActive ? meta.controlDetail : "TOUCH FIELD · LOCAL PHASE KICK")) +
          " · LIVE τ " + (meta.time || 0).toFixed(1))
        : phaseData[index].detail + " · LIVE τ " + (meta.time || 0).toFixed(1);
    }
    if (meshNode) {
      meshNode.textContent =
        String(meta.nodes || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
        " NODES · " +
        String(meta.tets || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
        " " + (meta.elementLabel || "TETS") +
        (meta.refined ? " · LOCAL h/2" : "");
    }
    if (normNode) normNode.textContent = (meta.norm || 1).toFixed(4);
    if (rightNode) rightNode.textContent = ((meta.right || 0) * 100).toFixed(1) + "%";

    phaseNodes.forEach(function (node, nodeIndex) {
      node.classList.toggle("active", liveEvolution ? nodeIndex === 3 : nodeIndex === index);
      node.classList.toggle("done", liveEvolution ? nodeIndex !== 3 : nodeIndex < index);
    });
  }

  function watchVisibility(target, callback) {
    if (!window.IntersectionObserver) {
      callback(true);
      return null;
    }
    var observer = new IntersectionObserver(function (entries) {
      callback(entries[0] ? entries[0].isIntersecting : true);
    }, { threshold: 0.04, rootMargin: "6% 0px 6% 0px" });
    observer.observe(target);
    return observer;
  }

  /* Pointer/touch never owns the scene or captures input. It contributes a
     decaying local phase impulse while normal page scrolling remains native. */
  function createLocalInteraction(requestRender) {
    var state = {
      x: 0,
      z: 0,
      targetX: 0,
      targetZ: 0,
      strength: 0,
      hover: 0,
      impulse: 0
    };
    var touchGesture = null;

    function setPoint(clientX, clientY, amount, impulse) {
      var bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      var u = (clientX - bounds.left) / bounds.width;
      var v = (clientY - bounds.top) / bounds.height;
      if (u < -0.04 || u > 1.04 || v < -0.04 || v > 1.04) return;
      state.targetX = clamp((u * 2 - 1) * 4.35, -4.35, 4.35);
      state.targetZ = clamp((0.5 - v) * 2.45, -1.18, 1.18);
      state.hover = Math.max(state.hover, amount);
      if (impulse) state.impulse = clamp(state.impulse + impulse, 0, 1);
      requestRender();
    }

    function pointerMove(event) {
      if (touchGesture && event.pointerId === touchGesture.id) {
        touchGesture.x = event.clientX;
        touchGesture.y = event.clientY;
        if (Math.hypot(event.clientX - touchGesture.startX, event.clientY - touchGesture.startY) > 12) {
          touchGesture.moved = true;
        }
      }
      setPoint(event.clientX, event.clientY, event.pointerType === "touch" ? 0.27 : 0.17, 0);
    }

    function pointerDown(event) {
      if (event.pointerType === "touch") {
        touchGesture = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
          moved: false,
          started: Date.now()
        };
        setPoint(event.clientX, event.clientY, 0.24, 0);
        return;
      }
      setPoint(
        event.clientX,
        event.clientY,
        0.28,
        0.82
      );
    }

    function clearPointer() {
      state.hover = 0;
      requestRender();
    }

    function cancelPointer() {
      touchGesture = null;
      clearPointer();
    }

    function releasePointer(event) {
      if (touchGesture && event && event.pointerId === touchGesture.id) {
        if (!touchGesture.moved && Date.now() - touchGesture.started < 700) {
          setPoint(touchGesture.x, touchGesture.y, 0.38, 0.9);
        }
        touchGesture = null;
      }
      clearPointer();
    }

    if (window.PointerEvent) {
      study.addEventListener("pointermove", pointerMove, { passive: true });
      study.addEventListener("pointerdown", pointerDown, { passive: true });
      study.addEventListener("pointerleave", cancelPointer, { passive: true });
      study.addEventListener("pointercancel", cancelPointer, { passive: true });
      window.addEventListener("pointerup", releasePointer, { passive: true });
    } else {
      var legacyTouch = null;
      function firstTouch(event, impulse) {
        if (!event.touches || !event.touches[0]) return;
        var touch = event.touches[0];
        setPoint(touch.clientX, touch.clientY, 0.3, impulse);
      }
      study.addEventListener("touchstart", function (event) {
        if (!event.touches || !event.touches[0]) return;
        legacyTouch = {
          startX: event.touches[0].clientX,
          startY: event.touches[0].clientY,
          x: event.touches[0].clientX,
          y: event.touches[0].clientY,
          moved: false,
          started: Date.now()
        };
        firstTouch(event, 0);
      }, { passive: true });
      study.addEventListener("touchmove", function (event) {
        if (legacyTouch && event.touches && event.touches[0]) {
          legacyTouch.x = event.touches[0].clientX;
          legacyTouch.y = event.touches[0].clientY;
          if (Math.hypot(legacyTouch.x - legacyTouch.startX, legacyTouch.y - legacyTouch.startY) > 12) {
            legacyTouch.moved = true;
          }
        }
        firstTouch(event, 0);
      }, { passive: true });
      study.addEventListener("touchend", function () {
        if (legacyTouch && !legacyTouch.moved && Date.now() - legacyTouch.started < 700) {
          setPoint(legacyTouch.x, legacyTouch.y, 0.38, 0.9);
        }
        legacyTouch = null;
        clearPointer();
      }, { passive: true });
      study.addEventListener("touchcancel", function () {
        legacyTouch = null;
        clearPointer();
      }, { passive: true });
    }

    return {
      state: state,
      step: function (delta) {
        if (reducedMotion) {
          state.x = state.targetX;
          state.z = state.targetZ;
          state.strength = clamp(state.hover + state.impulse * 0.45, 0, 0.45);
          state.impulse = 0;
          return;
        }
        var follow = 1 - Math.exp(-delta * 9);
        state.x += (state.targetX - state.x) * follow;
        state.z += (state.targetZ - state.z) * follow;
        state.impulse *= Math.exp(-delta * 1.18);
        state.hover *= Math.exp(-delta * 1.65);
        var targetStrength = clamp(state.hover + state.impulse, 0, 1);
        state.strength += (targetStrength - state.strength) * (1 - Math.exp(-delta * 7));
      }
    };
  }

  function bootFallback(reason) {
    var ctx = canvas.getContext("2d");
    if (!ctx) {
      var replacement = document.createElement("canvas");
      replacement.id = canvas.id;
      replacement.className = canvas.className;
      replacement.setAttribute("aria-label", canvas.getAttribute("aria-label") || "Quantum finite-element field");
      canvas.parentNode.replaceChild(replacement, canvas);
      canvas = replacement;
      ctx = canvas.getContext("2d");
    }
    if (!ctx) return;

    var width = 1;
    var height = 1;
    var dpr = 1;
    var active = true;
    var pageVisible = document.visibilityState !== "hidden";
    var raf = 0;
    var progress = autonomousProgress(0);
    var lastFrame = performance.now();
    var simulationTime = 0;
    var lastSize = "";
    var interaction;
    var evolution = createBlochEvolution();
    var controlEvolution = createAutonomousController(0xF411B4C);
    var fallbackFlowPhase = 0;
    var fallbackRandom = seededRandom(0x2DCA11);
    var fallbackWisps = [];
    for (var fallbackWispId = 0; fallbackWispId < 52; fallbackWispId += 1) {
      fallbackWisps.push({
        x: mix(-9.8, 9.8, fallbackRandom()),
        y: mix(-3.8, 3.8, fallbackRandom()),
        z: mix(-5.4, 5.4, fallbackRandom()),
        phase: fallbackRandom() * Math.PI * 2,
        speed: mix(0.22, 0.72, fallbackRandom())
      });
    }

    function resizeFallback() {
      var bounds = canvas.getBoundingClientRect();
      var nextWidth = Math.max(1, Math.round(bounds.width));
      var nextHeight = Math.max(1, Math.round(bounds.height));
      var key = nextWidth + "x" + nextHeight;
      if (key === lastSize) return;
      lastSize = key;
      width = nextWidth;
      height = nextHeight;
      dpr = Math.min(window.devicePixelRatio || 1, width < 620 ? 1.3 : 1.6);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function project(x, y, z) {
      var pointerParallax = interaction ? interaction.state.strength : 0;
      var yaw = -0.42 + progress * 0.36 +
        (interaction ? interaction.state.x * pointerParallax * 0.014 : 0);
      var pitch = 0.64 - progress * 0.17 +
        (interaction ? interaction.state.z * pointerParallax * 0.035 : 0);
      var cy = Math.cos(yaw);
      var sy = Math.sin(yaw);
      var cp = Math.cos(pitch);
      var sp = Math.sin(pitch);
      var rx = x * cy + z * sy;
      var rz = -x * sy + z * cy;
      var ry = y * cp - rz * sp;
      rz = y * sp + rz * cp;
      var scale = Math.min(width / 12.5, height / 7.2) * (1 + rz * 0.018);
      return {
        x: width * 0.52 + rx * scale,
        y: height * 0.52 - ry * scale,
        z: rz,
        s: scale
      };
    }

    function fieldAt(x, z, nowSeconds, stateData, controls) {
      var left = Math.exp(-((x + 2.05) * (x + 2.05) / 1.35 + z * z / 0.72));
      var right = Math.exp(-((x - 2.05) * (x - 2.05) / 1.35 + z * z / 0.72));
      var reveal = windowed(progress, 0.28, 0.45);
      var basisEven = left + right;
      var basisOdd = left - right;
      var excited = z * basisEven * controls.excited * 0.32;
      var excitedPhase = nowSeconds * 1.13;
      var real = basisEven * stateData.c0r + basisOdd * stateData.c1r +
        excited * Math.cos(excitedPhase);
      var imag = basisEven * stateData.c0i + basisOdd * stateData.c1i +
        excited * Math.sin(excitedPhase);
      var density = (real * real + imag * imag) * 0.25;
      if (controls.gate > 0.002) {
        var gateDx = x - controls.gateX;
        var gateLocal = Math.exp(-(gateDx * gateDx * 1.35 + z * z * 0.7));
        density *= 1 + controls.gate * gateLocal *
          Math.sin(gateDx * 5.2 - nowSeconds * 2.6) * 0.18;
      }
      if (controls.caustic > 0.002) {
        density *= 1 + controls.caustic *
          Math.sin(x * 3.15 + Math.sin(z * 2.7 - nowSeconds * 0.83) * 1.3 - nowSeconds * 1.4) *
          Math.cos(z * 3.8 - x * 0.46 + nowSeconds * 0.67) * 0.17;
      }
      if (interaction && interaction.state.strength > 0.002) {
        var dx = x - interaction.state.x;
        var dz = z - interaction.state.z;
        var radius = Math.sqrt(dx * dx + dz * dz);
        var local = Math.exp(-radius * radius * 1.15);
        var wave = Math.sin(radius * 7.4 - nowSeconds * 3.4);
        density *= 1 + interaction.state.strength * local * wave * 0.24;
        density += interaction.state.strength * local * local * 0.027;
      }
      return reveal * Math.max(0, density);
    }

    function fallbackRightProbability(nowSeconds, stateData, controls) {
      var total = 0;
      var right = 0;
      for (var i = 0; i < 64; i += 1) {
        var x = -4.6 + (i / 63) * 9.2;
        var density = fieldAt(x, 0, nowSeconds, stateData, controls);
        total += density;
        if (x > 0) right += density;
      }
      return total ? right / total : 0;
    }

    function line(a, b, colour, alpha, lineWidth) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = colour.replace("ALPHA", String(alpha));
      ctx.lineWidth = lineWidth || 1;
      ctx.stroke();
    }

    function drawFallback(nowSeconds, delta) {
      resizeFallback();
      ctx.clearRect(0, 0, width, height);

      var meshReveal = smooth(progress / 0.2);
      var fieldReveal = windowed(progress, 0.26, 0.44);
      var controls = controlEvolution.update(nowSeconds, progress);
      var refine = progress < 0.999
        ? windowed(progress, 0.78, 0.96)
        : controls.refine;
      var assembly = pulseWindow(progress, 0.16, 0.27, 0.42);
      var stateData = evolution.update(
        nowSeconds,
        progress,
        controls,
        interaction ? interaction.state : null
      );
      var signedCurrent = stateData.signedCurrent || 0;
      var fallbackCurrent = clamp(Math.abs(signedCurrent), 0, 1);
      fallbackFlowPhase += signedCurrent * (delta || 0) * (0.42 + controls.surge * 0.3);
      var energy = Math.max(
        pulseWindow(progress, 0.44, 0.54, 0.67),
        controls.gate * 0.96,
        controls.surge * 0.78,
        interaction ? interaction.state.strength * 0.92 : 0
      );
      var flux = windowed(progress, 0.56, 0.72);

      var gx;
      var gy;
      ctx.strokeStyle = "rgba(147,180,205,0.045)";
      ctx.lineWidth = 1;
      for (gx = 18 + (nowSeconds * 3) % 32; gx < width; gx += 32) {
        ctx.beginPath();
        ctx.moveTo(gx, 10);
        ctx.lineTo(gx, height - 12);
        ctx.stroke();
      }
      for (gy = 18; gy < height; gy += 32) {
        ctx.beginPath();
        ctx.moveTo(12, gy);
        ctx.lineTo(width - 12, gy);
        ctx.stroke();
      }

      var liveReveal = windowed(progress, 0.62, 0.98);
      var fallbackActivity = clamp(
        fallbackCurrent * 0.34 + controls.surge * 0.68 + controls.excited * 0.42 +
        controls.caustic * 0.82 + controls.measure * 0.54,
        0,
        1.35
      );
      fallbackWisps.forEach(function (wisp, wispId) {
        var wispClock = nowSeconds * wisp.speed + wisp.phase;
        var wispPoint = project(
          wisp.x + Math.sin(wispClock) * (0.25 + fallbackActivity * 0.55),
          wisp.y + Math.cos(wispClock * 1.37) * (0.16 + fallbackActivity * 0.3),
          wisp.z + Math.sin(wispClock * 0.73) * (0.3 + controls.measure * 0.62)
        );
        var wispAlpha = liveReveal * (0.025 + fallbackActivity * 0.075) *
          (0.45 + 0.55 * Math.abs(Math.sin(wispClock * 1.9 + wispId)));
        ctx.beginPath();
        ctx.arc(wispPoint.x, wispPoint.y, 0.55 + (wispId % 4) * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(112,196,221," + wispAlpha.toFixed(3) + ")";
        ctx.fill();
      });

      for (var causticId = 0; causticId < (width < 620 ? 3 : 5); causticId += 1) {
        ctx.beginPath();
        for (var causticPointId = 0; causticPointId < 58; causticPointId += 1) {
          var causticU = causticPointId / 57;
          var causticX = mix(-10.5, 10.5, causticU);
          var causticLens = Math.exp(-causticX * causticX * 0.026);
          var causticFold = Math.sin(
            causticX * (0.48 + causticId * 0.024) - nowSeconds * (0.46 + causticId * 0.037) +
            Math.sin(causticX * 0.19 + nowSeconds * 0.23) * 1.55 + causticId * 0.9
          );
          var causticProjected = project(
            causticX,
            (causticId - 2) * 0.31 + causticFold * (0.28 + causticLens * 0.58),
            (causticId - 2) * 0.5 + Math.cos(causticX * 0.39 + nowSeconds * 0.33) * 0.48
          );
          if (causticPointId === 0) ctx.moveTo(causticProjected.x, causticProjected.y);
          else ctx.lineTo(causticProjected.x, causticProjected.y);
        }
        ctx.strokeStyle = "rgba(105,191,217," +
          (liveReveal * (0.014 + fallbackCurrent * 0.025 + controls.caustic * 0.19)).toFixed(3) + ")";
        ctx.lineWidth = causticId === 2 ? 1.05 : 0.65;
        ctx.stroke();
      }

      var xSteps = width < 600 ? 17 : 23;
      var zSteps = width < 600 ? 8 : 12;
      var rows = [];
      var maxDensity = 0.0001;
      var ix;
      var iz;

      for (iz = 0; iz < zSteps; iz += 1) {
        var row = [];
        var z = -1.35 + (iz / (zSteps - 1)) * 2.7;
        for (ix = 0; ix < xSteps; ix += 1) {
          var x = -4.7 + (ix / (xSteps - 1)) * 9.4;
          var density = fieldAt(x, z, nowSeconds, stateData, controls);
          maxDensity = Math.max(maxDensity, density);
          row.push({ x: x, z: z, d: density });
        }
        rows.push(row);
      }

      for (iz = zSteps - 1; iz >= 0; iz -= 1) {
        for (ix = 0; ix < xSteps; ix += 1) {
          var sample = rows[iz][ix];
          var lift = fieldReveal * (sample.d / maxDensity) * 2.15 - 0.38;
          sample.p = project(sample.x, lift, sample.z);
        }
      }

      for (iz = zSteps - 1; iz > 0; iz -= 1) {
        for (ix = 0; ix < xSteps - 1; ix += 1) {
          var a = rows[iz][ix];
          var b = rows[iz][ix + 1];
          var c = rows[iz - 1][ix + 1];
          var d = rows[iz - 1][ix];
          var fill = ((a.d + b.d + c.d + d.d) * 0.25) / maxDensity;
          if (fieldReveal > 0.01 && fill > 0.025) {
            ctx.beginPath();
            ctx.moveTo(a.p.x, a.p.y);
            ctx.lineTo(b.p.x, b.p.y);
            ctx.lineTo(c.p.x, c.p.y);
            ctx.lineTo(d.p.x, d.p.y);
            ctx.closePath();
            ctx.fillStyle = "rgba(107,190,222," + (0.018 + fill * 0.17 * fieldReveal).toFixed(3) + ")";
            ctx.fill();
          }
          var order = (ix + iz * 0.7) / (xSteps + zSteps);
          if (order < meshReveal) {
            line(a.p, b.p, "rgba(147,180,205,ALPHA)", 0.1 + fill * 0.36, 0.65);
            line(a.p, d.p, "rgba(147,180,205,ALPHA)", 0.08 + fill * 0.28, 0.65);
            if ((ix + iz) % 2 === 0) line(a.p, c.p, "rgba(147,180,205,ALPHA)", 0.06 + fill * 0.2, 0.55);
          }
        }
      }

      var barrierA = project(-0.24, -0.58, -1.28);
      var barrierB = project(-0.24, 1.92, -1.28);
      var barrierC = project(0.24, 1.92, 1.28);
      var barrierD = project(0.24, -0.58, 1.28);
      ctx.beginPath();
      ctx.moveTo(barrierA.x, barrierA.y);
      ctx.lineTo(barrierB.x, barrierB.y);
      ctx.lineTo(barrierC.x, barrierC.y);
      ctx.lineTo(barrierD.x, barrierD.y);
      ctx.closePath();
      ctx.fillStyle = "rgba(207,160,104," + (0.035 + 0.11 * windowed(progress, 0.08, 0.28) + energy * 0.115).toFixed(3) + ")";
      ctx.fill();
      ctx.strokeStyle = "rgba(207,160,104," + (0.28 + energy * 0.5).toFixed(3) + ")";
      ctx.stroke();

      if (controls.gate > 0.01) {
        var gatePlaneA = project(controls.gateX, -3.8, -3.6);
        var gatePlaneB = project(controls.gateX, 4.2, -3.6);
        var gatePlaneC = project(controls.gateX, 4.2, 3.6);
        var gatePlaneD = project(controls.gateX, -3.8, 3.6);
        ctx.beginPath();
        ctx.moveTo(gatePlaneA.x, gatePlaneA.y);
        ctx.lineTo(gatePlaneB.x, gatePlaneB.y);
        ctx.lineTo(gatePlaneC.x, gatePlaneC.y);
        ctx.lineTo(gatePlaneD.x, gatePlaneD.y);
        ctx.closePath();
        ctx.fillStyle = "rgba(207,160,104," + (controls.gate * 0.045).toFixed(3) + ")";
        ctx.fill();
        ctx.strokeStyle = "rgba(207,160,104," + (controls.gate * 0.24).toFixed(3) + ")";
        ctx.stroke();
      }

      if (assembly > 0.01) {
        var scanX = mix(-4.5, 4.5, windowed(progress, 0.16, 0.4));
        var scanA = project(scanX, -0.5, -1.25);
        var scanB = project(scanX, 1.95, 1.25);
        line(scanA, scanB, "rgba(126,211,232,ALPHA)", assembly * 0.82, 1.2);
      }

      if (energy > 0.01) {
        var response = interaction ? interaction.state.strength : 0;
        var eventX = controls.gate > 0.01 ? controls.gateX : 0;
        var centre = project(
          mix(eventX, interaction ? interaction.state.x : eventX, response),
          0.7,
          interaction ? interaction.state.z * response : 0
        );
        for (var ring = 0; ring < 4; ring += 1) {
          var radius = (18 + ring * 16 + energy * 34) * (0.62 + energy * 0.42);
          ctx.beginPath();
          ctx.ellipse(centre.x, centre.y, radius, radius * 0.36, -0.3, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(207,160,104," +
            (energy * Math.max(0.1, 0.54 - ring * 0.105)).toFixed(3) + ")";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      if (controls.measure > 0.01) {
        var measurementCentre = project(controls.focusX, 0.2, controls.focusZ);
        for (var shellId = 0; shellId < 6; shellId += 1) {
          var shellRadius = (18 + shellId * 15) * (0.8 + controls.measure * 0.5);
          ctx.beginPath();
          ctx.ellipse(
            measurementCentre.x,
            measurementCentre.y,
            shellRadius,
            shellRadius * (0.38 + shellId * 0.025),
            shellId * 0.37 + nowSeconds * 0.14 * controls.measurementOutcome,
            0,
            Math.PI * 2
          );
          ctx.strokeStyle = "rgba(144,218,235," +
            (controls.measure * Math.max(0.04, 0.32 - shellId * 0.045)).toFixed(3) + ")";
          ctx.lineWidth = shellId === 0 ? 1.15 : 0.7;
          ctx.stroke();
        }
      }

      if (flux > 0.01) {
        for (var stream = 0; stream < 5; stream += 1) {
          var streamOffset = stream - 2;
          ctx.beginPath();
          for (var streamPoint = 0; streamPoint < 38; streamPoint += 1) {
            var streamU = streamPoint / 37;
            var streamX = mix(-3.45, 3.45, streamU);
            var streamEnvelope = Math.sin(Math.PI * streamU);
            var streamPhase = streamU * Math.PI * 2.25 + fallbackFlowPhase * 4.2 + stream * 0.83;
            var streamY = 0.22 + streamOffset * 0.075 * (0.35 + Math.abs(streamX) / 3.45) +
              Math.sin(streamPhase) * 0.12 * streamEnvelope;
            var streamZ = streamOffset * 0.2 +
              Math.cos(streamPhase * 0.82 + stream * 0.37) * 0.24 * streamEnvelope;
            var streamProjected = project(streamX, streamY, streamZ);
            if (streamPoint === 0) ctx.moveTo(streamProjected.x, streamProjected.y);
            else ctx.lineTo(streamProjected.x, streamProjected.y);
          }
          ctx.strokeStyle = "rgba(125,214,235," +
            (flux * (0.035 + fallbackCurrent * (stream === 2 ? 0.31 : 0.2))).toFixed(3) + ")";
          ctx.lineWidth = stream === 2 ? 1.25 : 0.75;
          ctx.stroke();
        }

        for (var packet = 0; packet < 20; packet += 1) {
          var packetT = ((fallbackFlowPhase * 0.58 + packet / 20) % 1 + 1) % 1;
          var px = mix(-2.9, 3.2, packetT);
          var packetPoint = project(px, 0.36 + Math.sin(packetT * 12 + packet) * 0.12, Math.sin(packet * 2.2) * 0.22);
          ctx.beginPath();
          ctx.arc(packetPoint.x, packetPoint.y, 1 + flux * 1.3, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(125,214,235," +
            (flux * fallbackCurrent * (0.14 + 0.52 * Math.sin(Math.PI * packetT))).toFixed(3) + ")";
          ctx.fill();
        }
      }

      if (refine > 0.01) {
        for (var rx = -0.9; rx <= 0.9; rx += 0.3) {
          var refineFocusX = progress >= 0.999 ? controls.focusX : 0;
          var refineFocusZ = progress >= 0.999 ? controls.focusZ : 0;
          var refineA = project(rx + refineFocusX, -0.5, -1.3 + refineFocusZ);
          var refineB = project(rx + refineFocusX, 1.9, 1.3 + refineFocusZ);
          line(refineA, refineB, "rgba(157,218,235,ALPHA)", refine * 0.3, 0.55);
        }
        for (var refineParticle = 0; refineParticle < 42; refineParticle += 1) {
          var particleAngle = refineParticle * 2.399 + nowSeconds * (0.34 + (refineParticle % 7) * 0.045);
          var particleRadius = 0.18 + (refineParticle % 13) / 13 * 1.45 * (1.16 - refine * 0.36);
          var refinePoint = project(
            refineFocusX + Math.cos(particleAngle) * particleRadius,
            ((refineParticle * 17) % 31) / 31 * 2.3 - 0.9,
            refineFocusZ + Math.sin(particleAngle) * particleRadius * 0.72
          );
          ctx.beginPath();
          ctx.arc(refinePoint.x, refinePoint.y, 0.65 + refine * 0.55, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(157,218,235," + (refine * 0.42).toFixed(3) + ")";
          ctx.fill();
        }
      }

      var rightProbability = fallbackRightProbability(nowSeconds, stateData, controls);
      updateUi(progress, {
        nodes: xSteps * zSteps,
        tets: (xSteps - 1) * (zSteps - 1) * 2,
        elementLabel: "TRIS",
        refined: refine > 0.05,
        norm: 1,
        right: rightProbability,
        time: nowSeconds,
        interaction: interaction ? interaction.state.strength : 0,
        controlId: controls.id,
        controlStatus: controls.status,
        controlDetail: controls.detail
      });

      ctx.font = "9px 'IBM Plex Mono', monospace";
      ctx.fillStyle = "rgba(169,177,185,0.52)";
      ctx.fillText("REDUCED-ORDER 2D COMPATIBILITY FIELD · " + reason, 18, height - 92);
    }

    function requestFallbackFrame() {
      if (!raf && active && pageVisible) raf = requestAnimationFrame(frameFallback);
    }

    interaction = createLocalInteraction(requestFallbackFrame);

    function frameFallback(now) {
      raf = 0;
      if (!active || !pageVisible) return;
      var delta = clamp((now - lastFrame) / 1000, 0, 0.05);
      lastFrame = now;
      simulationTime += reducedMotion ? 0 : delta;
      interaction.step(delta);
      progress = autonomousProgress(simulationTime);
      drawFallback(simulationTime, delta);
      if (!reducedMotion) requestFallbackFrame();
    }

    watchVisibility(canvas, function (visible) {
      active = visible;
      setStudyActive(visible);
      if (visible) {
        lastFrame = performance.now();
        requestFallbackFrame();
      }
    });
    document.addEventListener("visibilitychange", function () {
      pageVisible = document.visibilityState !== "hidden";
      if (pageVisible) requestFallbackFrame();
    });
    window.addEventListener("resize", function () {
      lastSize = "";
      requestFallbackFrame();
    }, { passive: true });
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        lastSize = "";
        requestFallbackFrame();
      }).observe(canvas);
    }
    function handleFallbackMotion(event) {
      reducedMotion = event.matches;
      progress = autonomousProgress(simulationTime);
      interaction.step(0);
      requestFallbackFrame();
    }
    if (motionQuery.addEventListener) motionQuery.addEventListener("change", handleFallbackMotion);
    else if (motionQuery.addListener) motionQuery.addListener(handleFallbackMotion);

    drawFallback(0, 0);
    requestFallbackFrame();
  }

  async function bootScene() {
    var THREE;
    try {
      THREE = await import("https://cdn.jsdelivr.net/npm/three@0.166.1/+esm");
    } catch (error) {
      bootFallback("MODULE FALLBACK");
      return;
    }

    if (!canvas.getContext || !window.WebGLRenderingContext) {
      bootFallback("WEBGL UNAVAILABLE");
      return;
    }

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance"
      });
    } catch (error) {
      bootFallback("WEBGL INITIALIZATION FALLBACK");
      return;
    }

    var isMobile = Math.min(window.innerWidth, window.innerHeight) < 650;
    var pixelCap = isMobile ? 1.3 : 1.6;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelCap));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    var scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b1015, 0.058);

    var camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
    camera.position.set(9.3, 5.4, 10.4);
    var cameraTarget = new THREE.Vector3(0, 0.18, 0);
    camera.lookAt(cameraTarget);

    var root = new THREE.Group();
    root.position.y = 0.18;
    scene.add(root);

    var NX = isMobile ? 16 : 19;
    var NY = isMobile ? 7 : 8;
    var NZ = isMobile ? 5 : 6;
    var nodeCount = NX * NY * NZ;
    var tetCount = 0;
    var nodes = [];
    var nodePositions = new Float32Array(nodeCount * 3);
    var nodeWeights = new Float32Array(nodeCount);
    var densityValues = new Float32Array(nodeCount);
    var phaseValues = new Float32Array(nodeCount);
    var rawReal = new Float32Array(nodeCount);
    var rawImag = new Float32Array(nodeCount);
    var basis0 = new Float32Array(nodeCount);
    var basis1 = new Float32Array(nodeCount);
    var basis2 = new Float32Array(nodeCount);
    var gridDx = 9.6 / (NX - 1);
    var gridDy = 3.44 / (NY - 1);
    var gridDz = 2.44 / (NZ - 1);

    function nodeIndex(i, j, k) {
      return (i * NY + j) * NZ + k;
    }

    function hash(i, j, k) {
      var value = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
      return value - Math.floor(value);
    }

    var i;
    var j;
    var k;
    var cursor = 0;
    for (i = 0; i < NX; i += 1) {
      var x = mix(-4.8, 4.8, i / (NX - 1));
      for (j = 0; j < NY; j += 1) {
        var y = mix(-1.72, 1.72, j / (NY - 1));
        for (k = 0; k < NZ; k += 1) {
          var z = mix(-1.22, 1.22, k / (NZ - 1));
          var interior = i > 0 && i < NX - 1 && j > 0 && j < NY - 1 && k > 0 && k < NZ - 1;
          var jitter = interior ? (hash(i, j, k) - 0.5) * 0.055 : 0;
          var node = {
            x: x + jitter,
            y: y + jitter * 0.42,
            z: z - jitter * 0.66,
            side: x > 0 ? 1 : 0
          };
          nodes.push(node);
          nodePositions[cursor * 3] = node.x;
          nodePositions[cursor * 3 + 1] = node.y;
          nodePositions[cursor * 3 + 2] = node.z;
          nodeWeights[cursor] = gridDx * gridDy * gridDz *
            (i === 0 || i === NX - 1 ? 0.5 : 1) *
            (j === 0 || j === NY - 1 ? 0.5 : 1) *
            (k === 0 || k === NZ - 1 ? 0.5 : 1);

          var left = Math.exp(
            -0.5 * (
              (node.x + 2.05) * (node.x + 2.05) / 0.92 +
              node.y * node.y / 0.62 +
              node.z * node.z / 0.46
            )
          );
          var right = Math.exp(
            -0.5 * (
              (node.x - 2.05) * (node.x - 2.05) / 0.92 +
              node.y * node.y / 0.62 +
              node.z * node.z / 0.46
            )
          );
          basis0[cursor] = left + right;
          basis1[cursor] = left - right;
          basis2[cursor] = node.y * (left + right) * 1.24;
          cursor += 1;
        }
      }
    }

    var meshPositionList = [];
    var meshOrderList = [];
    var tetrahedra = [];
    var uniqueEdges = Object.create(null);

    function registerTet(a, b, c, d) {
      var tet = [a, b, c, d];
      tetrahedra.push(tet);
      for (var one = 0; one < 4; one += 1) {
        for (var two = one + 1; two < 4; two += 1) {
          var low = Math.min(tet[one], tet[two]);
          var high = Math.max(tet[one], tet[two]);
          uniqueEdges[low + ":" + high] = [low, high];
        }
      }
    }

    function addEdge(aIndex, bIndex, orderBias) {
      var a = nodes[aIndex];
      var b = nodes[bIndex];
      meshPositionList.push(a.x, a.y, a.z, b.x, b.y, b.z);
      var order = clamp(
        ((a.x + b.x) * 0.5 + 4.8) / 9.6 * 0.74 +
        hash(aIndex % NX, bIndex % NY, (aIndex + bIndex) % NZ) * 0.22 +
        (orderBias || 0),
        0,
        1
      );
      meshOrderList.push(order, order);
    }

    // Every hexahedral cell is explicitly split into six P1 tetrahedra around
    // the v000–v111 body diagonal. The displayed edge network and element
    // count therefore come from the same connectivity.
    for (i = 0; i < NX - 1; i += 1) {
      for (j = 0; j < NY - 1; j += 1) {
        for (k = 0; k < NZ - 1; k += 1) {
          var v000 = nodeIndex(i, j, k);
          var v100 = nodeIndex(i + 1, j, k);
          var v010 = nodeIndex(i, j + 1, k);
          var v110 = nodeIndex(i + 1, j + 1, k);
          var v001 = nodeIndex(i, j, k + 1);
          var v101 = nodeIndex(i + 1, j, k + 1);
          var v011 = nodeIndex(i, j + 1, k + 1);
          var v111 = nodeIndex(i + 1, j + 1, k + 1);
          registerTet(v000, v100, v110, v111);
          registerTet(v000, v110, v010, v111);
          registerTet(v000, v010, v011, v111);
          registerTet(v000, v011, v001, v111);
          registerTet(v000, v001, v101, v111);
          registerTet(v000, v101, v100, v111);
        }
      }
    }
    tetCount = tetrahedra.length;
    Object.keys(uniqueEdges).forEach(function (key, edgeIndex) {
      var edge = uniqueEdges[key];
      addEdge(edge[0], edge[1], (edgeIndex % 7) * 0.008);
    });

    var meshGeometry = new THREE.BufferGeometry();
    meshGeometry.setAttribute("position", new THREE.Float32BufferAttribute(meshPositionList, 3));
    meshGeometry.setAttribute("aOrder", new THREE.Float32BufferAttribute(meshOrderList, 1));

    var meshMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uReveal: { value: 0 },
        uOpacity: { value: 0.28 },
        uPulse: { value: 0 },
        uColor: { value: new THREE.Color(0x93b4cd) }
      },
      vertexShader: [
        "attribute float aOrder;",
        "varying float vOrder;",
        "void main(){",
        "  vOrder = aOrder;",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform float uReveal;",
        "uniform float uOpacity;",
        "uniform float uPulse;",
        "uniform vec3 uColor;",
        "varying float vOrder;",
        "void main(){",
        "  float built = 1.0 - smoothstep(uReveal, uReveal + 0.075, vOrder);",
        "  float scan = exp(-pow((vOrder - uReveal) * 18.0, 2.0));",
        "  float alpha = built * uOpacity + scan * uPulse * 0.75;",
        "  if(alpha < 0.006) discard;",
        "  gl_FragColor = vec4(mix(uColor, vec3(0.76,0.91,0.98), scan), alpha);",
        "}"
      ].join("\n")
    });
    var meshLines = new THREE.LineSegments(meshGeometry, meshMaterial);
    meshLines.renderOrder = 2;
    root.add(meshLines);

    var cloudGeometry = new THREE.BufferGeometry();
    cloudGeometry.setAttribute("position", new THREE.BufferAttribute(nodePositions, 3));
    var cloudMaterial = new THREE.PointsMaterial({
      color: 0x93b4cd,
      size: isMobile ? 0.026 : 0.032,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var nodeCloud = new THREE.Points(cloudGeometry, cloudMaterial);
    nodeCloud.renderOrder = 3;
    root.add(nodeCloud);

    var fieldGeometry = new THREE.BufferGeometry();
    fieldGeometry.setAttribute("position", new THREE.BufferAttribute(nodePositions.slice(), 3));
    fieldGeometry.setAttribute("aDensity", new THREE.BufferAttribute(densityValues, 1));
    fieldGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phaseValues, 1));
    var fieldMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uReveal: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, pixelCap) },
        uTime: { value: 0 },
        uPointer: { value: new THREE.Vector2(0, 0) },
        uPointerStrength: { value: 0 },
        uControl: { value: new THREE.Vector3(0, 0, 0) },
        uGate: { value: new THREE.Vector2(0, 0) },
        uEvent: { value: new THREE.Vector4(0, 0, 0, 0) },
        uFocus: { value: new THREE.Vector3(0, 0, 1) }
      },
      vertexShader: [
        "attribute float aDensity;",
        "attribute float aPhase;",
        "uniform float uReveal;",
        "uniform float uPixelRatio;",
        "uniform float uTime;",
        "uniform vec2 uPointer;",
        "uniform float uPointerStrength;",
        "uniform vec3 uControl;",
        "uniform vec2 uGate;",
        "uniform vec4 uEvent;",
        "uniform vec3 uFocus;",
        "varying float vDensity;",
        "varying float vPhase;",
        "varying float vPerturbation;",
        "void main(){",
        "  vDensity = aDensity * uReveal;",
        "  vec2 pointerDelta = position.xz - uPointer;",
        "  float pointerRadius = length(pointerDelta);",
        "  float pointerEnvelope = exp(-pointerRadius * pointerRadius * 1.05);",
        "  float pointerWave = sin(pointerRadius * 7.5 - uTime * 3.4) * pointerEnvelope * uPointerStrength;",
        "  vec2 pointerRadial = pointerDelta / max(pointerRadius, 0.001);",
        "  float gateDx = position.x - uGate.x;",
        "  float gateEnvelope = exp(-(gateDx * gateDx * 1.28 + position.z * position.z * 0.72));",
        "  float gateWave = sin(gateDx * 5.1 - uTime * 2.55) * gateEnvelope * uGate.y;",
        "  float phaseFront = sin(position.x * 2.05 - uTime * (1.05 + uControl.z * 0.78) + position.y * 0.72 + position.z * 1.48);",
        "  float phaseFold = sin(position.x * 3.12 + sin(position.z * 2.7 - uTime * 0.83) * 1.35 + position.y * 1.06 - uTime * 1.41);",
        "  phaseFold *= cos(position.z * 3.8 - position.x * 0.46 + uTime * 0.67);",
        "  vec2 eventDelta = position.xz - uFocus.xy;",
        "  float eventRadius = length(eventDelta);",
        "  float measurementFront = sin(eventRadius * 10.2 - uTime * 5.4) * exp(-eventRadius * 0.72) * uEvent.x;",
        "  float frontEnvelope = (0.22 + 0.78 * vDensity) * exp(-position.y * position.y * 0.16);",
        "  float caustic = phaseFold * uEvent.z * (0.12 + vDensity * 0.38);",
        "  vPerturbation = abs(pointerWave) + abs(gateWave) * 0.5 + uControl.y * 0.12 + abs(measurementFront) * 0.3 + abs(caustic) * 0.45;",
        "  vPhase = aPhase + pointerWave * 1.48 + gateWave * 0.9 + phaseFront * (0.1 + uControl.y * 0.2) + caustic * 1.6 + measurementFront * uFocus.z * 0.82;",
        "  vec3 displaced = position;",
        "  displaced.y += sin(uTime * 0.7 + position.x * 1.35) * 0.018 * vDensity;",
        "  displaced.y += pointerWave * 0.125 + gateWave * 0.055;",
        "  displaced.z += pointerWave * pointerRadial.y * 0.082;",
        "  displaced.y += phaseFront * frontEnvelope * (0.022 + uControl.y * 0.052 + uControl.z * 0.027);",
        "  displaced.z += cos(position.x * 1.58 - uTime * 0.93 + position.y) * frontEnvelope * (0.014 + uControl.y * 0.032 + uControl.z * 0.025);",
        "  displaced.y += caustic * (0.08 + uEvent.z * 0.085) + measurementFront * 0.075;",
        "  displaced.x += caustic * cos(position.z * 2.1 + uTime) * 0.052;",
        "  displaced.z += caustic * sin(position.y * 1.9 - uTime * 0.7) * 0.09;",
        "  vec4 mv = modelViewMatrix * vec4(displaced, 1.0);",
        "  float perspective = clamp(5.0 / max(1.0, -mv.z), 0.52, 1.75);",
        "  gl_PointSize = (1.25 + 12.5 * pow(max(vDensity,0.0),0.48) + vPerturbation * 2.2) * uPixelRatio * perspective;",
        "  gl_Position = projectionMatrix * mv;",
        "}"
      ].join("\n"),
      fragmentShader: [
        "varying float vDensity;",
        "varying float vPhase;",
        "varying float vPerturbation;",
        "void main(){",
        "  vec2 p = gl_PointCoord - vec2(0.5);",
        "  float radius = length(p);",
        "  if(radius > 0.5 || vDensity < 0.003) discard;",
        "  float core = 1.0 - smoothstep(0.03,0.5,radius);",
        "  float halo = 1.0 - smoothstep(0.18,0.5,radius);",
        "  vec3 blue = vec3(0.41,0.73,0.86);",
        "  vec3 ice = vec3(0.79,0.89,0.94);",
        "  vec3 cyan = vec3(0.48,0.84,0.91);",
        "  float phaseX = 0.5 + 0.5 * cos(vPhase);",
        "  float phaseY = 0.5 + 0.5 * sin(vPhase);",
        "  vec3 colour = mix(blue, ice, phaseX);",
        "  colour = mix(colour, cyan, phaseY * 0.28 + vPerturbation * 0.2);",
        "  float alpha = (core * 0.76 + halo * 0.22) * (0.12 + 0.88 * pow(vDensity,0.58));",
        "  gl_FragColor = vec4(colour, alpha);",
        "}"
      ].join("\n")
    });
    var fieldPoints = new THREE.Points(fieldGeometry, fieldMaterial);
    fieldPoints.renderOrder = 8;
    root.add(fieldPoints);

    var domainEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(9.72, 3.52, 2.52)),
      new THREE.LineBasicMaterial({ color: 0x9dbbd0, transparent: true, opacity: 0.18, depthWrite: false })
    );
    root.add(domainEdges);

    var barrierMaterial = new THREE.MeshBasicMaterial({
      color: 0xcfa068,
      transparent: true,
      opacity: 0.04,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    });
    var barrier = new THREE.Mesh(new THREE.BoxGeometry(0.42, 3.1, 2.18), barrierMaterial);
    barrier.renderOrder = 5;
    root.add(barrier);
    var barrierEdgesMaterial = new THREE.LineBasicMaterial({
      color: 0xcfa068,
      transparent: true,
      opacity: 0.28,
      depthWrite: false
    });
    var barrierEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(0.42, 3.1, 2.18)),
      barrierEdgesMaterial
    );
    barrierEdges.renderOrder = 6;
    root.add(barrierEdges);

    function makeLobe(colour, wireframe, order) {
      var material = new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        wireframe: !!wireframe,
        blending: THREE.AdditiveBlending
      });
      var lobe = new THREE.Mesh(new THREE.SphereGeometry(1, wireframe ? 18 : 28, wireframe ? 12 : 18), material);
      lobe.renderOrder = order;
      root.add(lobe);
      return lobe;
    }

    var leftOuter = makeLobe(0x69bddb, false, 6);
    var leftWire = makeLobe(0xa8d8e9, true, 9);
    var rightOuter = makeLobe(0x79c7df, false, 6);
    var rightWire = makeLobe(0xc3d9ea, true, 9);
    leftOuter.position.x = leftWire.position.x = -2.05;
    rightOuter.position.x = rightWire.position.x = 2.05;

    var contourLines = [];
    var contourSamples = isMobile ? 72 : 108;
    for (var contourIndex = 0; contourIndex < 3; contourIndex += 1) {
      var contourArray = new Float32Array(contourSamples * 3);
      var contourGeometry = new THREE.BufferGeometry();
      contourGeometry.setAttribute("position", new THREE.BufferAttribute(contourArray, 3));
      var contourMaterial = new THREE.LineBasicMaterial({
        color: contourIndex === 1 ? 0xb8ddeb : 0x78bdd7,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      var contour = new THREE.Line(contourGeometry, contourMaterial);
      contour.position.z = (contourIndex - 1) * 0.63;
      contour.renderOrder = 10;
      root.add(contour);
      contourLines.push(contour);
    }

    var refinePositions = [];
    function addRefineLine(ax, ay, az, bx, by, bz) {
      refinePositions.push(ax, ay, az, bx, by, bz);
    }
    var refineStepX = 0.24;
    var refineStepY = 0.29;
    var refineStepZ = 0.26;
    for (var refineX = -0.96; refineX <= 0.97; refineX += refineStepX) {
      for (var refineY = -1.55; refineY <= 1.56; refineY += refineStepY) {
        addRefineLine(refineX, refineY, -1.08, refineX, refineY, 1.08);
      }
      for (var refineZ = -1.08; refineZ <= 1.09; refineZ += refineStepZ) {
        addRefineLine(refineX, -1.55, refineZ, refineX, 1.55, refineZ);
      }
    }
    var refineGeometry = new THREE.BufferGeometry();
    refineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(refinePositions, 3));
    var refineMaterial = new THREE.LineBasicMaterial({
      color: 0xa4d5e6,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var refineLines = new THREE.LineSegments(refineGeometry, refineMaterial);
    refineLines.renderOrder = 11;
    root.add(refineLines);

    var assemblyMaterial = new THREE.MeshBasicMaterial({
      color: 0x79d1e8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var assemblyRing = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.018, 8, 72), assemblyMaterial);
    assemblyRing.rotation.y = Math.PI / 2;
    assemblyRing.scale.set(1, 1.08, 0.76);
    assemblyRing.renderOrder = 12;
    root.add(assemblyRing);

    var energyGroup = new THREE.Group();
    root.add(energyGroup);
    var energyMaterials = [];
    for (var energyRingIndex = 0; energyRingIndex < 4; energyRingIndex += 1) {
      var energyMaterial = new THREE.MeshBasicMaterial({
        color: 0xcfa068,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false
      });
      var energyRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.46 + energyRingIndex * 0.24, 0.026, 8, 72),
        energyMaterial
      );
      energyRing.rotation.y = Math.PI / 2;
      energyRing.renderOrder = 13;
      energyGroup.add(energyRing);
      energyMaterials.push(energyMaterial);
    }

    var fluxCount = isMobile ? 34 : 58;
    var fluxArray = new Float32Array(fluxCount * 3);
    var fluxGeometry = new THREE.BufferGeometry();
    fluxGeometry.setAttribute("position", new THREE.BufferAttribute(fluxArray, 3));
    var fluxMaterial = new THREE.PointsMaterial({
      color: 0x8ddbed,
      size: isMobile ? 0.055 : 0.065,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var fluxPoints = new THREE.Points(fluxGeometry, fluxMaterial);
    fluxPoints.renderOrder = 14;
    root.add(fluxPoints);

    var streamlineCount = isMobile ? 4 : 6;
    var streamlineSamples = isMobile ? 36 : 52;
    var currentStreamlines = [];
    for (var streamlineId = 0; streamlineId < streamlineCount; streamlineId += 1) {
      var streamlineArray = new Float32Array(streamlineSamples * 3);
      var streamlineGeometry = new THREE.BufferGeometry();
      streamlineGeometry.setAttribute("position", new THREE.BufferAttribute(streamlineArray, 3));
      var streamlineMaterial = new THREE.LineBasicMaterial({
        color: streamlineId % 2 ? 0x9adff0 : 0x68bdd9,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      var streamline = new THREE.Line(streamlineGeometry, streamlineMaterial);
      streamline.renderOrder = 13;
      streamline.frustumCulled = false;
      root.add(streamline);
      currentStreamlines.push(streamline);
    }

    /* The numerical domain remains finite, but its evanescent tail, phase
       fronts and diagnostic fields are deliberately allowed to cross the
       camera frustum. CSS should therefore give the canvas an overflow-visible
       full-bleed stage; the finite box is no longer the visual boundary. */
    var effectRandom = seededRandom(0xC05E71C);
    var farFieldCount = isMobile ? 86 : 184;
    var farFieldPositions = new Float32Array(farFieldCount * 3);
    var farFieldDrift = new Float32Array(farFieldCount * 3);
    var farFieldSeeds = new Float32Array(farFieldCount);
    for (var farId = 0; farId < farFieldCount; farId += 1) {
      var farAngle = effectRandom() * Math.PI * 2;
      var farRadius = mix(4.5, 11.8, Math.pow(effectRandom(), 0.72));
      farFieldPositions[farId * 3] = Math.cos(farAngle) * farRadius;
      farFieldPositions[farId * 3 + 1] = mix(-4.2, 4.6, effectRandom());
      farFieldPositions[farId * 3 + 2] = Math.sin(farAngle) * farRadius * 0.62;
      farFieldDrift[farId * 3] = mix(-0.72, 0.72, effectRandom());
      farFieldDrift[farId * 3 + 1] = mix(-0.58, 0.58, effectRandom());
      farFieldDrift[farId * 3 + 2] = mix(-0.72, 0.72, effectRandom());
      farFieldSeeds[farId] = effectRandom();
    }
    var farFieldGeometry = new THREE.BufferGeometry();
    farFieldGeometry.setAttribute("position", new THREE.BufferAttribute(farFieldPositions, 3));
    farFieldGeometry.setAttribute("aDrift", new THREE.BufferAttribute(farFieldDrift, 3));
    farFieldGeometry.setAttribute("aSeed", new THREE.BufferAttribute(farFieldSeeds, 1));
    var farFieldMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uReveal: { value: 0 },
        uActivity: { value: 0 },
        uMeasure: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, pixelCap) }
      },
      vertexShader: [
        "attribute vec3 aDrift;",
        "attribute float aSeed;",
        "uniform float uTime;",
        "uniform float uReveal;",
        "uniform float uActivity;",
        "uniform float uMeasure;",
        "uniform float uPixelRatio;",
        "varying float vAlpha;",
        "varying float vSeed;",
        "void main(){",
        "  vec3 p = position;",
        "  float clock = uTime * (0.16 + aSeed * 0.31) + aSeed * 21.0;",
        "  p += aDrift * sin(clock) * (0.42 + uActivity * 0.72);",
        "  p.y += sin(p.x * 0.32 - uTime * 0.48 + aSeed * 9.0) * (0.18 + uActivity * 0.38);",
        "  p.z += cos(p.x * 0.21 + uTime * 0.39 + aSeed * 13.0) * (0.28 + uMeasure * 0.7);",
        "  float radial = length(p.xz);",
        "  float tail = exp(-max(0.0, radial - 4.1) * 0.12);",
        "  float flicker = 0.42 + 0.58 * sin(clock * 2.3) * sin(clock * 1.17 + 1.4);",
        "  vAlpha = uReveal * tail * (0.035 + uActivity * 0.11 + uMeasure * 0.16) * (0.45 + abs(flicker));",
        "  vSeed = aSeed;",
        "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
        "  gl_PointSize = (1.1 + aSeed * 2.4 + uActivity * 2.6) * uPixelRatio * clamp(5.0 / max(1.0,-mv.z),0.45,1.5);",
        "  gl_Position = projectionMatrix * mv;",
        "}"
      ].join("\n"),
      fragmentShader: [
        "varying float vAlpha;",
        "varying float vSeed;",
        "void main(){",
        "  vec2 p = gl_PointCoord - vec2(0.5);",
        "  float r = length(p);",
        "  if(r > 0.5) discard;",
        "  float soft = 1.0 - smoothstep(0.04,0.5,r);",
        "  vec3 colour = mix(vec3(0.27,0.58,0.73),vec3(0.63,0.86,0.94),vSeed);",
        "  gl_FragColor = vec4(colour, soft * vAlpha);",
        "}"
      ].join("\n")
    });
    var farFieldWisps = new THREE.Points(farFieldGeometry, farFieldMaterial);
    farFieldWisps.frustumCulled = false;
    farFieldWisps.renderOrder = 0;
    scene.add(farFieldWisps);

    var causticLineCount = isMobile ? 4 : 7;
    var causticSamples = isMobile ? 52 : 88;
    var phaseCaustics = [];
    for (var causticId = 0; causticId < causticLineCount; causticId += 1) {
      var causticArray = new Float32Array(causticSamples * 3);
      var causticGeometry = new THREE.BufferGeometry();
      causticGeometry.setAttribute("position", new THREE.BufferAttribute(causticArray, 3));
      var causticMaterial = new THREE.LineBasicMaterial({
        color: causticId % 3 === 0 ? 0xb5e4ef : 0x5eaac8,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      var causticLine = new THREE.Line(causticGeometry, causticMaterial);
      causticLine.frustumCulled = false;
      causticLine.renderOrder = 4;
      scene.add(causticLine);
      phaseCaustics.push(causticLine);
    }

    var gatePlaneMaterial = new THREE.MeshBasicMaterial({
      color: 0xcfa068,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    });
    var gatePlane = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 8.2, 1, 1), gatePlaneMaterial);
    gatePlane.rotation.y = Math.PI / 2;
    gatePlane.renderOrder = 7;
    root.add(gatePlane);
    var gateRings = [];
    for (var gateRingId = 0; gateRingId < 4; gateRingId += 1) {
      var gateRingMaterial = new THREE.MeshBasicMaterial({
        color: 0xcfa068,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false
      });
      var gateRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.25 + gateRingId * 0.72, 0.014 + gateRingId * 0.003, 6, 76),
        gateRingMaterial
      );
      gateRing.rotation.y = Math.PI / 2;
      gateRing.renderOrder = 9;
      root.add(gateRing);
      gateRings.push(gateRing);
    }

    var measurementGroup = new THREE.Group();
    root.add(measurementGroup);
    var measurementShells = [];
    for (var shellId = 0; shellId < 5; shellId += 1) {
      var shellMaterial = new THREE.MeshBasicMaterial({
        color: shellId === 0 ? 0xe0edf2 : 0x86d2e6,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        wireframe: true,
        blending: THREE.AdditiveBlending
      });
      var shell = new THREE.Mesh(
        new THREE.SphereGeometry(0.72 + shellId * 0.34, isMobile ? 12 : 18, isMobile ? 8 : 12),
        shellMaterial
      );
      shell.rotation.set(shellId * 0.43, shellId * 0.7, shellId * 0.19);
      shell.renderOrder = 12;
      measurementGroup.add(shell);
      measurementShells.push(shell);
    }

    var refineSwarmCount = isMobile ? 58 : 126;
    var refineSwarmArray = new Float32Array(refineSwarmCount * 3);
    var refineSwarmSeeds = new Float32Array(refineSwarmCount * 3);
    for (var swarmId = 0; swarmId < refineSwarmCount; swarmId += 1) {
      refineSwarmSeeds[swarmId * 3] = effectRandom();
      refineSwarmSeeds[swarmId * 3 + 1] = effectRandom();
      refineSwarmSeeds[swarmId * 3 + 2] = effectRandom();
    }
    var refineSwarmGeometry = new THREE.BufferGeometry();
    refineSwarmGeometry.setAttribute("position", new THREE.BufferAttribute(refineSwarmArray, 3));
    var refineSwarmMaterial = new THREE.PointsMaterial({
      color: 0x9edff0,
      size: isMobile ? 0.035 : 0.043,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var refineSwarm = new THREE.Points(refineSwarmGeometry, refineSwarmMaterial);
    refineSwarm.frustumCulled = false;
    refineSwarm.renderOrder = 15;
    root.add(refineSwarm);
    var refinementHaloMaterial = new THREE.MeshBasicMaterial({
      color: 0x98d9ea,
      transparent: true,
      opacity: 0,
      wireframe: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var refinementHalo = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.0, isMobile ? 1 : 2),
      refinementHaloMaterial
    );
    refinementHalo.renderOrder = 14;
    root.add(refinementHalo);

    var potentialVertices = [];
    var potentialIndices = [];
    var PX = 45;
    var PZ = 9;
    for (i = 0; i < PX; i += 1) {
      var potentialX = mix(-4.8, 4.8, i / (PX - 1));
      var quartic = Math.pow((potentialX * potentialX - 4.2) / 18, 2);
      var barrierShape = Math.exp(-potentialX * potentialX / 0.18) * 0.78;
      for (k = 0; k < PZ; k += 1) {
        var potentialZ = mix(-1.65, 1.65, k / (PZ - 1));
        potentialVertices.push(
          potentialX,
          -2.14 + Math.min(1.15, quartic + barrierShape) * 0.78,
          potentialZ
        );
      }
    }
    for (i = 0; i < PX - 1; i += 1) {
      for (k = 0; k < PZ - 1; k += 1) {
        var pa = i * PZ + k;
        var pb = (i + 1) * PZ + k;
        var pc = (i + 1) * PZ + k + 1;
        var pd = i * PZ + k + 1;
        potentialIndices.push(pa, pb, pc, pa, pc, pd);
      }
    }
    var potentialGeometry = new THREE.BufferGeometry();
    potentialGeometry.setAttribute("position", new THREE.Float32BufferAttribute(potentialVertices, 3));
    potentialGeometry.setIndex(potentialIndices);
    potentialGeometry.computeVertexNormals();
    var potentialMaterial = new THREE.MeshBasicMaterial({
      color: 0x365c71,
      transparent: true,
      opacity: 0.045,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    var potentialSurface = new THREE.Mesh(potentialGeometry, potentialMaterial);
    potentialSurface.renderOrder = 1;
    root.add(potentialSurface);
    var potentialWireMaterial = new THREE.LineBasicMaterial({
      color: 0x789eb3,
      transparent: true,
      opacity: 0.12,
      depthWrite: false
    });
    var potentialWire = new THREE.LineSegments(
      new THREE.WireframeGeometry(potentialGeometry),
      potentialWireMaterial
    );
    potentialWire.renderOrder = 2;
    root.add(potentialWire);

    var progress = autonomousProgress(0);
    var active = true;
    var pageVisible = document.visibilityState !== "hidden";
    var contextLost = false;
    var raf = 0;
    var lastFrame = performance.now();
    var lastRender = 0;
    var lastSizeKey = "";
    var simulationTime = 0;
    var fluxDirection = 1;
    var streamFlowPhase = 0;
    var interaction;
    var evolution = createBlochEvolution();
    var controlEvolution = createAutonomousController(0xA73C19D);
    var frameInterval = isMobile ? 1000 / 48 : 1000 / 60;

    function resize() {
      var bounds = canvas.getBoundingClientRect();
      var width = Math.max(1, Math.round(bounds.width));
      var height = Math.max(1, Math.round(bounds.height));
      var key = width + "x" + height + "@" + Math.min(window.devicePixelRatio || 1, pixelCap);
      if (key === lastSizeKey) return;
      lastSizeKey = key;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelCap));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      fieldMaterial.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, pixelCap);
      farFieldMaterial.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, pixelCap);
    }

    function updateField(nowSeconds) {
      var reveal = windowed(progress, 0.28, 0.45);
      var eigenMix = windowed(progress, 0.38, 0.57);
      var pointerStrength = interaction ? interaction.state.strength : 0;
      var controls = controlEvolution.update(nowSeconds, progress);
      var stateData = evolution.update(
        nowSeconds,
        progress,
        controls,
        interaction ? interaction.state : null
      );
      var energyMix = Math.max(
        pulseWindow(progress, 0.43, 0.53, 0.66),
        pointerStrength * 0.22,
        controls.excited * 0.92
      );

      var c0r = progress < 0.58 ? 1 : stateData.c0r;
      var c0i = progress < 0.58 ? 0 : stateData.c0i;
      var c1r;
      var c1i;
      if (progress < 0.58) {
        c1r = mix(0.12, 1, eigenMix);
        c1i = reducedMotion ? 0 : Math.sin(nowSeconds * 0.55) * 0.08 * eigenMix;
      } else {
        c1r = stateData.c1r;
        c1i = stateData.c1i;
      }
      var c2r = energyMix * 0.36 * Math.cos(nowSeconds * 1.13);
      var c2i = energyMix * 0.36 * Math.sin(nowSeconds * 1.13);

      var total = 0;
      var rightTotal = 0;
      for (var nodeId = 0; nodeId < nodeCount; nodeId += 1) {
        var re = basis0[nodeId] * c0r + basis1[nodeId] * c1r + basis2[nodeId] * c2r;
        var im = basis0[nodeId] * c0i + basis1[nodeId] * c1i + basis2[nodeId] * c2i;
        var phaseKick = 0;
        if (controls.gate > 0.002) {
          var gateDx = nodes[nodeId].x - controls.gateX;
          phaseKick += controls.gate * Math.exp(-(gateDx * gateDx * 1.28 +
            nodes[nodeId].z * nodes[nodeId].z * 0.72)) *
            Math.sin(gateDx * 5.1 - nowSeconds * 2.55) * 0.48;
        }
        if (pointerStrength > 0.002) {
          var pointerDx = nodes[nodeId].x - interaction.state.x;
          var pointerDz = nodes[nodeId].z - interaction.state.z;
          var pointerRadius = Math.sqrt(pointerDx * pointerDx + pointerDz * pointerDz);
          phaseKick += pointerStrength * Math.exp(-pointerRadius * pointerRadius * 1.05) *
            Math.sin(pointerRadius * 7.5 - nowSeconds * 3.4) * 0.68;
        }
        if (Math.abs(phaseKick) > 0.00001) {
          var kickCos = Math.cos(phaseKick);
          var kickSin = Math.sin(phaseKick);
          var kickedReal = re * kickCos - im * kickSin;
          im = re * kickSin + im * kickCos;
          re = kickedReal;
        }
        var raw = re * re + im * im;
        rawReal[nodeId] = re;
        rawImag[nodeId] = im;
        densityValues[nodeId] = raw;
        total += raw * nodeWeights[nodeId];
        if (nodes[nodeId].side) rightTotal += raw * nodeWeights[nodeId];
      }

      var inverseNorm = total > 0 ? 1 / total : 0;
      var maxDensity = 0.000001;
      var normalizedIntegral = 0;
      for (var normId = 0; normId < nodeCount; normId += 1) {
        densityValues[normId] *= inverseNorm;
        normalizedIntegral += densityValues[normId] * nodeWeights[normId];
        maxDensity = Math.max(maxDensity, densityValues[normId]);
      }
      var invMax = 1 / maxDensity;
      for (var fieldId = 0; fieldId < nodeCount; fieldId += 1) {
        densityValues[fieldId] = Math.pow(densityValues[fieldId] * invMax, 0.84);
        phaseValues[fieldId] = Math.atan2(rawImag[fieldId], rawReal[fieldId]);
      }
      fieldGeometry.attributes.aDensity.needsUpdate = true;
      fieldGeometry.attributes.aPhase.needsUpdate = true;
      fieldMaterial.uniforms.uReveal.value = reveal;
      fieldMaterial.uniforms.uTime.value = nowSeconds;
      fieldMaterial.uniforms.uPointer.value.set(
        interaction ? interaction.state.x : 0,
        interaction ? interaction.state.z : 0
      );
      fieldMaterial.uniforms.uPointerStrength.value = pointerStrength;
      fieldMaterial.uniforms.uControl.value.set(controls.gate, controls.excited, controls.surge);
      fieldMaterial.uniforms.uGate.value.set(controls.gateX, controls.gate);
      fieldMaterial.uniforms.uEvent.value.set(
        controls.measure,
        controls.refine,
        controls.caustic,
        controls.eventSerial % 19 / 19
      );
      fieldMaterial.uniforms.uFocus.value.set(
        controls.focusX,
        controls.focusZ,
        controls.measurementOutcome
      );
      return {
        norm: normalizedIntegral,
        right: total > 0 ? rightTotal / total : 0,
        current: clamp(stateData.current, 0, 1),
        signedCurrent: clamp(stateData.signedCurrent, -1, 1),
        gate: controls.gate,
        excited: controls.excited,
        surge: controls.surge,
        measure: controls.measure,
        refine: controls.refine,
        caustic: controls.caustic,
        gateX: controls.gateX,
        focusX: controls.focusX,
        focusZ: controls.focusZ,
        measurementOutcome: controls.measurementOutcome,
        eventSerial: controls.eventSerial,
        controlId: controls.id,
        controlStatus: controls.status,
        controlDetail: controls.detail
      };
    }

    function updateContours(meta) {
      var fieldReveal = windowed(progress, 0.31, 0.46);
      var fieldTime = fieldMaterial.uniforms.uTime.value;
      for (var contourId = 0; contourId < contourLines.length; contourId += 1) {
        var contour = contourLines[contourId];
        var positions = contour.geometry.attributes.position.array;
        var zOffset = (contourId - 1) * 0.63;
        for (var pointId = 0; pointId < contourSamples; pointId += 1) {
          var x = mix(-4.65, 4.65, pointId / (contourSamples - 1));
          var left = Math.exp(-0.5 * ((x + 2.05) * (x + 2.05) / 0.92 + zOffset * zOffset / 0.46));
          var right = Math.exp(-0.5 * ((x - 2.05) * (x - 2.05) / 0.92 + zOffset * zOffset / 0.46));
          var density = left * left * (1 - meta.right) + right * right * meta.right;
          var ripple = Math.sin(x * 2.15 + fieldTime * 1.48 * meta.direction + contourId * 0.7) *
            0.098 * fieldReveal;
          positions[pointId * 3] = x;
          positions[pointId * 3 + 1] = -0.28 + density * 2.05 * fieldReveal + ripple;
          positions[pointId * 3 + 2] = 0;
        }
        contour.geometry.attributes.position.needsUpdate = true;
        contour.material.opacity = fieldReveal * (0.22 + (contourId === 1 ? 0.26 : 0.12));
      }

      var leftProbability = clamp(1 - meta.right, 0, 1);
      var rightProbability = clamp(meta.right, 0, 1);
      var visible = windowed(progress, 0.31, 0.46);
      var breathingWave = reducedMotion ? 0 : Math.sin(fieldTime * 1.12) * 0.042;
      var currentBreath = reducedMotion ? 0 : (meta.current || 0) * 0.018;
      var leftBreath = 1 + breathingWave + currentBreath;
      var rightBreath = 1 - breathingWave + currentBreath;
      leftOuter.scale.set(1.42 * (0.28 + Math.sqrt(leftProbability) * 0.9), 0.78 * leftBreath, 0.64 * leftBreath);
      leftWire.scale.copy(leftOuter.scale).multiplyScalar(1.07);
      rightOuter.scale.set(1.42 * (0.28 + Math.sqrt(rightProbability) * 0.9), 0.78 * rightBreath, 0.64 * rightBreath);
      rightWire.scale.copy(rightOuter.scale).multiplyScalar(1.07);
      leftWire.rotation.x = reducedMotion ? 0 : Math.sin(fieldTime * 0.31) * 0.075;
      leftWire.rotation.z = reducedMotion ? 0 : fieldTime * 0.045;
      rightWire.rotation.x = reducedMotion ? 0 : -Math.sin(fieldTime * 0.29 + 0.7) * 0.075;
      rightWire.rotation.z = reducedMotion ? 0 : -fieldTime * 0.042;
      leftOuter.material.opacity = visible * (0.05 + leftProbability * 0.095 + (meta.current || 0) * 0.012);
      rightOuter.material.opacity = visible * (0.05 + rightProbability * 0.095 + (meta.current || 0) * 0.012);
      leftWire.material.opacity = visible * (0.08 + leftProbability * 0.13 + (meta.current || 0) * 0.018);
      rightWire.material.opacity = visible * (0.08 + rightProbability * 0.13 + (meta.current || 0) * 0.018);
    }

    function updateCurrentFlow(delta, meta) {
      var amount = windowed(progress, 0.56, 0.73);
      var currentMagnitude = meta.current || 0;
      streamFlowPhase += (meta.signedCurrent || 0) * delta * (1.08 + (meta.surge || 0) * 0.84);

      currentStreamlines.forEach(function (streamline, lineId) {
        var positions = streamline.geometry.attributes.position.array;
        var offset = lineId - (streamlineCount - 1) * 0.5;
        for (var pointId = 0; pointId < streamlineSamples; pointId += 1) {
          var u = pointId / (streamlineSamples - 1);
          var x = mix(-7.15, 7.15, u);
          var envelope = Math.sin(Math.PI * u);
          var neck = 0.27 + 0.73 * Math.abs(x) / 7.15;
          var phase = u * Math.PI * 2.25 + streamFlowPhase * 4.4 + lineId * 0.91;
          var gateLocal = Math.exp(-Math.pow(x - (meta.gateX || 0), 2) * 1.1);
          positions[pointId * 3] = x + Math.sin(phase * 0.63) * envelope * 0.045;
          positions[pointId * 3 + 1] = offset * 0.085 * neck +
            Math.sin(phase) * envelope * (0.075 + currentMagnitude * 0.055) +
            (meta.gate || 0) * gateLocal * offset * 0.026;
          positions[pointId * 3 + 2] = offset * 0.22 * neck +
            Math.cos(phase * 0.82 + lineId * 0.3) * envelope * (0.18 + currentMagnitude * 0.075) +
            (meta.excited || 0) * Math.sin(u * Math.PI * 3 + lineId) * envelope * 0.12;
        }
        streamline.geometry.attributes.position.needsUpdate = true;
        streamline.material.opacity = amount *
          (0.028 + currentMagnitude * (lineId === Math.floor(streamlineCount * 0.5) ? 0.38 : 0.25));
      });

      fluxMaterial.opacity = amount * currentMagnitude * (0.22 + currentMagnitude * 0.48);
      fluxMaterial.size = (isMobile ? 0.055 : 0.065) *
        (1 + currentMagnitude * 0.28 + (meta.surge || 0) * 0.22);
      for (var packet = 0; packet < fluxCount; packet += 1) {
        var t = ((packet / fluxCount + streamFlowPhase * 0.34) % 1 + 1) % 1;
        var x = mix(-6.65, 6.75, t);
        var envelope = Math.sin(Math.PI * t);
        var packetPhase = packet * 1.73 + streamFlowPhase * 4.1;
        fluxArray[packet * 3] = x;
        fluxArray[packet * 3 + 1] = Math.sin(packetPhase * 1.2) * 0.18 * envelope;
        fluxArray[packet * 3 + 2] = Math.cos(packetPhase) * 0.23 * envelope;
      }
      fluxGeometry.attributes.position.needsUpdate = true;
    }

    function updateUnboundedEffects(nowSeconds, meta) {
      var live = windowed(progress, 0.62, 0.98);
      var activity = clamp(
        (meta.current || 0) * 0.34 +
        (meta.surge || 0) * 0.68 +
        (meta.excited || 0) * 0.42 +
        (meta.caustic || 0) * 0.82 +
        (meta.measure || 0) * 0.54,
        0,
        1.35
      );
      farFieldMaterial.uniforms.uTime.value = nowSeconds;
      farFieldMaterial.uniforms.uReveal.value = live;
      farFieldMaterial.uniforms.uActivity.value = activity;
      farFieldMaterial.uniforms.uMeasure.value = meta.measure || 0;
      farFieldWisps.rotation.y = reducedMotion ? 0 : nowSeconds * 0.009;
      farFieldWisps.rotation.x = reducedMotion ? 0 : Math.sin(nowSeconds * 0.037) * 0.055;

      phaseCaustics.forEach(function (line, lineId) {
        var positions = line.geometry.attributes.position.array;
        var band = lineId - (causticLineCount - 1) * 0.5;
        var serialShift = (meta.eventSerial || 0) * 0.137;
        for (var pointId = 0; pointId < causticSamples; pointId += 1) {
          var u = pointId / (causticSamples - 1);
          var x = mix(-11.4, 11.4, u);
          var lens = Math.exp(-x * x * 0.026);
          var foldA = Math.sin(
            x * (0.48 + lineId * 0.021) - nowSeconds * (0.46 + lineId * 0.031) +
            Math.sin(x * 0.19 + nowSeconds * 0.23 + serialShift) * 1.65 + lineId * 0.91
          );
          var foldB = Math.sin(x * 1.27 + nowSeconds * 0.74 - lineId * 0.63) *
            Math.cos(x * 0.31 - nowSeconds * 0.29 + lineId);
          positions[pointId * 3] = x;
          positions[pointId * 3 + 1] = band * 0.34 + foldA * (0.32 + lens * 0.58) +
            foldB * (0.08 + (meta.caustic || 0) * 0.22);
          positions[pointId * 3 + 2] = band * 0.56 +
            Math.cos(x * 0.39 + nowSeconds * 0.33 + lineId * 0.72) * (0.44 + lens * 0.36) +
            foldA * (meta.measure || 0) * 0.28;
        }
        line.geometry.attributes.position.needsUpdate = true;
        line.material.opacity = live * (
          0.012 +
          (meta.current || 0) * 0.025 +
          (meta.caustic || 0) * (lineId % 3 === 0 ? 0.24 : 0.135) +
          (meta.measure || 0) * 0.055
        );
      });

      var gateAmount = meta.gate || 0;
      gatePlane.position.set(meta.gateX || 0, 0, 0);
      gatePlane.rotation.z = reducedMotion ? 0 : Math.sin(nowSeconds * 0.33) * 0.045;
      gatePlane.scale.set(
        0.55 + gateAmount * 0.45,
        0.55 + gateAmount * 0.45,
        1
      );
      gatePlaneMaterial.opacity = gateAmount * 0.048;
      gateRings.forEach(function (ring, ringId) {
        var gatePhase = ((nowSeconds * (0.52 + ringId * 0.05) + ringId * 0.22) % 1 + 1) % 1;
        ring.position.set(meta.gateX || 0, 0, 0);
        ring.scale.setScalar(0.72 + gatePhase * (0.9 + gateAmount * 0.85));
        ring.material.opacity = gateAmount * Math.max(0.035, (1 - gatePhase) * 0.31 - ringId * 0.022);
      });

      var measurement = meta.measure || 0;
      measurementGroup.position.set(meta.focusX || 0, 0.05, meta.focusZ || 0);
      measurementGroup.rotation.y = reducedMotion ? 0 : nowSeconds * 0.27 * (meta.measurementOutcome || 1);
      measurementGroup.rotation.z = reducedMotion ? 0 : -nowSeconds * 0.19;
      measurementShells.forEach(function (shell, shellId) {
        var shellWave = 0.86 + shellId * 0.18 +
          (reducedMotion ? 0 : Math.sin(nowSeconds * 1.4 - shellId * 0.9) * 0.08);
        shell.scale.set(
          shellWave * (1 + measurement * 0.2),
          shellWave * (1 - measurement * 0.15),
          shellWave * (1 + measurement * 0.42)
        );
        shell.material.opacity = measurement * Math.max(0.035, 0.23 - shellId * 0.032);
        if (!reducedMotion) {
          shell.rotation.x += 0.0015 * (shellId + 1) * (meta.measurementOutcome || 1);
          shell.rotation.y -= 0.0011 * (shellId + 1);
        }
      });

      var refine = meta.refine || 0;
      refinementHalo.position.set(meta.focusX || 0, 0, meta.focusZ || 0);
      refinementHalo.rotation.x = reducedMotion ? 0.2 : nowSeconds * 0.17;
      refinementHalo.rotation.y = reducedMotion ? 0.35 : -nowSeconds * 0.23;
      refinementHalo.scale.setScalar(0.7 + refine * 0.78 + Math.sin(nowSeconds * 1.1) * refine * 0.08);
      refinementHaloMaterial.opacity = refine * 0.24;
      for (var swarmId = 0; swarmId < refineSwarmCount; swarmId += 1) {
        var seedA = refineSwarmSeeds[swarmId * 3];
        var seedB = refineSwarmSeeds[swarmId * 3 + 1];
        var seedC = refineSwarmSeeds[swarmId * 3 + 2];
        var swarmAngle = seedA * Math.PI * 2 + nowSeconds * (0.32 + seedC * 0.88);
        var swarmRadius = (0.16 + Math.pow(seedB, 0.58) * 1.55) * (1.18 - refine * 0.38);
        refineSwarmArray[swarmId * 3] = (meta.focusX || 0) + Math.cos(swarmAngle) * swarmRadius;
        refineSwarmArray[swarmId * 3 + 1] = (seedC - 0.5) * 2.65 * (0.65 + swarmRadius * 0.22) +
          Math.sin(swarmAngle * 1.7) * 0.09;
        refineSwarmArray[swarmId * 3 + 2] = (meta.focusZ || 0) +
          Math.sin(swarmAngle) * swarmRadius * (0.58 + seedC * 0.52);
      }
      refineSwarmGeometry.attributes.position.needsUpdate = true;
      refineSwarmMaterial.opacity = refine * 0.62;
      refineSwarmMaterial.size = (isMobile ? 0.035 : 0.043) * (1 + refine * 0.5);
    }

    function updateCamera(nowSeconds) {
      var p = smooth(progress);
      var cameraX = mix(9.3, 7.25, p);
      var cameraY = mix(5.35, 3.35, p) + Math.sin(p * Math.PI) * 0.38;
      var cameraZ = mix(10.4, 8.25, p);
      if (progress > 0.82) {
        var section = windowed(progress, 0.82, 1);
        cameraX = mix(cameraX, 4.2, section);
        cameraY = mix(cameraY, 2.7, section);
        cameraZ = mix(cameraZ, 9.4, section);
      }
      var liveMix = windowed(progress, 0.72, 0.96);
      cameraX += Math.sin(nowSeconds * 0.17) * 0.46 * liveMix;
      cameraY += Math.sin(nowSeconds * 0.21 + 1.1) * 0.21 * liveMix;
      cameraZ += Math.cos(nowSeconds * 0.15) * 0.36 * liveMix;
      cameraTarget.set(mix(-0.25, 0.15, p), mix(0.15, -0.05, p), 0);
      cameraTarget.x += Math.sin(nowSeconds * 0.12) * 0.12 * liveMix;
      cameraTarget.y += Math.cos(nowSeconds * 0.14) * 0.045 * liveMix;
      var pointerParallax = interaction ? interaction.state.strength : 0;
      if (pointerParallax > 0.002) {
        var pointerX = interaction.state.x / 4.35;
        var pointerZ = interaction.state.z / 1.18;
        cameraX += pointerX * pointerParallax * 0.28;
        cameraY += pointerZ * pointerParallax * 0.16;
        cameraZ -= pointerX * pointerParallax * 0.17;
        cameraTarget.x += pointerX * pointerParallax * 0.24;
        cameraTarget.y += pointerZ * pointerParallax * 0.1;
        cameraTarget.z += pointerZ * pointerParallax * 0.18;
      }
      var dx = cameraX - cameraTarget.x;
      var dy = cameraY - cameraTarget.y;
      var dz = cameraZ - cameraTarget.z;
      var baseDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      var verticalHalfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
      var horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect);
      var limitingHalfFov = Math.max(0.08, Math.min(verticalHalfFov, horizontalHalfFov));
      var horizontalDomainRadius = 4.96;
      var framingScale = mix(1, isMobile ? 0.93 : 0.82, liveMix);
      var requiredDistance = horizontalDomainRadius / Math.sin(limitingHalfFov) * framingScale;
      var fit = Math.max(1, requiredDistance / Math.max(0.001, baseDistance));
      camera.position.set(
        cameraTarget.x + dx * fit,
        cameraTarget.y + dy * fit,
        cameraTarget.z + dz * fit
      );
      camera.lookAt(cameraTarget);
      root.rotation.y = -0.24 + progress * 0.38 + (reducedMotion ? 0 : Math.sin(nowSeconds * 0.17) * 0.028);
      root.rotation.x = -0.035 + windowed(progress, 0.82, 1) * 0.08 +
        (reducedMotion ? 0 : Math.sin(nowSeconds * 0.13 + 0.8) * 0.012 * liveMix);
    }

    function updateScene(nowSeconds, delta) {
      var meshBuild = clamp(progress / 0.25, 0, 1);
      var assemblyPulse = pulseWindow(progress, 0.16, 0.28, 0.42);
      var meta = updateField(nowSeconds);
      var introRefinement = progress < 0.999 ? windowed(progress, 0.78, 0.96) : 0;
      var refinement = Math.max(introRefinement, meta.refine || 0);
      var interactionStrength = interaction ? interaction.state.strength : 0;
      var energyPulse = clamp(Math.max(
        pulseWindow(progress, 0.43, 0.53, 0.67),
        (meta.gate || 0) * 0.96,
        (meta.surge || 0) * 0.8
      ) + interactionStrength * 0.62, 0, 1);

      meshMaterial.uniforms.uReveal.value = meshBuild;
      meshMaterial.uniforms.uPulse.value = assemblyPulse;
      meshMaterial.uniforms.uOpacity.value = 0.12 + windowed(progress, 0.1, 0.34) * 0.15 -
        windowed(progress, 0.78, 1) * 0.055;
      cloudMaterial.opacity = clamp(0.13 + assemblyPulse * 0.45 - windowed(progress, 0.46, 0.66) * 0.13, 0.05, 0.58);
      domainEdges.material.opacity = (0.08 + meshBuild * 0.17) *
        (1 - windowed(progress, 0.66, 1) * 0.93);

      barrierMaterial.opacity = 0.025 + windowed(progress, 0.08, 0.27) * 0.1 + energyPulse * 0.105;
      barrierEdgesMaterial.opacity = 0.13 + windowed(progress, 0.08, 0.27) * 0.25 + energyPulse * 0.43;
      barrier.scale.y = 0.35 + windowed(progress, 0.08, 0.27) * 0.65;
      barrier.scale.x = 1 + (meta.gate || 0) * 0.16 - (meta.surge || 0) * 0.14 + interactionStrength * 0.06;
      barrierEdges.scale.y = barrier.scale.y;
      barrierEdges.scale.x = barrier.scale.x;

      assemblyRing.position.x = mix(-4.55, 4.55, windowed(progress, 0.16, 0.41));
      assemblyMaterial.opacity = assemblyPulse * 0.72;
      assemblyRing.scale.set(1, 1.08 + assemblyPulse * 0.05, 0.76 + assemblyPulse * 0.04);

      var introEnergyX = mix(-4.4, -0.15, windowed(progress, 0.43, 0.57));
      var baseEnergyX = progress < 0.999 ? introEnergyX : ((meta.gate || 0) > 0.01 ? meta.gateX : 0);
      energyGroup.position.x = mix(baseEnergyX, interaction ? interaction.state.x : baseEnergyX, interactionStrength * 0.86);
      energyGroup.position.z = interaction ? interaction.state.z * interactionStrength * 0.78 : 0;
      energyGroup.rotation.x = reducedMotion ? 0 : nowSeconds * 0.19;
      energyGroup.rotation.z = reducedMotion ? 0 : -nowSeconds * 0.13;
      energyMaterials.forEach(function (material, ringIndex) {
        material.opacity = energyPulse * Math.max(0.22, 0.82 - ringIndex * 0.13);
      });
      energyGroup.scale.setScalar(0.72 + energyPulse * 0.58);

      refineLines.position.x = progress >= 0.999 ? (meta.focusX || 0) : 0;
      refineLines.position.z = progress >= 0.999 ? (meta.focusZ || 0) : 0;
      refineMaterial.opacity = refinement * (progress >= 0.999 ? 0.36 : 0.54);
      refineLines.scale.set(0.86 + refinement * 0.14, 0.86 + refinement * 0.14, 0.86 + refinement * 0.14);
      potentialMaterial.opacity = 0.02 + windowed(progress, 0.05, 0.3) * 0.04 -
        windowed(progress, 0.7, 1) * 0.018;
      potentialWireMaterial.opacity = 0.05 + windowed(progress, 0.05, 0.3) * 0.08 -
        windowed(progress, 0.7, 1) * 0.035;

      if (Math.abs(meta.signedCurrent || 0) > 0.015) {
        fluxDirection = meta.signedCurrent >= 0 ? 1 : -1;
      }
      meta.direction = fluxDirection >= 0 ? 1 : -1;
      updateContours(meta);
      updateCurrentFlow(delta || 0, meta);
      updateUnboundedEffects(nowSeconds, meta);
      updateCamera(nowSeconds);
      updateUi(progress, {
        nodes: nodeCount,
        tets: tetCount,
        refined: refinement > 0.05,
        norm: meta.norm,
        right: meta.right,
        time: nowSeconds,
        interaction: interactionStrength,
        controlId: meta.controlId,
        controlStatus: meta.controlStatus,
        controlDetail: meta.controlDetail
      });
    }

    function requestFrame() {
      if (!raf && active && pageVisible && !contextLost) raf = requestAnimationFrame(frame);
    }

    interaction = createLocalInteraction(requestFrame);

    function frame(now) {
      raf = 0;
      if (!active || !pageVisible || contextLost) return;
      if (!reducedMotion && now - lastRender < frameInterval) {
        requestFrame();
        return;
      }
      lastRender = now;
      var delta = clamp((now - lastFrame) / 1000, 0, 0.05);
      lastFrame = now;
      simulationTime += reducedMotion ? 0 : delta;
      interaction.step(delta);
      progress = autonomousProgress(simulationTime);
      resize();
      updateScene(simulationTime, delta);
      renderer.render(scene, camera);
      if (!reducedMotion) requestFrame();
    }

    canvas.addEventListener("webglcontextlost", function (event) {
      event.preventDefault();
      contextLost = true;
      if (statusNode) statusNode.textContent = "WEBGL CONTEXT LOST · RESTORING";
    });
    canvas.addEventListener("webglcontextrestored", function () {
      contextLost = false;
      lastSizeKey = "";
      lastUiKey = "";
      requestFrame();
    });

    watchVisibility(canvas, function (visible) {
      active = visible;
      setStudyActive(visible);
      if (visible) {
        lastFrame = performance.now();
        requestFrame();
      }
    });
    document.addEventListener("visibilitychange", function () {
      pageVisible = document.visibilityState !== "hidden";
      if (pageVisible) requestFrame();
    });
    window.addEventListener("resize", function () {
      lastSizeKey = "";
      requestFrame();
    }, { passive: true });
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        lastSizeKey = "";
        requestFrame();
      }).observe(canvas);
    }
    function handleMotionChange(event) {
      reducedMotion = event.matches;
      progress = autonomousProgress(simulationTime);
      interaction.step(0);
      requestFrame();
    }
    if (motionQuery.addEventListener) motionQuery.addEventListener("change", handleMotionChange);
    else if (motionQuery.addListener) motionQuery.addListener(handleMotionChange);

    resize();
    updateScene(0, 0);
    renderer.render(scene, camera);
    requestFrame();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootScene, { once: true });
  } else {
    bootScene();
  }
})();
