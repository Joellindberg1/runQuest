# 📋 ANALYS & PLAN: Frontend Cleanup - runQuest

## 🔍 NULÄGESANALYS

### Kritiska problem identifierade:

#### 1. **DUBBEL DATAHANTERING - Supabase Direct vs Backend API**
**Problem:** Frontend använder både direkta Supabase-anrop OCH backend API parallellt
- **Direkta Supabase-anrop finns i:**
  - `Index.tsx` - Hämtar users och runs direkt från Supabase
  - `RunHistoryGroup.tsx` - Direkta queries
  - `EditRunDialog.tsx` - Direkta updates/deletes
  - `ProfilePictureUpload.tsx` - Direkta uploads
  - `LoginContext.tsx` - Direkt autentisering (LEGACY)
  - `UserDataContext.tsx` - Direkt data-fetching (LEGACY)

- **Backend API-anrop finns i:**
  - `backendApi.ts` - Komplett API-wrapper
  - `runService.ts` - Använder backend för runs
  - `optimizedTitleService.ts` - Använder backend för titles

**Konsekvens:** 
- XP-beräkningar kan skilja sig (frontend har hårdkodad logik i `RunLogger.tsx`)
- Ingen single source of truth
- Risk för datainkonsistens
- Triggrar och business logic i backend körs inte när frontend går direkt till Supabase

#### 2. **XP-BERÄKNING PÅ FEL PLATS**
**Problem:** XP beräknas på 3 olika ställen:
1. `RunLogger.tsx` (frontend) - Hårdkodade värden för preview
2. `runService.ts` (frontend) - Anropar backend
3. Backend - Den ENDA källan till sanning med databas-triggers

**Exempel från `RunLogger.tsx`:**
```typescript
const calculateXP = (km: number, streakMultiplier: number = 1.0) => {
  // Hårdkodade värden som kan vara fel!
  const baseXP = 15;
  const kmXP = km * 2;
  // ...
}
```

#### 3. **LEGACY CONTEXTS SOM INTE ANVÄNDS**
- `LoginContext.tsx` - Använder direkt Supabase, ersatt av `AuthContext`
- `UserDataContext.tsx` - Använder direkt Supabase, data hämtas nu via backend
- Båda kan tas bort helt

#### 4. **OPTIMIZED-KOMPONENTER SOM INTE ANVÄNDS**
- `OptimizedLeaderboard.tsx` - Finns, används ALDRIG
- `OptimizedTitleSystem.tsx` - Finns, används ALDRIG
- Används endast `Leaderboard.tsx` och `TitleSystem.tsx`

#### 5. **KAOTISK KOMPONENTSTRUKTUR**
```
components/
├── Leaderboard.tsx          ❌ Root-nivå
├── TitleSystem.tsx          ❌ Root-nivå  
├── RunLogger.tsx            ❌ Root-nivå
├── UserProfile.tsx          ❌ Root-nivå
├── leaderboard/             ✅ Sub-komponenter
│   ├── UserTitles.tsx
│   ├── UserStats.tsx
│   └── ...
└── title/                   ✅ Sub-komponenter
    ├── TitleCard.tsx
    └── ...
```

**Problem:** Ingen separation mellan features och shared components

#### 6. **EXCESSIVE CONSOLE LOGGING**
- 50+ console.log() bara i frontend
- Många i produktion-kod
- Gör DevTools oanvändbar
- Kan exponera känslig info

#### 7. **APP.TSX HAR FÖR MYCKET LOGIK**
- Routing
- Auth-hantering  
- Loading states
- Provider setup
- Level service initialization

## 🎯 PLANERAD STRUKTUR

