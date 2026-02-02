/* global webgazer */

const hud = document.getElementById("hud");
const statusEl = document.getElementById("status");
const btnStart = document.getElementById("btnStart");
const btnCalibrate = document.getElementById("btnCalibrate");
const btnRecord = document.getElementById("btnRecord");
const btnToggleClickThrough = document.getElementById("btnToggleClickThrough");
const btnToggleHud = document.getElementById("btnToggleHud");
const calibrationRoot = document.getElementById("calibration");
const gazeDot = document.getElementById("gazeDot");
const predValue = document.getElementById("predValue");
const sampleValue = document.getElementById("sampleValue");
const clickValue = document.getElementById("clickValue");
const faceValue = document.getElementById("faceValue");
const videoValue = document.getElementById("videoValue");
const predState = document.getElementById("predState");
const predIndicator = document.getElementById("predIndicator");
const recordValue = document.getElementById("recordValue");
const recordIndicator = document.getElementById("recordIndicator");
const btnExportHeatmap = document.getElementById("btnExportHeatmap");
const ipCameraToggle = document.getElementById("useIpCamera");
const ipCameraUrlInput = document.getElementById("ipCameraUrl");
const recordMicAudioToggle = document.getElementById("recordMicAudio");
const recordSystemAudioToggle = document.getElementById("recordSystemAudio");
const hudHandle = document.getElementById("hudHandle");

const HUD_STORAGE_KEY = "webgazer:hud-position";
const HUD_PADDING_PX = 12;
const HUD_DOCK_SNAP_PX = 28;

let hudDrag = null;

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeJsonParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function getViewportSize() {
  const root = document.documentElement;
  return { width: root.clientWidth, height: root.clientHeight };
}

function loadHudPosition() {
  const raw = safeJsonParse(localStorage.getItem(HUD_STORAGE_KEY));
  if (!raw || typeof raw !== "object") return null;
  const dockX = raw.dockX === "left" || raw.dockX === "right" ? raw.dockX : null;
  const dockY = raw.dockY === "top" || raw.dockY === "bottom" ? raw.dockY : null;
  const left = isFiniteNumber(raw.left) ? raw.left : null;
  const top = isFiniteNumber(raw.top) ? raw.top : null;
  if (left === null || top === null) return null;
  return { dockX, dockY, left, top };
}

function saveHudPosition(position) {
  if (!position) return;
  localStorage.setItem(HUD_STORAGE_KEY, JSON.stringify(position));
}

function applyHudPosition(position) {
  if (!position) return;

  const { width: viewportWidth, height: viewportHeight } = getViewportSize();
  const width = Math.max(1, hud.offsetWidth || 0);
  const height = Math.max(1, hud.offsetHeight || 0);
  const maxLeft = Math.max(HUD_PADDING_PX, viewportWidth - width - HUD_PADDING_PX);
  const maxTop = Math.max(HUD_PADDING_PX, viewportHeight - height - HUD_PADDING_PX);

  const dockX = position.dockX === "left" || position.dockX === "right" ? position.dockX : null;
  const dockY = position.dockY === "top" || position.dockY === "bottom" ? position.dockY : null;

  const left = clampNumber(position.left, HUD_PADDING_PX, maxLeft);
  const top = clampNumber(position.top, HUD_PADDING_PX, maxTop);

  hud.style.left = dockX === "right" ? "auto" : `${Math.round(left)}px`;
  hud.style.right = dockX === "right" ? `${HUD_PADDING_PX}px` : "auto";
  hud.style.top = dockY === "bottom" ? "auto" : `${Math.round(top)}px`;
  hud.style.bottom = dockY === "bottom" ? `${HUD_PADDING_PX}px` : "auto";

  if (dockX === "left") {
    hud.style.left = `${HUD_PADDING_PX}px`;
    hud.style.right = "auto";
  }
  if (dockY === "top") {
    hud.style.top = `${HUD_PADDING_PX}px`;
    hud.style.bottom = "auto";
  }
}

function resetHudPosition() {
  localStorage.removeItem(HUD_STORAGE_KEY);
  hud.style.left = "";
  hud.style.right = "";
  hud.style.top = "";
  hud.style.bottom = "";
}

function snapHudDocking(rect) {
  const { width: viewportWidth, height: viewportHeight } = getViewportSize();

  const dLeft = Math.abs(rect.left - HUD_PADDING_PX);
  const dRight = Math.abs(viewportWidth - rect.right - HUD_PADDING_PX);
  const dTop = Math.abs(rect.top - HUD_PADDING_PX);
  const dBottom = Math.abs(viewportHeight - rect.bottom - HUD_PADDING_PX);

  let dockX = null;
  let dockY = null;

  if (dLeft <= HUD_DOCK_SNAP_PX || dRight <= HUD_DOCK_SNAP_PX) {
    dockX = dLeft <= dRight ? "left" : "right";
  }
  if (dTop <= HUD_DOCK_SNAP_PX || dBottom <= HUD_DOCK_SNAP_PX) {
    dockY = dTop <= dBottom ? "top" : "bottom";
  }

  return { dockX, dockY };
}

