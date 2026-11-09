#!/bin/sh
# Installs showem into ~/.showem/bin: curl -fsSL https://showem.shaitar.com/install.sh | sh
set -eu

REPO="artsiomshaitar/showem"
BIN_DIR="$HOME/.showem/bin"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "showem runs on macOS only for now." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) target="darwin-arm64" ;;
  x86_64) target="darwin-x64" ;;
  *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac
# A shell running under Rosetta reports x86_64 on Apple silicon.
if [ "$target" = "darwin-x64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
  target="darwin-arm64"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading showem ($target)..."
base="https://github.com/$REPO/releases/latest/download"
curl -fsSL "$base/showem-$target.tar.gz" -o "$tmp/showem.tar.gz"
curl -fsSL "$base/checksums.txt" -o "$tmp/checksums.txt"

expected="$(grep " showem-$target.tar.gz\$" "$tmp/checksums.txt" | cut -d' ' -f1)"
actual="$(shasum -a 256 "$tmp/showem.tar.gz" | cut -d' ' -f1)"
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  echo "The download doesn't match its checksum. Try again." >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
tar -xzf "$tmp/showem.tar.gz" -C "$BIN_DIR"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    case "${SHELL##*/}" in
      zsh) rc="${ZDOTDIR:-$HOME}/.zshrc"; line="export PATH=\"$BIN_DIR:\$PATH\"" ;;
      bash) rc="$HOME/.bash_profile"; line="export PATH=\"$BIN_DIR:\$PATH\"" ;;
      fish) rc="$HOME/.config/fish/config.fish"; line="fish_add_path $BIN_DIR" ;;
      *) rc="$HOME/.profile"; line="export PATH=\"$BIN_DIR:\$PATH\"" ;;
    esac
    if ! grep -qsF "$BIN_DIR" "$rc"; then
      mkdir -p "$(dirname "$rc")"
      printf '\n# showem\n%s\n' "$line" >> "$rc"
    fi
    echo "Added $BIN_DIR to your PATH in $rc. Open a new terminal to use showem."
    ;;
esac

"$BIN_DIR/showem" setup
echo "showem $("$BIN_DIR/showem" --version) is installed."
