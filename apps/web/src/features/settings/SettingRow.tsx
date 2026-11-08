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
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  hintId?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="min-w-0">
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
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}