function onHudPointerMove(event) {
  if (!hudDrag || event.pointerId !== hudDrag.pointerId) return;
  const dx = event.clientX - hudDrag.startX;
  const dy = event.clientY - hudDrag.startY;

  const { width: viewportWidth, height: viewportHeight } = getViewportSize();
  const maxLeft = Math.max(HUD_PADDING_PX, viewportWidth - hudDrag.width - HUD_PADDING_PX);
  const maxTop = Math.max(HUD_PADDING_PX, viewportHeight - hudDrag.height - HUD_PADDING_PX);

  const nextLeft = clampNumber(hudDrag.startLeft + dx, HUD_PADDING_PX, maxLeft);
  const nextTop = clampNumber(hudDrag.startTop + dy, HUD_PADDING_PX, maxTop);

  hud.style.left = `${Math.round(nextLeft)}px`;
  hud.style.top = `${Math.round(nextTop)}px`;
  hud.style.right = "auto";
  hud.style.bottom = "auto";
}

function endHudDrag(event) {
  if (!hudDrag || event.pointerId !== hudDrag.pointerId) return;
  window.removeEventListener("pointermove", onHudPointerMove);
  hud.classList.remove("dragging");

  const rect = hud.getBoundingClientRect();
  const docking = snapHudDocking(rect);
  const position = {
    dockX: docking.dockX,
    dockY: docking.dockY,
    left: rect.left,
    top: rect.top
  };
  saveHudPosition(position);
  applyHudPosition(position);

  hudDrag = null;
}

function initHudDragAndDock() {
  if (!hud || !hudHandle) return;

  const stored = loadHudPosition();
  if (stored) {
    // Wait a tick so offsetWidth/offsetHeight reflect final layout.
    requestAnimationFrame(() => applyHudPosition(stored));
  }

  hudHandle.addEventListener("dblclick", resetHudPosition);

  hudHandle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const rect = hud.getBoundingClientRect();
    hudDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height
    };
    hud.classList.add("dragging");

    try {
      hudHandle.setPointerCapture(event.pointerId);
    } catch {}

    window.addEventListener("pointermove", onHudPointerMove);
    window.addEventListener("pointerup", endHudDrag, { once: true });
    window.addEventListener("pointercancel", endHudDrag, { once: true });
  });

  window.addEventListener("resize", () => {
    const next = loadHudPosition();
    if (next) applyHudPosition(next);
  });
}

let started = false;
let clickThrough = false;
let hudHidden = false;
let calibrating = false;
let recording = false;
let exportingHeatmap = false;

let mediaRecorder = null;
let recordStream = null;
let recordDisplayStream = null;
let recordMicStream = null;
let recordAudioContext = null;
let recordedChunks = [];
let recordingBaseName = "";
let recordingStartMs = 0;
let recordingStartEpochMs = 0;
let gazeSamples = [];
let clickSamples = [];
let recordingDisplay = null;
let lastRecordingFile = "";
let lastGazeFile = "";
let lastClickFile = "";
let lastRecordingDisplay = null;
const recordingSupported =
  Boolean(navigator.mediaDevices?.getDisplayMedia) && typeof MediaRecorder !== "undefined";
const HEATMAP_WINDOW_MS = 10000;
const HEATMAP_EXPORT_FPS = 30;
const HEATMAP_BIN_MS = 10;
const HEATMAP_CELL_SIZE_PX = 50;
const HEATMAP_LOG_K = 9;

let lastX = null;
let lastY = null;
const smoothing = 0.2;
let predictionRaf = 0;
let predictionPending = false;

let ipCameraSession = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function setPredictionState(active) {
  predState.textContent = active ? "Active" : "Waiting";
  predIndicator.classList.toggle("active", active);
}

function setRecordingUI(active) {
  recording = active;
  recordValue.textContent = active ? "On" : "Off";
  recordIndicator.classList.toggle("active", active);
  btnRecord.textContent = active ? "Stop Recording" : "Record Screen";
  btnRecord.classList.toggle("recording", active);
  setExportHeatmapEnabled();
}

function setGazeDotVisible(visible) {
  gazeDot.classList.toggle("hidden", !visible);
}

function applyCalibrationVisibility() {
  calibrationRoot.classList.toggle("hidden", !calibrating || hudHidden);
}

function applyWebgazerUiVisibility() {
  if (typeof webgazer === "undefined") return;
  const showOverlays = !hudHidden;
  if (typeof webgazer.showVideoPreview === "function") {
    webgazer.showVideoPreview(showOverlays);
  }
  if (typeof webgazer.showFaceOverlay === "function") {
    webgazer.showFaceOverlay(showOverlays);
  }
  if (typeof webgazer.showFaceFeedbackBox === "function") {
    webgazer.showFaceFeedbackBox(showOverlays);
  }
}

function setHudVisible(visible) {
  hudHidden = !visible;
  hud.classList.toggle("hidden", !visible);
  btnToggleHud.textContent = visible ? "Hide UI" : "Show UI";
  if (hudHidden) setGazeDotVisible(false);
  applyCalibrationVisibility();
  applyWebgazerUiVisibility();
}

function setClickThroughUI(enabled) {
  clickThrough = enabled;
  btnToggleClickThrough.textContent = `Click-through: ${enabled ? "on" : "off"}`;
}

