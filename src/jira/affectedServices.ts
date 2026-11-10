import type { AffectedService, AffectedServicesProbe } from '../../shared/graph/jsm';
import { MAX_GRAPH_SERVICES } from '../../shared/graph/types';
import type { JiraIssueGateway, JiraResponse } from './client';

/**
 * JSM "Affected services" probe, using only the `read:jira-work` scope the app
 * already has. Both calls run as the user:
 *
 * 1. `GET /rest/api/3/field` (getFields; classic scope `read:jira-work`,
 *    Current) to find the Affected services field. It returns only fields
 *    the user can view, so the field id is looked up per invocation and never
 *    cached across invocations or users.
 * 2. `GET /rest/api/3/issue/{key}?fields=<field id>` (getIssue; same scope),
 *    the issue read the analysis already uses, asking only for that field.
 *
 * No Assets, service registry or JSM endpoint is called.
 */
export interface JiraFieldGateway {
  /** `GET /rest/api/3/field` */
  listFields(): Promise<JiraResponse>;
}

/**
 * Custom field type of the JSM Affected services field. Not stated in the
 * Jira REST spec; seen in Atlassian's public issue tracker (CONFCLOUD-76552)
 * as the field's `schema.custom`. A field with this type is the field.
 */
export const AFFECTED_SERVICES_CUSTOM_TYPE =
  'com.atlassian.jira.plugins.service-entity:service-entity-field-cftype';

const AFFECTED_SERVICES_NAME = 'affected services';

export interface AffectedServicesField {
  id: string;
  name: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function byId(a: AffectedServicesField, b: AffectedServicesField): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Finds the Affected services field in a `GET /rest/api/3/field` response.
 *
 * 1. A custom field whose `schema.custom` is `AFFECTED_SERVICES_CUSTOM_TYPE`.
 * 2. Otherwise a custom field named "Affected services" (any case) whose
 *    schema is an array of service items (`schema.items` mentions "service").
 *    The name alone is never enough: any admin can create a text field with
 *    that name.
 *
 * Several matches at the same rule: the lowest id, so the choice is stable.
 * Returns `null` when no field matches and `undefined` when the response is
 * not a field list.
 */
export function findAffectedServicesField(body: unknown): AffectedServicesField | null | undefined {
  if (!Array.isArray(body)) return undefined;
  const byType: AffectedServicesField[] = [];
  const byName: AffectedServicesField[] = [];
  for (const raw of body) {
    const field = asRecord(raw);
    const id = asString(field?.id);
    const name = asString(field?.name);
    const schema = asRecord(field?.schema);
    if (!field || !id || !name || field.custom !== true || !schema) continue;
    if (schema.custom === AFFECTED_SERVICES_CUSTOM_TYPE) {
      byType.push({ id, name });
      continue;
    }
    const items = asString(schema.items);
    if (
      name.trim().toLowerCase() === AFFECTED_SERVICES_NAME &&
      schema.type === 'array' &&
      items !== null &&
      /service/i.test(items)
    ) {
      byName.push({ id, name });
    }
  }
  const matches = byType.length > 0 ? byType : byName;
  return matches.length > 0 ? [...matches].sort(byId)[0]! : null;
}

export interface ParsedAffectedServices {
  services: AffectedService[];
  omitted: number;
}

/**
 * Parses the field value. Only one shape is accepted: `null` (empty) or an
 * array of objects that each carry a non-empty string `id`, with optional
 * string `name`, `workspaceId` and `objectId` (other keys are ignored). Any
 * other shape (a string, an object, an entry without a string `id`, or a
 * known key holding a non-string) returns `null` (unreadable): the probe
 * never guesses which key holds a service.
 *
 * Entries are kept in field order; a repeated id is kept once. At most
 * `MAX_GRAPH_SERVICES` are returned, the rest are counted in `omitted`.
 */
export function parseAffectedServicesValue(value: unknown): ParsedAffectedServices | null {
  if (value === null || value === undefined) return { services: [], omitted: 0 };
  if (!Array.isArray(value)) return null;
  const services: AffectedService[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const entry = asRecord(raw);
    if (!entry) return null;
    const id = asString(entry.id);
    if (!id) return null;
    for (const key of ['name', 'workspaceId', 'objectId'] as const) {
      if (entry[key] !== undefined && entry[key] !== null && asString(entry[key]) === null) {
        return null;
      }
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const workspaceId = asString(entry.workspaceId);
    const objectId = asString(entry.objectId);
    services.push({
      id,
      name: asString(entry.name),
      ...(workspaceId ? { assetsWorkspaceId: workspaceId } : {}),
      ...(objectId ? { assetsObjectId: objectId } : {}),
    });
  }
  return {
    services: services.slice(0, MAX_GRAPH_SERVICES),
    omitted: Math.max(0, services.length - MAX_GRAPH_SERVICES),
  };
}

async function readJson(response: JiraResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function failure(status: number, what: string): AffectedServicesProbe {
  if (status === 401 || status === 403) {
    return {
      kind: 'not-permitted',
      detail: `Jira did not let ScenarioForge ${what} as you (HTTP ${status}).`,
    };
  }
  return { kind: 'error', detail: `Jira returned HTTP ${status} when asked to ${what}.` };
}

/**
 * Runs the probe for one change. Never throws and never fails the graph: any
 * problem becomes a `not-permitted` or `error` probe, which the graph shows as
 * the JSM source status. `issueKey` is the key the analysis already read.
 */
export async function probeAffectedServices(
  gateway: JiraIssueGateway & JiraFieldGateway,
  issueKey: string,
  now: () => Date = () => new Date(),
): Promise<AffectedServicesProbe> {
  try {
    const fieldsResponse = await gateway.listFields();
    if (!fieldsResponse.ok) {
      return failure(fieldsResponse.status, 'list Jira fields');
    }
    const field = findAffectedServicesField(await readJson(fieldsResponse));
    if (field === undefined) {
      return { kind: 'error', detail: 'Jira returned a field list ScenarioForge could not read.' };
    }
    if (field === null) {
      return { kind: 'no-field' };
    }

    const issueResponse = await gateway.getIssue(
      issueKey,
      new URLSearchParams({ fields: field.id }),
    );
    if (!issueResponse.ok) {
      return failure(issueResponse.status, `read ${field.name} on ${issueKey}`);
    }
    const issue = asRecord(await readJson(issueResponse));
    const fields = asRecord(issue?.fields);
    if (!fields) {
      return {
        kind: 'error',
        detail: `Jira returned ${issueKey} in a shape ScenarioForge could not read.`,
      };
    }
    const present = Object.prototype.hasOwnProperty.call(fields, field.id);
    const parsed = parseAffectedServicesValue(fields[field.id]);
    if (!parsed) {
      return {
        kind: 'error',
        detail: `${field.name} on ${issueKey} has a value ScenarioForge could not read, so no service is shown.`,
      };
    }
    return {
      kind: 'read',
      issueKey,
      browsePath: `/browse/${issueKey}`,
      fieldId: field.id,
      fieldName: field.name,
      present,
      services: parsed.services,
      omitted: parsed.omitted,
      retrievedAt: now().toISOString(),
    };
  } catch (error) {
    console.error(
      'Affected services probe failed',
      error instanceof Error ? error.message : 'unknown',
    );
    return {
      kind: 'error',
      detail: 'ScenarioForge could not reach Jira to read Affected services.',
    };
  }
}
