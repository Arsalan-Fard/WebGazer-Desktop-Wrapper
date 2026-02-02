const { app, BrowserWindow, desktopCapturer, globalShortcut, screen, session } = require("electron");
const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { Readable } = require("stream");
const { spawn } = require("child_process");
const readline = require("readline");

// Use "localhost" so WebGazer doesn't show its non-https warning (it special-cases localhost).
const HOST = "localhost";
const PROXY_PATH_PREFIX = "/__proxy__/";
const PROXY_ALLOWED_HOSTS = new Set(["tfhub.dev", "www.kaggle.com", "storage.googleapis.com"]);
const CAMERA_PROXY_PATH_PREFIX = "/__camera__/";
const CAMERA_ALLOWED_HOSTS = new Set(
  (process.env.DESKTOP_WRAPPER_CAMERA_HOSTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".json":
      return "application/json; charset=utf-8";
    case ".csv":
      return "text/csv; charset=utf-8";
    case ".webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

function isWithin(childPath, parentPath) {
  const rel = path.relative(parentPath, childPath);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function resolveWebgazerRoot() {
  if (!app.isPackaged) return path.resolve(__dirname, "..");
  return path.join(process.resourcesPath, "webgazer");
}

function resolveBundledClickCaptureExe() {
  const configured = (process.env.DESKTOP_WRAPPER_CLICK_CAPTURE_EXE || "").trim();
  if (configured) return configured;

  const candidates = [
    path.join(process.resourcesPath, "bin", "mouse_click.exe"),
    path.join(__dirname, "bin", "mouse_click.exe")
  ];

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {}
  }

  return "";
}

async function resolveWebgazerBundlePath(webgazerRoot) {
  const distBundle = path.join(webgazerRoot, "dist", "webgazer.js");
  const wwwBundle = path.join(webgazerRoot, "www", "webgazer.js");

  try {
    await fsp.access(distBundle, fs.constants.R_OK);
    return distBundle;
  } catch {}

  await fsp.access(wwwBundle, fs.constants.R_OK);
  return wwwBundle;
}

async function startStaticServer() {
  const webgazerRoot = resolveWebgazerRoot();
  const staticRoot = path.join(__dirname, "static");
  const srcRoot = path.join(webgazerRoot, "src");
  const modelsRoot = path.join(__dirname, "models");
  const recordingsRoot = await ensureRecordingsDir();
  const webgazerBundle = await resolveWebgazerBundlePath(webgazerRoot);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${HOST}`);
      let requestPath = decodeURIComponent(url.pathname || "/");
      if (requestPath === "/") requestPath = "/index.html";

      let filePath;
      if (requestPath.startsWith(PROXY_PATH_PREFIX)) {
        const rest = requestPath.slice(PROXY_PATH_PREFIX.length);
        const parts = rest.split("/").filter(Boolean);
        const [scheme, host, ...remoteParts] = parts;

        if (!scheme || !host) {
          res.writeHead(400).end("Bad Request");
          return;
        }
        if (scheme !== "https" && scheme !== "http") {
          res.writeHead(400).end("Bad Request");
          return;
        }
        if (!PROXY_ALLOWED_HOSTS.has(host)) {
          res.writeHead(403).end("Forbidden");
          return;
        }

        const remotePath = `/${remoteParts.join("/")}`;
        const remoteUrl = `${scheme}://${host}${remotePath}${url.search || ""}`;

        const localRoot = path.join(modelsRoot, host);
        const localCandidate = path.resolve(localRoot, `.${remotePath}`);
        if (isWithin(localCandidate, localRoot)) {
          try {
            const localStat = await fsp.stat(localCandidate);
            if (localStat.isFile()) {
              res.statusCode = 200;
              res.setHeader("Cache-Control", "no-store");
              res.setHeader("Access-Control-Allow-Origin", "*");
              res.setHeader("Access-Control-Allow-Headers", "*");
              res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
              res.setHeader("Content-Type", contentTypeFor(localCandidate));
              createReadStreamSafe(localCandidate).pipe(res);
              return;
            }
          } catch {}
        }

        const upstream = await fetch(remoteUrl, {
          redirect: "follow",
          headers: {
            "User-Agent": session.defaultSession.getUserAgent(),
            Accept: "*/*"
          }
        });

        res.statusCode = upstream.status;
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");

        const contentType = upstream.headers.get("content-type");
        if (contentType) res.setHeader("Content-Type", contentType);

        if (!upstream.body) {
          res.end();
          return;
        }

        Readable.fromWeb(upstream.body).pipe(res);
        return;
      } else if (requestPath.startsWith(CAMERA_PROXY_PATH_PREFIX)) {
        const rest = requestPath.slice(CAMERA_PROXY_PATH_PREFIX.length);
        const parts = rest.split("/").filter(Boolean);
        const [scheme, host, ...remoteParts] = parts;

        if (!scheme || !host) {
          res.writeHead(400).end("Bad Request");
          return;
        }
        if (scheme !== "https" && scheme !== "http") {
          res.writeHead(400).end("Bad Request");
          return;
        }
        if (!CAMERA_ALLOWED_HOSTS.size) {
          res
            .writeHead(403)
            .end(
              "Forbidden (set DESKTOP_WRAPPER_CAMERA_HOSTS to a comma-separated allowlist like 10.99.104.35:8080)"
            );
          return;
        }
        const hostNoPort = host.startsWith("[") ? host : host.split(":")[0];
        if (!CAMERA_ALLOWED_HOSTS.has(host) && !CAMERA_ALLOWED_HOSTS.has(hostNoPort)) {
          res.writeHead(403).end("Forbidden");
          return;
        }

        const remotePath = `/${remoteParts.join("/")}`;
        const remoteUrl = `${scheme}://${host}${remotePath}${url.search || ""}`;

        const upstream = await fetch(remoteUrl, {
          redirect: "follow",
          headers: {
            "User-Agent": session.defaultSession.getUserAgent(),
            Accept: "*/*"
          }
        });

        res.statusCode = upstream.status;
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");

        const contentType = upstream.headers.get("content-type");
        if (contentType) res.setHeader("Content-Type", contentType);

        if (!upstream.body) {
          res.end();
          return;
        }

        Readable.fromWeb(upstream.body).pipe(res);
        return;
      } else if (requestPath === "/webgazer.js") {
        filePath = webgazerBundle;
      } else if (requestPath === "/ridgeWorker.mjs" || requestPath === "/ridgeWorker.js") {
        filePath = path.join(srcRoot, "ridgeWorker.mjs");
      } else if (requestPath.startsWith("/recordings/")) {
        const fileName = path.basename(requestPath);
        if (!fileName || fileName === "recordings") {
          res.writeHead(404).end("Not Found");
          return;
        }
        filePath = path.join(recordingsRoot, fileName);
      } else if (requestPath.startsWith("/worker_scripts/")) {
        const candidate = path.resolve(srcRoot, `.${requestPath}`);
        const workerScriptsRoot = path.join(srcRoot, "worker_scripts");
        if (!isWithin(candidate, workerScriptsRoot)) {
          res.writeHead(400).end("Bad Request");
          return;
        }
        filePath = candidate;
      } else {
        const candidate = path.resolve(staticRoot, `.${requestPath}`);
        if (!isWithin(candidate, staticRoot)) {
          res.writeHead(400).end("Bad Request");
          return;
        }
        filePath = candidate;
      }

      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) {
        res.writeHead(404).end("Not Found");
        return;
      }

      res.setHeader("Content-Type", contentTypeFor(filePath));
      res.setHeader("Cache-Control", "no-store");
      createReadStreamSafe(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500).end(String(error?.message || error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind HTTP server");
  }

  return { server, url: `http://${HOST}:${address.port}` };
}

function createReadStreamSafe(filePath) {
  return fs.createReadStream(filePath);
}

async function ensureRecordingsDir() {
  const recordingsDir = app.isPackaged
    ? path.join(app.getPath("documents"), "WebGazer Recordings")
    : path.join(__dirname, "recordings");
  await fsp.mkdir(recordingsDir, { recursive: true });
  return recordingsDir;
}

async function getUniqueRecordingPath(recordingsDir, suggestedName, fallbackBase, fallbackExt) {
  const safeName = path.basename(suggestedName || "");
  const ext = path.extname(safeName) || fallbackExt;
  const base = path.basename(safeName, ext) || fallbackBase;

  let candidate = path.join(recordingsDir, `${base}${ext}`);
  for (let index = 1; index < 1000; index += 1) {
    try {
      await fsp.access(candidate, fs.constants.F_OK);
      candidate = path.join(recordingsDir, `${base}-${index}${ext}`);
    } catch {
      break;
    }
  }

  return candidate;
}

function toBuffer(data) {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === "string") return Buffer.from(data, "utf8");
  return null;
}

