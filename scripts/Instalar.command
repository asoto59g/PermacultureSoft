#!/bin/bash
# Doble clic en macOS: instala en una ventana de Terminal y, al terminar, abre
# la aplicacion. Equivalente a scripts/Instalar.cmd.
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi
if ! "$DIR/install.sh"; then
  echo
  echo "La instalacion no termino. Revisa el mensaje de arriba."
  echo "Pulsa Enter para cerrar."
  read -r _
  exit 1
fi
exit 0
