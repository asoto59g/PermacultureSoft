#!/usr/bin/env bash
# Instalación de una sola vez en Linux y macOS. Crea el venv, instala
# dependencias, compila la interfaz, deja un acceso en el escritorio y abre
# la aplicación. Equivalente a scripts/Instalar.cmd.
#
#   ./install.sh                 instala y abre
#   ./install.sh --shortcut-only solo recrea el acceso del escritorio

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/unix-common.sh"

unix_prepare_path

ROOT="$(unix_root)"
BACKEND="${ROOT}/backend"
FRONTEND="${ROOT}/frontend"
VENV_PY="${BACKEND}/venv/bin/python"
REQ="${BACKEND}/requirements.txt"
SHORTCUT_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --shortcut-only|-ShortcutOnly) SHORTCUT_ONLY=1 ;;
    -h|--help)
      echo "Uso: $0 [--shortcut-only]"
      exit 0
      ;;
    *)
      echo "Opción no reconocida: $arg" >&2
      exit 1
      ;;
  esac
done

case "$(unix_os)" in
  MINGW*|MSYS*|CYGWIN*)
    echo "En Windows usa scripts\\Instalar.cmd (o CrearAccesoEscritorio.cmd)."
    exit 1
    ;;
esac

# Tras clonar desde Windows los scripts pueden haber perdido el bit ejecutable.
chmod +x "${SCRIPT_DIR}/install.sh" \
         "${SCRIPT_DIR}/launcher.sh" \
         "${SCRIPT_DIR}/crear-acceso.sh" \
         "${SCRIPT_DIR}/Instalar.command" \
         "${SCRIPT_DIR}/CrearAcceso.command" \
         "${ROOT}/PermacultureSoft.command" 2>/dev/null || true

step() {
  echo
  echo "==> $*"
}

fail() {
  echo
  echo "ERROR: $*" >&2
  echo
  echo "Si rasterio o GDAL fallan:"
  echo "  Debian/Ubuntu: sudo apt install python3-venv python3-tk gdal-bin"
  echo "  Fedora:        sudo dnf install python3-tkinter gdal"
  echo "  macOS:         brew install python-tk gdal"
  exit 1
}

write_linux_desktop() {
  local dest="$1"
  cat > "$dest" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=PermacultureSoft
Comment=Diseño de paisaje en permacultura
Exec="${ROOT}/scripts/launcher.sh"
Path=${ROOT}
Icon=${ROOT}/frontend/public/globe.svg
Terminal=false
Categories=Science;Education;Geography;
StartupNotify=false
EOF
  chmod +x "$dest"
  if command -v gio >/dev/null 2>&1; then
    gio set "$dest" metadata::trusted true 2>/dev/null || true
  fi
}

write_macos_app() {
  local dest="$1"
  local macdir="${dest}/Contents/MacOS"
  rm -rf "$dest"
  mkdir -p "$macdir"
  cat > "${dest}/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>PermacultureSoft</string>
  <key>CFBundleIdentifier</key>
  <string>local.permaculturesoft.launcher</string>
  <key>CFBundleName</key>
  <string>PermacultureSoft</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
</dict>
</plist>
EOF
  cat > "${macdir}/PermacultureSoft" <<EOF
#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:\$PATH"
exec "${ROOT}/scripts/launcher.sh"
EOF
  chmod +x "${macdir}/PermacultureSoft"
}

create_shortcut() {
  local desktop os dest apps
  desktop="$(unix_desktop_dir)"
  os="$(unix_os)"
  mkdir -p "$desktop" 2>/dev/null || true

  if [ "$os" = "Darwin" ]; then
    dest="${desktop}/PermacultureSoft.app"
    write_macos_app "$dest"
    write_macos_app "${ROOT}/PermacultureSoft.app"
    printf '%s' "$dest"
    return 0
  fi

  dest="${desktop}/PermacultureSoft.desktop"
  write_linux_desktop "$dest"
  apps="${HOME}/.local/share/applications"
  mkdir -p "$apps"
  write_linux_desktop "${apps}/PermacultureSoft.desktop"
  printf '%s' "$dest"
}

start_app() {
  nohup "${SCRIPT_DIR}/launcher.sh" >/dev/null 2>&1 &
}

if [ "$SHORTCUT_ONLY" -eq 1 ]; then
  created="$(create_shortcut)"
  if [ -n "$created" ]; then
    echo "Acceso creado: ${created}"
    exit 0
  fi
  echo "No se pudo crear el acceso del escritorio." >&2
  exit 1
fi

echo "PermacultureSoft - instalacion"
echo "Carpeta: ${ROOT}"

# ------------------------------------------------------------------ requisitos

step "Comprobando Python 3.11+ y Node.js 20+"

PYTHON=""
for cand in python3.13 python3.12 python3.11 python3 python; do
  command -v "$cand" >/dev/null 2>&1 || continue
  ver="$("$cand" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || true)"
  [ -n "$ver" ] || continue
  major="${ver%%.*}"
  minor="${ver#*.}"
  if [ "$major" -eq 3 ] && [ "$minor" -ge 11 ]; then
    PYTHON="$(command -v "$cand")"
    echo "    Python ${ver}  (${PYTHON})"
    break
  fi
