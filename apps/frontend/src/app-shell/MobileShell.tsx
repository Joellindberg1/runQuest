import { useState } from 'react';
import { AppHeader } from './AppHeader';
import { BottomBar } from './BottomBar';
import { NewSheet } from './NewSheet';
import { RightNowPills } from './RightNow';
import { ShellOutlet } from './ShellOutlet';
import { useRightNow } from './useRightNow';
import { useShellUser } from './useShellUser';

/** < 1024 px: header + "Right now"-pills + sida + bottenbar (App Prototype). */
export function MobileShell() {
  const [newOpen, setNewOpen] = useState(false);
  const user = useShellUser();
  const { items, hasOpenEvent } = useRightNow();

  return (
    <div className="rq-shell rq-shell--mobile" data-shell="mobile">
      <div className="rq-shell__top">
        <AppHeader variant="mobile" user={user} hasOpenEvent={hasOpenEvent} />
        <RightNowPills items={items} />
      </div>
      <main className="rq-shell__main">
        <ShellOutlet />
      </main>
      <BottomBar newOpen={newOpen} onNewClick={() => setNewOpen((open) => !open)} />
      <NewSheet open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
