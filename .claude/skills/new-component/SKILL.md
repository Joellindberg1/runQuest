---
name: new-component
description: Scaffolds a new React component in the correct feature folder following RunQuest conventions (Radix UI, Tailwind, TypeScript)
---

Skapa en ny React-komponent för RunQuest-frontenden.

**Fråga användaren:**
1. Vad ska komponenten heta? (PascalCase)
2. Vilken feature tillhör den? (admin / auth / challenges / leaderboard / profile / runs / settings / titles) — eller är det en delad komponent?
3. Vad ska komponenten göra? (kort beskrivning)

**Placering:**
- Feature-komponent: `apps/frontend/src/features/<feature>/components/<Name>.tsx`
- Delad komponent: `apps/frontend/src/components/<Name>.tsx`

**Mall att följa:**
```tsx
import { type FC } from 'react'
import { cn } from '@/lib/utils'

interface <Name>Props {
  className?: string
}

const <Name>: FC<<Name>Props> = ({ className }) => {
  return (
    <div className={cn('', className)}>
      {/* innehåll */}
    </div>
  )
}

export default <Name>
```

**Konventioner:**
- Använd `cn()` från `@/lib/utils` för className-merging
- Props-interface alltid explicit, exportera inte interfacet om det inte behövs externt
- Radix UI-primitiver för interaktiva element (Dialog, Collapsible, etc.)
- Tailwind för all styling — inga inline styles
- Exportera komponenten som default export

Skapa filen, visa den för användaren och fråga om något ska justeras.