function getFileName(filePath) {
  if (!filePath) return "";
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

function setExportHeatmapEnabled() {
  const ready = Boolean(lastRecordingFile && lastGazeFile);
  btnExportHeatmap.disabled = !ready || exportingHeatmap || recording;
}

function moveDot(x, y) {
  if (typeof x !== "number" || typeof y !== "number") return;
  if (lastX === null || lastY === null) {
    lastX = x;
    lastY = y;
  } else {
    lastX = lastX + (x - lastX) * smoothing;
    lastY = lastY + (y - lastY) * smoothing;
  }
  gazeDot.style.transform = `translate(${Math.round(lastX)}px, ${Math.round(lastY)}px)`;
  return { x: lastX, y: lastY };
}

function buildCalibrationGrid() {
  calibrationRoot.innerHTML = "";
  const points = [
    [0.1, 0.1],
    [0.5, 0.1],
    [0.9, 0.1],
    [0.1, 0.5],
    [0.5, 0.5],
    [0.9, 0.5],
    [0.1, 0.9],
    [0.5, 0.9],
    [0.9, 0.9]
  ];

  for (const [px, py] of points) {
    const point = document.createElement("button");
    point.type = "button";
    point.className = "cal-point";
    point.style.left = `${px * 100}%`;
    point.style.top = `${py * 100}%`;
    point.title = "Click 5-10 times";
    let clicks = 0;
    point.addEventListener("click", () => {
      clicks += 1;
      point.dataset.clicks = String(clicks);
      point.classList.toggle("done", clicks >= 5);
      if (clicks >= 10) {
        point.disabled = true;
      }
      if ([...calibrationRoot.querySelectorAll(".cal-point")].every((p) => p.classList.contains("done"))) {
        setStatus("Calibration complete (press Calibrate to hide)");
      }
    });
    calibrationRoot.appendChild(point);
  }
}

function buildCameraProxyUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) throw new Error("IP camera URL is empty.");

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("IP camera URL is invalid.");
  }

  const scheme = parsed.protocol.replace(":", "");
  if (scheme !== "http" && scheme !== "https") {
    throw new Error("IP camera URL must be http(s).");
  }

  return `/__camera__/${scheme}/${parsed.host}${parsed.pathname}${parsed.search || ""}`;
}

function waitForImageLoad(img, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out loading IP camera stream."));
    }, timeoutMs);

    const onLoad = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("Failed to load IP camera stream (check URL/allowlist)."));
    };

    function cleanup() {
      clearTimeout(timeout);
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
    }

    img.addEventListener("load", onLoad, { once: true });
    img.addEventListener("error", onError, { once: true });
  });
}

async function createMjpegImage(rawUrl, timeoutMs = 8000) {
  const proxiedUrl = buildCameraProxyUrl(rawUrl);
  const img = new Image();
  img.decoding = "async";
  img.src = proxiedUrl;
  await waitForImageLoad(img, timeoutMs);
  return { img, proxiedUrl };
}

