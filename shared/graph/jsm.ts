import type { ChangeAnalysis } from '../analysis/types';
import type { EvidenceReference } from '../domain/types';
import type { GraphExtras } from './build';
import { changeNodeId, pageNodeId } from './build';
import type { GraphEdge, GraphNode, SourceStatus, UnassessedLink } from './types';
import { MAX_GRAPH_SERVICES } from './types';

/**
 * JSM "Affected services" probe → readiness graph extras.
 *
 * The probe reads one Jira field on the change with the existing
 * `read:jira-work` scope (see src/jira/affectedServices.ts). It names the
 * services the change affects; it does not say which service a runbook
 * recovers or which team owns a service, so neither link is drawn here.
 */

/** One service as written in the Affected services field. */
export interface AffectedService {
  /** The `id` of the field value entry, kept verbatim (a service ARI on the sites seen so far). */
  id: string;
  /** The `name` of the entry when the field carries one; never derived from the id. */
  name: string | null;
  /** Assets ids, when the entry carries them; kept for the Assets proposal, never resolved. */
  assetsWorkspaceId?: string;
  assetsObjectId?: string;
}

/** What the probe learned, in a form the pure builder can map. */
export type AffectedServicesProbe =
  /** The site has no Affected services field the user can see. */
  | { kind: 'no-field' }
  /** The field exists and was read on the change. */
  | {
      kind: 'read';
      issueKey: string;
      browsePath: string;
      fieldId: string;
      fieldName: string;
      /** False when the issue response did not include the field at all. */
      present: boolean;
      services: AffectedService[];
      /** Entries left out because of `MAX_GRAPH_SERVICES`. */
      omitted: number;
      retrievedAt: string;
    }
  /** A call failed or returned something the probe could not read. */
  | { kind: 'not-permitted' | 'error'; detail: string };

export const NO_AFFECTED_SERVICES_FIELD = 'No Affected services field on this site.';
export const TEAM_SOURCE_REASON = 'Teamwork Graph is not connected yet.';
export const JSM_PAGE_SERVICE_REASON =
  'Affected services names the services a change affects, not the service a runbook recovers.';

export function serviceNodeId(serviceId: string): string {
  return `service:jsm:${serviceId}`;
}

function serviceLabel(service: AffectedService): string {
  return service.name ?? service.id;
}

function pagesWithFindings(analysis: ChangeAnalysis): string[] {
  const pages: string[] = [];
  for (const finding of analysis.findings) {
    const id = pageNodeId(finding.pageId);
    if (!pages.includes(id)) pages.push(id);
  }
  return pages;
}

function readDetail(probe: Extract<AffectedServicesProbe, { kind: 'read' }>): string {
  const count = probe.services.length + probe.omitted;
  const parts = [`Affected services field read on ${probe.issueKey}: ${count} service(s).`];
  if (probe.omitted > 0) {
    parts.push(`Showing the first ${probe.services.length}.`);
  }
  const unnamed = probe.services.filter((s) => s.name === null).length;
  if (unnamed > 0) {
    parts.push(
      `${unnamed} without a name in the field; shown by id (resolving names needs Assets, not connected).`,
    );
  }
  return parts.join(' ');
}

/**
 * Pure and deterministic: the same analysis and probe give the same extras.
 *
 * - `read` with services: one `service` node and one confirmed
 *   `change-impacts-service` edge per service, in field order. Each service's
 *   owning team stays unassessed (Teamwork Graph).
 * - `read` without services: no node; the change gets an unassessed service
 *   link saying the field is empty.
 * - `read` either way: pages with a finding keep an unassessed JSM service
 *   link, because the field does not name the service a runbook recovers.
 * - `no-field`, `not-permitted`, `error`: only the JSM source status; the
 *   builder then lists the missing service per page.
 */
export function jsmGraphExtras(
  analysis: ChangeAnalysis,
  probe: AffectedServicesProbe,
): Pick<GraphExtras, 'nodes' | 'edges' | 'unassessed' | 'sources'> {
  if (probe.kind === 'no-field') {
    return {
      sources: [{ source: 'jsm', status: 'not-connected', detail: NO_AFFECTED_SERVICES_FIELD }],
    };
  }
  if (probe.kind !== 'read') {
    return { sources: [{ source: 'jsm', status: probe.kind, detail: probe.detail }] };
  }

  const changeId = changeNodeId(analysis.change.key);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const unassessed: UnassessedLink[] = [];

  for (const service of probe.services.slice(0, MAX_GRAPH_SERVICES)) {
    const serviceId = serviceNodeId(service.id);
    const label = serviceLabel(service);
    nodes.push({ id: serviceId, kind: 'service', label, origin: 'live', source: 'jsm' });
    const evidence: EvidenceReference = {
      id: `${probe.issueKey}:jsm:${probe.fieldId}:${service.id}`,
      origin: 'live',
      kind: 'jsm-service',
      title: `${probe.issueKey}: ${probe.fieldName}`,
      excerpt: label,
      url: probe.browsePath,
      retrievedAt: probe.retrievedAt,
    };
    edges.push({
      id: `edge:impacts:${probe.issueKey}:${service.id}`,
      kind: 'change-impacts-service',
      from: changeId,
      to: serviceId,
      confidence: 'confirmed',
      basis: `${probe.issueKey} lists ${label} in its ${probe.fieldName} field.`,
      source: 'jsm',
      evidence: [evidence],
    });
    unassessed.push({
      from: serviceId,
      expected: 'team',
      source: 'teamwork-graph',
      reason: TEAM_SOURCE_REASON,
    });
  }

  if (probe.services.length === 0) {
    unassessed.push({
      from: changeId,
      expected: 'service',
      source: 'jsm',
      reason: probe.present
        ? `Affected services is empty on ${probe.issueKey}.`
        : `Affected services is empty on ${probe.issueKey} (Jira did not return the field for this issue).`,
    });
  }
  for (const page of pagesWithFindings(analysis)) {
    unassessed.push({
      from: page,
      expected: 'service',
      source: 'jsm',
      reason: JSM_PAGE_SERVICE_REASON,
    });
  }

  const status: SourceStatus = { source: 'jsm', status: 'used', detail: readDetail(probe) };
  return { nodes, edges, unassessed, sources: [status] };
}
