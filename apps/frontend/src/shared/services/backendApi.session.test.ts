import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendApi } from './backendApi';
import { SESSION_TOKEN_KEY, SESSION_USER_KEY } from './sessionStorageKeys';

// Sessionen läses vid appstart (AuthProvider) och av landningens hydrering. Med blockerad lagring (webbläsarens inställning, vissa privata lägen) kastar
// åtkomsten till localStorage: utan skydd kastar AuthProvider i sin effekt och hela trädet, landningen med, försvinner efter hydreringen.

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function blockStorage() {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  });
}

describe('backendApi session reads', () => {
  it('read the stored session', () => {
    localStorage.setItem(SESSION_TOKEN_KEY, 'fake-token');
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify({ id: 'u1', name: 'Anna', email: 'anna@example.com' }));
    expect(backendApi.isAuthenticated()).toBe(true);
    expect(backendApi.getToken()).toBe('fake-token');
    expect(backendApi.getCurrentUser()).toEqual({ id: 'u1', name: 'Anna', email: 'anna@example.com' });
  });

  it('treat blocked storage as signed out instead of throwing', () => {
    blockStorage();
    expect(backendApi.isAuthenticated()).toBe(false);
    expect(backendApi.getToken()).toBeNull();
    expect(backendApi.getCurrentUser()).toBeNull();
  });
});
