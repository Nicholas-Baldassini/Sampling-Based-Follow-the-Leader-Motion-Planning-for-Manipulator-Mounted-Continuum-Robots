// app.js — main-thread DOM/UI layer.
//
// All Pyodide work happens in docs/worker.js. The main thread only:
//   - runs the Three.js viewers (PathViewer + PlannerViewer)
//   - drives the loader / live-output / metrics UI
//   - relays user actions to the worker over postMessage
//
// This is what keeps the page responsive: Python execution sits on a separate
// OS thread, so the spinner spins, dropdowns work, and stdout from the planner
// streams in live (each Python `print` posts a `stdout` message, the main
// thread's event loop picks it up between repaints).

import { PathViewer, PlannerViewer } from "./viewer.js";

const WORKER_URL = "worker.js";

// ────────────────────────────────────────────────────────────────────────────
//  DOM handles
// ────────────────────────────────────────────────────────────────────────────
const loaderEl       = document.getElementById("loader");
const loaderTitle    = document.getElementById("loader-title");
const loaderPct      = document.getElementById("loader-pct");
const loaderFill     = document.getElementById("loader-fill");
const loaderSteps    = document.getElementById("loader-steps");

const runBtn         = document.getElementById("run-btn");
const plannerSel     = document.getElementById("planner-select");
const shapeLibSel    = document.getElementById("shape-lib-select");
const interpInput    = document.getElementById("interp-steps");
const gammaSlider    = document.getElementById("gamma-slider");
const gammaReadout   = document.getElementById("gamma-value");

const resultsEl      = document.getElementById("results");
const playbackEl     = document.getElementById("playback");
const playBtn        = document.getElementById("play-btn");
const frameSlider    = document.getElementById("frame-slider");
const frameReadout   = document.getElementById("frame-readout");

const pathViewerEl    = document.getElementById("path-viewer");
const plannerViewerEl = document.getElementById("planner-viewer");

const runtimeLogEl    = document.getElementById("runtime-log");
const runOutputEl     = document.getElementById("run-output");
const outputIndicator = document.getElementById("output-indicator");
const outputLabel     = document.getElementById("output-label");

// ────────────────────────────────────────────────────────────────────────────
//  Loader / progress UI
// ────────────────────────────────────────────────────────────────────────────
const STEP_WEIGHTS = {
  pyodide:  18,
  packages: 60,
  bundle:   12,
  ready:    10,
};

let pctBase = 0;
let activeStep = null;

function setLoaderTitle(text) { if (loaderTitle) loaderTitle.textContent = text; }
function setLoaderPct(pct) {
  pct = Math.max(0, Math.min(100, pct));
  if (loaderFill) loaderFill.style.width = `${pct}%`;
  if (loaderPct)  loaderPct.textContent  = `${Math.round(pct)}%`;
}
function startStep(stepName, title) {
  activeStep = stepName;
  for (const li of loaderSteps.children) {
    li.classList.remove("active");
    if (li.dataset.step === stepName) li.classList.add("active");
  }
  setLoaderTitle(title);
  setLoaderPct(pctBase);
}
function progressStep(fraction) {
  if (!activeStep) return;
  const w = STEP_WEIGHTS[activeStep] || 0;
  setLoaderPct(pctBase + w * Math.max(0, Math.min(1, fraction)));
}
function completeStep(stepName) {
  pctBase += STEP_WEIGHTS[stepName] || 0;
  for (const li of loaderSteps.children) {
    if (li.dataset.step === stepName) {
      li.classList.remove("active");
      li.classList.add("done");
    }
  }
  setLoaderPct(pctBase);
}
function loaderReady() {
  setLoaderPct(100);
  setLoaderTitle("Ready");
  loaderEl.classList.add("loader--done");
  setTimeout(() => { loaderEl.hidden = true; }, 600);
}
function loaderError(msg) {
  loaderEl.classList.add("loader--error");
  setLoaderTitle(`Error: ${msg}`);
}