async function startMjpegCanvasCapture(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = null;
  }

  const candidates = [trimmed].filter(Boolean);
  if (parsed && parsed.pathname === "/" && !parsed.search) {
    const base = `${parsed.protocol}//${parsed.host}`;
    candidates.push(`${base}/video`, `${base}/?action=stream`);
  }

  let img = null;
  let proxiedUrl = "";
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const created = await createMjpegImage(candidate, 6000);
      img = created.img;
      proxiedUrl = created.proxiedUrl;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!img) {
    const baseHint =
      parsed && parsed.pathname === "/" && !parsed.search ? " (try adding /video)" : "";
    throw new Error(`Failed to load IP camera stream${baseHint}: ${lastError?.message || lastError || "Unknown"}`);
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const initialWidth = img.naturalWidth || 640;
  const initialHeight = img.naturalHeight || 480;
  canvas.width = initialWidth;
  canvas.height = initialHeight;

  let active = true;
  const draw = () => {
    if (!active) return;

    const width = img.naturalWidth || canvas.width;
    const height = img.naturalHeight || canvas.height;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    try {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } catch {}

    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  const stream = canvas.captureStream(30);
  return {
    stream,
    stop() {
      active = false;
      try {
        img.src = "";
      } catch {}
      try {
        stream.getTracks().forEach((track) => track.stop());
      } catch {}
    }
  };
}

async function startWebgazer() {
  if (started) return;
  if (typeof webgazer === "undefined") {
    setStatus("webgazer.js not loaded");
    return;
  }

  setStatus("Starting camera...");
  try {
    webgazer.showPredictionPoints(false);

    webgazer.addMouseEventListeners();

    const useIpCamera = Boolean(ipCameraToggle?.checked);
    const ipCameraUrl = String(ipCameraUrlInput?.value || "").trim();
    let didPatchGetUserMedia = false;
    let priorGetUserMedia = null;
    let priorGetUserMediaThis = null;

    try {
      if (useIpCamera) {
        setStatus("Starting IP camera...");
        ipCameraSession = await startMjpegCanvasCapture(ipCameraUrl);

        if (!navigator.mediaDevices) navigator.mediaDevices = {};
        if (typeof navigator.mediaDevices.getUserMedia === "function") {
          priorGetUserMedia = navigator.mediaDevices.getUserMedia;
          priorGetUserMediaThis = navigator.mediaDevices;
        }

        navigator.mediaDevices.getUserMedia = async () => ipCameraSession.stream;
        didPatchGetUserMedia = true;
      }

      await webgazer.begin();
    } finally {
      if (didPatchGetUserMedia && navigator.mediaDevices) {
        if (typeof priorGetUserMedia === "function") {
          navigator.mediaDevices.getUserMedia = priorGetUserMedia.bind(priorGetUserMediaThis || navigator.mediaDevices);
        } else {
          try {
            delete navigator.mediaDevices.getUserMedia;
          } catch {}
        }
      }
    }
    applyWebgazerUiVisibility();

    started = true;
    btnStart.disabled = true;
    setStatus("Running (waiting for predictions)");
    setPredictionState(false);

    const tick = () => {
      const tracker = webgazer.getTracker?.();
      const positions = tracker?.getPositions?.();
      const faceDetected = Array.isArray(positions) && positions.length > 0;
      faceValue.textContent = faceDetected ? "Yes" : "No";

      const videoReady = typeof webgazer.isReady === "function" && webgazer.isReady();
      videoValue.textContent = videoReady ? "Ready" : "Init";

      const regs = webgazer.getRegression?.();
      let sampleCount = 0;
      if (Array.isArray(regs) && regs.length > 0 && typeof regs[0].getData === "function") {
        const samples = regs[0].getData();
        if (Array.isArray(samples)) sampleCount = samples.length;
      }
      sampleValue.textContent = String(sampleCount);

      if (!predictionPending && typeof webgazer.getCurrentPrediction === "function") {
        predictionPending = true;
        Promise.resolve(webgazer.getCurrentPrediction())
          .then((data) => {
            const hasPrediction = data && typeof data.x === "number" && typeof data.y === "number";
            if (hasPrediction) {
              const smoothed = moveDot(data.x, data.y);
              predValue.textContent = `${Math.round(data.x)}, ${Math.round(data.y)}`;
              setPredictionState(true);
              setGazeDotVisible(!hudHidden);
              if (recording && smoothed && recordingBaseName) {
                const t = recordingElapsedMs();
                gazeSamples.push({ t, x: data.x, y: data.y, sx: smoothed.x, sy: smoothed.y });
              }
              if (statusEl.textContent.includes("waiting")) setStatus("Running");
            } else {
              predValue.textContent = "--";
              setPredictionState(false);
              setGazeDotVisible(false);
            }
          })
          .catch(() => {
            predValue.textContent = "--";
            setPredictionState(false);
            setGazeDotVisible(false);
          })
          .finally(() => {
            predictionPending = false;
          });
      }
      predictionRaf = requestAnimationFrame(tick);
    };
    predictionRaf = requestAnimationFrame(tick);
  } catch (error) {
    try {
      ipCameraSession?.stop?.();
    } catch {}
    ipCameraSession = null;
    setStatus(`Failed: ${error?.message || error}`);
  }
}

function toggleCalibration() {
  calibrating = !calibrating;
  applyCalibrationVisibility();
  if (calibrating) {
    buildCalibrationGrid();
    setStatus("Calibration: click each dot 5-10 times");
  } else {
    setStatus(started ? "Running" : "Idle");
  }
}

async function toggleClickThrough() {
  setClickThroughUI(!clickThrough);
  await window.desktopAPI.setClickThrough(clickThrough);
  if (clickThrough) {
    setHudVisible(false);
  }
}

async function toggleFocusMode() {
  const enabling = !(clickThrough && hudHidden);
  if (enabling) {
    setHudVisible(false);
    setClickThroughUI(true);
    await window.desktopAPI.setClickThrough(true);
  } else {
    setClickThroughUI(false);
    await window.desktopAPI.setClickThrough(false);
    setHudVisible(true);
  }
}

function getRecordingBaseName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `webgazer-recording-${stamp}`;
}

function getRecordingName(baseName) {
  return `${baseName}.webm`;
}

function getGazeName(baseName) {
  return `${baseName}-gaze.csv`;
}

function getClickName(baseName) {
  return `${baseName}-clicks.csv`;
}

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function recordingElapsedMs() {
  if (recordingStartEpochMs) {
    return Math.max(0, Date.now() - recordingStartEpochMs);
  }
  return Math.max(0, Math.round(nowMs() - recordingStartMs));
}

function recordMouseClick(event) {
  if (!recording || !recordingBaseName) return;
  if (!event) return;

  const t = recordingElapsedMs();
  clickSamples.push({
    t,
    screenX: typeof event.screenX === "number" ? event.screenX : null,
    screenY: typeof event.screenY === "number" ? event.screenY : null,
    clientX: typeof event.clientX === "number" ? event.clientX : null,
    clientY: typeof event.clientY === "number" ? event.clientY : null,
    button: typeof event.button === "number" ? event.button : null
  });

  if (clickValue) clickValue.textContent = String(clickSamples.length);
}

function resetGazeRecording() {
  recordingBaseName = "";
  recordingStartMs = 0;
  recordingStartEpochMs = 0;
  gazeSamples = [];
  clickSamples = [];
  if (clickValue) clickValue.textContent = "0";
  recordingDisplay = null;
}

function getRecordingUrl(fileName) {
  return `/recordings/${encodeURIComponent(fileName)}`;
}

function parseGazeCsv(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];
  if (lines[0].toLowerCase().startsWith("t_ms")) lines.shift();

  const samples = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const t = Number.parseFloat(parts[0]);
    const x = Number.parseFloat(parts[1]);
    const y = Number.parseFloat(parts[2]);
    const sx = Number.parseFloat(parts[3]);
    const sy = Number.parseFloat(parts[4]);
    if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    samples.push({
      t,
      x,
      y,
      sx: Number.isFinite(sx) ? sx : x,
      sy: Number.isFinite(sy) ? sy : y
    });
  }

  if (samples.length > 0) {
    const intervals = [];
    for (let i = 0; i < samples.length - 1; i += 1) {
      const dt = samples[i + 1].t - samples[i].t;
      if (Number.isFinite(dt) && dt > 0) intervals.push(dt);
    }
    intervals.sort((a, b) => a - b);
    const defaultDt =
      intervals.length > 0 ? intervals[Math.floor(intervals.length / 2)] : 33;

    for (let i = 0; i < samples.length - 1; i += 1) {
      const dt = Math.max(1, samples[i + 1].t - samples[i].t);
      samples[i].dt = Math.min(dt, HEATMAP_WINDOW_MS);
    }
    samples[samples.length - 1].dt = Math.min(Math.max(1, defaultDt), HEATMAP_WINDOW_MS);
  }

  return samples;
}

