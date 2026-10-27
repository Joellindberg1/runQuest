import { afterEach, describe, expect, it } from 'vitest';
import { findRunnerElement } from './findRunnerElement';

afterEach(() => {
  document.body.innerHTML = '';
});

const render = (html: string) => {
  document.body.innerHTML = html;
};

describe('findRunnerElement', () => {
  it('returns the first element in document order that belongs to the runner', () => {
    render(`
      <button id="other" data-runner-id="u-adam">Adam</button>
      <button id="first" data-runner-id="u-karl">Karl</button>
      <button id="second" data-runner-id="u-karl">Karl again</button>
    `);

    expect(findRunnerElement('u-karl')?.id).toBe('first');
  });

  it('returns null when no element belongs to the runner', () => {
    render('<button data-runner-id="u-adam">Adam</button>');

    expect(findRunnerElement('u-karl')).toBeNull();
  });

  it('skips elements that are not rendered and returns the next visible one', () => {
    render(`
      <div hidden><button id="in-hidden" data-runner-id="u-karl">Karl</button></div>
      <div style="display: none"><button id="in-none" data-runner-id="u-karl">Karl</button></div>
      <button id="invisible" style="visibility: hidden" data-runner-id="u-karl">Karl</button>
      <button id="visible" data-runner-id="u-karl">Karl</button>
    `);

    expect(findRunnerElement('u-karl')?.id).toBe('visible');
  });

  it('returns null when every match is hidden', () => {
    render('<div hidden><button data-runner-id="u-karl">Karl</button></div>');

    expect(findRunnerElement('u-karl')).toBeNull();
  });

  it('still finds an element inside an aria-hidden region, which is how a dialog hides the page behind it', () => {
    render('<main aria-hidden="true"><button id="behind" data-runner-id="u-karl">Karl</button></main>');

    expect(findRunnerElement('u-karl')?.id).toBe('behind');
  });

  it('matches ids that contain characters with meaning in selectors', () => {
    render('<button id="odd" data-runner-id=\'a"b]c\'>Odd</button>');

    expect(findRunnerElement('a"b]c')?.id).toBe('odd');
  });

  it('only searches inside the given root', () => {
    render(`
      <section id="a"><button id="in-a" data-runner-id="u-karl">Karl</button></section>
      <section id="b"><button id="in-b" data-runner-id="u-karl">Karl</button></section>
    `);

    expect(findRunnerElement('u-karl', document.getElementById('b')!)?.id).toBe('in-b');
  });
});
