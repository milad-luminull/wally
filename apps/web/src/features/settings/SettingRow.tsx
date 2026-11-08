import type { ReactNode } from 'react';

/**
 * One setting: label and optional hint on the left, the control on the right. The caller
 * gives the hint an id and points the control's `aria-describedby` at it.
 */
export function SettingRow({
  label,
  hint,
  hintId,
  htmlFor,
  status,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  hintId?: string;
  htmlFor?: string;
  /** A live status line under the label that takes no space, so the row never moves. */
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-row-text">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="setting-row-label">
            {label}
          </label>
        ) : (
          <span className="setting-row-label">{label}</span>
        )}
        {hint && (
          <p id={hintId} className="setting-row-hint">
            {hint}
          </p>
        )}
        {status !== undefined && (
          <p role="status" className="setting-row-status">
            {status}
          </p>
        )}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}