// ────────────────────────────────────────────────────────────────────────────
//  Live output + persistent runtime log
// ────────────────────────────────────────────────────────────────────────────
const MAX_OUTPUT_LINES = 200;
let outputLines = [];

function setOutputState(state, label) {
  outputIndicator.classList.remove("idle", "busy", "ok", "err");
  outputIndicator.classList.add(state);
  outputLabel.textContent = label;
}
function clearOutput() {
  outputLines = [];
  runOutputEl.textContent = "";
}
function appendOutput(line) {
  outputLines.push(line);
  if (outputLines.length > MAX_OUTPUT_LINES) outputLines.shift();
  runOutputEl.textContent = outputLines.join("\n");
  runOutputEl.scrollTop = runOutputEl.scrollHeight;
}
function appendRuntimeLog(line) {
  runtimeLogEl.textContent += line + "\n";
  runtimeLogEl.scrollTop = runtimeLogEl.scrollHeight;
}
function pyOut(text) {
  if (!text) return;
  appendOutput(text);
  appendRuntimeLog(text);
}
function appLog(...parts) {
  const line = "[demo] " + parts
    .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
    .join(" ");
  console.log(line);
  appendRuntimeLog(line);
}

// ────────────────────────────────────────────────────────────────────────────
//  Three.js viewers (live as soon as the page loads)
// ────────────────────────────────────────────────────────────────────────────
const pathViewer    = new PathViewer(pathViewerEl);
const plannerViewer = new PlannerViewer(plannerViewerEl);
plannerViewer.frameChangeListener = (i) => syncFrameUi(i);

function syncFrameUi(i) {
  if (!plannerViewer.frames) return;
  frameSlider.value = String(i);
  frameReadout.textContent = `${i + 1} / ${plannerViewer.frames.length}`;
}

// ────────────────────────────────────────────────────────────────────────────
//  UI helpers
// ────────────────────────────────────────────────────────────────────────────
function setControlsEnabled(enabled) {
  runBtn.disabled      = !enabled;
  plannerSel.disabled  = !enabled;
  shapeLibSel.disabled = !enabled;
  interpInput.disabled = !enabled;
  syncGammaSliderState(enabled);
}
function syncGammaSliderState(enabled) {
  gammaSlider.disabled = !enabled || plannerSel.value !== "Threshold Cluster";
}
function setMetric(name, value) {
  const el = resultsEl.querySelector(`[data-metric="${name}"]`);
  if (el) el.textContent = value;
}
function formatDev(dev) {
  if (!dev) return "—";
  return `${dev.mean.toFixed(3)}% / ${dev.max.toFixed(3)}%`;
}

let _toastTimer = null;
function toast(message, durationMs = 3200) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.classList.add("toast--show");
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove("toast--show");
    setTimeout(() => { el.hidden = true; }, 220);
  }, durationMs);
}

// ────────────────────────────────────────────────────────────────────────────
//  Worker setup + request/response plumbing
// ────────────────────────────────────────────────────────────────────────────
const worker = new Worker(WORKER_URL);

let nextCallId = 0;
const pendingCalls = new Map();

function workerCall(type, params = {}) {
  const id = ++nextCallId;
  return new Promise((resolve, reject) => {
    pendingCalls.set(id, { resolve, reject });
    worker.postMessage({ type, id, ...params });
  });
}

worker.onerror = (e) => {
  console.error("[worker error]", e);
  appLog("worker error:", e.message || String(e));
  loaderError(e.message || "worker crashed");
  setOutputState("err", "Worker crashed — see runtime log.");
};

worker.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "stage":
      startStep(msg.step, msg.title);
      break;
    case "stageProgress":
      if (msg.step === activeStep) progressStep(msg.fraction);
      break;
    case "stageDone":
      completeStep(msg.step);
      break;
    case "ready":
      onWorkerReady(msg);
      break;
    case "stdout":
      pyOut(msg.text);
      break;
    case "log":
      appLog(msg.text);
      break;
    case "response": {
      const slot = pendingCalls.get(msg.id);
      if (slot) { pendingCalls.delete(msg.id); slot.resolve(msg.payload); }
      break;
    }
    case "error": {
      if (msg.id != null) {
        const slot = pendingCalls.get(msg.id);
        if (slot) { pendingCalls.delete(msg.id); slot.reject(new Error(msg.message)); }
      } else {
        loaderError(msg.message);
        setOutputState("err", "Setup failed.");
      }
      break;
    }
    default:
      console.warn("[unknown worker message]", msg);
  }
};

