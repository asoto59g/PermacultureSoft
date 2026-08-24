#!/usr/bin/env python3
"""Lanzador de escritorio de PermacultureSoft para Linux y macOS.

Arranca FastAPI y Next.js, espera a que respondan, abre el navegador y deja
una ventana pequena de control. Al cerrarla se detienen solo los procesos
que este lanzador arranco.

Equivalente a scripts/launcher.ps1. Lo invoca scripts/launcher.sh.
"""

from __future__ import annotations

import fcntl
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
LOG_DIR = ROOT / "logs"
PYTHON_EXE = BACKEND / "venv" / "bin" / "python"
NEXT_BIN = FRONTEND / "node_modules" / "next" / "dist" / "bin" / "next"

BACKEND_PORT = 8000
FRONTEND_PORT = 3000
BACKEND_URL = f"http://127.0.0.1:{BACKEND_PORT}/"
APP_URL = f"http://127.0.0.1:{FRONTEND_PORT}/"

LOG_DIR.mkdir(parents=True, exist_ok=True)
LAUNCHER_LOG = LOG_DIR / "launcher.log"
LOCK_PATH = LOG_DIR / "launcher.lock"

owned: list[subprocess.Popen] = []
lock_fd = None


def log(message: str) -> None:
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S}  {message}"
    try:
        with LAUNCHER_LOG.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


