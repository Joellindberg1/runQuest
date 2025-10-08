# Railway Deployment Guide för RunQuest

## 🚂 Helhetslösning för Railway Deployment

Detta repo använder en workspace-baserad arkitektur med shared packages. Railway behöver bygga shared paketet innan backend startar.

### ⚙️ Konfigurationsfiler

- `railway.toml` - Railway service konfiguration
- `nixpacks.toml` - Build konfiguration för Railway
- Root `package.json` - Workspace build scripts

### 🔧 Build Process

1. **Install**: `npm install` (installerar alla workspace dependencies)
2. **Build Shared**: `npm run build:all` (bygger shared package först, sedan backend)
3. **Start**: `npm run start:railway` (startar backend med tsx)

### 📦 Package Dependencies

- `@runquest/shared` används som local dependency via `file:../../packages/shared`
- Railway bygger denna dependency automatiskt via `build:all` script

### 🎯 För att deploya på Railway:

1. Länka denna repo till Railway service
2. Railway kommer automatiskt att köra:
   ```bash
   npm install
   npm run build:all  # Bygger shared paketet
   npm run start:railway  # Startar backend
   ```

### 🔍 Troubleshooting

Om du får `Cannot find module '@runquest/shared'`:
- Kontrollera att `packages/shared/dist/` mapp existerar
- Kör `npm run build:all` manuellt
- Kontrollera att alla dependencies är installerade

### 📂 Filer som skapats/modifierade för Railway:

- ✅ `railway.toml` - Service konfiguration  
- ✅ `nixpacks.toml` - Build environment
- ✅ Root `package.json` - Build scripts
- ✅ `packages/shared/src/index.ts` - Package entry point
- ✅ Backend imports använder `@runquest/shared` istället för direkta paths

### 🎉 Fördelar med denna lösning:

- Inga hardcoded paths till `/packages/shared/dist/`
- Fungerar lokalt OCH på Railway
- Använder standard npm workspace patterns
- Automatisk shared package building
- Lätt att underhålla och uppdatera