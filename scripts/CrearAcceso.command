#!/bin/bash
# Recrea el icono del escritorio en macOS.
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi
if ! "$DIR/crear-acceso.sh"; then
  echo
  echo "No se pudo crear el acceso."
  echo "Pulsa Enter para cerrar."
  read -r _
  exit 1
fi
echo
echo "Pulsa Enter para cerrar."
read -r _
exit 0
