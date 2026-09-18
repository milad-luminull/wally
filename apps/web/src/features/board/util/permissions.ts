import type { EffectiveRole } from '@wally/shared';

/** SPEC §9: only VIEW is read-only — OWNER and EDIT can both modify notes. */
export function canEdit(role: EffectiveRole | undefined): boolean {
  return role === 'OWNER' || role === 'EDIT';
}

export function isOwner(role: EffectiveRole | undefined): boolean {
  return role === 'OWNER';
}