let mainWindow;
let maskWindow;
let httpServer;
let proxyBaseUrl;
let maskVisible = true;
let maskInteractive = false;
let maskSaveTimer = null;

let clickCaptureProc = null;
let clickCaptureRl = null;
let clickCaptureClicks = [];
let clickCaptureLastError = "";
let clickCaptureStderrRl = null;
let clickCaptureInfo = null;

async function createWindow(baseUrl) {
  const primary = screen.getPrimaryDisplay();
  const bounds = primary.bounds;

  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    fullscreen: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  await mainWindow.loadURL(`${baseUrl}/index.html`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function getDefaultMaskBounds() {
  const primary = screen.getPrimaryDisplay();
  const bounds = primary.bounds;
  return {
    x: bounds.x + 20,
    y: bounds.y + 10,
    width: Math.max(400, Math.round(bounds.width * 0.55)),
    height: 70
  };
}

async function getMaskStatePath() {
  return path.join(app.getPath("userData"), "privacy-mask.json");
}

async function loadMaskState() {
  try {
    const filePath = await getMaskStatePath();
    const text = await fsp.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function saveMaskState(state) {
  const filePath = await getMaskStatePath();
  await fsp.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

function scheduleSaveMaskState() {
  if (!maskWindow) return;
  if (maskSaveTimer) clearTimeout(maskSaveTimer);
  maskSaveTimer = setTimeout(async () => {
    maskSaveTimer = null;
    try {
      await saveMaskState({ visible: maskVisible, bounds: maskWindow.getBounds() });
    } catch {}
  }, 200);
}

function sendMaskBounds() {
  if (!maskWindow) return;
  try {
    maskWindow.webContents.send("mask:bounds", { bounds: maskWindow.getBounds() });
  } catch {}
}

function setMaskVisible(visible) {
  maskVisible = Boolean(visible);
  if (!maskWindow) return;
  if (maskVisible) {
    if (!maskWindow.isVisible()) maskWindow.showInactive?.() || maskWindow.show();
  } else {
    if (maskWindow.isVisible()) maskWindow.hide();
  }
  scheduleSaveMaskState();
}

function setMaskInteractive(enabled) {
  maskInteractive = Boolean(enabled);
  if (!maskWindow) return;

  if (maskInteractive) {
    setMaskVisible(true);
    maskWindow.setIgnoreMouseEvents(false);
    maskWindow.setFocusable(true);
    maskWindow.focus();
  } else {
    maskWindow.setIgnoreMouseEvents(true, { forward: true });
    maskWindow.setFocusable(false);
    if (maskVisible) maskWindow.showInactive?.() || maskWindow.show();
  }

  try {
    maskWindow.webContents.send("mask:interactive", { enabled: maskInteractive });
  } catch {}
}

async function createMaskWindow(baseUrl) {
  const state = await loadMaskState();
  const initialBounds = state?.bounds && typeof state.bounds === "object" ? state.bounds : getDefaultMaskBounds();
  maskVisible = typeof state?.visible === "boolean" ? state.visible : true;
  maskInteractive = false;

  maskWindow = new BrowserWindow({
    ...initialBounds,
    transparent: true,
    frame: false,
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  maskWindow.setAlwaysOnTop(true, "screen-saver");
  maskWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  maskWindow.setIgnoreMouseEvents(true, { forward: true });

  await maskWindow.loadURL(`${baseUrl}/mask.html`);

  maskWindow.on("move", () => {
    sendMaskBounds();
    scheduleSaveMaskState();
  });
  maskWindow.on("resize", () => {
    sendMaskBounds();
    scheduleSaveMaskState();
  });
  maskWindow.on("closed", () => {
    maskWindow = null;
  });

  setMaskVisible(maskVisible);
  setMaskInteractive(false);
  sendMaskBounds();
}

function setClickThrough(enabled) {
  if (!mainWindow) return;
  mainWindow.setIgnoreMouseEvents(Boolean(enabled), { forward: true });
  mainWindow.setFocusable(!enabled);
  mainWindow.webContents.send("desktop:clickThrough", { enabled: Boolean(enabled) });
}

function resolvePythonCommand() {
  const configured = (process.env.DESKTOP_WRAPPER_PYTHON || "").trim();
  if (configured) return { command: configured, args: [] };
  // Prefer python.exe if available; users can override via DESKTOP_WRAPPER_PYTHON.
  return { command: "python", args: [] };
}

function formatProc(command, args) {
  return [command, ...args].map((part) => (part.includes(" ") ? `"${part}"` : part)).join(" ");
}

function attachClickCaptureProcess(proc, info) {
  clickCaptureProc = proc;
  clickCaptureInfo = info;

  clickCaptureProc.once("error", (error) => {
    clickCaptureLastError = String(error?.message || error);
    console.error(`[system-click] process error: ${clickCaptureLastError}`);
    try {
      clickCaptureRl?.close?.();
    } catch {}
    clickCaptureRl = null;
    try {
      clickCaptureStderrRl?.close?.();
    } catch {}
    clickCaptureStderrRl = null;
    clickCaptureProc = null;
    clickCaptureInfo = null;
  });

  clickCaptureProc.on("exit", (code, signal) => {
    if (!clickCaptureLastError && typeof code === "number" && code !== 0) {
      clickCaptureLastError = `Exited with code ${code}`;
    }
    const suffix = signal ? `signal=${signal}` : `code=${code}`;
    console.log(
      `[system-click] stopped (${suffix}); captured=${clickCaptureClicks.length}${
        clickCaptureLastError ? `; lastError=${clickCaptureLastError}` : ""
      }`
    );

    try {
      clickCaptureRl?.close?.();
    } catch {}
    clickCaptureRl = null;
    try {
      clickCaptureStderrRl?.close?.();
    } catch {}
    clickCaptureStderrRl = null;
    clickCaptureProc = null;
    clickCaptureInfo = null;
  });

  clickCaptureRl = readline.createInterface({ input: clickCaptureProc.stdout });
  clickCaptureRl.on("line", (line) => {
    const trimmed = String(line || "").trim();
    if (!trimmed) return;
    try {
      const payload = JSON.parse(trimmed);
      if (payload && typeof payload.t_ms === "number") {
        clickCaptureClicks.push(payload);
        // Requested: show a terminal log for every click captured by Python.
        console.log(`[system-click] ${trimmed}`);
      }
    } catch {}
  });

  clickCaptureStderrRl = readline.createInterface({ input: clickCaptureProc.stderr });
  clickCaptureStderrRl.on("line", (line) => {
    const trimmed = String(line || "").trim();
    if (!trimmed) return;
    if (trimmed === "READY") {
      console.log("[system-click] ready");
      return;
    }
    clickCaptureLastError = trimmed;
    console.error(`[system-click][stderr] ${trimmed}`);
  });
}

function startSystemClickCapture(startEpochMs) {
  if (clickCaptureProc) return { ok: true, alreadyRunning: true };

  const startArg =
    typeof startEpochMs === "number" && Number.isFinite(startEpochMs) ? String(Math.round(startEpochMs)) : "";

  clickCaptureClicks = [];
  clickCaptureLastError = "";

  const clickArgs = ["--jsonl", ...(startArg ? ["--start-epoch-ms", startArg] : [])];

  const bundledExe = resolveBundledClickCaptureExe();
  if (bundledExe) {
    const proc = spawn(bundledExe, clickArgs, {
      cwd: __dirname,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    attachClickCaptureProcess(proc, { command: bundledExe, args: clickArgs, bundled: true });
    console.log(`[system-click] starting: ${formatProc(bundledExe, clickArgs)}`);
    return { ok: true, command: bundledExe, args: clickArgs, bundled: true };
  }

  if (app.isPackaged) {
    clickCaptureLastError =
      "Click capture is unavailable: bundled mouse_click.exe is missing (rebuild with npm run build:click).";
    console.error(`[system-click] ${clickCaptureLastError}`);
    return { ok: false, error: clickCaptureLastError };
  }

  const scriptPath = path.join(__dirname, "mouse_click.py");
  const attemptLaunchPython = (command, args) => {
    const procArgs = [...args, "-u", scriptPath, ...clickArgs];

    const proc = spawn(command, procArgs, {
      cwd: __dirname,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    attachClickCaptureProcess(proc, { command, args: procArgs });

    console.log(`[system-click] starting: ${formatProc(command, procArgs)}`);
    return { proc, procArgs };
  };

  const primary = resolvePythonCommand();
  const launched = attemptLaunchPython(primary.command, primary.args);

  // If "python" isn't available, retry with Windows' py launcher (common on Win).
  launched.proc.once("error", (error) => {
    const code = String(error?.code || "");
    if (code !== "ENOENT") return;
    if (clickCaptureProc) return;
    clickCaptureLastError = "";
    const fallback = { command: "py", args: ["-3"] };
    attemptLaunchPython(fallback.command, fallback.args);
  });

  return { ok: true, command: primary.command, args: launched.procArgs };
}

async function stopSystemClickCapture() {
  const proc = clickCaptureProc;
  if (!proc) {
    return {
      ok: true,
      clicks: clickCaptureClicks.slice(),
      error: clickCaptureLastError || "",
      info: clickCaptureInfo
    };
  }

  const infoSnapshot = clickCaptureInfo;
  console.log("[system-click] stopping...");

  try {
    proc.stdin.write("STOP\n");
  } catch {}
  try {
    proc.stdin.end();
  } catch {}

  const exited = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 3000);
    proc.once("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });

  if (!exited) {
    try {
      proc.kill();
    } catch {}
  }

  return {
    ok: true,
    clicks: clickCaptureClicks.slice(),
    error: clickCaptureLastError || "",
    info: infoSnapshot
  };
}

function registerShortcuts() {
  globalShortcut.register("CommandOrControl+G", () => {
    if (!mainWindow) return;
    mainWindow.webContents.send("desktop:shortcut", { type: "toggle-focus-mode" });
  });
  globalShortcut.register("CommandOrControl+M", () => {
    if (!maskWindow) return;
    setMaskVisible(!maskVisible);
  });
  globalShortcut.register("CommandOrControl+Shift+M", () => {
    if (!maskWindow) return;
    setMaskInteractive(!maskInteractive);
  });
  globalShortcut.register("CommandOrControl+Shift+I", () => {
    if (!mainWindow) return;
    mainWindow.webContents.toggleDevTools();
  });
  globalShortcut.register("CommandOrControl+Shift+R", () => {
    if (!mainWindow) return;
    mainWindow.webContents.send("desktop:shortcut", { type: "toggle-recording" });
  });
  globalShortcut.register("CommandOrControl+Shift+1", () => {
    app.quit();
  });
}

app.whenReady().then(async () => {
  // Some model hosts (tfhub/kaggle redirects) may reject Electron's default user-agent.
  // Use a vanilla Chrome UA so model downloads behave like a normal browser.
  const chromeUa =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  session.defaultSession.setUserAgent(chromeUa);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "display-capture");
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      const primary = screen.getPrimaryDisplay();
      const source =
        sources.find((item) => item.display_id === String(primary.id)) || sources[0] || null;
      callback({ video: source, audio: null });
    } catch (error) {
      callback({ video: null, audio: null });
    }
  });

  // Proxy model downloads through our localhost server so:
  // - CORS is no longer relevant (the renderer fetches same-origin)
  // - we can survive hosts that block Electron/localhost origins
  session.defaultSession.webRequest.onBeforeRequest(
    {
      urls: ["https://tfhub.dev/*", "https://www.kaggle.com/*", "https://storage.googleapis.com/*"]
    },
    (details, callback) => {
      if (!proxyBaseUrl) {
        callback({});
        return;
      }

      const target = new URL(details.url);
      const scheme = target.protocol.replace(":", "");
      callback({
        redirectURL: `${proxyBaseUrl}${PROXY_PATH_PREFIX}${scheme}/${target.host}${target.pathname}${target.search}`
      });
    }
  );

  // WebGazer/TensorFlow.js loads some models from tfhub.dev (and redirects via kaggle.com).
  // Those hosts may not emit permissive CORS headers for our localhost origin.
  // Since this is a desktop app (not a general browser), relax CORS for these endpoints.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url || "";
    const allowList = [
      "https://tfhub.dev/",
      "https://www.kaggle.com/models/",
      "https://storage.googleapis.com/"
    ];

    if (!allowList.some((prefix) => url.startsWith(prefix))) {
      callback({});
      return;
    }

    const responseHeaders = details.responseHeaders || {};
    responseHeaders["access-control-allow-origin"] = ["*"];
    responseHeaders["access-control-allow-headers"] = ["*"];
    responseHeaders["access-control-allow-methods"] = ["GET,HEAD,OPTIONS"];
    callback({ responseHeaders });
  });

  // Avoid caching a failed/blocked model fetch across restarts.
  await session.defaultSession.clearCache();

  const { server, url } = await startStaticServer();
  httpServer = server;
  proxyBaseUrl = url;

  registerShortcuts();
  await createWindow(url);
  await createMaskWindow(url);

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow(url);
      await createMaskWindow(url);
    }
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
});

app.on("before-quit", () => {
  try {
    httpServer?.close();
  } catch {}
  try {
    clickCaptureProc?.kill?.();
  } catch {}
});

const { ipcMain } = require("electron");
ipcMain.handle("desktop:setClickThrough", (_evt, enabled) => {
  setClickThrough(enabled);
});
ipcMain.handle("desktop:getDisplayInfo", () => {
  const display = screen.getPrimaryDisplay();
  return {
    bounds: display.bounds,
    scaleFactor: display.scaleFactor
  };
});
ipcMain.handle("desktop:saveRecording", async (_evt, payload) => {
  const data = payload?.data;
  const suggestedName = payload?.suggestedName || "webgazer-recording.webm";
  const buffer = toBuffer(data);
  if (!buffer) return { canceled: true };

  const recordingsDir = await ensureRecordingsDir();
  const filePath = await getUniqueRecordingPath(
    recordingsDir,
    suggestedName,
    "webgazer-recording",
    ".webm"
  );

  await fsp.writeFile(filePath, buffer);
  return { canceled: false, filePath };
});

ipcMain.handle("desktop:saveGazeData", async (_evt, payload) => {
  const data = payload?.data;
  const suggestedName = payload?.suggestedName || "webgazer-gaze.csv";
  const buffer = toBuffer(data);
  if (!buffer) return { canceled: true };

  const recordingsDir = await ensureRecordingsDir();
  const filePath = await getUniqueRecordingPath(
    recordingsDir,
    suggestedName,
    "webgazer-gaze",
    ".csv"
  );

  await fsp.writeFile(filePath, buffer);
  return { canceled: false, filePath };
});

ipcMain.handle("desktop:startSystemClickCapture", (_evt, payload) => {
  const startEpochMs = payload?.startEpochMs;
  return startSystemClickCapture(startEpochMs);
});

ipcMain.handle("desktop:stopSystemClickCapture", async () => {
  return stopSystemClickCapture();
});

ipcMain.handle("mask:getBounds", () => {
  if (!maskWindow) return null;
  return maskWindow.getBounds();
});

ipcMain.handle("mask:setBounds", (_evt, bounds) => {
  if (!maskWindow) return;
  const current = maskWindow.getBounds();
  const next = {
    x: typeof bounds?.x === "number" ? Math.round(bounds.x) : current.x,
    y: typeof bounds?.y === "number" ? Math.round(bounds.y) : current.y,
    width: typeof bounds?.width === "number" ? Math.max(100, Math.round(bounds.width)) : current.width,
    height: typeof bounds?.height === "number" ? Math.max(40, Math.round(bounds.height)) : current.height
  };
  maskWindow.setBounds(next);
  sendMaskBounds();
  scheduleSaveMaskState();
});

ipcMain.handle("mask:setVisible", (_evt, visible) => {
  setMaskVisible(Boolean(visible));
});

ipcMain.handle("mask:setInteractive", (_evt, enabled) => {
  setMaskInteractive(Boolean(enabled));
});
