# Utilidades compartidas por install.sh y launcher.sh.
# Compatible con Bash 3.2 (el de macOS). Se carga con: . unix-common.sh

unix_scripts_dir() {
  local src="${BASH_SOURCE[0]}"
  local dir
  while [ -L "$src" ]; do
    dir="$(cd "$(dirname "$src")" && pwd)"
    src="$(readlink "$src")"
    case "$src" in
      /*) ;;
      *) src="$dir/$src" ;;
    esac
  done
  cd "$(dirname "$src")" && pwd
}

unix_prepare_path() {
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi

  if [ -s "${HOME}/.nvm/nvm.sh" ]; then
    export NVM_DIR="${HOME}/.nvm"
    # shellcheck disable=SC1091
    . "${NVM_DIR}/nvm.sh"
  fi

  if [ -d "${HOME}/.volta/bin" ]; then
    PATH="${HOME}/.volta/bin:${PATH}"
  fi
  if [ -x "${HOME}/.local/share/fnm/fnm" ]; then
    PATH="${HOME}/.local/share/fnm:${PATH}"
    eval "$(fnm env --shell bash 2>/dev/null)" || true
  fi
  export PATH
}

unix_root() {
  cd "$(unix_scripts_dir)/.." && pwd
}

unix_desktop_dir() {
  local d
  if command -v xdg-user-dir >/dev/null 2>&1; then
    d="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
  fi
  if [ -z "${d:-}" ]; then
    if [ -d "${HOME}/Desktop" ]; then
      d="${HOME}/Desktop"
    elif [ -d "${HOME}/Escritorio" ]; then
      d="${HOME}/Escritorio"
    else
      d="${HOME}/Desktop"
    fi
  fi
  printf '%s' "$d"
}

unix_os() {
  uname -s
}
