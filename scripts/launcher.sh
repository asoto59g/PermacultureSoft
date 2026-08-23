#!/usr/bin/env bash
# Punto de entrada del lanzador en Linux y macOS. Equivale a PermacultureSoft.vbs:
# arranca launcher.py sin dejar una consola visible.
# No se usa a mano; lo llama el acceso del escritorio o install.sh.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/unix-common.sh"

unix_prepare_path

ROOT="$(unix_root)"
LAUNCHER="${SCRIPT_DIR}/launcher.py"
VENV_PY="${ROOT}/backend/venv/bin/python"

if [ ! -f "$LAUNCHER" ]; then
  echo "No se encontro scripts/launcher.py." >&2
  exit 1
fi

pick_python() {
  local c exe
  # La GUI usa tkinter (stdlib). El venv sirve uvicorn; aqui preferimos
  # un interprete que pueda abrir la ventana de control.
  for c in python3 python "$VENV_PY"; do
    if [ -x "$c" ]; then
      exe="$c"
    elif command -v "$c" >/dev/null 2>&1; then
      exe="$(command -v "$c")"
    else
      continue
    fi
    if "$exe" -c 'import tkinter' >/dev/null 2>&1; then
      printf '%s' "$exe"
      return 0
    fi
  done
  if [ -x "$VENV_PY" ]; then
    printf '%s' "$VENV_PY"
    return 0
  fi
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1; then
      command -v "$c"
      return 0
    fi
  done
  return 1
}

PYTHON="$(pick_python)" || {
  echo "No se encontro Python. Ejecuta scripts/install.sh una vez." >&2
  exit 1
}

# Sin terminal: si se lanza desde un .desktop / .app no hay TTY.
exec "$PYTHON" "$LAUNCHER"
