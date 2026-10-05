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

up=0
for _ in $(seq 1 50); do
  if curl -fs "http://127.0.0.1:$PORT/health" > /dev/null; then up=1; break; fi
  sleep 0.2
done
if (( up == 0 )); then
  echo "FAIL Caddy svarade aldrig på /health"; tail -40 "$WORK/caddy.log"; exit 1
fi

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
check "saknad hashad fil ger 404, aldrig cachad"  "/assets/index-DOESNOTEXIST.js"  404 "^cache-control: no-store" "immutable|content-type: text/html"
check "assets-katalogen ger 404, aldrig cachad"   "/assets/"                       404 "^cache-control: no-store" "immutable"
check "Strava-popupen serveras"                   "/strava-popup.html"             200 "^content-type: text/html"
check "robots.txt serveras"                       "/robots.txt"                    200 ""
check "health svarar utan index.html"             "/health"                        200 "" "content-type: text/html"
if [[ -n "$(curl -s "http://127.0.0.1:$PORT/health")" ]]; then
  echo "FAIL health: kroppen ska vara tom (skuggad av SPA-blocket?)"; failures=$((failures + 1))
else
  echo "ok   health har tom kropp"
fi
check "nosniff och ingen Server-header"           "/"                              200 "^x-content-type-options: nosniff" "^server:"

# Apex-domänen skickas till www med sökväg och query kvar; www och Railways egen adress serveras som vanligt.
host_check() {
  local desc="$1" host="$2" path="$3" want_status="$4" want_location="${5:-}"
  local headers status location
  headers="$(curl -s -o /dev/null -D - -H "Host: $host" "http://127.0.0.1:$PORT$path" | tr -d '\r')"
  status="$(printf '%s\n' "$headers" | head -1 | awk '{print $2}')"
  location="$(printf '%s\n' "$headers" | grep -i '^location:' | sed 's/^[Ll]ocation: //')"
  if [[ "$status" != "$want_status" || "$location" != "$want_location" ]]; then
    echo "FAIL $desc: $host$path gav $status ${location:-(ingen location)}, väntade $want_status ${want_location:-(ingen location)}"
    failures=$((failures + 1)); return
  fi
  echo "ok   $desc"
}
host_check "runquest.dev skickas till www"            "runquest.dev"                     "/titles?view=all" 308 "https://www.runquest.dev/titles?view=all"
host_check "runquest.dev-roten skickas till www"      "runquest.dev"                     "/"                308 "https://www.runquest.dev/"
host_check "www serveras utan omdirigering"           "www.runquest.dev"                 "/board"           200
host_check "Railways egen adress serveras"            "spectacular-rebirth-production-186c.up.railway.app" "/" 200

if (( failures > 0 )); then
  echo "--- caddy-logg ---"; tail -20 "$WORK/caddy.log"
  exit 1
fi
echo "Statisk servering: alla kontroller gröna."
