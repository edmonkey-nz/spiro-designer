/** Small form controls, shared by every panel. */

import { useEffect, useId, useRef, useState } from 'react';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint ? <span className="field-hint" title={hint}>?</span> : null}
      </span>
      {children}
    </label>
  );
}

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hint?: string;
  integer?: boolean;
  disabled?: boolean;
}

/**
 * A number input that lets you type freely.
 *
 * Committing on every keystroke makes intermediate states like "" or "-" or
 * "0." impossible to type, so the raw text is held locally and only parsed
 * when it is a valid number.
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  hint,
  integer,
  disabled,
}: NumberFieldProps) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || Number.isNaN(n)) return;
    let v = integer ? Math.round(n) : n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
  };

  return (
    <Field label={label} hint={hint}>
      <span className="input-wrap">
        <input
          type="number"
          className="num"
          value={text}
          min={min}
          max={max}
          step={step ?? (integer ? 1 : 0.1)}
          disabled={disabled}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            commit(text);
            setText(String(value));
          }}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
        />
        {unit ? <span className="unit">{unit}</span> : null}
      </span>
    </Field>
  );
}

export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  hint,
  format,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  format?: (v: number) => string;
}) {
  return (
    <Field label={label} hint={hint}>
      <span className="slider-wrap">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="slider-value">
          {format ? format(value) : value}
          {unit ? <span className="unit"> {unit}</span> : null}
        </span>
      </span>
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Toggle({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <label className="toggle" htmlFor={id} title={hint}>
      <input id={id} type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Section({
  title,
  children,
  defaultOpen = true,
  right,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  right?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`panel-section${open ? ' open' : ''}`}>
      <div className="section-head">
        <button type="button" className="section-toggle" onClick={() => setOpen(!open)}>
          <span className="chevron">{open ? '▾' : '▸'}</span>
          {title}
        </button>
        {right}
      </div>
      {open ? <div className="section-body">{children}</div> : null}
    </section>
  );
}

export function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button type="button" className={`btn ${variant}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}
