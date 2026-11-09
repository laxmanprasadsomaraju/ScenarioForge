import type { EvidenceReference } from '@shared/domain/types';

const KIND_LABELS: Record<EvidenceReference['kind'], string> = {
  'jira-issue': 'Change record',
  'confluence-page': 'Runbook page',
  'jsm-service': 'Service record',
  'runbook-step': 'Runbook',
  'scenario-rule': 'Scenario rule',
};

export function EvidenceItem({ evidence }: { evidence: EvidenceReference }) {
  return (
    <figure className="evidence">
      <figcaption>
        <span className="evidence-kind">{KIND_LABELS[evidence.kind]}</span>
        <span className="evidence-title">{evidence.title}</span>
      </figcaption>
      {evidence.excerpt ? <blockquote>{evidence.excerpt}</blockquote> : null}
    </figure>
  );
}

export function EvidenceList({ items }: { items: EvidenceReference[] }) {
  return (
    <div className="evidence-list">
      {items.map((e) => (
        <EvidenceItem key={e.id} evidence={e} />
      ))}
    </div>
  );
}
