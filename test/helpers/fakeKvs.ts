import type {
  GovernanceKvsClient,
  GovernanceRecord,
  WriteCondition,
} from '../../src/ai/forgeStorage';

/** Shape of a Forge KVS API error (ForgeKvsAPIError: code + responseDetails.status). */
export function apiError(status: number, code: string): Error {
  return Object.assign(new Error(code), { code, responseDetails: { status } });
}

/**
 * In-memory Custom Entity Store for one entity. A failed condition rejects
 * with a 400 and an arbitrary code, like the lane-a2 fake (the real code is
 * undocumented). `failOn` makes a chosen operation throw instead.
 */
export class FakeEntity implements GovernanceKvsClient {
  readonly rows = new Map<string, GovernanceRecord>();
  readonly ops: string[] = [];
  failOn: ((op: 'get' | 'set' | 'delete', key: string) => Error | undefined) | undefined;
  /** Model a store where `notExists` does not permit create-only writes. */
  rejectCreateOnly = false;

  private maybeFail(op: 'get' | 'set' | 'delete', key: string) {
    const error = this.failOn?.(op, key);
    if (error) throw error;
  }

  async get(key: string) {
    this.ops.push(`get ${key}`);
    this.maybeFail('get', key);
    const row = this.rows.get(key);
    return row ? { ...row } : undefined;
  }

  async conditionalSet(key: string, record: GovernanceRecord, condition: WriteCondition) {
    this.ops.push(`set ${key}`);
    this.maybeFail('set', key);
    const current = this.rows.get(key);
    const met =
      condition.kind === 'absent'
        ? current === undefined && !this.rejectCreateOnly
        : current !== undefined && current.version === condition.equals;
    if (!met) throw apiError(400, 'SOME_UNDOCUMENTED_CONDITION_CODE');
    this.rows.set(key, { ...record });
  }

  async delete(key: string) {
    this.ops.push(`delete ${key}`);
    this.maybeFail('delete', key);
    this.rows.delete(key);
  }
}

/** One fake per entity name, created on first use. */
export function fakeStore() {
  const entities = new Map<string, FakeEntity>();
  const clientFor = (name: string): FakeEntity => {
    let entity = entities.get(name);
    if (!entity) {
      entity = new FakeEntity();
      entities.set(name, entity);
    }
    return entity;
  };
  return { entities, clientFor };
}