async function loadGazeSamples(fileName) {
  const response = await fetch(getRecordingUrl(fileName));
  if (!response.ok) throw new Error(`Failed to load gaze CSV (${response.status})`);
  const text = await response.text();
  return parseGazeCsv(text);
}

function getRecordingScale(videoWidth, videoHeight) {
  const bounds = lastRecordingDisplay?.bounds;
  if (!bounds || !bounds.width || !bounds.height) {
    return { x: 1, y: 1 };
  }
  return {
    x: videoWidth / bounds.width,
    y: videoHeight / bounds.height
  };
}

function waitForVideoMetadata(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Video failed to load"));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onError);
  });
}

function getPreferredMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function stopStream(stream) {
  if (!stream || typeof stream.getTracks !== "function") return;
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {}
  });
}

async function buildRecordingStream() {
  const includeSystemAudio = Boolean(recordSystemAudioToggle?.checked);
  const includeMicAudio = Boolean(recordMicAudioToggle?.checked);

  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: includeSystemAudio
  });

  let micStream = null;
  if (includeMicAudio && navigator.mediaDevices?.getUserMedia) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (error) {
      console.warn("[recording] microphone capture unavailable:", error);
      micStream = null;
    }
  }

  const displayAudioTracks = displayStream.getAudioTracks();
  const micAudioTracks = micStream?.getAudioTracks?.() || [];

  let mixedAudioTrack = null;
  let audioContext = null;
  if (displayAudioTracks.length + micAudioTracks.length === 1) {
    mixedAudioTrack = (displayAudioTracks[0] || micAudioTracks[0]) ?? null;
  } else if (displayAudioTracks.length + micAudioTracks.length > 1) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const destination = audioContext.createMediaStreamDestination();

      if (displayAudioTracks[0]) {
        const source = audioContext.createMediaStreamSource(new MediaStream([displayAudioTracks[0]]));
        source.connect(destination);
      }
      if (micAudioTracks[0]) {
        const source = audioContext.createMediaStreamSource(new MediaStream([micAudioTracks[0]]));
        source.connect(destination);
      }

      try {
        await audioContext.resume();
      } catch {}

      mixedAudioTrack = destination.stream.getAudioTracks()[0] || null;
    } catch (error) {
      console.warn("[recording] audio mixing unavailable:", error);
      mixedAudioTrack = displayAudioTracks[0] || micAudioTracks[0] || null;
      if (audioContext) {
        try {
          await audioContext.close();
        } catch {}
      }
      audioContext = null;
    }
  }

  const tracks = [...displayStream.getVideoTracks()];
  if (mixedAudioTrack) tracks.push(mixedAudioTrack);
  const stream = new MediaStream(tracks);

  const cleanup = async () => {
    stopStream(stream);
    stopStream(displayStream);
    stopStream(micStream);
    if (audioContext) {
      try {
        await audioContext.close();
      } catch {}
    }
  };

  return { stream, displayStream, micStream, audioContext, cleanup };
}

async function startRecording() {
  if (!recordingSupported) {
    setStatus("Screen recording is not supported.");
    return;
  }
  if (recording) return;
  if (typeof window.desktopAPI?.saveRecording !== "function") {
    setStatus("Screen recording is not available.");
    return;
  }

  setStatus("Starting screen recording...");
  try {
    const recordingStream = await buildRecordingStream();
    recordStream = recordingStream.stream;
    recordDisplayStream = recordingStream.displayStream;
    recordMicStream = recordingStream.micStream;
    recordAudioContext = recordingStream.audioContext;

    const warnings = [];
    try {
      if (recordMicAudioToggle?.checked && !recordMicStream) {
        warnings.push("microphone unavailable");
      }
    } catch {}
    try {
      if (recordSystemAudioToggle?.checked && recordDisplayStream?.getAudioTracks?.().length === 0) {
        warnings.push("system audio unavailable");
      }
    } catch {}
    try {
      if (recordMicAudioToggle?.checked || recordSystemAudioToggle?.checked) {
        if (recordStream?.getAudioTracks?.().length === 0) warnings.push("no audio track");
      }
    } catch {}

    const mimeType = getPreferredMimeType();
    const options = mimeType ? { mimeType } : undefined;
    recordedChunks = [];
    gazeSamples = [];
    clickSamples = [];
    if (clickValue) clickValue.textContent = "0";
    recordingBaseName = getRecordingBaseName();
    recordingStartMs = nowMs();
    recordingStartEpochMs = Date.now();
    recordingDisplay = null;
    try {
      if (typeof window.desktopAPI?.getDisplayInfo === "function") {
        recordingDisplay = await window.desktopAPI.getDisplayInfo();
      }
    } catch {}

    try {
      const result = await window.desktopAPI?.startSystemClickCapture?.({ startEpochMs: recordingStartEpochMs });
      if (result && result.ok === false && result.error) {
        console.warn("[system-click] start failed:", result.error);
        setStatus(`Recording screen (click capture unavailable: ${result.error})`);
      }
    } catch {}
    mediaRecorder = new MediaRecorder(recordStream, options);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) recordedChunks.push(event.data);
    });

    mediaRecorder.addEventListener("stop", () => {
      finishRecording();
    });

    recordStream.getVideoTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (mediaRecorder && mediaRecorder.state !== "inactive") stopRecording();
      });
    });

    mediaRecorder.start();
    setRecordingUI(true);
    const warningText = warnings.length ? ` (audio: ${warnings.join(", ")})` : "";
    setStatus(`Recording screen${warningText}`);
  } catch (error) {
    setStatus(`Recording failed: ${error?.message || error}`);
    try {
      await window.desktopAPI?.stopSystemClickCapture?.();
    } catch {}
    cleanupRecording();
    resetGazeRecording();
    setRecordingUI(false);
  }
}

