import { describe, expect, it } from 'vitest';
import { headToHeadSentence } from './headToHeadSentence';

const record = (wins: number, draws: number, losses: number) => ({ wins, draws, losses, total: wins + draws + losses });

describe('head to head sentence', () => {
  it('head to head sentence reads wins, draws and losses from my side', () => {
    expect(headToHeadSentence(record(2, 0, 1), 'Karl Persson')).toBe('Head to head: 2–0–1 to you');
    expect(headToHeadSentence(record(3, 2, 0), 'Karl Persson')).toBe('Head to head: 3–2–0 to you');
  });

  it('names the opponent by first name when they lead', () => {
    expect(headToHeadSentence(record(0, 1, 2), 'Karl Persson')).toBe('Head to head: 0–1–2 to Karl');
    expect(headToHeadSentence(record(1, 0, 4), 'Nicklas von Elling')).toBe('Head to head: 1–0–4 to Nicklas');
  });

  it('says level when wins and losses are equal, with or without draws', () => {
    expect(headToHeadSentence(record(1, 0, 1), 'Karl Persson')).toBe('Head to head: 1–0–1 level');
    expect(headToHeadSentence(record(2, 3, 2), 'Karl Persson')).toBe('Head to head: 2–3–2 level');
    expect(headToHeadSentence(record(0, 2, 0), 'Karl Persson')).toBe('Head to head: 0–2–0 level');
  });

  it('says there are no duels yet when the pair has never met', () => {
    expect(headToHeadSentence(record(0, 0, 0), 'Karl Persson')).toBe('Head to head: no duels against Karl yet');
  });

  it('never uses a gendered pronoun for the opponent', () => {
    const sentences = [record(2, 0, 1), record(0, 1, 2), record(1, 0, 1), record(0, 0, 0)].map((entry) => headToHeadSentence(entry, 'Karl Persson'));
    for (const sentence of sentences) expect(sentence).not.toMatch(/\b(him|her|his|hers|he|she)\b/i);
  });
});
