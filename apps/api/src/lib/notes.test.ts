import { describe, expect, it } from 'vitest';
import { INITIAL_BOARD_NAME } from '@wally/shared';
import type { WhiteboardRole } from '@wally/shared';
import type { Board } from './db/types.js';
import { assertValidAssignee, computeMoveUpdate } from './notes.js';
import { AppError } from './errors.js';

describe('computeMoveUpdate', () => {
  const base = { horizon: 'TODAY' as const, priority: 'MEDIUM' as const, freeX: 10, freeY: 20 };

  it('HORIZON mode writes only horizon, leaving priority/freeX/freeY untouched', () => {
    const { data, metadata } = computeMoveUpdate(base, { mode: 'HORIZON', horizon: 'LATER' });
    expect(data).toEqual({ horizon: 'LATER' });
    expect(data).not.toHaveProperty('priority');
    expect(data).not.toHaveProperty('freeX');
    expect(data).not.toHaveProperty('freeY');
    expect(metadata).toEqual({ mode: 'HORIZON', from: 'TODAY', to: 'LATER' });
  });

  it('PRIORITY mode writes only priority, leaving horizon/freeX/freeY untouched', () => {
    const { data, metadata } = computeMoveUpdate(base, { mode: 'PRIORITY', priority: 'HIGH' });
    expect(data).toEqual({ priority: 'HIGH' });
    expect(data).not.toHaveProperty('horizon');
    expect(data).not.toHaveProperty('freeX');
    expect(data).not.toHaveProperty('freeY');
    expect(metadata).toEqual({ mode: 'PRIORITY', from: 'MEDIUM', to: 'HIGH' });
  });

  it('FREE mode writes only freeX/freeY, leaving horizon/priority untouched', () => {
    const { data, metadata } = computeMoveUpdate(base, { mode: 'FREE', x: 111, y: 222 });
    expect(data).toEqual({ freeX: 111, freeY: 222 });
    expect(data).not.toHaveProperty('horizon');
    expect(data).not.toHaveProperty('priority');
    expect(metadata).toEqual({
      mode: 'FREE',
      from: { x: 10, y: 20 },
      to: { x: 111, y: 222 },
    });
  });
});

describe('assertValidAssignee', () => {
  // A plain board literal, no database: the check is a pure function over the board that
  // requireWhiteboardAccess has already loaded, rather than a second read of its own.
  function makeBoard(memberRoles: Record<string, WhiteboardRole>): Board {
    const timestamp = new Date();
    return {
      id: 'board-1',
      name: INITIAL_BOARD_NAME.de,
      ownerId: 'u-owner',
      revision: 1,
      deletedAt: null,
      assistantDisabled: false,
      memberRoles,
      shareLinkToken: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  // liveBoard computes memberRoles from ACTIVE members only, so a PENDING invite is not in it.
  const board = makeBoard({ 'u-editor': 'EDIT' });

  it('allows null (unassign)', () => {
    expect(() => assertValidAssignee(board, null)).not.toThrow();
  });

  it('allows the board owner', () => {
    expect(() => assertValidAssignee(board, 'u-owner')).not.toThrow();
  });

  it('allows an ACTIVE member', () => {
    expect(() => assertValidAssignee(board, 'u-editor')).not.toThrow();
  });

  it('rejects a PENDING member', () => {
    expect(() => assertValidAssignee(board, 'u-pending')).toThrow(AppError);
  });

  it('rejects a non-member', () => {
    expect(() => assertValidAssignee(board, 'u-outsider')).toThrow(AppError);
  });

  it.each(['constructor', 'toString', '__proto__'])('rejects inherited property %s', (id) => {
    expect(() => assertValidAssignee(board, id)).toThrow(AppError);
  });

  it('rejects an inherited role even when its value is EDIT', () => {
    const roles = Object.create({ 'u-inherited': 'EDIT' }) as Record<string, WhiteboardRole>;
    expect(() => assertValidAssignee(makeBoard(roles), 'u-inherited')).toThrow(AppError);
  });

  it('allows active viewers and own properties whose names also exist on Object.prototype', () => {
    const active = makeBoard({ 'u-viewer': 'VIEW', constructor: 'EDIT' as const });
    expect(() => assertValidAssignee(active, 'u-viewer')).not.toThrow();
    expect(() => assertValidAssignee(active, 'constructor')).not.toThrow();
  });
});
