import { describe, expect, it } from 'vitest';
import { GROUP_CAPABILITIES, GROUP_ROLES, groupRoleCan } from '../groupRoles.js';

describe('groupRoleCan', () => {
  it('admin får skriva gruppinställningar', () => {
    expect(groupRoleCan('admin', 'settings.write')).toBe(true);
  });

  it('member får inte skriva gruppinställningar', () => {
    expect(groupRoleCan('member', 'settings.write')).toBe(false);
  });

  it('en okänd, tom eller saknad roll nekas (fail-closed)', () => {
    for (const role of ['owner', 'vice_admin', 'ADMIN', ' admin', '', null, undefined]) {
      expect(groupRoleCan(role, 'settings.write'), String(role)).toBe(false);
    }
  });

  it('en okänd rättighet nekas för alla roller, även admin', () => {
    for (const role of GROUP_ROLES) {
      expect(groupRoleCan(role, 'settings.delete' as never), role).toBe(false);
      expect(groupRoleCan(role, 'constructor' as never), role).toBe(false);
      expect(groupRoleCan(role, '__proto__' as never), role).toBe(false);
    }
  });

  it('en rolltext som råkar vara ett objektsfält nekas', () => {
    expect(groupRoleCan('constructor', 'settings.write')).toBe(false);
    expect(groupRoleCan('toString', 'settings.write')).toBe(false);
  });

  it('varje rättighet har en tabellrad och varje roll i tabellen finns bland rollerna', () => {
    for (const [capability, roles] of Object.entries(GROUP_CAPABILITIES)) {
      expect(roles.length, capability).toBeGreaterThan(0);
      for (const role of roles) expect(GROUP_ROLES, `${capability} -> ${role}`).toContain(role);
    }
  });
});
