// Genererar .claude/settings.json från källfilerna i denna mapp (beslut 13).
// Kör: node merge-settings.mjs  (från templates/settings-src/ i repot)
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
const out = { permissions: { allow: [], ask: [], deny: [] }, env: {} };
for (const f of readdirSync(".").filter(f => f.endsWith(".json"))) {
  const src = JSON.parse(readFileSync(f, "utf8"));
  for (const key of ["allow", "ask", "deny"]) out.permissions[key].push(...(src[key] ?? []));
  Object.assign(out.env, src.env ?? {});
}
for (const key of ["allow", "ask", "deny"]) out.permissions[key] = [...new Set(out.permissions[key])];
mkdirSync("../../.claude", { recursive: true });
writeFileSync("../../.claude/settings.json", JSON.stringify(out, null, 2) + "\n");
console.log("Genererade .claude/settings.json —", out.permissions.allow.length, "allow,", out.permissions.ask.length, "ask,", out.permissions.deny.length, "deny");
