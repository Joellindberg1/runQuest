import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { findRunnerTarget, watchRunnerOpener } from './runnerOpener';

const KARL = 'u-karl';
const ADAM = 'u-adam';

const render = (html: string) => {
  document.body.innerHTML = html;
};
const byId = (id: string) => document.getElementById(id)!;

let stopWatching: () => void;

beforeEach(() => {
  stopWatching = watchRunnerOpener();
});
afterEach(() => {
  stopWatching();
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/');
});

const THREE_ROWS = `
  <main>
    <button id="first" data-runner-id="${KARL}">Karl, first row</button>
    <button id="adam" data-runner-id="${ADAM}">Adam</button>
    <button id="second" data-runner-id="${KARL}"><span id="second-label">Karl, second row</span></button>
    <button id="third" data-runner-id="${KARL}">Karl, third row</button>
  </main>`;

describe('findRunnerTarget', () => {
  it('returns the element that was clicked, not the first row of the same runner', () => {
    render(THREE_ROWS);

    fireEvent.click(byId('third'));

    expect(findRunnerTarget(KARL)?.id).toBe('third');
  });

  it('does not need the clicked element to have taken focus', () => {
    render(THREE_ROWS);

    fireEvent.click(byId('second'));

    expect(document.activeElement).toBe(document.body);
    expect(findRunnerTarget(KARL)?.id).toBe('second');
  });

  it('resolves a click on something inside the opener to the opener', () => {
    render(THREE_ROWS);

    fireEvent.click(byId('second-label'));

    expect(findRunnerTarget(KARL)?.id).toBe('second');
  });

  it('is replaced by the next opening, so nothing leaks from one opening to the next', () => {
    render(THREE_ROWS);

    fireEvent.click(byId('third'));
    fireEvent.click(byId('second'));

    expect(findRunnerTarget(KARL)?.id).toBe('second');
  });

  it('is cleared by a click that opens no runner, so the first row is the answer', () => {
    render(`${THREE_ROWS}<a id="elsewhere" href="#">Elsewhere</a>`);

    fireEvent.click(byId('third'));
    fireEvent.click(byId('elsewhere'));

    expect(findRunnerTarget(KARL)?.id).toBe('first');
  });

  it('is kept by clicks inside a dialog and on its scrim, which open no runner', () => {
    render(`${THREE_ROWS}<div class="rq-scrim" id="scrim"></div><div role="dialog" aria-modal="true"><button id="challenge">Challenge</button></div>`);

    fireEvent.click(byId('third'));
    fireEvent.click(byId('challenge'));
    fireEvent.click(byId('scrim'));

    expect(findRunnerTarget(KARL)?.id).toBe('third');
  });

  it('answers only for the runner that was opened', () => {
    render(THREE_ROWS);

    fireEvent.click(byId('third'));

    expect(findRunnerTarget(ADAM)?.id).toBe('adam');
  });

  it('falls back on the first visible row when the opener is gone and nothing sits at its place', () => {
    render(THREE_ROWS);
    fireEvent.click(byId('third'));

    byId('third').remove();

    expect(findRunnerTarget(KARL)?.id).toBe('first');
  });

  it('falls back on the first visible row when the opener has been hidden', () => {
    render(THREE_ROWS);
    fireEvent.click(byId('third'));

    byId('third').hidden = true;

    expect(findRunnerTarget(KARL)?.id).toBe('first');
  });

  it('finds the element at the opener\'s place when the page has been drawn again', () => {
    render(THREE_ROWS);
    fireEvent.click(byId('third'));

    // Mobilens kort är en egen sida: sidan under det avmonteras och ritas om med nya element.
    render(THREE_ROWS.replace('id="third"', 'id="third-again"'));

    expect(findRunnerTarget(KARL)?.id).toBe('third-again');
  });

  it('answers nothing from the memory on another page than the one the click was made on', () => {
    window.history.pushState({}, '', '/duels?view=history');
    render(THREE_ROWS);
    fireEvent.click(byId('third'));

    window.history.pushState({}, '', '/duels?view=standings');

    expect(findRunnerTarget(KARL)?.id).toBe('first');
  });

  it('keeps to the root it is asked about', () => {
    render(`<aside><button id="side" data-runner-id="${KARL}">Karl in the side</button></aside><main><button id="row" data-runner-id="${KARL}">Karl</button></main>`);
    fireEvent.click(byId('side'));

    expect(findRunnerTarget(KARL, document.querySelector('main')!)?.id).toBe('row');
  });

  it('returns null when the runner has no visible element at all', () => {
    render('<main><h1>Page</h1></main>');

    expect(findRunnerTarget(KARL)).toBeNull();
  });
});

describe('watchRunnerOpener', () => {
  it('forgets the opener and stops listening when it is stopped', () => {
    render(THREE_ROWS);
    fireEvent.click(byId('third'));

    stopWatching();
    expect(findRunnerTarget(KARL)?.id).toBe('first');

    fireEvent.click(byId('second'));
    expect(findRunnerTarget(KARL)?.id).toBe('first');
  });
});