function stopRecording() {
  if (!mediaRecorder) return;
  if (mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    setStatus("Saving recording...");
  }
  setRecordingUI(false);
}

function cleanupRecording() {
  stopStream(recordStream);
  stopStream(recordDisplayStream);
  stopStream(recordMicStream);
  if (recordAudioContext) {
    try {
      recordAudioContext.close();
    } catch {}
  }
  recordStream = null;
  recordDisplayStream = null;
  recordMicStream = null;
  recordAudioContext = null;
  mediaRecorder = null;
}

async function finishRecording() {
  const chunks = recordedChunks;
  recordedChunks = [];
  const samples = gazeSamples;
  gazeSamples = [];
  const clicks = clickSamples;
  clickSamples = [];
  const baseName = recordingBaseName || getRecordingBaseName();
  recordingBaseName = "";
  recordingStartMs = 0;
  recordingStartEpochMs = 0;
  const displaySnapshot = recordingDisplay;
  recordingDisplay = null;
  const mimeType = mediaRecorder?.mimeType || "video/webm";
  cleanupRecording();

  if (!chunks.length) {
    try {
      await window.desktopAPI?.stopSystemClickCapture?.();
    } catch {}
    setStatus("Recording canceled.");
    return;
  }

  try {
    let systemClicks = [];
    let systemClickError = "";
    try {
      const result = await window.desktopAPI?.stopSystemClickCapture?.();
      if (Array.isArray(result?.clicks)) systemClicks = result.clicks;
      if (typeof result?.error === "string" && result.error.trim()) systemClickError = result.error.trim();
    } catch {}

    const mergedClicks = [];
    for (const click of clicks) mergedClicks.push(click);
    for (const click of systemClicks) {
      mergedClicks.push({
        t: typeof click?.t_ms === "number" ? click.t_ms : null,
        screenX: typeof click?.screen_x === "number" ? click.screen_x : null,
        screenY: typeof click?.screen_y === "number" ? click.screen_y : null,
        clientX: null,
        clientY: null,
        button:
          typeof click?.button === "string"
            ? ({ left: 0, middle: 1, right: 2 }[click.button] ?? click.button)
            : null
      });
    }

    mergedClicks.sort((a, b) => (a?.t ?? 0) - (b?.t ?? 0));
    const dedupedClicks = [];
    for (const click of mergedClicks) {
      const last = dedupedClicks[dedupedClicks.length - 1];
      if (
        last &&
        typeof last.t === "number" &&
        typeof click.t === "number" &&
        Math.abs(click.t - last.t) <= 10 &&
        click.button === last.button &&
        click.screenX === last.screenX &&
        click.screenY === last.screenY
      ) {
        continue;
      }
      dedupedClicks.push(click);
    }

    const blob = new Blob(chunks, { type: mimeType });
    const buffer = await blob.arrayBuffer();
    const suggestedName = getRecordingName(baseName);
    const result = await window.desktopAPI.saveRecording({ data: buffer, suggestedName });
    const recordingSaved = Boolean(result && !result.canceled);

    let gazeSaved = false;
    let gazeResult = null;
    if (samples.length && typeof window.desktopAPI?.saveGazeData === "function") {
      const csvHeader = "t_ms,x,y,smoothed_x,smoothed_y";
      const csvRows = samples.map((sample) =>
        [sample.t, sample.x, sample.y, sample.sx, sample.sy].join(",")
      );
      const csv = [csvHeader, ...csvRows].join("\n");
      const gazeBlob = new Blob([csv], { type: "text/csv" });
      const gazeBuffer = await gazeBlob.arrayBuffer();
      const gazeName = getGazeName(baseName);
      gazeResult = await window.desktopAPI.saveGazeData({
        data: gazeBuffer,
        suggestedName: gazeName
      });
      gazeSaved = Boolean(gazeResult && !gazeResult.canceled);
    }

    let clicksSaved = false;
    let clicksResult = null;
    if (typeof window.desktopAPI?.saveGazeData === "function" && (recordingSaved || dedupedClicks.length)) {
      const clickHeader = "t_ms,screen_x,screen_y,client_x,client_y,button";
      const clickRows = dedupedClicks.map((click) =>
        [click.t, click.screenX, click.screenY, click.clientX, click.clientY, click.button].join(",")
      );
      const clickCsv = [clickHeader, ...clickRows].join("\n");
      const clickBlob = new Blob([clickCsv], { type: "text/csv" });
      const clickBuffer = await clickBlob.arrayBuffer();
      const clickName = getClickName(baseName);
      clicksResult = await window.desktopAPI.saveGazeData({
        data: clickBuffer,
        suggestedName: clickName
      });
      clicksSaved = Boolean(clicksResult && !clicksResult.canceled);
    }

    if (recordingSaved && result?.filePath) {
      lastRecordingFile = getFileName(result.filePath);
    }
    if (gazeSaved && gazeResult?.filePath) {
      lastGazeFile = getFileName(gazeResult.filePath);
    }
    if (clicksSaved && clicksResult?.filePath) {
      lastClickFile = getFileName(clicksResult.filePath);
    }
    if (recordingSaved || gazeSaved) {
      lastRecordingDisplay = displaySnapshot;
    }
    setExportHeatmapEnabled();

    if (recordingSaved && gazeSaved) {
      setStatus(systemClickError ? `Recording + gaze saved (click capture: ${systemClickError}).` : "Recording + gaze saved.");
    } else if (recordingSaved) {
      setStatus(systemClickError ? `Recording saved (click capture: ${systemClickError}).` : "Recording saved.");
    } else if (gazeSaved) {
      setStatus(systemClickError ? `Gaze saved (click capture: ${systemClickError}).` : "Gaze saved (video save failed).");
    } else {
      setStatus("Recording canceled.");
    }
  } catch (error) {
    setStatus(`Recording save failed: ${error?.message || error}`);
  }
}

