/* RunQuest shared badge source: tiers, series, emblem builder. Single definition for every DC.
   Load after runquest-icons.js: <script src="./runquest-badges.js"></script>
   Use: const B = window.RQBadges(React, cfg?); cfg = { heroicAmber, legendaryOrange, breathe } */
window.RQBadges = function (React, cfg) {
  cfg = cfg || {};
  const rq = window.RQIcons(React);
  const CREST = 'polygon(50% 0%, 100% 14%, 100% 60%, 50% 100%, 0% 60%, 0% 14%)';
  const mk = (name, c, grad) => ({ name: name, c: c, grad: grad, tint: 'rgba(' + hexRgb(c) + ',.1)', bord: 'rgba(' + hexRgb(c) + ',.45)' });
  function hexRgb(h) { return parseInt(h.slice(1, 3), 16) + ',' + parseInt(h.slice(3, 5), 16) + ',' + parseInt(h.slice(5, 7), 16); }
  const ALT = {
    heroic: mk('Heroic', '#fbbf24', 'linear-gradient(145deg,#fde68a,#92400e)'),
    legendary: mk('Legendary', '#ff9a1f', 'linear-gradient(145deg,#ffd700,#ff9a1f 45%,#b4520a)')
  };
  const TIERS = {
    common: mk('Common', '#a8a8a8', 'linear-gradient(145deg,#c2c2c2,#636363)'),
    uncommon: mk('Uncommon', '#4ade80', 'linear-gradient(145deg,#86efac,#166534)'),
    rare: mk('Rare', '#60a5fa', 'linear-gradient(145deg,#93c5fd,#1e40af)'),
    heroic: cfg.heroicAmber ? ALT.heroic : mk('Heroic', '#f87171', 'linear-gradient(145deg,#fca5a5,#991b1b)'),
    epic: mk('Epic', '#c084fc', 'linear-gradient(145deg,#d8b4fe,#6b21a8)'),
    legendary: cfg.legendaryOrange ? ALT.legendary : mk('Legendary', '#ffd700', 'linear-gradient(145deg,#fff2a8,#ffd700 45%,#8a6d1c)')
  };
  const ORDER = ['common', 'uncommon', 'rare', 'heroic', 'epic', 'legendary'];
  /* Tokens: --rq-emblem-mini 28, --rq-emblem-med 56, --rq-emblem-lg 96 (h = w*1.12); icon 15/24/42 */
  const SIZES = {
    mini: { w: 28, i: 15, core: 2, ring1: 2, ring2: 3 },
    medium: { w: 56, i: 24, core: 3, ring1: 4, ring2: 5.5 },
    large: { w: 96, i: 42, core: 5, ring1: 7, ring2: 9 }
  };
  /* Layers: glow wrapper (drop-shadow) > crest frame (tier gradient) > hairline ring (Heroic only,
     the non-colour mark) > dark core > series icon. Locked: tier = null. */
  function emblem(tier, iconName, sizeKey, opts) {
    opts = opts || {};
    const S = SIZES[sizeKey] || SIZES.medium;
    const T = tier ? (opts.alt && ALT[tier] ? ALT[tier] : TIERS[tier]) : null;
    const heroicRing = tier === 'heroic';
    const coreIn = heroicRing ? S.ring2 : S.core;
    let glow = 'display:inline-flex; flex-shrink:0;';
    if (T) {
      const breathe = cfg.breathe !== false && opts.breathe !== false;
      if (tier === 'legendary') {
        glow += ' filter:drop-shadow(0 0 ' + (S.w >= 56 ? 10 : 5) + 'px ' + T.c + '99);';
        if (S.w >= 56 && breathe) glow = 'display:inline-flex; flex-shrink:0; color:' + T.c + '; animation:rqGlow 2.6s ease-in-out infinite;';
      } else if (tier === 'rare' || tier === 'heroic' || tier === 'epic') {
        glow += ' filter:drop-shadow(0 0 ' + (S.w >= 56 ? 7 : 4) + 'px ' + T.c + '73);';
      }
      if (opts.ignite) glow += ' animation:rqIgnite .9s ease-out both' + (tier === 'legendary' && S.w >= 56 && breathe ? ', rqGlow 2.6s ease-in-out 1.3s infinite' : '') + ';';
    }
    return {
      glow: glow,
      frame: 'position:relative; display:flex; width:' + S.w + 'px; height:' + Math.round(S.w * 1.12) + 'px; clip-path:' + CREST + '; background:' + (T ? T.grad : 'rgba(255,255,255,.12)') + '; flex-shrink:0;',
      ring: 'position:absolute; inset:' + S.ring1 + 'px; clip-path:' + CREST + '; background:' + (heroicRing ? 'rgba(255,255,255,.55)' : 'transparent') + ';',
      inner: 'position:absolute; inset:' + coreIn + 'px; clip-path:' + CREST + '; background:#1c1c1c; display:flex; align-items:center; justify-content:center;',
      svg: rq.icon(iconName, S.i, T ? T.c : 'rgba(255,255,255,.28)'),
      tip: T ? T.name : 'Locked'
    };
  }
  /* Status chip recipe: tint 10% / border 45% / text full accent */
  function chip(tier) {
    const T = tier ? TIERS[tier] : null;
    return 'padding:2px 8px; font-size:11px; font-weight:600; letter-spacing:.16em; text-transform:uppercase; white-space:nowrap; ' +
      (T ? 'background:' + T.tint + '; border:1px solid ' + T.bord + '; color:' + T.c + ';'
         : 'background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.18); color:rgba(255,255,255,.45);');
  }
  /* Six pips = tier position, not progress. --rq-pip: 6px */
  function pips(tier) {
    const idx = tier ? ORDER.indexOf(tier) + 1 : 0;
    const c = tier ? TIERS[tier].c : '';
    return ORDER.map((k, i) => ({ style: 'width:6px; height:6px; background:' + (i < idx ? c : 'rgba(255,255,255,.12)') + ';' }));
  }
  const SERIES = [
    { key: 'milestoner', icon: 'flag', name: 'Milestoner', metric: 'Longest single run', tiers: [
      { req: 'A single run of 5 km', fl: 'First Five' }, { req: 'A single run of 10 km', fl: 'Double Digits' },
      { req: 'A single run of 21.1 km', fl: 'Half Marathon' }, { req: 'A single run of 30 km', fl: 'The Long Haul' },
      { req: 'A single run of 42.2 km', fl: 'Marathon' }, { req: 'A single run of 50 km', fl: 'Ultra' }] },
    { key: 'earth', icon: 'globe', name: 'Earth Trotter', metric: 'Total distance', tiers: [
      { req: '100 km total distance', fl: 'Off the Mark' }, { req: '500 km total distance', fl: 'Road Worn' },
      { req: '1,000 km total distance', fl: 'Four Figures' }, { req: '2,000 km total distance', fl: 'The Long Way' },
      { req: '4,015 km total distance', fl: 'Coast to Coast to Coast' }, { req: '10,000 km total distance', fl: 'Ten Thousand' }] },
    { key: 'climber', icon: 'mountain', name: 'Climber', metric: 'Total elevation gain', tiers: [
      { req: '500 m of elevation gain', fl: 'Foothills' }, { req: '1,345 m of elevation gain', fl: 'Ben Nevis' },
      { req: '4,800 m of elevation gain', fl: 'Mont Blanc' }, { req: '5,895 m of elevation gain', fl: 'Kilimanjaro' },
      { req: '8,848 m of elevation gain', fl: 'Everest' }, { req: '17,696 m of elevation gain', fl: 'Everest, Twice' }] },
    { key: 'streak', icon: 'flame', name: 'Streak Keeper', metric: 'Longest run streak', tiers: [
      { req: '3 days in a row', fl: 'Long Weekend' }, { req: '7 days in a row', fl: 'Full Week' },
      { req: '14 days in a row', fl: 'Fortnight' }, { req: '30 days in a row', fl: 'Calendar Month' },
      { req: '60 days in a row', fl: 'Two Months' }, { req: '100 days in a row', fl: 'The Hundred' }] },
    { key: 'early', icon: 'sun', name: 'Early Bird', metric: 'Early starts', tiers: [
      { req: '5 runs started 04:00\u201306:59', fl: 'First Light' }, { req: '15 runs started 04:00\u201306:59', fl: 'Dawn Patrol' },
      { req: '50 runs started 04:00\u201306:59', fl: 'Sunrise Regular' }, { req: '100 runs started 04:00\u201306:59', fl: 'Morning Fixture' },
      { req: '50 runs started 04:00\u201305:59', fl: 'Before the Birds' }, { req: '100 runs started 04:00\u201305:59', fl: 'The Dark Hours' }] },
    { key: 'night', icon: 'moon', name: 'Night Owl', metric: 'Late starts', tiers: [
      { req: '5 runs started 21:00\u201303:59', fl: 'Lights Out' }, { req: '15 runs started 21:00\u201303:59', fl: 'Street-lamp Pace' },
      { req: '50 runs started 21:00\u201303:59', fl: 'Closing Time' }, { req: '100 runs started 21:00\u201303:59', fl: 'Nocturnal' },
      { req: '25 runs started 22:30\u201303:59', fl: 'Past Midnight' }, { req: '10 runs started 23:30\u201300:30', fl: 'The Midnight Run' }] },
    { key: 'speedster', icon: 'zap', name: 'Speedster', metric: 'Fastest 5 km', tiers: [
      { req: 'A 5 km run under 35:00', fl: 'Moving' }, { req: 'A 5 km run under 30:00', fl: 'Brisk' },
      { req: 'A 5 km run under 25:00', fl: 'Quick' }, { req: 'A 5 km run under 22:00', fl: 'Fast' },
      { req: 'A 5 km run under 20:00', fl: 'Sub-20' }, { req: 'A 5 km run under 18:00', fl: 'Flying' }] },
    { key: 'precisionist', icon: 'target', name: 'Precisionist', metric: 'Exact finishes', tiers: [
      { req: '3 runs on an exact whole km', fl: 'On the Nose' }, { req: '10 runs on an exact whole km', fl: 'Measured' },
      { req: '25 runs on an exact whole km', fl: 'Calibrated' }, { req: '50 runs on an exact whole km', fl: 'Clockwork' },
      { req: 'One run of exactly 21.10 km', fl: 'The Half, Exactly' }, { req: 'One run each of exactly 10.00, 21.10 and 42.20 km', fl: 'The Full Set' }] }
  ];
  return { TIERS: TIERS, ALT: ALT, ORDER: ORDER, SERIES: SERIES, CREST: CREST, SIZES: SIZES, emblem: emblem, chip: chip, pips: pips, icon: rq.icon, logo: rq.logo };
};
