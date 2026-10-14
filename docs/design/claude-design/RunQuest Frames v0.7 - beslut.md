# RunQuest Frames v0.7: decisions after Design Council (2026-10-14)

The reference image is `RunQuest Frames v0.7.dc.html` (+ `rq-frames.css`), the owner's version from Claude Design. **Design Council: APPROVED WITH CHANGES** (5 of 5 roles; no redraw). The decisions below **take precedence over the image** wherever they differ. They apply to RUN-242 (S18–S24 in RUN-9) and RUN-241 (S25 in RUN-93).

## The owner's decisions

1. **Switch** is green when on (`--rq-toggle-on`). The theme switch stays gold.
2. **Read state:**
   - **Mouse:** hover marks a row as read immediately, but only after real pointer movement. Ignore `pointerenter` for the first ~150 ms after mount, so a pointer that is resting over the row when the list opens does not mark it read.
   - **Touch:** tap.
   - **Keyboard:** focus does NOT mark a row as read; Enter or Space does. "Mark all read" stays.

   This deviates from ADR 011 B4 (focus = read); an ADR addendum follows.
3. **Ranks:**
   - The colour is blue (`--rq-news-rank*`, kept strictly separate from `--rq-tier-minor` and `--rq-badge-*`).
   - "passed you" has a neutral tone.
   - "— now #N" is shown as a **placement badge** (mono/Bebas, no new colour). The unread row is not made more prominent than other unread rows.
4. **The Strava card when paused** shows two buttons: **"Turn sync back on"** and **"Disconnect"**. "Disconnect" goes straight to the disconnect confirmation. "Pause or disconnect" (the popup with both options) appears only when sync is running.
5. **The disconnect confirmation** shows the number of runs being deleted ("Disconnect and delete N runs"). The count comes from the frontend's own runs data (`source === 'strava'`).
6. **The notification list (popover)** gets **no gear**. Settings are reached from Settings and from /news.
7. **The tour (tour_news_v2)** has **five steps**:
   - The steps "newest first" and "gold dot = unread, hover/tap marks it read" are merged into one.
   - The texts use the app's voice, e.g. step 5: "Your bell, your rules. The page always shows the whole pack."
   - Lead/Designer writes the final copy at build time.

## Changes in the internal loop (no owner decision needed)

### Documentation and tokens
- Write three exceptions into `designsprak-forslag.md`, the theme file and the lint allowlist:
  - green switch (rule 3: "green = on/active in a switch")
  - blue news category Ranks (rule 10)
  - the tour's gold buttons (an exception to the gold rule)
- The popover's empty state is a deliberate exception to rule 9.
- The chip **"Paused"** uses a neutral ink tone with a static dot, **not silver** (silver = rank 2).
- The Notifications card's edge must match Strava/Password. Red is never placed next to gold in P1.

### Layout and content
- An empty section is not rendered (variant A).
- The overall total is dropped on narrow surfaces.
- N1:
  - In the error state, "Defaults shown" must be clear.
  - Disabled-on and disabled-off must be distinguishable.
  - Section headings must clearly be clickable (chevron and contrast).
  - "Reset to defaults" is a `button` that looks like a link and is shown only when something has been changed.
- P1:
  - The choice step has one sentence per option.
  - The full explanation and "cannot be undone" appear only in the confirmation step.

### Accessibility
- **N2:**
  - A news row is a `button`/group with a clear name, not `li tabindex=0`.
  - A polite live update of the unread counter.
- **N1/N5:**
  - The off track has ≥ 3:1 against the surface (or a 1 px border).
  - Mono labels (text-3/4/5) are measured against 4.5:1. Anything that fails must not carry information.
- **N1.C:** a space in "them. Retry". Retry is a button with a hit area ≥ 24×24 px.
- **P1:**
  - `alertdialog` with initial focus on "Keep my connection".
  - After Disconnect, focus moves to the card heading (`tabindex=-1`) or to Connect.
  - The status message is placed in a region that persists after the dialog closes.
  - Text on red has ≥ 4.5:1.
- **Verify at build time:**
  - `aria-describedby` for "Off by default"
  - groups with `aria-labelledby`
  - no double announcement of status/alert
  - the 7th chip is reachable on focus
  - the tour's focus and Esc
  - 44 px targets on mobile
  - `prefers-reduced-motion` for the connected dot and the skeleton

## Known gap
The light theme is neither drawn nor reviewed. It is checked separately before it is enabled.
