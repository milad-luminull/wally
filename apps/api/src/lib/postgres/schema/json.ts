import type { Timestamp } from 'firebase-admin/firestore';

/**
 * A stored Firestore shape as a jsonb value: every Timestamp inside it becomes an ISO
 * string, since JSON has no instant type. Top-level instants are `timestamptz` columns.
 */
export type AsJson<T> = T extends Timestamp
  ? string
  : T extends readonly (infer Item)[]
    ? AsJson<Item>[]
    : T extends object
      ? { [Key in keyof T]: AsJson<T[Key]> }
      : T;