async function exportHeatmapVideo() {
  if (exportingHeatmap) return;
  if (!lastRecordingFile || !lastGazeFile) {
    setStatus("Record and save before exporting a heatmap.");
    return;
  }
  if (typeof window.h337 === "undefined") {
    setStatus("Heatmap library not loaded.");
    return;
  }

  exportingHeatmap = true;
  setExportHeatmapEnabled();
  setStatus("Preparing heatmap export...");

  let exportRoot = null;
  let video = null;
  let exportRecorder = null;
  let exportStream = null;

  try {
    const samples = await loadGazeSamples(lastGazeFile);
    if (!samples.length) {
      setStatus("No gaze samples found.");
      return;
    }

    exportRoot = document.createElement("div");
    exportRoot.style.cssText =
      "position: fixed; left: -99999px; top: 0; width: 1px; height: 1px; overflow: hidden;";

    video = document.createElement("video");
    video.src = getRecordingUrl(lastRecordingFile);
    video.muted = true;
    video.playsInline = true;

    const heatmapContainer = document.createElement("div");
    heatmapContainer.style.position = "absolute";
    heatmapContainer.style.left = "0";
    heatmapContainer.style.top = "0";

    const compositeCanvas = document.createElement("canvas");

    exportRoot.appendChild(video);
    exportRoot.appendChild(heatmapContainer);
    exportRoot.appendChild(compositeCanvas);
    document.body.appendChild(exportRoot);

    await waitForVideoMetadata(video);
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      throw new Error("Video metadata missing.");
    }

    heatmapContainer.style.width = `${width}px`;
    heatmapContainer.style.height = `${height}px`;
    const heatmapInstance = window.h337.create({
      container: heatmapContainer,
      radius: 90,
      maxOpacity: 0.95,
      minOpacity: 0.00,
      blur: 0.95,
      gradient: {
        0.00: "rgba(0, 255, 0, 0)",       // 0s: fully transparent
        0.05: "rgba(0, 255, 0, 0.3)",     // ~0.5s: already 30% visible (log boost)
        0.10: "rgba(100, 255, 0, 0.5)",   // ~1s: 50% opacity
        0.20: "rgba(200, 255, 0, 0.7)",   // ~2s: 70% opacity  
        0.40: "rgba(255, 100, 0, 0.85)",  // ~4s: 85% opacity (orange-red)
        0.60: "rgba(255, 50, 0, 0.92)",   // ~6s: 92% opacity
        1.00: "rgba(255, 0, 0, 0.98)"     // 10s: near full opacity red
      }
    });
    const heatmapCanvas = heatmapContainer.querySelector("canvas");

    compositeCanvas.width = width;
    compositeCanvas.height = height;
    const ctx = compositeCanvas.getContext("2d");

    const scale = getRecordingScale(width, height);
    const rawDuration = video.duration;
    const durationMs = Number.isFinite(rawDuration) ? Math.max(1, Math.round(rawDuration * 1000)) : 0;
    let sampleIndex = 0;
    let windowStartIndex = 0;
    let lastProgressUpdate = 0;

    const updateHeatmap = (tMs) => {
      while (sampleIndex < samples.length && samples[sampleIndex].t <= tMs) {
        sampleIndex += 1;
      }
      while (windowStartIndex < sampleIndex && samples[windowStartIndex].t < tMs - HEATMAP_WINDOW_MS) {
        windowStartIndex += 1;
      }
      const pointsMap = new Map();
      for (let i = windowStartIndex; i < sampleIndex; i += 1) {
        const sample = samples[i];
        const x = Math.round(sample.sx * scale.x);
        const y = Math.round(sample.sy * scale.y);
        if (x < 0 || y < 0 || x > width || y > height) continue;
        const dt = Number.isFinite(sample.dt) ? sample.dt : 0;
        if (dt <= 0) continue;
        const bx = Math.floor(x / HEATMAP_CELL_SIZE_PX);
        const by = Math.floor(y / HEATMAP_CELL_SIZE_PX);
        const key = `${bx},${by}`;
        const cx = Math.min(
          width,
          Math.max(0, Math.round(bx * HEATMAP_CELL_SIZE_PX + HEATMAP_CELL_SIZE_PX / 2))
        );
        const cy = Math.min(
          height,
          Math.max(0, Math.round(by * HEATMAP_CELL_SIZE_PX + HEATMAP_CELL_SIZE_PX / 2))
        );
        const entry = pointsMap.get(key) || { x: cx, y: cy, ms: 0 };
        entry.ms += dt;
        pointsMap.set(key, entry);
      }
      const maxValue = Math.max(1, Math.ceil(HEATMAP_WINDOW_MS / HEATMAP_BIN_MS));
      const points = Array.from(pointsMap.values())
        .map((entry) => {
          const normalized = Math.min(1, Math.max(0, entry.ms / HEATMAP_WINDOW_MS));
          const curved =
            Math.log1p(HEATMAP_LOG_K * normalized) / Math.log1p(HEATMAP_LOG_K);
          return {
            x: entry.x,
            y: entry.y,
            value: curved * maxValue
          };
        })
        .filter((entry) => entry.value > 0);
      heatmapInstance.setData({ max: maxValue, data: points });
    };

    const drawFrame = (tMs) => {
      updateHeatmap(tMs);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(video, 0, 0, width, height);
      if (heatmapCanvas) {
        ctx.drawImage(heatmapCanvas, 0, 0, width, height);
      }
      if (tMs - lastProgressUpdate >= 1000) {
        lastProgressUpdate = tMs;
        const progress = durationMs ? Math.min(100, Math.round((tMs / durationMs) * 100)) : 0;
        setStatus(`Exporting heatmap... ${progress}%`);
      }
    };

    exportStream = compositeCanvas.captureStream(HEATMAP_EXPORT_FPS);
    const exportChunks = [];
    const mimeType = getPreferredMimeType();
    const exportOptions = mimeType ? { mimeType } : undefined;
    exportRecorder = new MediaRecorder(exportStream, exportOptions);

    exportRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) exportChunks.push(event.data);
    });

    const recorderStopped = new Promise((resolve, reject) => {
      exportRecorder.addEventListener("stop", resolve, { once: true });
      exportRecorder.addEventListener("error", () => reject(new Error("Heatmap export failed")));
    });

    video.currentTime = 0;
    await video.play();

    exportRecorder.start();
    drawFrame(Math.round(video.currentTime * 1000));

    let active = true;
    const scheduleFrame = () => {
      if (!active) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        video.requestVideoFrameCallback((_now, metadata) => {
          if (!active) return;
          drawFrame(Math.round(metadata.mediaTime * 1000));
          if (!video.ended) scheduleFrame();
        });
      } else {
        requestAnimationFrame(() => {
          if (!active) return;
          drawFrame(Math.round(video.currentTime * 1000));
          if (!video.ended) scheduleFrame();
        });
      }
    };

    scheduleFrame();
    await new Promise((resolve) => {
      video.addEventListener("ended", resolve, { once: true });
    });

    active = false;
    exportRecorder.stop();
    await recorderStopped;

    if (!exportChunks.length) {
      throw new Error("Heatmap export produced no data.");
    }

    const exportBlob = new Blob(exportChunks, { type: exportRecorder.mimeType || "video/webm" });
    const exportBuffer = await exportBlob.arrayBuffer();
    const baseName = lastRecordingFile.replace(/\.webm$/i, "");
    const suggestedName = `${baseName}-heatmap.webm`;
    const result = await window.desktopAPI.saveRecording({ data: exportBuffer, suggestedName });
    if (result?.canceled) {
      setStatus("Heatmap export canceled.");
    } else {
      setStatus("Heatmap video saved.");
    }
  } catch (error) {
    setStatus(`Heatmap export failed: ${error?.message || error}`);
  } finally {
    try {
      video?.pause?.();
    } catch {}
    try {
      if (exportRecorder && exportRecorder.state !== "inactive") {
        exportRecorder.stop();
      }
    } catch {}
    try {
      exportStream?.getTracks?.().forEach((track) => track.stop());
    } catch {}
    exportRoot?.remove?.();
    exportingHeatmap = false;
    setExportHeatmapEnabled();
  }
}

