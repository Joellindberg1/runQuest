#!/usr/bin/env bash
# Hämtar samma Caddy-version som scripts/verify-static-serving.sh fäster (linux amd64, kontrollsumma från releasen) till katalogen i $1
# och skriver binärens sökväg som sista rad. Det här är det enda Lighthouse-steget som når internet; själva mätningen går bara mot 127.0.0.1.
# Används av CI-jobbet (en egen workflow-rad) och av run.sh när CADDY_BIN saknas.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:?ange katalogen Caddy ska hamna i}"
CADDY_VERSION="$(sed -n 's/^CADDY_VERSION="\(.*\)"$/\1/p' "$HERE/../verify-static-serving.sh")"
if [[ -z "$CADDY_VERSION" ]]; then echo "FAIL hittade ingen CADDY_VERSION i scripts/verify-static-serving.sh" >&2; exit 1; fi

archive="caddy_${CADDY_VERSION}_linux_amd64.tar.gz"
base="https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}"
mkdir -p "$DEST"
curl -fsSL -o "$DEST/$archive" "$base/$archive"
curl -fsSL -o "$DEST/checksums.txt" "$base/caddy_${CADDY_VERSION}_checksums.txt"
(cd "$DEST" && grep " $archive\$" checksums.txt | sha512sum -c - >&2)
tar -xzf "$DEST/$archive" -C "$DEST" caddy
echo "$DEST/caddy"
