// Roller i en grupp och vad de får göra (ADR 012 beslut 2.5, ägarbeslut F6).
//
// `groupRoleCan` är den ENDA platsen där en roll blir en rättighet. Ingen annan kod jämför en roll mot ett rollnamn
// (`role === 'admin'`); den frågar `groupRoleCan(role, capability)`. En ny roll (vice admin) eller en ny rättighet
// (admin-spelmekaniska uppgifter) är då en ny rad här, inte en ny kontrollstruktur. Vakten `checkGroupRoleMapping` i
// scripts/ci-guards.mjs fäller bygget om en rolljämförelse dyker upp någon annanstans.
//
// Rollerna speglar CHECK-listan på group_members.role (databasen). Roll läses alltid färskt ur databasen av anroparen,
// aldrig ur JWT, URL eller body (ADR 012 beslut 6.4); den här funktionen avgör bara vad en känd roll får.

export const GROUP_ROLES = ['admin', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

/** Rättigheter i en grupp. Fler läggs till här när en funktion behöver dem. */
export type GroupCapability = 'settings.write';

/** Rättighet -> de roller som har den. */
export const GROUP_CAPABILITIES: Readonly<Record<GroupCapability, readonly GroupRole[]>> = {
  'settings.write': ['admin'],
};

/**
 * Får en medlem med rollen `role` göra `capability`? Fail-closed: okänd roll, saknad roll (null/undefined) och okänd rättighet
 * ger false. `role` är en sträng (inte `GroupRole`) eftersom värdet kommer ur databasen och ska nekas, inte kasta, om det är fel.
 */
export function groupRoleCan(role: string | null | undefined, capability: GroupCapability): boolean {
  if (typeof role !== 'string') return false;
  if (!Object.prototype.hasOwnProperty.call(GROUP_CAPABILITIES, capability)) return false;
  return (GROUP_CAPABILITIES[capability] as readonly string[]).includes(role);
}