### Ny mappstruktur:
```
src/
├── main.tsx                 ← Bara React-mount + providers
├── App.tsx                  ← Bara routing
├── features/                ← NY: Feature-first struktur
│   ├── leaderboard/
│   │   ├── index.ts
│   │   ├── LeaderboardFeature.tsx
│   │   ├── components/
│   │   │   ├── UserCard.tsx
│   │   │   ├── UserStats.tsx
│   │   │   └── LevelProgress.tsx
│   │   ├── hooks/
│   │   │   └── useLeaderboard.ts
│   │   └── README.md
│   ├── titles/
│   │   ├── index.ts
│   │   ├── TitlesFeature.tsx
│   │   ├── components/
│   │   └── hooks/
│   ├── profile/
│   │   ├── index.ts
│   │   ├── ProfileFeature.tsx
│   │   └── components/
│   ├── run-logger/
│   │   ├── index.ts
│   │   ├── RunLoggerFeature.tsx
│   │   ├── components/
│   │   └── hooks/
│   └── admin/
│       ├── index.ts
│       ├── AdminFeature.tsx
│       └── components/
├── pages/                   ← Endast page-layouts
│   ├── DashboardPage.tsx
│   ├── AdminPage.tsx
│   ├── SettingsPage.tsx
│   └── LoginPage.tsx
├── shared/                  ← NY: Delade komponenter
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   └── Navigation.tsx
│   └── layouts/
│       └── MainLayout.tsx
├── components/
│   └── ui/                  ← Endast Shadcn primitives
├── services/                ← Endast backend API-anrop
│   ├── api.ts              ← Unified API client
│   ├── authService.ts
│   ├── runService.ts
│   └── titleService.ts
├── contexts/
│   └── AuthContext.tsx      ← Endast AUTH
├── hooks/
│   └── use-toast.ts
├── lib/
└── utils/
```

## 📋 EXEKUTIONSPLAN

### **FAS 1: KRITISK SANERING** ⚠️ ✅ KLAR

#### 1.1 Ta bort legacy contexts
- [x] Hitta alla imports av `LoginContext` och `UserDataContext`
- [x] Ersätt med `AuthContext` där nödvändigt
- [x] Ta bort filer:
  - `contexts/LoginContext.tsx`
  - `contexts/UserDataContext.tsx`

#### 1.2 Ta bort oanvända optimized-komponenter
- [x] Verifiera att `OptimizedLeaderboard.tsx` inte används (grep-search)
- [x] Verifiera att `OptimizedTitleSystem.tsx` inte används
- [x] Ta bort båda filerna

#### 1.3 Rensa console.logs
- [x] Skapa utility: `src/utils/logger.ts` med dev/prod-lägen
- [x] Ersätt kritiska console.logs med logger
- [x] Ta bort alla debug console.logs från huvudkomponenter
- [x] Behåll endast error-logging

**Resultat:** -910 rader kod, +60 rader logger, ~50+ console.logs borta
**Commits:** ce39515, d13f0bd, 610856e, 347f80c
**Status:** Pushad till GitHub (frontend-cleanup branch)

### **FAS 2: DATAHANTERING - SINGLE SOURCE OF TRUTH** 🎯

#### 2.1 Eliminera direkta Supabase-anrop
**Flytta till backend API:**
- [ ] `Index.tsx` - Fetch users/runs → Skapa backend endpoint
- [ ] `RunHistoryGroup.tsx` - Queries → Backend API
- [ ] `EditRunDialog.tsx` - Updates/deletes → Backend API  
- [ ] `ProfilePictureUpload.tsx` - Uploads → Backend API

**Behåll endast Supabase för:**
- File uploads (storage)
- Real-time subscriptions (om nödvändiga)

#### 2.2 Centralisera XP-beräkning
- [ ] Ta bort `calculateXP()` från `RunLogger.tsx`
- [ ] Använd endast backend för faktiska beräkningar
- [ ] Skapa `services/xpPreviewService.ts` som anropar backend för preview
- [ ] Alternativt: Gör preview till en simple visualization utan exakta siffror

#### 2.3 Konsolidera services
- [ ] Merge `runService.ts`, `titleService.ts`, `optimizedTitleService.ts`
- [ ] Skapa en unified `services/api.ts` med alla backend-anrop
- [ ] Ta bort duplicerad kod

### **FAS 3: FEATURE-FIRST OMSTRUKTURERING** 🏗️

#### 3.1 Skapa features-mapp och flytta features
**Ordning (börja med enklast):**

1. **Admin Feature** (enklast, isolerad)
   - [ ] Skapa `features/admin/`
   - [ ] Flytta admin-komponenter från `AdminPage.tsx`
   - [ ] Skapa `AdminFeature.tsx`
   - [ ] Uppdatera `AdminPage.tsx` att endast importera feature

2. **Profile Feature**
   - [ ] Skapa `features/profile/`
   - [ ] Flytta `UserProfile.tsx` → `ProfileFeature.tsx`
   - [ ] Flytta `ProfilePictureUpload.tsx` → `features/profile/components/`
   - [ ] Skapa hooks för profile-hantering

3. **Run Logger Feature**
   - [ ] Skapa `features/run-logger/`
   - [ ] Flytta `RunLogger.tsx` → `RunLoggerFeature.tsx`
   - [ ] Flytta `RunHistoryGroup.tsx` och `EditRunDialog.tsx` → components/
   - [ ] Skapa `hooks/useRunLogger.ts`