done
if [ -z "$PYTHON" ]; then
  fail "No se encontro Python 3.11 o superior. Instalalo desde https://www.python.org/downloads/ o con el gestor de paquetes (apt, dnf, brew)."
fi

NODE=""
for cand in node /opt/homebrew/bin/node /usr/local/bin/node; do
  if command -v "$cand" >/dev/null 2>&1; then
    NODE="$(command -v "$cand")"
  elif [ -x "$cand" ]; then
    NODE="$cand"
  else
    continue
  fi
  node_ver="$("$NODE" --version 2>/dev/null || true)"
  [ -n "$node_ver" ] || continue
  node_major="${node_ver#v}"
  node_major="${node_major%%.*}"
  if [ "$node_major" -ge 20 ]; then
    echo "    Node ${node_ver}  (${NODE})"
    break
  fi
  NODE=""
done
if [ -z "$NODE" ]; then
  fail "No se encontro Node.js 20 o superior. Instalalo desde https://nodejs.org/ (LTS)."
fi

NPM=""
if command -v npm >/dev/null 2>&1; then
  NPM="$(command -v npm)"
else
  sibling="$(dirname "$NODE")/npm"
  if [ -x "$sibling" ]; then
    NPM="$sibling"
  fi
fi
if [ -z "$NPM" ]; then
  fail "Node esta instalado pero no se encontro npm."
fi
echo "    npm  (${NPM})"

if ! "$PYTHON" -c 'import tkinter' >/dev/null 2>&1; then
  echo "    Aviso: tkinter no esta disponible. El lanzador usara un dialogo del sistema."
  echo "    Para la ventana de control: python3-tk (Linux) o brew install python-tk (macOS)."
fi

# ------------------------------------------------------------------ backend

step "Entorno de Python"
if [ ! -x "$VENV_PY" ]; then
  echo "    Creando venv..."
  "$PYTHON" -m venv "${BACKEND}/venv" || fail "Fallo la creacion del venv. En Debian/Ubuntu: sudo apt install python3-venv."
else
  echo "    venv ya existe, se reutiliza."
fi

echo "    Instalando dependencias del backend (tarda la primera vez)..."
"$VENV_PY" -m pip install --upgrade pip || fail "Fallo la actualizacion de pip."
"$VENV_PY" -m pip install -r "$REQ" || fail "Fallo la instalacion de requirements.txt."

# ------------------------------------------------------------------ frontend

step "Dependencias del frontend"
if [ ! -f "${FRONTEND}/.env.local" ] && [ -f "${FRONTEND}/.env.example" ]; then
  cp "${FRONTEND}/.env.example" "${FRONTEND}/.env.local"
  echo "    Creado frontend/.env.local a partir del ejemplo."
fi

cd "$FRONTEND"
# npm junto a node (nvm/fnm/volta). Un omit=optional viejo deja sin binario a Tailwind.
export PATH="$(dirname "$NODE"):${PATH}"
unset NPM_CONFIG_OMIT
"$NPM" install --no-fund --no-audit || fail "Fallo npm install."

if ! "$NODE" -e "require('lightningcss')" >/dev/null 2>&1; then
  plat="$("$NODE" -p "process.platform")"
  arch="$("$NODE" -p "process.arch")"
  native=""
  case "$plat" in
    darwin) native="lightningcss-darwin-${arch}" ;;
    linux)
      glibc="$("$NODE" -p "try { process.report.getReport().header.glibcVersionRuntime || '' } catch (e) { '' }" 2>/dev/null || true)"
      if [ "$arch" = "arm" ]; then
        native="lightningcss-linux-arm-gnueabihf"
      elif [ -n "$glibc" ]; then
        native="lightningcss-linux-${arch}-gnu"
      else
        native="lightningcss-linux-${arch}-musl"
      fi
      ;;
  esac
  [ -n "$native" ] || fail "No hay binario CSS para ${plat}-${arch}."
  echo "    Falta el binario CSS ($native). Instalando..."
  "$NPM" install "$native" --no-save --no-fund --no-audit || fail "Fallo la instalacion de $native (necesario para Tailwind)."
  if ! "$NODE" -e "require('lightningcss')" >/dev/null 2>&1; then
    fail "Sigue sin cargarse lightningcss tras instalar $native."
  fi
fi

echo "    Compilando la interfaz (un minuto la primera vez)..."
"$NPM" run build || fail "Fallo la compilacion (npm run build)."
cd "$ROOT"

# ------------------------------------------------------------------ acceso

step "Acceso en el escritorio"
created="$(create_shortcut)"
if [ -n "$created" ]; then
  echo "    ${created}"
else
  echo "    No se pudo crear. Usa scripts/launcher.sh desde la carpeta del proyecto."
fi

step "Abriendo PermacultureSoft"
start_app
echo
echo "Listo. Se abre la ventana de control y, en unos segundos, el navegador."
echo "Para el dia a dia usa el acceso del escritorio; no hace falta volver a instalar."
echo "Ya puedes cerrar esta terminal."
