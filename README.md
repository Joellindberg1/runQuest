# RunQuest 🏃‍♂️

En löparapp där du och dina vänner kan tävla, spåra progress, och importera löprundor från Strava med ett XP-system och leaderboards.

## ✨ Features

- 🏆 **Leaderboard** - Tävla med dina vänner
- 📊 **XP & Level System** - Gamification av löpning
- 🔄 **Strava Integration** - Automatisk import av löprundor
- 🏅 **Achievements & Titles** - Lås upp belöningar
- 📈 **Streak Tracking** - Håll koll på löpserier
- 👤 **Personliga Profiler** - Spåra din progress

## 🛠️ Tech Stack

- **Frontend:** React, TypeScript, Vite, TailwindCSS, shadcn/ui
- **Backend:** Node.js, Express (planerat)
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth + Strava OAuth2
- **Deployment:** TBD (Railway/Vercel)

## 🚧 Current Status

**Fas 0: Planering & Cleanup** 
- ✅ Database strategy (Supabase) beslutad
- ✅ Monorepo struktur implementerad
- ✅ Lovable-referenser borttagna
- ✅ Git repository fresh start
- [ ] Authentication architecture 
- [ ] API design & documentation

Se [docs/DEVELOPMENT_PHASES.md](./docs/DEVELOPMENT_PHASES.md) för detaljerad utvecklingsplan.

## 🚀 Development Setup

```bash
# Klona repo
git clone [URL kommer snart]
cd runquest

# Installera dependencies
npm install

# Starta development server  
npm run dev
```

## 📁 Projektstruktur

```
runquest/
├── apps/
│   ├── frontend/         # React Vite app med TypeScript
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── services/
│   │   │   ├── contexts/
│   │   │   └── utils/
│   │   └── package.json
│   └── backend/          # Node.js Express API
│       ├── src/
│       │   └── index.ts
│       └── package.json
├── packages/
│   ├── types/           # Gemensamma TypeScript types  
│   └── config/          # Delad konfiguration
├── docs/                # Dokumentation
│   └── DEVELOPMENT_PHASES.md
└── package.json         # Root workspace config
```

## 🎯 Roadmap

- **Fas 1:** Monorepo setup & backend foundation
- **Fas 2:** Frontend refactoring & integration  
- **Fas 3:** Deployment & production
- **Fas 4:** Advanced features (chat, utmaningar, mobile app)

## 👥 Team

- **Joel Lindberg** - Developer & Product Owner
- Vänner som testar och ger feedback 🙂

---

