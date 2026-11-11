/**
 * TEST-ONLY `whoami-probe` action (docs/M6_DEPLOYMENT_READINESS.md §1.4).
 * `rovo-test` build only; removed in the next `rovo-test` deploy.
 *
 * Calls `GET /rest/api/3/myself` AS THE USER through the injected
 * `requestMyself` and returns only whether the returned accountId equals the
 * invocation's accountId, plus the HTTP status. There is no app-identity
 * fallback: if the user call fails, the probe reports the failure.
 *
 * Logs contain key names, the location of `accountId` and error names only,
 * never an accountId or any Jira field value.
 */

export interface MyselfResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface WhoamiProbeDeps {
  /** Must call Jira as the invoking user (`api.asUser()`). */
  requestMyself: () => Promise<MyselfResponse>;
  log: (line: string) => void;
}

export interface WhoamiProbeResult {
  accountIdMatch: boolean | null;
  httpStatus: number | null;
}

export type AccountIdLocation = 'context' | 'payload.context' | 'none';

type Bag = Record<string, unknown>;

const asBag = (value: unknown): Bag | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Bag) : undefined;

const keysOf = (value: unknown): string[] => Object.keys(asBag(value) ?? {}).sort();

/**
 * Where the invocation's accountId was found. The Action page says "The
 * `context` contains the user's `accountId`" without saying whether that is
 * the second argument or `payload.context`, so both are checked.
 */
export function locateAccountId(
  payload: unknown,
  context: unknown,
): { accountId: string | undefined; location: AccountIdLocation } {
  const fromContext = asBag(context)?.accountId;
  if (typeof fromContext === 'string' && fromContext.length > 0) {
    return { accountId: fromContext, location: 'context' };
  }
  const fromPayload = asBag(asBag(payload)?.context)?.accountId;
  if (typeof fromPayload === 'string' && fromPayload.length > 0) {
    return { accountId: fromPayload, location: 'payload.context' };
  }
  return { accountId: undefined, location: 'none' };
}

export async function runWhoamiProbe(
  deps: WhoamiProbeDeps,
  payload: unknown,
  context: unknown,
): Promise<WhoamiProbeResult> {
  const { accountId, location } = locateAccountId(payload, context);
  deps.log(
    JSON.stringify({
      probe: 'whoami',
      contextKeys: keysOf(context),
      payloadKeys: keysOf(payload),
      payloadContextKeys: keysOf(asBag(payload)?.context),
      accountIdIn: location,
    }),
  );
  try {
    const res = await deps.requestMyself();
    if (!res.ok) {
      deps.log(JSON.stringify({ probe: 'whoami', httpStatus: res.status }));
      return { accountIdMatch: null, httpStatus: res.status };
    }
    let returned: unknown;
    try {
      returned = asBag(await res.json())?.accountId;
    } catch {
      deps.log(JSON.stringify({ probe: 'whoami', httpStatus: res.status, body: 'unparseable' }));
      return { accountIdMatch: null, httpStatus: res.status };
    }
    const accountIdMatch =
      accountId === undefined || typeof returned !== 'string' ? null : returned === accountId;
    deps.log(JSON.stringify({ probe: 'whoami', httpStatus: res.status, accountIdMatch }));
    return { accountIdMatch, httpStatus: res.status };
  } catch (error) {
    const e = asBag(error);
    const name = typeof e?.name === 'string' ? e.name : 'Error';
    const status = typeof e?.status === 'number' ? e.status : null;
    deps.log(JSON.stringify({ probe: 'whoami', threw: name, httpStatus: status }));
    return { accountIdMatch: null, httpStatus: status };
  }
}