async function toggleRecording() {
  if (recording) {
    stopRecording();
    return;
  }
  await startRecording();
}

btnStart.addEventListener("click", startWebgazer);
btnCalibrate.addEventListener("click", toggleCalibration);
btnRecord.addEventListener("click", toggleRecording);
btnExportHeatmap.addEventListener("click", exportHeatmapVideo);
btnToggleClickThrough.addEventListener("click", toggleClickThrough);
btnToggleHud.addEventListener("click", () => setHudVisible(hudHidden));
document.addEventListener("mousedown", recordMouseClick, true);

window.desktopAPI.onShortcut(async (payload) => {
  if (payload?.type === "toggle-focus-mode") {
    await toggleFocusMode();
  }
  if (payload?.type === "toggle-click-through") {
    await toggleClickThrough();
  }
  if (payload?.type === "toggle-ui") {
    setHudVisible(hudHidden);
  }
  if (payload?.type === "toggle-recording") {
    await toggleRecording();
  }
});

window.desktopAPI.onClickThroughChanged((payload) => {
  if (typeof payload?.enabled === "boolean") setClickThroughUI(payload.enabled);
});

if (!recordingSupported) {
  btnRecord.disabled = true;
  recordValue.textContent = "N/A";
}

initHudDragAndDock();
setExportHeatmapEnabled();
setStatus("Idle (press Start)");
