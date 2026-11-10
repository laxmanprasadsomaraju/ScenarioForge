import { useId, useState, type ReactNode } from 'react';
import type { EvidenceReference } from '@shared/domain/types';
import type {
  GraphEdge,
  GraphNode,
  GraphSource,
  ReadinessGraph,
  SourceStatus,
  UnassessedLink,
} from '@shared/graph/types';
import { useSite } from '../../lib/site';
import { confluencePath } from './Analysis';
import { buildImpactModel, type Hop, type ImpactRow, type Slot } from './impactModel';

export const SOURCE_LABELS: Record<GraphSource | 'm3-analysis', string> = {
  jira: 'Jira',
  confluence: 'Confluence',
  jsm: 'JSM',
  'teamwork-graph': 'Teamwork Graph',
  'm3-analysis': 'Change analysis',
};

const STATUS_LABELS: Record<SourceStatus['status'], string> = {
  used: 'Used',
  'not-connected': 'Not connected',
  'not-permitted': 'Not permitted',
  error: 'Error',
};

const CONFIDENCE_WORDS: Record<GraphEdge['confidence'], string> = {
  confirmed: 'Confirmed',
  suspected: 'Suspected',
};

type Role = 'change' | 'subject' | 'step' | 'page' | 'service' | 'team' | 'replacement';

const ROLE_LABELS: Record<Role, string> = {
  change: 'Change',
  subject: 'Subject',
  replacement: 'Replaced by',
  step: 'Recovery step',
  page: 'Runbook page',
  service: 'Service',
  team: 'Owning team',
};

/**
 * A site-relative link for a source, or null. Only Jira (`/browse/…`) and
 * Confluence (`/wiki/…`) paths on the current site are opened; a Confluence
 * web UI path is placed under /wiki and an absolute URL is reduced to its path.
 */
export function sourcePath(
  url: string | undefined,
  kind?: EvidenceReference['kind'],
): { path: string; product: 'Jira' | 'Confluence' } | null {
  if (!url) return null;
  let path = url;
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  }
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  if (path.startsWith('/browse/')) return { path, product: 'Jira' };
  if (path.startsWith('/wiki/')) return { path, product: 'Confluence' };
  if (kind === 'confluence-page' || kind === 'runbook-step') {
    const wiki = confluencePath(path);
    return wiki ? { path: wiki, product: 'Confluence' } : null;
  }
  return null;
}

