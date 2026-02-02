import argparse
import csv
import json
import os
import sys
import threading
import time
from datetime import datetime
from typing import Optional

from pynput import keyboard, mouse


def epoch_ms() -> int:
    return int(time.time() * 1000)


def _now_iso_stamp_utc() -> str:
    """
    Match the JS naming style: ISO timestamp with ':' and '.' replaced by '-'
    (e.g. 2026-01-22T12-34-56-789Z).
    """
    try:
        stamp = datetime.utcnow().isoformat(timespec="milliseconds")
    except TypeError:
        stamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
    stamp = stamp.replace(":", "-").replace(".", "-")
    return f"{stamp}Z"


def _get_windows_documents_dir() -> Optional[str]:
    try:
        if os.name != "nt":
            return None
        import ctypes
        import uuid
        from ctypes import wintypes

        # FOLDERID_Documents
        folder_id = ctypes.c_byte * 16
        fid = folder_id.from_buffer_copy(uuid.UUID("{FDD39AD0-238F-46AF-ADB4-6C85480369C7}").bytes_le)

        path_ptr = wintypes.LPWSTR()
        SHGetKnownFolderPath = ctypes.windll.shell32.SHGetKnownFolderPath
        SHGetKnownFolderPath.argtypes = [ctypes.POINTER(folder_id), wintypes.DWORD, wintypes.HANDLE, ctypes.POINTER(wintypes.LPWSTR)]
        SHGetKnownFolderPath.restype = ctypes.c_long

        hr = SHGetKnownFolderPath(ctypes.byref(fid), 0, 0, ctypes.byref(path_ptr))
        if hr != 0 or not path_ptr:
            return None
        try:
            return str(path_ptr)
        finally:
            ctypes.windll.ole32.CoTaskMemFree(path_ptr)
    except Exception:
        return None


def resolve_recordings_dir() -> str:
    configured = (os.environ.get("DESKTOP_WRAPPER_RECORDINGS_DIR") or "").strip()
    if configured:
        return configured

    docs = _get_windows_documents_dir()
    if docs:
        return os.path.join(docs, "WebGazer Recordings")

    home_docs = os.path.join(os.path.expanduser("~"), "Documents")
    return os.path.join(home_docs, "WebGazer Recordings") if os.path.isdir(home_docs) else os.path.join(os.path.expanduser("~"), "WebGazer Recordings")


def resolve_default_clicks_base_name() -> str:
    return f"webgazer-recording-{_now_iso_stamp_utc()}"


def resolve_default_csv_path() -> str:
    base = resolve_default_clicks_base_name()
    out_dir = resolve_recordings_dir()
    try:
        os.makedirs(out_dir, exist_ok=True)
    except Exception:
        out_dir = os.path.abspath(".")
    return os.path.join(out_dir, f"{base}-system-clicks.csv")


