'use client';

/** 几个反复用到的小零件。组件保持薄，逻辑都在 store 和 lib 里。 */

import type { ReactNode } from 'react';

export function Section({
  title,
  sub,
  children,
}: {
  title?: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <div className="section">
      {title ? <div className="section-title">{title}</div> : null}
      {sub ? <div className="section-sub">{sub}</div> : null}
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field-label">
        {label}
        {optional ? <span className="opt">{optional}</span> : null}
      </label>
      {children}
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

export function Toggle({
  name,
  desc,
  on,
  onChange,
}: {
  name: string;
  desc?: string;
  on: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-text">
        <span className="toggle-name">{name}</span>
        {desc ? <span className="toggle-desc">{desc}</span> : null}
      </div>
      <button
        type="button"
        className="switch"
        data-on={on}
        aria-pressed={on}
        aria-label={name}
        onClick={() => onChange(!on)}
      />
    </div>
  );
}

export function Note({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: 'warn' | 'accent';
}) {
  return (
    <div className="note" data-tone={tone}>
      {children}
    </div>
  );
}

export function Chip({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: 'accent' | 'warn' | 'danger';
}) {
  return (
    <span className="chip" data-tone={tone}>
      {children}
    </span>
  );
}
