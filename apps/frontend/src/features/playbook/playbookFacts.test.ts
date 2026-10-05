import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ADMIN_SETTINGS, DEFAULT_STREAK_MULTIPLIERS } from '@runquest/shared';
import { MIN_RUN_DISTANCE_KM } from '@/constants/appConstants';
import { HOW_IT_WORKS, observedStakes } from '@/features/challenges/rulesModel';
import type { XpRules } from '@/features/log/xpPreviewModel';
import { EVENT_FACTS, WEEKLY_XP } from './playbookFacts';
import { buildChapters, type ChapterId } from './playbookModel';

// Playbook får bara påstå det koden gör. Faktapunkterna som går att låsa mot backendens källfiler (och frontendens egna
// konstanter) låses här: ändras backend faller testet och texten måste följa med.

// resolve() i stället för new URL(`…${x}`, import.meta.url): Vite tolkar det mönstret som en dynamisk asset-import.
const backend = (path: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../backend', path), 'utf8');

const RULES: XpRules = { settings: DEFAULT_ADMIN_SETTINGS, streak_multipliers: DEFAULT_STREAK_MULTIPLIERS };
const chapters = buildChapters(RULES, undefined, observedStakes([]));
const text = (id: ChapterId): string => {
  const chapter = chapters.find((candidate) => candidate.id === id);
  if (!chapter) throw new Error(id);
  return [chapter.lead, ...chapter.paras, ...(chapter.table?.rows.flatMap((row) => [row.label, row.note ?? '', row.value]) ?? [])].join('\n');
};

describe('Run — minimidistans (routes/runs.ts, routes/strava.ts)', () => {
  it('manuella rundor kräver minst 1,0 km i backend och i appens konstant; Strava-rundor har ingen distansgräns', () => {
    expect(backend('src/routes/runs.ts')).toMatch(/distanceNum < 1\.0\b[\s\S]{0,80}Distance must be at least 1\.0 km/);
    expect(MIN_RUN_DISTANCE_KM).toBe(1);
    // Strava-importen filtrerar på sport och dubbletter — inte på distans.
    expect(backend('src/routes/strava.ts')).toMatch(/const runningActivities = activities\.filter\(\(activity: any\) =>\s*isRunningActivity\(activity\) &&\s*!existingIds\.has/);
  });

  it('texten säger det som det är och påstår inget om "qualifying run" för streaken', () => {
    expect(text('run')).toContain('Manual runs need at least 1.0 km; runs synced from Strava count at any distance.');
    expect(text('streaks')).not.toMatch(/qualif/i);
  });

  it('Strava-importen: var 30:e minut och löpning = Run, TrailRun, VirtualRun', () => {
    expect(backend('src/scheduler/stravaSync.ts')).toMatch(/Run every 30 minutes/);
    expect(backend('src/routes/strava.ts')).toContain("new Set(['Run', 'TrailRun', 'VirtualRun'])");
    expect(text('run')).toMatch(/every 30 minutes/);
    expect(text('run')).toMatch(/Run, Trail Run and Virtual Run/);
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

  it('min km och XP per deltagarevent (migration 017, 024)', () => {
    const seeded = (name: string) => new RegExp(`\\('${name}', 'participation'[\\s\\S]*?\\n\\s+(\\d+), (\\d+)(?:, \\d+)?(?:, ARRAY|\\);)`).exec(m017);
    const pairs = (name: string): [number, number] | null => {
      const hit = seeded(name);
      return hit ? [Number(hit[1]), Number(hit[2])] : null;
    };
    expect(pairs('Morgonrunda')).toEqual([EVENT_FACTS.morning.minKm, EVENT_FACTS.morning.xp]);
    expect(pairs('Kvällsrunda')).toEqual([EVENT_FACTS.evening.minKm, EVENT_FACTS.evening.xp]);
    expect(pairs('5K Friday')).toEqual([EVENT_FACTS.fiveKFriday.minKm, EVENT_FACTS.fiveKFriday.xp]);
    expect(pairs('Hangover Run')).toEqual([EVENT_FACTS.hangover.minKm, EVENT_FACTS.hangover.xp]);
    expect(pairs('Storm Chaser')).toEqual([EVENT_FACTS.storm.minKm, EVENT_FACTS.storm.xp]);
    expect(m024).toMatch(/'Half Marathon Chaser'[\s\S]*?\n\s+10, 25, 0\.15/);
    expect([EVENT_FACTS.halfMarathon.minKm, EVENT_FACTS.halfMarathon.xp]).toEqual([10, 25]);
  });

  it('fönstren: Morgonrunda 05–09, Kvällsrunda 18–22 (migration 022); Half Marathon Chaser fredag–söndag (024 + 028)', () => {
    expect(m022).toContain(`start_hour = ${EVENT_FACTS.morning.from},  end_hour = ${EVENT_FACTS.morning.to},  end_minute = 0  WHERE name = 'Morgonrunda'`);
    expect(m022).toContain(`start_hour = ${EVENT_FACTS.evening.from}, end_hour = ${EVENT_FACTS.evening.to}, end_minute = 0  WHERE name = 'Kvällsrunda'`);
    expect(m028).toContain("end_day_offset = 2 WHERE name = 'Half Marathon Chaser'");
    expect(m024).toMatch(/Friday, Saturday or Sunday/);
  });

  it('Storm Chaser: ≥ 3 stormtimmar dagtid (06–21) ELLER ≥ 4 timmar med byar ≥ 15 m/s (eventService)', () => {
    const { stormHours, gustHours, gustMs, dayFrom, dayTo } = EVENT_FACTS.storm;
    expect(service).toContain(`if (hour < ${dayFrom} || hour > ${dayTo}) continue;`);
    expect(service).toContain(`(gusts[i] ?? 0) >= ${gustMs}`);
    expect(service).toContain(`const qualifies = stormyHours >= ${stormHours} || gustyHours >= ${gustHours};`);
  });

  it('daglig dragning 19:00, veckotävlingen avgörs måndag 00:05, 40/30/20 XP (scheduler, migration 017)', () => {
    expect(scheduler).toContain("cron.schedule('0 19 * * *'");
    expect(scheduler).toContain("cron.schedule('5 0 * * 1'");
    expect(m017).toContain(`'km', 7, ${WEEKLY_XP.join(', ')}`);
  });

  it('texten bär faktapunkterna', () => {
    const events = text('events');
    expect(events).toContain('05:00–09:00');
    expect(events).toContain('18:00–22:00');
    expect(events).toContain('Half Marathon Chaser');
    expect(events).toMatch(/at least 3 hours of rain, snow or thunder, or at least 4 hours of gusts of 15 m\/s or more/);
    expect(events).toContain('06:00–21:00');
    expect(events).toMatch(/settled just after midnight on Monday/);
    expect(events).toContain('40 / 30 / 20 XP');
    expect(events).not.toMatch(/12 m\/s|06:00–10:00/);
  });
});
