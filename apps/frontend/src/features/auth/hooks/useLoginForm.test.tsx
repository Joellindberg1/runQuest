import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLoginForm } from './useLoginForm';

const submitEvent = { preventDefault: vi.fn() } as unknown as FormEvent;

describe('useLoginForm', () => {
  it('skickar det som skrivits och står kvar utan fel när inloggningen lyckas', async () => {
    const login = vi.fn().mockResolvedValue({ success: true });
    const { result } = renderHook(() => useLoginForm(login));
    act(() => {
      result.current.setUsername('anna');
      result.current.setPassword('hemligt');
    });
    await act(() => result.current.submit(submitEvent));
    expect(login).toHaveBeenCalledWith('anna', 'hemligt');
    expect(submitEvent.preventDefault).toHaveBeenCalled();
    expect(result.current.error).toBe('');
    expect(result.current.loading).toBe(false);
  });

  it('serverns fel visas och fälten behåller sitt innehåll', async () => {
    const login = vi.fn().mockResolvedValue({ success: false, error: 'Invalid credentials' });
    const { result } = renderHook(() => useLoginForm(login));
    act(() => {
      result.current.setUsername('anna');
      result.current.setPassword('fel');
    });
    await act(() => result.current.submit(submitEvent));
    expect(result.current.error).toBe('Invalid credentials');
    expect(result.current.username).toBe('anna');
    expect(result.current.password).toBe('fel');
    expect(result.current.loading).toBe(false);
  });

  it('ett fel utan text blir "Login failed", och nästa försök rensar det gamla felet', async () => {
    const login = vi.fn().mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useLoginForm(login));
    await act(() => result.current.submit(submitEvent));
    expect(result.current.error).toBe('Login failed');
    await act(() => result.current.submit(submitEvent));
    expect(result.current.error).toBe('');
  });

  it('loading är sant medan anropet pågår', async () => {
    let finish: (value: { success: boolean }) => void = () => {};
    const login = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useLoginForm(login));
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.submit(submitEvent); });
    expect(result.current.loading).toBe(true);
    await act(async () => { finish({ success: true }); await pending; });
    expect(result.current.loading).toBe(false);
  });

  it('ett nytt submit medan ett anrop pågår ignoreras (dubbelklick, Enter + klick)', async () => {
    let finish: (value: { success: boolean }) => void = () => {};
    const login = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useLoginForm(login));
    let first: Promise<void> = Promise.resolve();
    act(() => { first = result.current.submit(submitEvent); });
    await act(async () => { await result.current.submit(submitEvent); });
    expect(login).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ success: true }); await first; });
  });
});
