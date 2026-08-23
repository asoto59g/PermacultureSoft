#!/usr/bin/env bash
# Recrea el acceso de escritorio en Linux o macOS.
# Equivalente a scripts/CrearAccesoEscritorio.cmd
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/install.sh" --shortcut-only
