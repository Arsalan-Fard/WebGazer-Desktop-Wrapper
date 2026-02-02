# WebGazer Desktop Wrapper (Electron)

This is a minimal Electron wrapper that runs WebGazer in a full-screen, transparent, always-on-top overlay so you can get gaze coordinates in **screen space** (instead of a normal webpage).

## Setup

From `desktop-wrapper/`:

```bash
npm install
npm run start
```

Notes:
- The app serves its UI on a local `http://localhost:<port>` URL.
- `/webgazer.js` is loaded from `../dist/webgazer.js` if present, otherwise `../www/webgazer.js`.
- `/ridgeWorker.mjs` and `/worker_scripts/*` are served from `../src/*` (needed by the default regression worker).
- WebGazer downloads TensorFlow models on first run (tfhub/kaggle redirects); you need connectivity unless you vendor the models locally.
- The wrapper proxies those model endpoints via `http://localhost` (and also relaxes CORS headers) so the downloads work reliably from the Electron app.
- If tfhub is blocked (403 / recaptcha), you can place local copies under `desktop-wrapper/models/<host>/<path>`.
  Example for blazeface:
  `desktop-wrapper/models/tfhub.dev/tensorflow/tfjs-model/blazeface/1/default/1/model.json`
  and the corresponding weights file(s) listed in the model's `weightsManifest` (for blazeface: `group1-shard1of1.bin` in the same folder).

## Distribute to teammates (Windows, no Node/Python)

On your dev machine:

```bash
cd desktop-wrapper
npm install
npm run build:click
npm run dist
```

Share `desktop-wrapper/dist/*.exe` (portable build). Teammates just run it.

Recordings are saved under `Documents/WebGazer Recordings` on the teammate's machine.

## Usage

- Click **Start** and allow camera access.
- To use an IP camera (HTTP MJPEG), check **Use IP camera (MJPEG)** and paste the stream URL (this must be the actual MJPEG stream endpoint, not the camera's HTML landing page).
- Click **Calibrate**, then click each dot ~5-10 times.
- Click **Record Screen** (or press **Ctrl+Shift+R**) to record; you can toggle microphone/system audio capture, then you'll be prompted to pick a screen/window and save a WebM file when you stop.
- Press **Ctrl+G** to toggle focus mode (hide UI + enable click-through so you can interact with other apps while the overlay stays on top).
- Press **Ctrl+M** to toggle the URL privacy mask (a draggable rectangle that can cover your address bar/URL).
- Press **Ctrl+Shift+M** to edit/lock the mask (when editing, the mask captures the mouse so you can drag/resize it).
- Press **Ctrl+Shift+I** to open DevTools (useful to see console errors).
- Press **Ctrl+Shift+1** to quit.
Note: when the UI is hidden, the webcam preview, face overlay, and gaze dot are hidden too.

Audio note: microphone capture depends on Windows privacy settings (Settings → Privacy & security → Microphone → allow desktop apps). System audio capture availability depends on Windows/Electron support.

### System click capture (Windows)

The wrapper captures system-level clicks while recording and appends them into the same `*-clicks.csv` (so clicks still get captured in focus/click-through mode).

Requirements:
- Packaged app: none (uses a bundled `mouse_click.exe`).
- Dev mode (`npm run start`): Python 3 + `pynput` (`pip install pynput`).

If Python isn't on your PATH, set `DESKTOP_WRAPPER_PYTHON` to your Python executable path (e.g. `C:\\Python311\\python.exe`).

Manual usage (no Electron):

- Run `desktop-wrapper/dist/win-unpacked/resources/bin/mouse_click.exe`
- It writes `clicks.csv` next to the `.exe` and stops on **ESC**.

### IP camera allowlist

The wrapper proxies IP camera streams through the local server to avoid browser CORS/canvas restrictions. For safety, the proxy is disabled unless you allowlist the camera host.

- Windows PowerShell:
  - ` $env:DESKTOP_WRAPPER_CAMERA_HOSTS="10.99.104.35:8080"; npm run start ` (port optional)
- macOS/Linux:
  - ` DESKTOP_WRAPPER_CAMERA_HOSTS="10.99.104.35:8080" npm run start ` (port optional)

Example stream URLs (depends on your camera/app):
- Android "IP Webcam" app: `http://10.99.104.35:8080/video`
- mjpg-streamer: `http://10.99.104.35:8080/?action=stream`

## What this does (and doesn't) do

- It can estimate gaze and display a dot across the whole screen area.
- It does **not** give WebGazer extra permission to read other apps' pixels/windows; it's still a browser-based model running inside Electron.
- If you want OS-wide automation (move/click the mouse, detect active window, etc.), you'd add native integrations on top of this wrapper.