def which_node() -> str | None:
    found = shutil.which("node")
    if found:
        return found
    for candidate in ("/opt/homebrew/bin/node", "/usr/local/bin/node"):
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def fetch(url: str, timeout: float) -> tuple[int, str]:
    # 127.0.0.1 y proxy vacio: un proxy corporativo deja el lanzador congelado.
    req = urllib.request.Request(url, headers={"User-Agent": "PermacultureSoft-launcher"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", "replace")
        return resp.getcode(), body


def backend_up() -> bool:
    try:
        _code, body = fetch(BACKEND_URL, 3)
        return "PermacultureSoft" in body
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def frontend_up() -> bool:
    try:
        code, body = fetch(APP_URL, 5)
        return code == 200 and "PermacultureSoft" in body
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def port_busy(port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(0.4)
    try:
        sock.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def start_silent(exe: str, args: list[str], workdir: Path, log_name: str) -> subprocess.Popen:
    log_path = LOG_DIR / f"{log_name}.log"
    log(f"lanzando {log_name}: {exe} {' '.join(args)}")
    handle = log_path.open("w", encoding="utf-8")
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env.pop("HTTP_PROXY", None)
    env.pop("HTTPS_PROXY", None)
    env.pop("ALL_PROXY", None)
    env.pop("http_proxy", None)
    env.pop("https_proxy", None)
    env["NO_PROXY"] = "127.0.0.1,localhost"
    env["no_proxy"] = "127.0.0.1,localhost"
    return subprocess.Popen(
        [exe, *args],
        cwd=str(workdir),
        stdout=handle,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        env=env,
    )


def stop_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except OSError:
        try:
            proc.terminate()
        except OSError:
            return
    deadline = time.time() + 5
    while time.time() < deadline and proc.poll() is None:
        time.sleep(0.15)
    if proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            try:
                proc.kill()
            except OSError:
                pass


def wait_until(test, timeout_sec: float) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if test():
            return True
        time.sleep(0.6)
    return False


def build_stale() -> bool:
    return not (FRONTEND / ".next" / "BUILD_ID").is_file()


def open_app() -> None:
    chrome_flags = [f"--app={APP_URL}", "--window-size=1600,1000"]
    if sys.platform == "darwin":
        for app_name in ("Google Chrome", "Chromium", "Microsoft Edge"):
            try:
                subprocess.Popen(
                    ["open", "-na", app_name, "--args", *chrome_flags],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return
            except OSError:
                continue
        subprocess.Popen(["open", APP_URL])
        return

    for exe in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"):
        path = shutil.which(exe)
        if path:
            try:
                subprocess.Popen(
                    [path, *chrome_flags],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return
            except OSError:
                continue
    opener = shutil.which("xdg-open")
    if opener:
        subprocess.Popen([opener, APP_URL], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return
    import webbrowser

    webbrowser.open(APP_URL)


class LaunchError(Exception):
    pass


def acquire_lock() -> bool:
    global lock_fd
    lock_fd = os.open(LOCK_PATH, os.O_CREAT | os.O_RDWR, 0o644)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except BlockingIOError:
        return False


def start_servers(status) -> None:
    if not PYTHON_EXE.is_file():
        raise LaunchError(
            f"No existe el entorno de Python:\n{PYTHON_EXE}\n\n"
            "Ejecuta scripts/install.sh una vez."
        )
    if not NEXT_BIN.is_file():
        raise LaunchError(
            "Faltan las dependencias del frontend.\n\n"
            "Ejecuta scripts/install.sh una vez."
        )
    node = which_node()
    if not node:
        raise LaunchError(
            "No se encontro Node.js. Instalalo desde https://nodejs.org/ "
            "(LTS 20 o superior) y vuelve a ejecutar scripts/install.sh."
        )

    if backend_up():
        status("El servidor de calculo ya estaba corriendo.")
    elif port_busy(BACKEND_PORT):
        raise LaunchError(
            f"El puerto {BACKEND_PORT} esta ocupado por otro programa. "
            "Cierralo y vuelve a intentar."
        )
    else:
        status("Iniciando el servidor de calculo...")
        proc = start_silent(
            str(PYTHON_EXE),
            ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(BACKEND_PORT)],
            BACKEND,
            "backend",
        )
        owned.append(proc)
        if not wait_until(backend_up, 90):
            raise LaunchError("El servidor de calculo no respondio.\nRevisa logs/backend.log.")

    if frontend_up():
        status("La aplicacion ya estaba corriendo.")
    elif port_busy(FRONTEND_PORT):
        raise LaunchError(
            f"El puerto {FRONTEND_PORT} esta ocupado por otro programa. "
            "Cierralo y vuelve a intentar."
        )
    else:
        if build_stale():
            status("Compilando la aplicacion. La primera vez tarda cerca de un minuto...")
            build = start_silent(node, [str(NEXT_BIN), "build", "--webpack"], FRONTEND, "build")
            build.wait()
            if build.returncode != 0:
                raise LaunchError("Fallo la compilacion.\nRevisa logs/build.log.")
        status("Iniciando la aplicacion...")
        proc = start_silent(
            node,
            [str(NEXT_BIN), "start", "--hostname", "127.0.0.1", "--port", str(FRONTEND_PORT)],
            FRONTEND,
            "frontend",
        )
        owned.append(proc)
        if not wait_until(frontend_up, 90):
            raise LaunchError("La aplicacion no respondio.\nRevisa logs/frontend.log.")

    status(f"Lista en {APP_URL}\nDeja esta ventana abierta mientras trabajas.")


def stop_owned() -> None:
    for proc in owned:
        stop_tree(proc)
    owned.clear()
    log("detenido")


def try_tk():
    try:
        import tkinter as tk
        from tkinter import messagebox
    except ImportError:
        return None
    if sys.platform.startswith("linux") and not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY"):
        return None
    return tk, messagebox


def run_tk(tk, messagebox) -> None:
    root = tk.Tk()
    root.title("PermacultureSoft")
    root.geometry("430x168")
    root.resizable(False, False)
    bg = "#18181b"
    muted = "#a1a1aa"
    green = "#34d399"
    root.configure(bg=bg)

    title = tk.Label(
        root, text="PermacultureSoft", font=("Helvetica", 14, "bold"),
        fg=green, bg=bg,
    )
    title.place(x=20, y=14)

    status_var = tk.StringVar(value="Preparando...")
    status_label = tk.Label(
        root, textvariable=status_var, font=("Helvetica", 9),
        fg=muted, bg=bg, justify="left", anchor="nw",
    )
    status_label.place(x=22, y=48, width=388, height=36)

    bar = tk.Frame(root, bg="#3f3f46", height=6)
    bar.place(x=22, y=88, width=386, height=6)
    pulse = tk.Frame(bar, bg=green, height=6)
    pulse.place(x=0, y=0, width=80, height=6)
    pulsing = {"on": True, "x": 0}

    def animate():
        if not pulsing["on"]:
            return
        pulsing["x"] = (pulsing["x"] + 8) % 310
        pulse.place(x=pulsing["x"], y=0, width=80, height=6)
        root.after(40, animate)

    def set_status(text: str) -> None:
        def _apply() -> None:
            status_var.set(text)
            log(text)

        root.after(0, _apply)

    def ready() -> None:
        pulsing["on"] = False
        pulse.place(x=0, y=0, width=386, height=6)
        open_btn.configure(state="normal")

    def fail(message: str) -> None:
        pulsing["on"] = False
        log(f"ERROR: {message}")
        messagebox.showerror(
            "PermacultureSoft",
            f"{message}\n\nDetalle en:\n{LAUNCHER_LOG}",
        )
        root.destroy()

    def on_close() -> None:
        status_var.set("Deteniendo...")
        root.update_idletasks()
        stop_owned()
        root.destroy()

    open_btn = tk.Button(
        root, text="Abrir", command=open_app, state="disabled",
        bg="#047857", fg="white", activebackground="#065f46",
        activeforeground="white", relief="flat", width=16,
    )
    open_btn.place(x=22, y=110, width=190, height=34)

    stop_btn = tk.Button(
        root, text="Detener y salir", command=on_close,
        bg="#3f3f46", fg="white", activebackground="#27272a",
        activeforeground="white", relief="flat", width=16,
    )
    stop_btn.place(x=218, y=110, width=190, height=34)

    root.protocol("WM_DELETE_WINDOW", on_close)

    def worker() -> None:
        try:
            log("--- arranque ---")
            start_servers(set_status)
            root.after(0, ready)
            open_app()
        except LaunchError as exc:
            root.after(0, lambda: fail(str(exc)))
        except Exception as exc:  # noqa: BLE001
            root.after(0, lambda: fail(str(exc)))

    animate()
    threading.Thread(target=worker, daemon=True).start()
    root.mainloop()


def zenity_available() -> bool:
    return shutil.which("zenity") is not None


def osascript_available() -> bool:
    return sys.platform == "darwin" and shutil.which("osascript") is not None


def run_zenity() -> None:
    def status(text: str) -> None:
        log(text)
        print(text, flush=True)

    start_servers(status)
    open_app()
    while True:
        result = subprocess.run(
            [
                "zenity",
                "--question",
                "--title=PermacultureSoft",
                f"--text=Lista en {APP_URL}\n\nDeja este cuadro abierto mientras trabajas.",
                "--ok-label=Abrir",
                "--cancel-label=Detener y salir",
                "--width=360",
            ],
            check=False,
        )
        if result.returncode == 0:
            open_app()
        else:
            break


def run_osascript() -> None:
    def status(text: str) -> None:
        log(text)
        print(text, flush=True)

    start_servers(status)
    open_app()
    script = f'''
repeat
    set theResult to display dialog "Lista en {APP_URL}" & return & return & "Deja este cuadro abierto mientras trabajas." buttons {{"Detener y salir", "Abrir"}} default button "Abrir" with title "PermacultureSoft"
    if button returned of theResult is "Abrir" then
        do shell script "open {APP_URL}"
    else
        exit repeat
    end if
end repeat
'''
    subprocess.run(["osascript", "-e", script], check=False)


def run_tty() -> None:
    def status(text: str) -> None:
        log(text)
        print(text, flush=True)

    start_servers(status)
    open_app()
    print()
    print("Deja esta terminal abierta mientras trabajas.")
    print("Pulsa Enter para detener y salir.")
    try:
        input()
    except EOFError:
        try:
            signal.pause()
        except AttributeError:
            while True:
                time.sleep(3600)


def spawn_terminal_fallback() -> bool:
    cmd = [sys.executable, str(Path(__file__).resolve()), "--tty"]
    if sys.platform == "darwin":
        # Abre Terminal.app solo si no hay dialogo nativo (no deberia llegar aqui).
        escaped = " ".join(f'"{part}"' if " " in part else part for part in cmd)
        apple = f'tell application "Terminal" to do script "{escaped}"'
        try:
            subprocess.Popen(["osascript", "-e", apple])
            return True
        except OSError:
            return False
    for argv in (
        ["gnome-terminal", "--", *cmd],
        ["kgx", "--", *cmd],
        ["konsole", "-e", *cmd],
        ["xfce4-terminal", "-e", " ".join(cmd)],
        ["xterm", "-e", *cmd],
    ):
        if shutil.which(argv[0]):
            try:
                subprocess.Popen(argv)
                return True
            except OSError:
                continue
    return False


def main() -> int:
    force_tty = "--tty" in sys.argv
    toolkit = try_tk()

    if (
        not force_tty
        and toolkit is None
        and not zenity_available()
        and not osascript_available()
        and not sys.stdin.isatty()
    ):
        if spawn_terminal_fallback():
            return 0
        log("ERROR: no hay interfaz grafica ni terminal")
        print(
            "No se pudo abrir la ventana de control. Instala python3-tk "
            "(Linux) o python-tk (macOS), o ejecuta scripts/launcher.sh "
            "desde una terminal.",
            file=sys.stderr,
        )
        return 1

    if not acquire_lock():
        log("ya habia un lanzador abierto; solo se abre la ventana")
        open_app()
        return 0

    try:
        if force_tty or (toolkit is None and not zenity_available() and not osascript_available()):
            run_tty()
            return 0
        if toolkit:
            try:
                run_tk(*toolkit)
                return 0
            except Exception as exc:
                log(f"tkinter fallo ({exc}); usando dialogo del sistema")
        log("tkinter no disponible; usando dialogo del sistema")
        if zenity_available():
            run_zenity()
            return 0
        run_osascript()
        return 0
    except LaunchError as exc:
        log(f"ERROR: {exc}")
        print(exc, file=sys.stderr)
        print(f"\nDetalle en: {LAUNCHER_LOG}", file=sys.stderr)
        return 1
    finally:
        stop_owned()
        if lock_fd is not None:
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_UN)
                os.close(lock_fd)
            except OSError:
                pass


if __name__ == "__main__":
    sys.exit(main())
