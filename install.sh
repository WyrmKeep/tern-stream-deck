#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Tern plugin for OpenDeck (Stream Deck).

  ./install.sh              install or update the plugin, then restart OpenDeck
  ./install.sh --page       the same, and build the ready-made "Tern" page
                            (15-key decks; replaces an existing "Tern" page)
  ./install.sh --uninstall  remove the plugin, then restart OpenDeck
EOF
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN=io.github.wyrmkeep.tern.sdPlugin
FLATPAK_ID=me.amankhanna.opendeck

if [[ -d "$HOME/.var/app/$FLATPAK_ID/config/opendeck" ]]; then
  CONFIG="$HOME/.var/app/$FLATPAK_ID/config/opendeck"
  FLATPAK=1
elif [[ -d "${XDG_CONFIG_HOME:-$HOME/.config}/opendeck" ]]; then
  CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/opendeck"
  FLATPAK=0
else
  echo "install.sh: OpenDeck's config folder was not found. Start OpenDeck once, then run this again." >&2
  exit 1
fi

stop_opendeck() {
  if [[ $FLATPAK == 1 ]]; then flatpak kill "$FLATPAK_ID" 2>/dev/null || true; else pkill -x opendeck 2>/dev/null || true; fi
  for _ in $(seq 20); do pgrep -x opendeck >/dev/null || return 0; sleep 0.25; done
  echo "install.sh: OpenDeck is still running. Quit it, then run this again." >&2
  exit 1
}

start_opendeck() {
  if [[ $FLATPAK == 1 ]]; then
    setsid -f flatpak run --command=opendeck "$FLATPAK_ID" --hide >/dev/null 2>&1
  else
    setsid -f opendeck --hide >/dev/null 2>&1
  fi
}

case "${1:-}" in
  --uninstall)
    stop_opendeck
    rm -rf "$CONFIG/plugins/$PLUGIN"
    start_opendeck
    echo "Removed the Tern plugin from $CONFIG/plugins."
    ;;
  "" | --page)
    command -v node >/dev/null || { echo "install.sh: Node.js 22 or later is needed. OpenDeck runs the plugin with it." >&2; exit 1; }
    stop_opendeck
    mkdir -p "$CONFIG/plugins"
    rm -rf "$CONFIG/plugins/$PLUGIN"
    cp -R "$HERE/$PLUGIN" "$CONFIG/plugins/$PLUGIN"
    echo "Installed the Tern plugin into $CONFIG/plugins."
    if [[ "${1:-}" == --page ]]; then node "$HERE/page.mjs" "$CONFIG" --select; fi
    start_opendeck
    echo "OpenDeck is starting again in the tray. The Tern actions are at the bottom of its action list."
    ;;
  -h | --help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
