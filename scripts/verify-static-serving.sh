#!/usr/bin/env bash
# Kör repo-rotens Caddyfile med samma Caddy-version som Railpack mot det byggda
# apps/frontend/dist och kontrollerar cache- och 404-beteendet med riktiga HTTP-anrop.
# Körs i CI efter frontend-bygget, från repo-roten.
# CADDY_BIN (valfri): sökväg till en redan hämtad Caddy av samma version. Då hämtas inget; används för körning lokalt utan nätverk.
set -euo pipefail

CADDY_VERSION="2.11.4"
PORT="18080"
# Rubriken som Caddyfilen ska bära CSP i (RUN-344): först Report-Only i staging, sedan skarp. Det här är enda raden som byts när CSP blir skarp
# (Caddyfilens rubrik byts samtidigt); den andra rubriken får då inte finnas alls.
CSP_HEADER="content-security-policy"
if [[ "$CSP_HEADER" == "content-security-policy" ]]; then CSP_OTHER="content-security-policy-report-only"; else CSP_OTHER="content-security-policy"; fi
WORK="$(mktemp -d)"
# Windows (Git Bash): en inbyggd Caddy vill ha C:/-sökvägar i Caddyfilen, inte /tmp/…; på Linux är sökvägen oförändrad.
native_path() { if command -v cygpath > /dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
DIST="$(native_path "$(cd apps/frontend/dist && pwd)")"

if [[ -n "${CADDY_BIN:-}" ]]; then
  CADDY="$CADDY_BIN"
else
  archive="caddy_${CADDY_VERSION}_linux_amd64.tar.gz"
  base="https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}"
  curl -fsSL -o "$WORK/$archive" "$base/$archive"
  curl -fsSL -o "$WORK/checksums.txt" "$base/caddy_${CADDY_VERSION}_checksums.txt"
  (cd "$WORK" && grep " $archive\$" checksums.txt | sha512sum -c -)
  tar -xzf "$WORK/$archive" -C "$WORK" caddy
  CADDY="$WORK/caddy"
fi

# Samma rendering som Railpack gör av {{.DIST_DIR}}.
sed "s|{{.DIST_DIR}}|$DIST|g" Caddyfile > "$WORK/Caddyfile"
"$CADDY" validate --config "$WORK/Caddyfile" --adapter caddyfile

PORT="$PORT" "$CADDY" run --config "$WORK/Caddyfile" --adapter caddyfile > "$WORK/caddy.log" 2>&1 &
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
# Utanför /assets hade SPA-fallbacken svarat 200 med index.html; Caddyfilens .map-regel gäller alla sökvägar.
check "källkarta utanför /assets ger 404, inte index.html" "/foo.js.map"           404 "^cache-control: no-store" "content-type: text/html"
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

# Säkerhetshuvuden (RUN-344) ska finnas på ALLA svar, också 404, omdirigeringar och /health. security_headers prövar fem huvuden på ett svar och rapporterar vilka som saknas.
# HSTS är exakt ett år, utan includeSubDomains och utan preload (underdomänerna är inte inventerade, preload går inte att ångra snabbt).
security_headers() {
  local desc="$1" path="$2" headers missing=""
  shift 2
  headers="$(curl -s -o /dev/null -D - "$@" "http://127.0.0.1:$PORT$path" | tr -d '\r')"
  printf '%s\n' "$headers" | grep -qiE '^strict-transport-security: max-age=31536000$' || missing+=" Strict-Transport-Security(max-age=31536000, utan includeSubDomains/preload)"
  printf '%s\n' "$headers" | grep -qiE '^referrer-policy: strict-origin-when-cross-origin$' || missing+=" Referrer-Policy"
  printf '%s\n' "$headers" | grep -qiE '^x-frame-options: DENY$' || missing+=" X-Frame-Options"
  printf '%s\n' "$headers" | grep -qiE "^$CSP_HEADER: default-src 'self'; .*frame-ancestors 'none'\$" || missing+=" $CSP_HEADER"
  if printf '%s\n' "$headers" | grep -qiE "^$CSP_OTHER:"; then missing+=" (förbjuden $CSP_OTHER)"; fi
  if [[ -n "$missing" ]]; then
    echo "FAIL $desc: $path:$missing"; printf '%s\n' "$headers"; failures=$((failures + 1)); return
  fi
  echo "ok   $desc"
}
security_headers "säkerhetshuvuden på startsidan"                 "/"
security_headers "säkerhetshuvuden på en SPA-route"               "/titles"
security_headers "säkerhetshuvuden på en hashad fil"              "/$asset"
security_headers "säkerhetshuvuden på en saknad hashad fil (404)" "/assets/index-DOESNOTEXIST.js"
security_headers "säkerhetshuvuden på en källkarta (404)"         "/foo.js.map"
security_headers "säkerhetshuvuden på /health"                    "/health"
security_headers "säkerhetshuvuden på Strava-popupen"             "/strava-popup.html"
security_headers "säkerhetshuvuden på en omdirigering (307)"      "/landing.html"
security_headers "säkerhetshuvuden på apex-omdirigeringen (308)"  "/titles" -H "Host: runquest.dev"

# CSP-hasharna är fästa i Caddyfilen och måste stämma med det färdiga bygget: ett inline-skript vars hash ändrats blockeras tyst i webbläsaren.
# scripts/csp-hashes.mjs räknar hasharna ur dist/**/*.html och fäller också en hash som inget längre matchar, eller en policy som släppt på ett grunddirektiv.
if node scripts/csp-hashes.mjs "$DIST" Caddyfile; then :; else failures=$((failures + 1)); fi

# Umamis tracker (public/vendor, RUN-344) är en versionerad fil på eget ursprung: serveras som JS, cachas för alltid, saknad version ger 404 (aldrig index.html),
# och filen är oförändrad mot hashen i licensfilen bredvid.
check "Umami-trackern serveras som JS, cachad för alltid" "/vendor/umami.v1.js" 200 "^content-type: (text|application)/javascript" "content-type: text/html"
check "Umami-trackern är immutable"                       "/vendor/umami.v1.js" 200 "^cache-control: public, max-age=31536000, immutable"
check "saknad vendor-fil ger 404, aldrig index.html"      "/vendor/saknas.v1.js" 404 "^cache-control: no-store" "immutable|content-type: text/html"
umami_sha="$(sha256sum "$DIST/vendor/umami.v1.js" | awk '{print $1}')"
if grep -q "$umami_sha" "$DIST/vendor/umami.LICENSE.txt"; then
  echo "ok   Umami-trackern är oförändrad mot hashen i licensfilen"
else
  echo "FAIL Umami-trackern ($umami_sha) stämmer inte med hashen i umami.LICENSE.txt: byt namn (.v2) och uppdatera licensfilen om filen medvetet bytts"; failures=$((failures + 1))
fi

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

# Fel som file_server själv svarar med (405 på POST/OPTIONS) rensade huvudena tills Caddyfilen fick handle_errors med samma snippet. Statusen prövas också, så att provet visar att felet verkligen uppstod.
check_with "POST / ger 405 med Allow, utan Server-header"      "/" 405 "^allow: GET, HEAD" "^server:" -X POST
security_headers "säkerhetshuvuden på ett 405-svar (POST /)"   "/" -X POST
check_with "OPTIONS / ger 405, utan Server-header"            "/" 405 "^allow: GET, HEAD" "^server:" -X OPTIONS
security_headers "säkerhetshuvuden på ett 405-svar (OPTIONS /)" "/" -X OPTIONS
# En felformad adress (/%zz) avvisas av Go:s http-server innan Caddy hunnit läsa den: 400 med fast kropp, och Caddyfilen kan inte sätta huvuden på det svaret (inga säkerhetshuvuden är möjliga
# här; det är ett protokollfel utan innehåll att skydda). Provet låser det som går: statusen och att ingen Server-header avslöjar programvaran.
check_with "felformad adress (/%zz) ger 400, utan Server-header" "/%zz" 400 "" "^server:" --path-as-is

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

# Källkartor som FINNS på disk (RUN-285). Det riktiga dist saknar .map, så kontrollerna ovan visar bara att en saknad fil ger 404. Här planteras riktiga
# .map-filer i en kopia av dist (assets/, media/, fonts/ och roten) och en egen Caddy-instans serverar kopian: Caddyfile-adaptern sorterar handle-block
# efter path-matcherns längd, och en .map-regel som hamnat efter /assets/*, /media/* eller /fonts/* serverar då kartan (200 + immutable).
# Varje katalog får också en vanlig fil som kontroll: den ska serveras (200), annars bevisar ett 404 inget om regeln. Det riktiga dist rörs inte.
PLANT="$WORK/dist-with-maps"
PLANT_PORT="18081"
cp -R "$DIST" "$PLANT"
for dir in assets media fonts .; do
  mkdir -p "$PLANT/$dir"
  printf '{"version":3,"sources":[],"mappings":""}' > "$PLANT/$dir/planted.js.map"
  printf 'planted' > "$PLANT/$dir/planted.txt"
done
sed "s|{{.DIST_DIR}}|$(native_path "$PLANT")|g" Caddyfile > "$WORK/Caddyfile.planted"
"$CADDY" validate --config "$WORK/Caddyfile.planted" --adapter caddyfile
PORT="$PLANT_PORT" "$CADDY" run --config "$WORK/Caddyfile.planted" --adapter caddyfile > "$WORK/caddy-planted.log" 2>&1 &
PLANT_PID=$!
trap 'kill "$CADDY_PID" "$PLANT_PID" 2>/dev/null || true' EXIT
up=0
for _ in $(seq 1 50); do
  if curl -fs "http://127.0.0.1:$PLANT_PORT/health" > /dev/null; then up=1; break; fi
  sleep 0.2
done
if (( up == 0 )); then
  echo "FAIL Caddy med planterade kartor svarade aldrig på /health"; tail -40 "$WORK/caddy-planted.log"; exit 1
fi
MAIN_PORT="$PORT"
PORT="$PLANT_PORT"
for dir in assets media fonts; do
  check "kontroll: vanlig fil i /$dir serveras"          "/$dir/planted.txt"    200 "^cache-control: public, max-age=31536000, immutable"
  check "planterad källkarta i /$dir ger 404, no-store"  "/$dir/planted.js.map" 404 "^cache-control: no-store" "immutable|content-type: (text|application)/(json|javascript)"
done
check "kontroll: vanlig fil i roten serveras"            "/planted.txt"         200 "^cache-control: no-cache"
check "planterad källkarta i roten ger 404, no-store"    "/planted.js.map"      404 "^cache-control: no-store" "content-type: text/html"
PORT="$MAIN_PORT"

# Förrenderad landning på exakt / (RUN-260, ADR 006 addendum 2026-10-19 punkt 3 och 11). `/` ger landing.html, alla andra adresser index.html vars #root bara har
# laddningsvyn, och ett bygge utan landing.html faller tillbaka på index.html i stället för 404. body_check läser kroppen (curl -s), same_body jämför två svar.
body_check() {
  local desc="$1" path="$2" want_pattern="$3" reject_pattern="${4:-}" body
  body="$(curl -s --path-as-is "http://127.0.0.1:$PORT$path")"
  if ! printf '%s' "$body" | grep -qE "$want_pattern"; then
    echo "FAIL $desc: $path saknar /$want_pattern/ i kroppen"; failures=$((failures + 1)); return
  fi
  if [[ -n "$reject_pattern" ]] && printf '%s' "$body" | grep -qE "$reject_pattern"; then
    echo "FAIL $desc: $path har förbjuden /$reject_pattern/ i kroppen"; failures=$((failures + 1)); return
  fi
  echo "ok   $desc"
}
same_body() {
  local desc="$1" path_a="$2" path_b="$3" sum_a sum_b
  sum_a="$(curl -s "http://127.0.0.1:$PORT$path_a" | sha256sum)"
  sum_b="$(curl -s "http://127.0.0.1:$PORT$path_b" | sha256sum)"
  if [[ "$sum_a" != "$sum_b" ]]; then echo "FAIL $desc: $path_a och $path_b gav olika kroppar"; failures=$((failures + 1)); return; fi
  echo "ok   $desc"
}
LOADER_ONLY='<div id="root"><div class="rq-shell__pending"><div role="status"'
LANDING_MARKUP='landing-title|rq-landing'

check "roten är HTML, no-cache"                           "/"                     200 "^content-type: text/html" "immutable"
body_check "roten är den förrenderade landningen"          "/"                     "landing-title" '<div id="root"></div>'
body_check "/?tab=titles ger landningen"                 "/?tab=titles"          "landing-title"
same_body "/?tab=titles ger samma fil som /"               "/"                     "/?tab=titles"
body_check "/?utm_source=x ger landningen"               "/?utm_source=x"        "landing-title"
same_body "/?utm_source=x ger samma fil som /"             "/"                     "/?utm_source=x"
check "/?utm_source=x är HTML, no-cache"                  "/?utm_source=x"        200 "^cache-control: no-cache"
for spa in /titles /login /runner/x /board /legal; do
  body_check "$spa ger index.html med bara laddningsvyn i #root" "$spa" "$LOADER_ONLY" "$LANDING_MARKUP"
done
# Bara den råa sökvägen / är landningen. Caddys path-matchare slår ihop snedstreck och rensar punktsegment, så "path /" gav landing.html också på //, ///, /./ och /%2f;
# där kastar lean routern (en tom värd i new URL) och sidan blir vit. De ska få index.html med bara laddningsvyn, som före S6. --path-as-is hindrar curl från att städa adressen.
for odd in // /// /./ /%2f /%2F//; do
  body_check "$odd ger index.html med bara laddningsvyn, inte landningen" "$odd" "$LOADER_ONLY" "$LANDING_MARKUP"
done
# /landing.html och /landing löses av SPA-blockets try_files till samma fil. De omdirigeras till / (frågan följer med) i stället för att ge en andra adress till landningen.
host_check "/landing.html omdirigeras till /"              "www.runquest.dev"      "/landing.html"           307 "/"
host_check "/landing omdirigeras till /"                   "www.runquest.dev"      "/landing"                307 "/"
host_check "/landing.html behåller frågan i omdirigeringen" "www.runquest.dev"     "/landing.html?utm_source=x" 307 "/?utm_source=x"

# Ett bygge utan landing.html: / faller tillbaka på index.html (200, laddningsvyn), aldrig 404, och omdirigeringarna är kvar. Egen kopia av dist, egen Caddy.
BARE="$WORK/dist-without-landing"
BARE_PORT="18082"
cp -R "$DIST" "$BARE"
rm "$BARE/landing.html"
sed "s|{{.DIST_DIR}}|$(native_path "$BARE")|g" Caddyfile > "$WORK/Caddyfile.bare"
"$CADDY" validate --config "$WORK/Caddyfile.bare" --adapter caddyfile
PORT="$BARE_PORT" "$CADDY" run --config "$WORK/Caddyfile.bare" --adapter caddyfile > "$WORK/caddy-bare.log" 2>&1 &
BARE_PID=$!
trap 'kill "$CADDY_PID" "$PLANT_PID" "$BARE_PID" 2>/dev/null || true' EXIT
up=0
for _ in $(seq 1 50); do
  if curl -fs "http://127.0.0.1:$BARE_PORT/health" > /dev/null; then up=1; break; fi
  sleep 0.2
done
if (( up == 0 )); then
  echo "FAIL Caddy utan landing.html svarade aldrig på /health"; tail -40 "$WORK/caddy-bare.log"; exit 1
fi
PORT="$BARE_PORT"
check "utan landing.html ger / index.html, inte 404"       "/"                     200 "^cache-control: no-cache"
body_check "utan landing.html har / bara laddningsvyn"      "/"                     "$LOADER_ONLY" "$LANDING_MARKUP"
body_check "utan landing.html har /?utm_source=x bara laddningsvyn" "/?utm_source=x" "$LOADER_ONLY" "$LANDING_MARKUP"
PORT="$MAIN_PORT"

if (( failures > 0 )); then
  echo "--- caddy-logg ---"; tail -20 "$WORK/caddy.log"; tail -20 "$WORK/caddy-planted.log"; tail -20 "$WORK/caddy-bare.log"
  exit 1
fi
echo "Statisk servering: alla kontroller gröna."
