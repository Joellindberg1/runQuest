import { describe, it, expect } from 'vitest';
import { supabaseHost } from '../lib/supabaseHost.js';

describe('supabaseHost', () => {
  it('värd ur URL, "unknown" när den saknas eller är ogiltig', () => {
    expect(supabaseHost('https://x.supabase.co')).toBe('x.supabase.co');
    expect(supabaseHost('')).toBe('unknown');
    expect(supabaseHost('localhost:54321')).toBe('unknown');
    expect(supabaseHost('not a url')).toBe('unknown');
  });
});
