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
# Källkartor är till för Sentry och får aldrig serveras (RUN-285): bygget tar bort dem ur dist. Provet gäller en riktig chunk, inte en påhittad:
# om en .map låg kvar i dist skulle den ge 200 här. Felspårningens chunk (optional-*.js) kontrolleras särskilt eftersom den är den som bär SDK:t.
check "källkarta till en hashad fil ger 404"      "/$asset.map"                    404 "^cache-control: no-store" "immutable|content-type: (text|application)/(json|javascript)"
optional_chunks=("$DIST"/assets/optional-*.js)
if [[ ! -e "${optional_chunks[0]}" ]]; then
  echo "FAIL felspårningens chunk (assets/optional-*.js) finns inte i dist; döptes den om? Uppdatera vite.config.ts och det här skriptet"; failures=$((failures + 1))
else
  check "källkarta till felspårningens chunk ger 404" "/assets/$(basename "${optional_chunks[0]}").map" 404 "^cache-control: no-store" "immutable"
fi
if [[ -n "$(find "$DIST" -name '*.map' -print -quit)" ]]; then
  echo "FAIL dist innehåller .map-filer"; find "$DIST" -name '*.map'; failures=$((failures + 1))
else
  echo "ok   dist saknar .map-filer"
fi
check "assets-katalogen ger 404, aldrig cachad"  "/assets/"                       404 "^cache-control: no-store" "immutable"
check "Strava-popupen serveras"                   "/strava-popup.html"             200 "^content-type: text/html"
check "robots.txt serveras"                       "/robots.txt"                    200 "^content-type: text/plain" "content-type: text/html"
check "sitemap.xml serveras"                      "/sitemap.xml"                   200 "^content-type: (text|application)/xml" "content-type: text/html"
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
  # grep utan träff (ingen omdirigering) får inte avsluta skriptet via pipefail.
  location="$(printf '%s\n' "$headers" | { grep -i '^location:' || true; } | sed 's/^[Ll]ocation: //')"
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

# Filmen, ikonerna, manifestet och delningsbilden (RUN-257, RUN-199, RUN-205). check_with skickar extra curl-argument: filmen begärs
# MED Accept-Encoding, annars prövas aldrig att Caddy låter bli att komprimera mp4, och Range ska ge 206.
check_with() {
  local desc="$1" path="$2" want_status="$3" header_pattern="$4" reject_pattern="$5"
  shift 5
  local headers status
  headers="$(curl -s -o /dev/null -D - "$@" "http://127.0.0.1:$PORT$path" | tr -d '\r')"
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

films=("$DIST"/media/landing-film-720.v*.mp4)
film="media/$(basename "${films[0]}")"
accept=(-H "Accept-Encoding: gzip, zstd")
check_with "filmen serveras som video, utan komprimering      " "/$film" 200 "^content-type: video/mp4" "content-encoding:" "${accept[@]}"
check_with "filmen är cachad som immutable"                          "/$film" 200 "^cache-control: public, max-age=31536000, immutable" "content-encoding:" "${accept[@]}"
check_with "filmen svarar på Range med 206"                          "/$film" 206 "^content-range: bytes 0-1023/" "content-encoding:" "${accept[@]}" -H "Range: bytes=0-1023"
check_with "saknad mediafil ger 404, aldrig index.html"              "/media/saknas.mp4" 404 "^cache-control: no-store" "immutable|content-type: text/html" "${accept[@]}"
font="fonts/bebas-neue-400.v1.woff2"
check_with "typsnittet serveras som woff2, utan komprimering" "/$font" 200 "^content-type: font/woff2" "content-type: text/html|content-encoding:" "${accept[@]}"
check_with "typsnittet är cachat som immutable"                      "/$font" 200 "^cache-control: public, max-age=31536000, immutable" "content-encoding:" "${accept[@]}"
check_with "saknat typsnitt ger 404, aldrig index.html"              "/fonts/saknas.v1.woff2" 404 "^cache-control: no-store" "immutable|content-type: text/html" "${accept[@]}"
check_with "favicon.svg serveras med bildtyp"                      "/favicon.svg" 200 "^content-type: image/svg\+xml" "content-type: text/html"
check_with "favicon.ico serveras med ikontyp"                        "/favicon.ico" 200 "^content-type: image/(x-icon|vnd\.microsoft\.icon)" "content-type: text/html"
check_with "apple-touch-icon serveras som PNG"                       "/apple-touch-icon.png" 200 "^content-type: image/png" "content-type: text/html"
check_with "site.webmanifest har manifesttyp"                        "/site.webmanifest" 200 "^content-type: application/manifest\+json" "content-type: text/html"
check_with "saknad manifestfil får inte manifesttypen"        "/saknas.webmanifest" 200 "^content-type: text/html" "application/manifest[+]json"
check_with "delningsbilden serveras som PNG"                         "/og-image.v1.png" 200 "^content-type: image/png" "content-type: text/html"

if (( failures > 0 )); then
  echo "--- caddy-logg ---"; tail -20 "$WORK/caddy.log"
  exit 1
fi
echo "Statisk servering: alla kontroller gröna."