function onWorkerReady({ defaultCurve, defaultRobot }) {
  pathViewer.showTargetPath(defaultCurve);
  plannerViewer.showTargetPath(defaultCurve);
  plannerViewer.showDefaultRobot(defaultRobot);

  loaderReady();
  setOutputState("idle", "Idle — pick a planner and hit Run.");
  setControlsEnabled(true);

  runBtn.addEventListener("click", onRunClicked);
  plannerSel.addEventListener("change", () => syncGammaSliderState(true));
  gammaSlider.addEventListener("input", () => {
    gammaReadout.textContent = parseFloat(gammaSlider.value).toFixed(2);
  });
  playBtn.addEventListener("click", () => {
    if (!plannerViewer.frames) {
      toast("Run the planner first — there's no motion plan to play yet.");
      return;
    }
    plannerViewer.togglePlay();
    playBtn.textContent = plannerViewer.playing ? "⏸" : "▶";
  });
  frameSlider.addEventListener("input", () => {
    if (!plannerViewer.frames) {
      toast("Run the planner first — there's no motion plan to scrub yet.");
      return;
    }
    plannerViewer.pause();
    playBtn.textContent = "▶";
    plannerViewer.setFrame(parseInt(frameSlider.value, 10));
  });
}

// Kick off the worker bootstrap.
setOutputState("busy", "Booting Pyodide…");
worker.postMessage({ type: "init" });

// ────────────────────────────────────────────────────────────────────────────
//  Run pipeline
// ────────────────────────────────────────────────────────────────────────────
async function onRunClicked() {
  setControlsEnabled(false);
  setOutputState("busy", "Planner running…");
  clearOutput();

  const plannerName = plannerSel.value;
  const interpSteps = Math.max(1, parseInt(interpInput.value, 10) || 20);
  const gamma       = parseFloat(gammaSlider.value);
  const shapeLibUrl = shapeLibSel.value;

  appLog(`Running planner=${plannerName}, interp_steps=${interpSteps}` +
         (plannerName === "Threshold Cluster" ? `, gamma=${gamma}` : "") +
         (plannerName !== "Direct Optimization" ? `, shape_lib=${shapeLibUrl}` : ""));

  const t0 = performance.now();
  try {
    const result = await workerCall("run", {
      plannerName,
      shapeLibUrl,
      interpSteps,
      gamma,
      numWaypoints: 10,
    });
    const wallSecs = (performance.now() - t0) / 1000;
    appLog(`run complete in ${wallSecs.toFixed(2)} s — ${result.frames} frames`);

    resultsEl.hidden = false;
    setMetric("tip",        formatDev(result.tip_dev));
    setMetric("shape",      formatDev(result.shape_dev));
    setMetric("setup-time", `${result.setup_secs.toFixed(2)} s`);
    setMetric("plan-time",  `${result.plan_secs.toFixed(2)} s`);
    setMetric("frames",     `${result.frames}`);

    plannerViewer.loadResult(result);
    playbackEl.hidden        = false;
    frameSlider.disabled     = false;
    frameSlider.min          = "0";
    frameSlider.max          = String(result.frames - 1);
    frameSlider.value        = "0";
    frameReadout.textContent = `1 / ${result.frames}`;

    // Start playback automatically so the user immediately sees what was just
    // computed. They can pause / scrub with the controls.
    plannerViewer.play();
    playBtn.textContent = "⏸";

    setOutputState("ok", `Run finished in ${wallSecs.toFixed(2)} s.`);
  } catch (err) {
    console.error(err);
    appLog("ERROR:", err.message || String(err));
    setOutputState("err", "Run failed — see runtime log.");
  } finally {
    setControlsEnabled(true);
  }
}