4. **Leaderboard Feature**
   - [ ] Skapa `features/leaderboard/`
   - [ ] Flytta `Leaderboard.tsx` → `LeaderboardFeature.tsx`
   - [ ] Flytta `components/leaderboard/*` → `features/leaderboard/components/`
   - [ ] Skapa `index.ts` för clean exports

5. **Titles Feature**
   - [ ] Skapa `features/titles/`
   - [ ] Flytta `TitleSystem.tsx` → `TitlesFeature.tsx`
   - [ ] Flytta `components/title/*` → `features/titles/components/`
   - [ ] Skapa hooks för title-hantering

#### 3.2 Skapa shared components
- [ ] Skapa `shared/components/`
- [ ] Identifiera shared components:
  - `ProfileMenu.tsx`
  - `AuthDebugInfo.tsx` (eller ta bort i prod)
- [ ] Flytta till shared/

#### 3.3 Uppdatera pages
- [ ] Refaktorera `Index.tsx` → `DashboardPage.tsx`
  - Ta bort all affärslogik
  - Importera features istället
  - Endast layout och tab-navigation
- [ ] Uppdatera `AdminPage.tsx` - Använd AdminFeature
- [ ] Uppdatera `SettingsPage.tsx` - Extrahera features

### **FAS 4: APP & MAIN CLEANUP** 🧹

#### 4.1 Refaktorera App.tsx
- [ ] Flytta providers till `main.tsx`
- [ ] Flytta auth-logik till AuthContext eller custom hook
- [ ] Behåll endast routing
- [ ] Ta bort level service init (flytta till rätt plats)

#### 4.2 Uppdatera main.tsx
- [ ] Lägg alla providers här
- [ ] Tydlig provider-struktur

### **FAS 5: TESTING & VALIDATION** ✅

#### 5.1 Teknisk validering
- [ ] `npm run lint` - Inga errors
- [ ] `npm run build` - Bygger utan errors
- [ ] Verifiera import paths (`@/*` alias)
- [ ] Testa dev-server

#### 5.2 Funktionell testning
- [ ] Routing funkar (alla pages)
- [ ] Login/logout
- [ ] Leaderboard visas korrekt
- [ ] Titles fungerar
- [ ] Run logger - Logga run
- [ ] Run logger - Edit/delete runs
- [ ] Admin-funktioner
- [ ] Settings - Strava connection
- [ ] Profile - Bild upload

#### 5.3 Performance check
- [ ] Inga onödiga re-renders
- [ ] API-anrop optimerade
- [ ] Console är ren i produktion

### **FAS 6: DOKUMENTATION** 📚

- [ ] Uppdatera README.md med ny struktur
- [ ] Skapa feature README.md (mall)
- [ ] Dokumentera API-services
- [ ] Changelog/migration notes

## ⚠️ RISKER & MITIGERING

### Högrisk-områden:

1. **Byta från Supabase Direct → Backend API**
   - **Risk:** Breaking changes, data loss
   - **Mitigering:** 
     - Gör en feature i taget
     - Testa grundligt efter varje ändring
     - Ha backup av databas
     - Implementera backend endpoints först, testa dem, sedan flytta frontend

2. **XP-beräkning ändras**
   - **Risk:** Fel XP-värden, användardata förstörs
   - **Mitigering:**
     - Backend är redan source of truth
     - Verifiera att triggers funkar
     - Testa med test-users först
     - Dokumentera alla XP-formler

3. **Feature-flytt kan bryta dependencies**
   - **Risk:** Circular imports, broken paths
   - **Mitigering:**
     - Flytta features i ordning (enklast först)
     - Använd `index.ts` för clean exports
     - Testa import paths löpande

## 📊 ESTIMERAD TID

- **Fas 1:** 2-3 timmar (kritisk sanering)
- **Fas 2:** 4-6 timmar (datahantering)
- **Fas 3:** 8-12 timmar (feature-omstrukturering)
- **Fas 4:** 2-3 timmar (app cleanup)
- **Fas 5:** 3-4 timmar (testing)
- **Fas 6:** 1-2 timmar (dokumentation)

**Total:** ~20-30 timmar (beroende på komplexitet)

## 🎯 REKOMMENDATION

**Börja med FAS 1 och FAS 2** - dessa är kritiska för dataintegritet. Återkom sedan för godkännande innan FAS 3 påbörjas, då det är den mest omfattande omstruktureringen.

## 📝 CHANGELOG

- **2025-11-21:** Initial plan skapad baserat på nuvarande kodstruktur
