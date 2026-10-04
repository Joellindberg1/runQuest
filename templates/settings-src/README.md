# Modulära permission-källor (beslut 13)

Varje fil här är SANNINGEN för sin kategori — Claude Code läser dem inte
direkt. `node merge-settings.mjs` genererar `.claude/settings.json` (den
tekniska spärren) från alla aktiva källfiler. Av/på för en hel kategori =
flytta filen till `disabled/` och regenerera. Redigera ALDRIG genererade
settings.json för hand. Spegling av agent-approval-policy.json: policyn är den
mänskligt läsbara sanningen om avsikt, källfilerna här är samma regler i
Claude Codes permission-syntax.
