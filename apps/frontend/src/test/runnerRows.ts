import { expect } from 'vitest';
import type { UserEvent } from '@testing-library/user-event';

const MAX_TABS = 120;

/** Tabbar framåt tills `target` har fokus; faller om den inte nås med tangentbord. */
export async function tabTo(user: UserEvent, target: HTMLElement) {
  for (let presses = 0; presses < MAX_TABS && document.activeElement !== target; presses += 1) {
    await user.tab();
  }
  expect(target).toHaveFocus();
}

export const OPEN_KEYS = [
  { label: 'Enter', keys: '{Enter}' },
  { label: 'Space', keys: ' ' },
] as const;
