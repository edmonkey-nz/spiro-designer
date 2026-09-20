/** Live design rules. Advisory by design — nothing here blocks a build. */

import type { Issue } from '../../geom/validate';
import { useDesign } from '../../state/design';
import { Section } from '../widgets';

const ICON: Record<Issue['severity'], string> = {
  error: '✕',
  warning: '!',
  info: 'i',
};

export function IssuePanel({ issues }: { issues: Issue[] }) {
  const selectPart = useDesign((s) => s.selectPart);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  return (
    <Section
      title="Checks"
      right={
        <span className="badges">
          {errors > 0 ? <span className="badge error">{errors}</span> : null}
          {warnings > 0 ? <span className="badge warning">{warnings}</span> : null}
          {errors === 0 && warnings === 0 ? <span className="badge ok">ok</span> : null}
        </span>
      }
    >
      {issues.length === 0 ? (
        <p className="note">Nothing to flag. Cut the fit coupon before committing to a full ring.</p>
      ) : (
        <ul className="issues">
          {issues.map((issue, i) => (
            <li key={`${issue.code}-${i}`} className={`issue ${issue.severity}`}>
              <span className="issue-icon">{ICON[issue.severity]}</span>
              <span className="issue-text">
                {issue.message}
                {issue.partId ? (
                  <button type="button" className="link" onClick={() => selectPart(issue.partId!)}>
                    show part
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
