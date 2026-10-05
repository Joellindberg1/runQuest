import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ADMIN_SETTINGS, DEFAULT_STREAK_MULTIPLIERS } from '@runquest/shared';
import { MIN_RUN_DISTANCE_KM } from '@/constants/appConstants';
import { HOW_IT_WORKS, observedStakes } from '@/features/challenges/rulesModel';
import type { XpRules } from '@/features/log/xpPreviewModel';
import { EVENT_FACTS, STRAVA_SYNC_MINUTES, WEEKLY_COMPETITIONS, WEEKLY_XP } from './playbookFacts';
import { buildChapters, type ChapterId } from './playbookModel';

// Playbook får bara påstå det koden gör. Faktapunkterna som går att låsa mot backendens källfiler (och frontendens egna
// konstanter) låses här: ändras backend faller testet och texten måste följa med.

// resolve() i stället för new URL(`…${x}`, import.meta.url): Vite tolkar det mönstret som en dynamisk asset-import.
// CRLF i arbetskopian normaliseras så att flerradiga mönster träffar.
const backend = (path: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../backend', path), 'utf8').replace(/\r\n/g, '\n');

const RULES: XpRules = { settings: DEFAULT_ADMIN_SETTINGS, streak_multipliers: DEFAULT_STREAK_MULTIPLIERS };
const chapters = buildChapters(RULES, undefined, observedStakes([]));
const text = (id: ChapterId): string => {
  const chapter = chapters.find((candidate) => candidate.id === id);
  if (!chapter) throw new Error(id);
  return [chapter.lead, ...chapter.paras, ...(chapter.table?.rows.flatMap((row) => [row.label, row.note ?? '', row.value]) ?? [])].join('\n');
};

describe('Run — minimidistans (routes/runs.ts, routes/strava.ts)', () => {
  it('manuella rundor kräver minst 1,0 km i backend och i appens konstant; Strava-rundor har ingen distansgräns utöver > 0', () => {
    expect(backend('src/routes/runs.ts')).toMatch(/distanceNum < 1\.0\b[\s\S]{0,80}Distance must be at least 1\.0 km/);
    expect(MIN_RUN_DISTANCE_KM).toBe(1);
    const strava = backend('src/routes/strava.ts');
    // Importen filtrerar på sport och dubbletter — inte på distans…
    expect(strava).toMatch(/const runningActivities = activities\.filter\(\(activity: any\) =>\s*isRunningActivity\(activity\) &&\s*!existingIds\.has/);
    // …men en aktivitet med distans 0 sparas inte.
    expect(strava).toContain('runningActivities.filter((a: any) => a.distance / 1000 > 0)');
  });

  it('texten säger det som det är och påstår inget om "qualifying run" för streaken', () => {
    expect(text('run')).toContain('Manual runs need at least 1.0 km; runs synced from Strava count at any distance above zero.');
    expect(text('streaks')).not.toMatch(/qualif/i);
  });

  it('Strava-importen: intervallet är konstanten SYNC_INTERVAL_MINUTES, löpning = Run, TrailRun, VirtualRun, och synken räknar från senast importerade rundan', () => {
    const sync = backend('src/scheduler/stravaSync.ts');
    expect(Number(/^const SYNC_INTERVAL_MINUTES = (\d+);/m.exec(sync)?.[1])).toBe(STRAVA_SYNC_MINUTES);
    expect(sync).toContain('cron.schedule(`*/${SYNC_INTERVAL_MINUTES} * * * *`');
    const strava = backend('src/routes/strava.ts');
    expect(strava).toContain("new Set(['Run', 'TrailRun', 'VirtualRun'])");
    expect(strava).toMatch(/Find the most recent imported run date[\s\S]{0,500}sevenDaysBeforeMostRecent\.setDate\(sevenDaysBeforeMostRecent\.getDate\(\) - 7\)/);
    expect(text('run')).toContain(`every ${STRAVA_SYNC_MINUTES} minutes`);
    expect(text('run')).toMatch(/Run, Trail Run and Virtual Run/);
    expect(text('run')).toMatch(/a week before your most recent Strava-imported run/);
  });

  it('basen betalas från konfigurationens min_run_distance (calculateRunXP), inte från 1 km', () => {
    expect(text('xp')).toContain('The base is paid from 1.0 km.');
  });
});

describe('Challenges — token lottas vid nivåuppgång, inte vid sändning', () => {
  it('backend lottar tier-mått, längd och insats när token delas ut', () => {
    const service = backend('src/services/challengeService.ts');
    expect(service).toMatch(/level_challenge_rewards/);
    expect(service).toMatch(/const metric = pick\(metrics\);\s*const duration = pick\(durations\);\s*const reward = pick\(challengeRewards\);/);
  });

  it('vid sändning väljs bara token och motståndare (token_id + opponent_id) — inget lottas', () => {
    const route = backend('src/routes/challenges.ts');
    expect(route).toMatch(/const \{ token_id, opponent_id \} = req\.body/);
    const send = route.slice(route.indexOf("router.post('/send'"), route.indexOf("router.post('/send'") + 6000);
    expect(send).not.toMatch(/Math\.random/);
    expect(send).toMatch(/metric: token\.metric,\s*duration_days: token\.duration_days/);
  });

  it('kapitlet återger Rules-vyns formulering och säger aldrig att man väljer nivå, mått eller längd', () => {
    const challenges = text('challenges');
    expect(challenges).toContain(HOW_IT_WORKS.find((item) => item.title === 'One token, one duel')?.body);
    expect(challenges).toMatch(/drawn when you earn it/);
    expect(challenges).toMatch(/choosing one of your tokens and an opponent/);
    expect(challenges).not.toMatch(/you (pick|choose|select) the (tier|metric|length|duration)/i);
    expect(challenges).not.toMatch(/drawn at random for that tier|random(ised|ized)? (when|at) (you )?send/i);
  });

  it('insatserna är de observerade (som Rules-vyn): ett verkligt exempel slår seed-värdet', () => {
    const observed = observedStakes([{ tier: 'minor', winner_delta: 0.3, winner_duration: 3, loser_delta: -0.1, loser_duration: 3, winner_type: 'multiplier_days', loser_type: 'multiplier_days' }]);
    const rows = buildChapters(RULES, undefined, observed).find((chapter) => chapter.id === 'challenges')?.table?.rows ?? [];
    expect(rows[0]).toMatchObject({ label: 'Minor · win', value: '+0.3× / 3 d' });
    expect(rows[2]).toMatchObject({ label: 'Major · win', value: '+0.25× / 10 d' }); // inget exempel → seed
  });
});

describe('Events — mot migrationerna, eventService och schemat', () => {
  const m017 = backend('migrations/017_seed_event_templates.sql');
  const m022 = backend('migrations/022_add_time_window_to_event_templates.sql');
  const m024 = backend('migrations/024_add_half_marathon_chaser.sql');
  const m028 = backend('migrations/028_add_end_day_offset_to_event_templates.sql');
  const service = backend('src/services/eventService.ts');
  const scheduler = backend('src/scheduler/eventScheduler.ts');

  // Prod-namnen är engelska (025/029 seedar dem); 017/022 skrevs med de gamla svenska namnen, som siffrorna nedan slås upp med.
  const LEGACY_NAME: Record<string, string> = { 'Morning run': 'Morgonrunda', 'Evening run': 'Kvällsrunda' };
  const legacy = (name: string) => LEGACY_NAME[name] ?? name;
  const m025 = backend('migrations/025_create_event_pools.sql');
  const m029 = backend('migrations/029_add_weekly_competition_pool.sql');

  it('namnen och poolerna är prods (025, 029): daily = Morning run / Evening run / Storm Chaser, thursday = 5K Friday / Half Marathon Chaser, weekend = Hangover Run', () => {
    const { morning, evening, storm, fiveKFriday, halfMarathon, hangover } = EVENT_FACTS;
    expect(m025).toContain(`t.name IN ('${morning.name}', '${evening.name}')`);
    expect(m025).toContain(`p.name = 'daily' AND t.name = '${storm.name}'`);
    expect(m025).toContain(`t.name IN ('${fiveKFriday.name}', '${halfMarathon.name}')`);
    expect(m025).toContain(`p.name = 'weekend' AND t.name = '${hangover.name}'`);
    expect(m029).toContain(`t.name IN ('${WEEKLY_COMPETITIONS.join("', '")}')`);
    expect(Object.values(EVENT_FACTS).map((fact) => fact.name)).toEqual(['Morning run', 'Evening run', '5K Friday', 'Half Marathon Chaser', 'Hangover Run', 'Storm Chaser']);
  });

  it('min km och XP per deltagarevent (migration 017, 024)', () => {
    const seeded = (name: string) => new RegExp(`\\('${legacy(name)}', 'participation'[\\s\\S]*?\\n\\s+(\\d+), (\\d+)(?:, \\d+)?(?:, ARRAY|\\);)`).exec(m017);
    const pairs = (name: string): [number, number] | null => {
      const hit = seeded(name);
      return hit ? [Number(hit[1]), Number(hit[2])] : null;
    };
    for (const fact of [EVENT_FACTS.morning, EVENT_FACTS.evening, EVENT_FACTS.fiveKFriday, EVENT_FACTS.hangover, EVENT_FACTS.storm]) {
      expect({ name: fact.name, pair: pairs(fact.name) }).toEqual({ name: fact.name, pair: [fact.minKm, fact.xp] });
    }
    expect(m024).toMatch(/'Half Marathon Chaser'[\s\S]*?\n\s+10, 25, 0\.15/);
    expect([EVENT_FACTS.halfMarathon.minKm, EVENT_FACTS.halfMarathon.xp]).toEqual([10, 25]);
  });

  it('fönstren: Morning run 05–09, Evening run 18–22 (migration 022); Half Marathon Chaser fredag–söndag (024 + 028)', () => {
    expect(m022).toContain(`start_hour = ${EVENT_FACTS.morning.from},  end_hour = ${EVENT_FACTS.morning.to},  end_minute = 0  WHERE name = '${legacy(EVENT_FACTS.morning.name)}'`);
    expect(m022).toContain(`start_hour = ${EVENT_FACTS.evening.from}, end_hour = ${EVENT_FACTS.evening.to}, end_minute = 0  WHERE name = '${legacy(EVENT_FACTS.evening.name)}'`);
    expect(m028).toContain("end_day_offset = 2 WHERE name = 'Half Marathon Chaser'");
    expect(m024).toMatch(/Friday, Saturday or Sunday/);
  });

  it('Storm Chaser: ≥ 3 stormtimmar dagtid (06–21) ELLER ≥ 4 timmar med byar ≥ 15 — i km/h, för Open-Meteo-anropet saknar wind_speed_unit (eventService)', () => {
    const { stormHours, gustHours, gustKmh, dayFrom, dayTo } = EVENT_FACTS.storm;
    // Enheten avgör texten: utan wind_speed_unit levererar Open-Meteo km/h. Läggs parametern till blir tröskeln en annan — då ska det här testet falla.
    const fetchUrl = /const url =([\s\S]*?);\s*\n\s*const res = await fetch\(url/.exec(service)?.[1] ?? '';
    expect(fetchUrl).toContain('wind_gusts_10m');
    expect(fetchUrl).not.toMatch(/wind_speed_unit/);
    expect(service).toContain(`if (hour < ${dayFrom} || hour > ${dayTo}) continue;`);
    expect(service).toContain(`(gusts[i] ?? 0) >= ${gustKmh}`);
    expect(service).toContain(`const qualifies = stormyHours >= ${stormHours} || gustyHours >= ${gustHours};`);
  });

  it('kvalificering: bara redigering (PUT) kräver att rundans datum ligger inom eventets dagar — POST och Strava-importen gör det inte', () => {
    const runs = backend('src/routes/runs.ts');
    const put = runs.slice(runs.indexOf("router.put('/:id'"), runs.indexOf("router.delete('/:id'"));
    const post = runs.slice(runs.indexOf("router.post('/'"), runs.indexOf("router.put('/:id'"));
    expect(put).toContain('enforceRunDateWindow: true');
    expect(post).not.toContain('enforceRunDateWindow');
    expect(backend('src/routes/strava.ts')).not.toContain('enforceRunDateWindow');
    // Utan flaggan räcker det att eventet startat och att rundans datum inte ligger efter slutet.
    expect(service).toMatch(/\.lte\('starts_at', now\)\s*\.gte\('ends_at', `\$\{params\.runDate\}T00:00:00Z`\)/);
    expect(service).toMatch(/if \(params\.enforceRunDateWindow\) \{/);
  });

  it('daglig dragning 19:00, veckotävlingen avgörs måndag 00:05, båda veckotävlingarna ger 40/30/20 XP (scheduler, migration 017)', () => {
    expect(scheduler).toContain("cron.schedule('0 19 * * *'");
    expect(scheduler).toContain("cron.schedule('5 0 * * 1'");
    const prizes = WEEKLY_XP.join(', ');
    expect(m017).toContain(`'km', 7, ${prizes}`); // Weekly km
    expect(m017).toContain(`'elevation', 7, ${prizes}`); // Weekly elevation (hette "höjdmeter" när den seedades)
  });

  it('texten bär faktapunkterna', () => {
    const events = text('events');
    expect(events).toContain('Morning run');
    expect(events).toContain('Evening run');
    expect(events).not.toMatch(/Morgonrunda|Kvällsrunda/);
    expect(events).toContain('05:00–09:00');
    expect(events).toContain('18:00–22:00');
    expect(events).toContain('Half Marathon Chaser');
    expect(events).toMatch(/at least 3 hours of drizzle, rain, snow, showers or thunder, or at least 4 hours of gusts of 15 km\/h or more/);
    expect(events).not.toMatch(/m\/s/);
    expect(events).toContain('06:00–21:00');
    expect(events).toMatch(/log or sync a run while the event is open/);
    expect(events).toContain('the run’s date can’t be after the event ends');
    expect(events).not.toMatch(/fall within the event/);
    expect(events).not.toMatch(/finish a run inside the window/);
    expect(events).toMatch(/settled just after midnight on Monday/);
    expect(events).toContain('40 / 30 / 20 XP');
    expect(events).toMatch(/weekly km or elevation competition/);
  });

  it('utmaningstexten: token vid många nivåuppgångar, vid nivå 16+ varje (seed 006) — inte "minor at most level-ups"', () => {
    const seed = backend('migrations/006_seed_challenge_data.sql');
    const levels = [...seed.matchAll(/^\s*\((\d+),\s*'(?:minor|major|legendary)'\)/gm)].map((m) => Number(m[1]));
    for (const none of [2, 4, 6, 7, 9, 11, 13]) expect(levels).not.toContain(none);
    for (let level = 16; level <= 47; level++) expect(levels).toContain(level);
    const challenges = text('challenges');
    expect(challenges).toMatch(/many level-ups at first and, from level 16, at every level-up/);
    expect(challenges).not.toMatch(/at most level-ups/);
  });
});
