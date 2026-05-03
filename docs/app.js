// app.js — bootstraps Pyodide and runs a smoke test.
//
// First-pass scope: load Pyodide + numpy, run a 1-line Python snippet to confirm
// the runtime is alive, and surface status (loading / ready / error) on the page.
// Loading the planner code itself comes in the next iteration.
//
// Pyodide docs: https://pyodide.org/en/stable/usage/quickstart.html
// `loadPyodide` is provided by the pyodide.js <script> tag in index.html.

const PYODIDE_VERSION  = "0.29.3";
const PYODIDE_BASE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const statusEl  = document.getElementById("runtime-status");
const statusTxt = statusEl.querySelector(".runtime-status__text");
const logEl     = document.getElementById("runtime-log");
const demoPanel = document.getElementById("demo-panel");

function setStatus(state, text) {
  statusEl.classList.remove("loading", "ready", "error");
  statusEl.classList.add(state);
  statusTxt.textContent = text;
}

function log(...parts) {
  const line = parts
    .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
    .join(" ");
  console.log("[pyodide]", line);
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

async function bootstrap() {
  setStatus("loading", "Loading Python runtime…");

  if (typeof window.loadPyodide !== "function") {
    setStatus("error", "Pyodide failed to load — see runtime log.");
    log("FATAL: window.loadPyodide is not defined. Did pyodide.js fail to load from CDN?");
    return;
  }

  try {
    log(`Initializing Pyodide ${PYODIDE_VERSION}`);
    const pyodide = await window.loadPyodide({
      indexURL: PYODIDE_BASE_URL,
      stdout: (msg) => log(msg),
      stderr: (msg) => log("err:", msg),
    });
    log("Pyodide runtime loaded");

    setStatus("loading", "Loading numpy…");
    log("Loading numpy");
    await pyodide.loadPackage(["numpy"]);
    log("numpy loaded");

    // Smoke test: confirm the runtime can execute Python and return values.
    const result = pyodide
      .runPython(`
import numpy as np
import sys
{
    "python_version": sys.version.split(" ")[0],
    "numpy_version":  np.__version__,
    "smoke_check":    float(np.array([1.0, 2.0, 3.0]).mean()),
}
`)
      .toJs({ dict_converter: Object.fromEntries });

    log("Smoke test:", result);

    setStatus(
      "ready",
      `Python ${result.python_version} ready (numpy ${result.numpy_version})`
    );
    demoPanel.hidden = false;
    demoPanel.textContent =
      "Pyodide is loaded. Demo controls and 3D viewer will be wired up next.";

    // Expose for console-poking during development.
    window.pyodide = pyodide;
  } catch (err) {
    console.error(err);
    log("FATAL:", err.message || String(err));
    setStatus("error", "Failed to load Python runtime — see runtime log.");
  }
}

bootstrap();