def run_jsonl(start_epoch_ms: Optional[int], csv_out: Optional[str], stop_on_esc: bool) -> None:
    stop_event = threading.Event()
    print("READY", file=sys.stderr, flush=True)

    def on_click(x, y, button, pressed):
        if not pressed:
            return
        now_epoch = epoch_ms()
        record = {
            "t_ms": max(0, now_epoch - start_epoch_ms) if start_epoch_ms is not None else now_epoch,
            "epoch_ms": now_epoch,
            "screen_x": x,
            "screen_y": y,
            "button": getattr(button, "name", str(button)),
        }
        sys.stdout.write(json.dumps(record, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        if csv_out:
            try:
                with open(csv_out, "a", encoding="utf-8", newline="") as f:
                    writer = csv.writer(f)
                    writer.writerow(
                        [
                            record.get("t_ms", ""),
                            record.get("epoch_ms", ""),
                            record.get("screen_x", ""),
                            record.get("screen_y", ""),
                            record.get("button", ""),
                        ]
                    )
            except Exception:
                pass

    def on_stdin():
        for line in sys.stdin:
            if line.strip().upper() == "STOP":
                stop_event.set()
                break

    def on_key_press(key):
        if key == keyboard.Key.esc:
            stop_event.set()
            return False
        return True

    stdin_thread = threading.Thread(target=on_stdin, daemon=True)
    stdin_thread.start()

    mouse_listener = mouse.Listener(on_click=on_click)
    mouse_listener.start()

    keyboard_listener = None
    if stop_on_esc:
        keyboard_listener = keyboard.Listener(on_press=on_key_press)
        keyboard_listener.start()

    stop_event.wait()

    mouse_listener.stop()
    try:
        mouse_listener.join(1)
    except Exception:
        pass

    if keyboard_listener:
        try:
            keyboard_listener.stop()
        except Exception:
            pass


def run_legacy() -> None:
    click_count = 0
    clicks = []

    out_dir = resolve_recordings_dir()
    try:
        os.makedirs(out_dir, exist_ok=True)
    except Exception:
        out_dir = os.path.abspath(".")
    out_path = os.path.join(out_dir, f"{resolve_default_clicks_base_name()}-system-clicks.txt")

    def on_click(_x, _y, button, pressed):
        nonlocal click_count
        if pressed:
            click_count += 1
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            clicks.append({"number": click_count, "time": timestamp, "button": button.name})
            print(f"Click #{click_count} at {timestamp} ({button.name})")

    def on_press(key):
        if key == keyboard.Key.esc:  # Press Escape to stop
            print(f"\n\nTotal clicks: {click_count}")
            with open(out_path, "w", encoding="utf-8") as f:
                for c in clicks:
                    f.write(f"{c['number']}, {c['time']}, {c['button']}\n")
            print(f"Log saved to {out_path}")
            return False  # Stops the keyboard listener

    print("Listening for clicks... Press ESC to stop.\n")

    mouse_listener = mouse.Listener(on_click=on_click)
    keyboard_listener = keyboard.Listener(on_press=on_press)

    mouse_listener.start()
    keyboard_listener.start()

    keyboard_listener.join()  # Wait for ESC
    mouse_listener.stop()


def run_csv(out_path: str, start_epoch_ms: Optional[int]) -> None:
    stop_event = threading.Event()
    out_path = out_path or resolve_default_csv_path()

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["t_ms", "epoch_ms", "screen_x", "screen_y", "button"])
        f.flush()

        def on_click(x, y, button, pressed):
            if not pressed:
                return
            now_epoch = epoch_ms()
            t_ms = max(0, now_epoch - start_epoch_ms) if start_epoch_ms is not None else now_epoch
            writer.writerow([t_ms, now_epoch, x, y, getattr(button, "name", str(button))])
            f.flush()

        def on_press(key):
            if key == keyboard.Key.esc:
                stop_event.set()
                return False
            return True

        def on_stdin():
            for line in sys.stdin:
                if line.strip().upper() == "STOP":
                    stop_event.set()
                    break

        print(f"Writing clicks to: {out_path}", file=sys.stderr, flush=True)
        print("Press ESC to stop.", file=sys.stderr, flush=True)

        stdin_thread = threading.Thread(target=on_stdin, daemon=True)
        stdin_thread.start()

        mouse_listener = mouse.Listener(on_click=on_click)
        keyboard_listener = keyboard.Listener(on_press=on_press)
        mouse_listener.start()
        keyboard_listener.start()

        stop_event.wait()

        try:
            mouse_listener.stop()
        except Exception:
            pass
        try:
            keyboard_listener.stop()
        except Exception:
            pass


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--jsonl", action="store_true", help="Write click events as JSON lines to stdout.")
    parser.add_argument(
        "--csv-out",
        default="",
        help="Also write click events to this CSV file (or in CSV mode, the output path).",
    )
    parser.add_argument(
        "--stop-on-esc",
        action="store_true",
        help="In --jsonl mode, pressing ESC stops the process (stdin STOP still works).",
    )
    parser.add_argument("--legacy", action="store_true", help="Legacy console mode (writes clicks_log.txt).")
    parser.add_argument(
        "--start-epoch-ms",
        type=int,
        default=None,
        help="If set, emit t_ms relative to this epoch start time.",
    )
    args = parser.parse_args()

    if args.legacy:
        run_legacy()
        return

    if args.jsonl:
        csv_out = (args.csv_out or "").strip() or None
        if csv_out:
            try:
                os.makedirs(os.path.dirname(os.path.abspath(csv_out)), exist_ok=True)
                with open(csv_out, "w", encoding="utf-8", newline="") as f:
                    writer = csv.writer(f)
                    writer.writerow(["t_ms", "epoch_ms", "screen_x", "screen_y", "button"])
                    f.flush()
            except Exception:
                csv_out = None
        run_jsonl(args.start_epoch_ms, csv_out, bool(args.stop_on_esc))
        return

    csv_out = (args.csv_out or "").strip() or resolve_default_csv_path()
    run_csv(csv_out, args.start_epoch_ms)


if __name__ == "__main__":
    main()
