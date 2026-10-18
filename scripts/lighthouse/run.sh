#!/usr/bin/env bash
# Lighthouse CI för de publika sidorna (RUN-259): serverar det byggda apps/frontend/dist med samma Caddy och Caddyfile som
# scripts/verify-static-serving.sh, mäter / och /legal (mobilprofil, 3 körningar) och prövar budgeten i lighthouserc.json.
# Inget når internet: allt går mot 127.0.0.1, ingen Railway, ingen prod, ingen extern lagring.
# Körs från repo-roten efter frontend-bygget. Budgeten och hur den ändras: docs/release.md ("Lighthouse-budget").
#
# Miljövariabler (alla valfria):
#   STATS_MODE   "error" (standard: inget lyssnar på API-porten, /api/public/stats ger anslutningsfel) eller "mock" (falskt API med tre tal).
#                Sidan ska klara båda; budgeten är densamma.
#   DIST_DIR     katalogen som serveras (standard apps/frontend/dist). Används för att prova en planterad regression i en kopia.
#   CADDY_BIN    sökväg till en redan hämtad Caddy (CI hämtar den i ett eget steg med install-caddy.sh); saknas den hämtas den här.
#   CHROME_PATH  webbläsaren som Lighthouse startar (standard: den som chrome-launcher hittar).
# Rapporterna (JSON + HTML per körning) skriver lhci i .lighthouseci i repo-roten (kan inte ändras); skriptet kopierar dem till
# lighthouse-reports/<STATS_MODE>/ så att de två lägena kan köras efter varandra och laddas upp tillsammans.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATS_MODE="${STATS_MODE:-error}"
DIST_DIR="${DIST_DIR:-apps/frontend/dist}"
OUT_DIR=".lighthouseci"
PORT="18090" # samma port som urlerna i lighthouserc.json
API_PORT="3001"
WORK="$(mktemp -d)"
LHCI="$HERE/node_modules/.bin/lhci"

if [[ ! -x "$LHCI" ]]; then echo "FAIL lhci saknas: kör npm ci i scripts/lighthouse"; exit 1; fi
if [[ ! -f "$DIST_DIR/index.html" ]]; then echo "FAIL $DIST_DIR/index.html saknas: bygg frontend först"; exit 1; fi
case "$STATS_MODE" in error|mock) ;; *) echo "FAIL STATS_MODE ska vara error eller mock, inte '$STATS_MODE'"; exit 1 ;; esac

# Frontend-bygget pekar på http://localhost:3001/api när VITE_API_URL saknas. Något som redan svarar där är ett riktigt backend, inte
# vårt falska: i läget "error" avbryter vi hellre än att mäta mot det (och i "mock" kan porten inte bindas).
if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$API_PORT/"; then
  echo "FAIL något svarar redan på port $API_PORT; stoppa det innan Lighthouse körs"; exit 1
fi

# Windows (Git Bash): Caddy och Chrome vill ha C:/-sökvägar.
DIST="$(cd "$DIST_DIR" && (pwd -W 2>/dev/null || pwd))"

if [[ -n "${CADDY_BIN:-}" ]]; then
  CADDY="$CADDY_BIN"
else
  CADDY="$(bash "$HERE/install-caddy.sh" "$WORK/caddy-install" | tail -n 1)"
fi

sed "s|{{.DIST_DIR}}|$DIST|g" Caddyfile > "$WORK/Caddyfile"
"$CADDY" validate --config "$WORK/Caddyfile" --adapter caddyfile

rm -rf "$OUT_DIR"
PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  # Rapporterna sparas per läge (CI laddar upp lighthouse-reports/ som artefakt), också när budgeten fälldes.
  if [[ -d "$OUT_DIR" ]]; then mkdir -p "lighthouse-reports" && rm -rf "lighthouse-reports/$STATS_MODE" && cp -R "$OUT_DIR" "lighthouse-reports/$STATS_MODE"; fi
}
trap cleanup EXIT

PORT="$PORT" "$CADDY" run --config "$WORK/Caddyfile" --adapter caddyfile > "$WORK/caddy.log" 2>&1 &
PIDS+=("$!")

if [[ "$STATS_MODE" == "mock" ]]; then
  node "$HERE/mock-api.mjs" "$API_PORT" > "$WORK/mock-api.log" 2>&1 &
  PIDS+=("$!")
fi

up=0
for _ in $(seq 1 50); do
  if curl -fs "http://127.0.0.1:$PORT/health" > /dev/null; then up=1; break; fi
  sleep 0.2
done
if (( up == 0 )); then echo "FAIL Caddy svarade aldrig på /health"; tail -40 "$WORK/caddy.log"; exit 1; fi
if [[ "$STATS_MODE" == "mock" ]]; then
  curl -fs "http://127.0.0.1:$API_PORT/api/public/stats" > /dev/null || { echo "FAIL det falska API:et svarade aldrig"; cat "$WORK/mock-api.log"; exit 1; }
fi

echo "Lighthouse mot $DIST (STATS_MODE=$STATS_MODE, Caddy på 127.0.0.1:$PORT)"
"$LHCI" collect --config "$HERE/lighthouserc.json"
node "$HERE/summarize.mjs" "$OUT_DIR"

# assert avslutar med fel om en budgetrad inte hålls; cleanup stoppar servrarna oavsett.
"$LHCI" assert --config "$HERE/lighthouserc.json"
echo "Lighthouse: budgeten hålls."
