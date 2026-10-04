/* RunQuest shared icon + logo source. Single definition for every DC.
   Load in a DC's <helmet>: <script src="./runquest-icons.js"></script>
   Then in the logic class:  RQIcons(React).icon('flame', 16, '#ffd700')

   Icon grammar: paths are 24x24 lucide-style line data, stroke 1.9, round caps.
   A path string starting with '@' is a circle: '@cx cy r'.
   Adding an icon means adding ONE entry here. */
(function () {
  var PATHS = {
    trophy: ['M6 9H4.5a2.5 2.5 0 0 1 0-5H6', 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18', 'M4 22h16', 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22', 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22', 'M18 2H6v7a6 6 0 0 0 12 0V2Z'],
    crown: ['M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z', 'M5 21h14'],
    swords: ['M14.5 17.5 3 6V3h3l11.5 11.5', 'M13 19l6-6', 'M16 16l4 4', 'M19 21l2-2'],
    calendar: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'],
    user: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', '@12 7 4'],
    plus: ['M12 5v14', 'M5 12h14'],
    list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
    book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z'],
    sparkles: ['M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9Z', 'M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z'],
    settings: ['@12 12 3', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a1.7 1.7 0 0 0-1.6-1H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 3 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 3a2 2 0 0 1 4 0v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 9h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z'],
    shield: ['M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V6l8-3 8 3Z'],
    help: ['@12 12 10', 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3', 'M12 17h.01'],
    bug: ['M8 2l1.9 1.9', 'M16 2l-1.9 1.9', 'M9 7.1V6a3 3 0 1 1 6 0v1.1', 'M9 7h6a4 4 0 0 1 4 4v3a7 7 0 1 1-14 0v-3a4 4 0 0 1 4-4Z', 'M3 13h4', 'M17 13h4', 'M12 20v2'],
    logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
    flame: ['M12 2c3 4 6 6.5 6 10a6 6 0 0 1-12 0c0-2 1-3.5 2-5 .5 1.5 1.5 2 2.5 2C10 7 11 4.5 12 2Z'],
    bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
    sun: ['@12 12 4', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M6.3 17.7l-1.4 1.4', 'M19.1 4.9l-1.4 1.4'],
    moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z'],
    chevron: ['M6 9l6 6 6-6'],
    clock: ['@12 12 10', 'M12 6v6l4 2'],
    sync: ['M21 12a9 9 0 1 1-3-6.7', 'M21 3v6h-6'],
    zap: ['M13 2 3 14h9l-1 8 10-12h-9Z'],
    flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
    globe: ['@12 12 10', 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'],
    mountain: ['M8 3l4 8 5-5 5 15H2L8 3z'],
    snow: ['M12 2v20', 'M3.3 7l17.4 10', 'M20.7 7L3.3 17'],
    users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', '@9 7 4', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    target: ['@12 12 10', '@12 12 6', '@12 12 2']
  };

  var cache = null;

  function build(React) {
    function ic(paths, size, color, strokeWidth) {
      return React.createElement('svg', {
        viewBox: '0 0 24 24', width: size || 16, height: size || 16, fill: 'none',
        stroke: color || 'currentColor', strokeWidth: strokeWidth || 1.9,
        strokeLinecap: 'round', strokeLinejoin: 'round', style: { flexShrink: 0 }
      }, paths.map(function (d, i) {
        if (d.charAt(0) === '@') {
          var p = d.slice(1).split(' ');
          return React.createElement('circle', { key: i, cx: p[0], cy: p[1], r: p[2] });
        }
        return React.createElement('path', { key: i, d: d });
      }));
    }

    function icon(name, size, color) {
      return ic(PATHS[name] || PATHS.trophy, size, color);
    }

    /* The wordmark. o.taglineFill defaults to gold; pass null to drop the tagline. */
    function logo(o) {
      o = o || {};
      var taglineFill = o.taglineFill === undefined ? '#ffd700' : o.taglineFill;
      var kids = [
        React.createElement('g', { key: 'runner', stroke: 'currentColor', strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('circle', { key: 'head', cx: 23, cy: 3.25, r: 3.5, fill: 'currentColor', stroke: 'none' }),
          React.createElement('line', { key: 'l1', x1: 21, y1: 8.5, x2: 16, y2: 20 }),
          React.createElement('line', { key: 'l2', x1: 20.5, y1: 8.5, x2: 27.5, y2: 17.5 }),
          React.createElement('line', { key: 'l3', x1: 33, y1: 13, x2: 28.5, y2: 16.5 }),
          React.createElement('line', { key: 'l4', x1: 19.3, y1: 8.7, x2: 12, y2: 10 }),
          React.createElement('line', { key: 'l5', x1: 12, y1: 10, x2: 10, y2: 15 }),
          React.createElement('line', { key: 'l6', x1: 16, y1: 20, x2: 23, y2: 23.5 }),
          React.createElement('line', { key: 'l7', x1: 23, y1: 23.5, x2: 20, y2: 33 }),
          React.createElement('path', { key: 'l8', d: 'M16 20 L11 27 Q10 29, 6.5 33.5', fill: 'none' })),
        React.createElement('text', { key: 'word', x: 40, y: 25, fontFamily: "'Oswald', sans-serif", fontSize: 28, letterSpacing: '0.5' }, 'RUNQUEST')
      ];
      if (taglineFill) {
        kids.push(React.createElement('text', { key: 'tag', x: 45, y: 40.1, fontFamily: "'Oswald', sans-serif", fontSize: 12, letterSpacing: '0.75', fill: taglineFill }, 'RUN - RANK - REIGN'));
      }
      return React.createElement('svg', {
        viewBox: '0 0 165 40', width: o.width || 148, height: o.height || 36,
        fill: 'currentColor', 'aria-label': 'RunQuest'
      }, kids);
    }

    return { ic: ic, icon: icon, logo: logo, PATHS: PATHS, names: Object.keys(PATHS) };
  }

  window.RQIcons = function (React) {
    if (!cache) cache = build(React);
    return cache;
  };
  window.RQIcons.PATHS = PATHS;
  window.RQIcons.names = Object.keys(PATHS);
})();

