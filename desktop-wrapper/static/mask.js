const root = document.getElementById("root");
const resizeHandle = document.getElementById("resizeHandle");
const help = document.getElementById("help");

let interactive = false;
let resizing = false;
let resizeStart = null;

function setInteractive(enabled) {
  interactive = Boolean(enabled);
  root?.classList.toggle("editing", interactive);
}

async function getBounds() {
  return window.maskAPI?.getBounds?.();
}

async function setBounds(bounds) {
  return window.maskAPI?.setBounds?.(bounds);
}

function clampSize(value, min) {
  if (typeof value !== "number" || Number.isNaN(value)) return min;
  return Math.max(min, value);
}

function onPointerMove(event) {
  if (!resizing || !resizeStart) return;
  const dx = event.clientX - resizeStart.startX;
  const dy = event.clientY - resizeStart.startY;

  const nextWidth = clampSize(resizeStart.width + dx, 100);
  const nextHeight = clampSize(resizeStart.height + dy, 40);

  setBounds({
    x: resizeStart.x,
    y: resizeStart.y,
    width: nextWidth,
    height: nextHeight
  });
}

function endResize() {
  resizing = false;
  resizeStart = null;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", endResize);
  window.removeEventListener("pointercancel", endResize);
}

async function beginResize(event) {
  if (!interactive) return;
  event.preventDefault();
  event.stopPropagation();

  const bounds = await getBounds();
  if (!bounds) return;

  resizing = true;
  resizeStart = {
    startX: event.clientX,
    startY: event.clientY,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", endResize, { once: true });
  window.addEventListener("pointercancel", endResize, { once: true });
}

resizeHandle?.addEventListener("pointerdown", beginResize);

window.maskAPI?.onInteractive?.((payload) => {
  setInteractive(Boolean(payload?.enabled));
});

window.maskAPI?.onBounds?.((_payload) => {
  // no-op for now; bounds are persisted by the main process.
});
