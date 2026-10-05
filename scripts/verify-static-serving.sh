#!/usr/bin/env bash
# Kör repo-rotens Caddyfile med samma Caddy-version som Railpack mot det byggda
# apps/frontend/dist och kontrollerar cache- och 404-beteendet med riktiga HTTP-anrop.
# Körs i CI efter frontend-bygget, från repo-roten.
set -euo pipefail

CADDY_VERSION="2.11.4"
PORT="18080"
WORK="$(mktemp -d)"
DIST="$(cd apps/frontend/dist && pwd)"

archive="caddy_${CADDY_VERSION}_linux_amd64.tar.gz"
base="https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}"
curl -fsSL -o "$WORK/$archive" "$base/$archive"
curl -fsSL -o "$WORK/checksums.txt" "$base/caddy_${CADDY_VERSION}_checksums.txt"
(cd "$WORK" && grep " $archive\$" checksums.txt | sha512sum -c -)
tar -xzf "$WORK/$archive" -C "$WORK" caddy

# Samma rendering som Railpack gör av {{.DIST_DIR}}.
sed "s|{{.DIST_DIR}}|$DIST|g" Caddyfile > "$WORK/Caddyfile"
"$WORK/caddy" validate --config "$WORK/Caddyfile" --adapter caddyfile

PORT="$PORT" "$WORK/caddy" run --config "$WORK/Caddyfile" --adapter caddyfile > "$WORK/caddy.log" 2>&1 &
CADDY_PID=$!
trap 'kill "$CADDY_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  curl -fs "http://127.0.0.1:$PORT/health" > /dev/null && break
  sleep 0.2
done

failures=0
check() {
  local desc="$1" path="$2" want_status="$3" header_pattern="$4" reject_pattern="${5:-}"
  local headers status
  headers="$(curl -s -o /dev/null -D - "http://127.0.0.1:$PORT$path" | tr -d '\r')"
  status="$(printf '%s\n' "$headers" | head -1 | awk '{print $2}')"
  if [[ "$status" != "$want_status" ]]; then
    echo "FAIL $desc: $path gav $status, väntade $want_status"; failures=$((failures + 1)); return
  fi
  if [[ -n "$header_pattern" ]] && ! printf '%s\n' "$headers" | grep -qiE "$header_pattern"; then
    echo "FAIL $desc: $path saknar header /$header_pattern/"; printf '%s\n' "$headers"; failures=$((failures + 1)); return
  fi
  if [[ -n "$reject_pattern" ]] && printf '%s\n' "$headers" | grep -qiE "$reject_pattern"; then
    echo "FAIL $desc: $path har förbjuden header /$reject_pattern/"; printf '%s\n' "$headers"; failures=$((failures + 1)); return
  fi
  echo "ok   $desc"
}

assets=("$DIST"/assets/*.js)
asset="assets/$(basename "${assets[0]}")"

check "startsidan revalideras alltid"            "/"                              200 "^cache-control: no-cache"
check "SPA-route ger index.html, revalideras"     "/titles"                        200 "^content-type: text/html"
check "SPA-route är no-cache"                     "/runner/some-id"                200 "^cache-control: no-cache"
check "hashad fil cachas för alltid"              "/$asset"                        200 "^cache-control: public, max-age=31536000, immutable"
check "hashad fil har JS-typ"                     "/$asset"                        200 "^content-type: (text|application)/javascript"
check "saknad hashad fil ger 404"                 "/assets/index-DOESNOTEXIST.js"  404 "" "immutable|content-type: text/html"
check "Strava-popupen serveras"                   "/strava-popup.html"             200 "^content-type: text/html"
check "robots.txt serveras"                       "/robots.txt"                    200 ""
check "health"                                    "/health"                        200 ""
check "nosniff och ingen Server-header"           "/"                              200 "^x-content-type-options: nosniff" "^server:"

if (( failures > 0 )); then
  echo "--- caddy-logg ---"; tail -20 "$WORK/caddy.log"
  exit 1
fi
echo "Statisk servering: alla kontroller gröna."