export function ImpactPath({ graph }: { graph: ReadinessGraph }) {
  const model = buildImpactModel(graph);
  const pathCount = model.groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="impact">
      <SourcesStrip sources={graph.sources} />

      {model.groups.length === 0 ? (
        <p className="region-body">
          The check named nothing this change retires, replaces, migrates, renames, disables or
          upgrades, so there is no path to follow.
        </p>
      ) : (
        <>
          <p className="results-meta">
            {pathCount === 1 ? '1 path' : `${pathCount} paths`} through{' '}
            {model.groups.length === 1 ? '1 subject' : `${model.groups.length} subjects`}
          </p>
          <ul className="impact-groups">
            {model.groups.map((group) => (
              <SubjectGroupItem key={group.subject.node.id} group={group} change={model.change} />
            ))}
          </ul>
        </>
      )}

      {model.direct.length > 0 ? (
        <section className="impact-direct" aria-labelledby="impact-direct-title">
          <h3 id="impact-direct-title" className="impact-group-title">
            Services the change names directly
          </h3>
          <ul className="impact-paths">
            {model.direct.map(({ service, teamSlot }) => (
              <li key={service.node.id} className="impact-row">
                <ol className="hops">
                  <HopItem role="service" hop={service} />
                  <SlotItems role="team" slot={teamSlot} noneText={noneTeam(service)} />
                </ol>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {model.otherUnassessed.length > 0 ? (
        <section className="impact-direct" aria-labelledby="impact-other-title">
          <h3 id="impact-other-title" className="impact-group-title">
            Also not assessed
          </h3>
          <ul className="hops">
            {model.otherUnassessed.map((u, i) => (
              <MissingItem
                key={`${u.from}-${u.expected}-${i}`}
                role={u.expected === 'service' ? 'service' : 'team'}
                link={u}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function noneTeam(service: Hop | null) {
  return service
    ? 'No owning team was returned for this service.'
    : 'Not checked: there is no service to look up an owner for.';
}

function SubjectGroupItem({
  group,
  change,
}: {
  group: ReturnType<typeof buildImpactModel>['groups'][0];
  change: GraphNode | null;
}) {
  const titleId = useId();
  const { subject, replacedBy, rows } = group;
  return (
    <li className="impact-group" aria-labelledby={titleId}>
      <h3 id={titleId} className="impact-group-title">
        {subject.node.label}
      </h3>
      <ol className="hops hops-subject">
        {subject.edge ? (
          // The group is the subject; this hop names the change that names it.
          <HopItem
            role={change ? 'change' : 'subject'}
            hop={{ node: change ?? subject.node, edge: subject.edge }}
          />
        ) : null}
        {replacedBy.map((hop) => (
          <HopItem key={hop.edge.id} role="replacement" hop={hop} />
        ))}
      </ol>
      {rows.length === 0 ? (
        <p className="region-body">No recovery step in the runbooks read depends on it.</p>
      ) : (
        <ol className="impact-paths">
          {rows.map((row, i) => (
            <PathRow key={row.id} row={row} index={i + 1} total={rows.length} />
          ))}
        </ol>
      )}
    </li>
  );
}

function PathRow({ row, index, total }: { row: ImpactRow; index: number; total: number }) {
  const label = `Path ${index} of ${total}: ${row.step.node.label}${
    row.page ? ` of ${row.page.node.label}` : ''
  }${row.service ? `, service ${row.service.node.label}` : ''}`;
  return (
    <li className="impact-row" aria-label={label}>
      <ol className="hops">
        <HopItem role="step" hop={row.step} />
        {row.page ? (
          <HopItem role="page" hop={row.page} />
        ) : (
          <NoneItem role="page" text="No runbook page link was returned for this step." />
        )}
        <SlotItems
          role="service"
          slot={row.serviceSlot}
          noneText="No service link was returned for this runbook page."
        />
        <SlotItems role="team" slot={row.teamSlot} noneText={noneTeam(row.service)} />
      </ol>
    </li>
  );
}

function SlotItems({ role, slot, noneText }: { role: Role; slot: Slot; noneText: string }) {
  if (slot.kind === 'hops') {
    return (
      <>
        {slot.hops.map((hop) => (
          <HopItem key={hop.edge.id} role={role} hop={hop} />
        ))}
      </>
    );
  }
  if (slot.kind === 'not-assessed') {
    return (
      <>
        {slot.links.map((link, i) => (
          <MissingItem key={`${link.from}-${i}`} role={role} link={link} />
        ))}
      </>
    );
  }
  return <NoneItem role={role} text={noneText} />;
}

function NodeName({ node, role }: { node: GraphNode; role: Role }) {
  const { openInJira } = useSite();
  const link = sourcePath(
    node.path,
    role === 'page' || role === 'step' ? 'confluence-page' : undefined,
  );
  return (
    <span className="hop-node">
      {link ? (
        <button
          type="button"
          className="issue-key hop-link"
          onClick={() => openInJira(link.path)}
          aria-label={`Open ${node.label} in ${link.product} (new tab)`}
        >
          {node.label}
        </button>
      ) : (
        <span className="hop-name">{node.label}</span>
      )}
      {node.origin === 'demo' ? <span className="hop-demo">Synthetic demo data</span> : null}
    </span>
  );
}

/** One node on the path and the evidenced link that reaches it. */
function HopItem({ role, hop }: { role: Role; hop: Hop }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { edge } = hop;
  const count = edge.evidence.length;
  const visible = count === 1 ? 'Evidence' : `Evidence (${count})`;
  return (
    <li className="hop">
      <span className="hop-kind">{ROLE_LABELS[role]}</span>
      <NodeName node={hop.node} role={role} />
      <span className="hop-meta">
        <span className={`link-confidence link-${edge.confidence}`}>
          {CONFIDENCE_WORDS[edge.confidence]}
        </span>
        <span className="hop-source">from {SOURCE_LABELS[edge.source]}</span>
        <button
          type="button"
          className="disclosure"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${visible} for ${ROLE_LABELS[role]} ${hop.node.label}`}
          onClick={() => setOpen((v) => !v)}
        >
          {visible}
        </button>
      </span>
      <div id={panelId} className="hop-evidence" hidden={!open}>
        {open ? <EvidencePanel edge={edge} /> : null}
      </div>
    </li>
  );
}

function EvidencePanel({ edge }: { edge: GraphEdge }) {
  const { openInJira } = useSite();
  return (
    <>
      <p className="hop-basis">
        <span className="hop-basis-label">Why linked</span> {edge.basis}
      </p>
      {edge.evidence.length === 0 ? (
        <p className="region-body">No evidence was returned for this link.</p>
      ) : (
        <ul className="evidence-list">
          {edge.evidence.map((e) => {
            const link = sourcePath(e.url, e.kind);
            return (
              <li key={e.id} className="source">
                <span className="source-title">{e.title}</span>
                {e.excerpt ? (
                  <blockquote className="quote">{e.excerpt}</blockquote>
                ) : (
                  <p className="source-nolink">This source has no text to quote.</p>
                )}
                {link ? (
                  <div>
                    <button
                      type="button"
                      className="issue-key hop-link"
                      onClick={() => openInJira(link.path)}
                    >
                      Open {e.title} in {link.product}
                    </button>
                  </div>
                ) : (
                  <p className="source-nolink">No link was returned for this source.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** A link the graph could not check: stated in words, never drawn as a node. */
function MissingItem({ role, link }: { role: Role; link: UnassessedLink }) {
  return (
    <li className="hop hop-missing">
      <span className="hop-kind">{ROLE_LABELS[role]}</span>
      <span className="hop-node hop-unassessed">Not assessed</span>
      <span className="hop-reason">
        {link.reason} <span className="hop-source">({SOURCE_LABELS[link.source]})</span>
      </span>
    </li>
  );
}

function NoneItem({ role, text }: { role: Role; text: string }) {
  return (
    <li className="hop hop-missing">
      <span className="hop-kind">{ROLE_LABELS[role]}</span>
      <span className="hop-node hop-unassessed">None returned</span>
      <span className="hop-reason">{text}</span>
    </li>
  );
}

function SourcesStrip({ sources }: { sources: SourceStatus[] }): ReactNode {
  if (sources.length === 0) {
    return <p className="region-body">The graph did not say which sources it read.</p>;
  }
  return (
    <div className="sources-strip">
      <h3 className="sources-title" id="impact-sources-title">
        Sources
      </h3>
      <ul aria-labelledby="impact-sources-title">
        {sources.map((s) => (
          <li key={s.source} className={`source-status source-status-${s.status}`}>
            <span className="source-status-name">{SOURCE_LABELS[s.source]}</span>
            <span className="source-status-word">{STATUS_LABELS[s.status]}</span>
            {s.detail ? <span className="source-status-detail">{s.detail}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
