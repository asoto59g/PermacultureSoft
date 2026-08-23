#!/bin/bash
# Doble clic diario en macOS si no usas el icono del escritorio.
# Cierra esta ventana en cuanto arranca el lanzador.
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi
nohup "$DIR/scripts/launcher.sh" >/dev/null 2>&1 &
exit 0
