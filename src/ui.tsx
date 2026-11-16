// Buzz's design-system controls as installed plugins can have them. Buzz
// exposes no components to plugins, but its controls are styled by global
// `buzz-*` classes, so the same markup looks and behaves the same: buttons,
// fields, inputs, settings groups and preference rows. Layout
// that Buzz keeps in CSS modules is written inline here.
import type { ReactNode } from "react";
import { React } from "./react";

export function Button({
  children,
  variant = "outline",
  size = "md",
  type = "button",
  disabled,
  label,
  onClick,
  wide,
}: {
  children: ReactNode;
  variant?: "outline" | "subtle" | "prominent";
  size?: "sm" | "md";
  type?: "button" | "submit";
  disabled?: boolean;
  /** Its accessible name, when the visible text is not enough. */
  label?: string;
  onClick?: () => void;
  wide?: boolean;
}) {
  return (
    <button
      type={type}
      data-buzz-ui=""
      className="buzz-button"
      data-variant={variant}
      data-size={size}
      data-button-shape="control"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      style={wide ? { width: "100%" } : undefined}
    >
      <span className="buzz-button-label">{children}</span>
    </button>
  );
}

export function SettingsGroup({
  children,
  layout = "rows",
}: {
  children: ReactNode;
  layout?: "rows" | "form" | "cards";
}) {
  return (
    <div data-buzz-ui="" className="buzz-settings-group" data-layout={layout}>
      {children}
    </div>
  );
}

export function PreferenceRow({
  title,
  description,
  trailing,
  titleId,
}: {
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  titleId?: string;
}) {
  return (
    <div data-buzz-ui="" className="buzz-preference-row" data-variant="default">
      <div className="buzz-preference-row-content">
        <div id={titleId} className="buzz-preference-row-label">
          {title}
        </div>
        {description && (
          <span className="buzz-preference-row-description">
            {description}
          </span>
        )}
      </div>
      {trailing != null && (
        <div className="buzz-preference-row-trailing">{trailing}</div>
      )}
    </div>
  );
}

export function Field({
  label,
  description,
  error,
  optional,
  children,
  id,
}: {
  label: string;
  description?: ReactNode;
  error?: string | undefined;
  optional?: boolean;
  children: ReactNode;
  id: string;
}) {
  return (
    <div
      data-buzz-ui=""
      className="buzz-field"
      data-invalid={error ? "" : undefined}
    >
      <label htmlFor={id} className="buzz-field-label">
        {label}
        {optional && (
          <>
            {" "}
            <span className="buzz-field-optional">Optional</span>
          </>
        )}
      </label>
      {children}
      {description && !error && (
        <p className="buzz-field-description">{description}</p>
      )}
      {error && (
        <div className="buzz-field-error-track">
          <p role="alert" className="buzz-field-error">
            {error}
          </p>
        </div>
      )}
    </div>
  );
}

export function TextInput({
  id,
  value,
  disabled,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange(value: string): void;
}) {
  return (
    <input
      id={id}
      data-buzz-ui=""
      className="buzz-input"
      data-size="md"
      value={value}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="none"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}



/** A native select in Buzz's input styling. */
export function Select({
  id,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  options: readonly Readonly<{ value: string; label: string }>[];
  disabled?: boolean;
  onChange(value: string): void;
}) {
  return (
    <select
      id={id}
      data-buzz-ui=""
      className="buzz-input"
      data-size="md"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** A labelled checkbox row. */
export function Toggle({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}) {
  const id = React.useId();
  return (
    <PreferenceRow
      titleId={id}
      title={title}
      description={description}
      trailing={
        <input
          type="checkbox"
          aria-labelledby={id}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
      }
    />
  );
}

/** Instructions, as Buzz's own agent settings show them. */
export function Instructions({
  value,
  disabled = false,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange(value: string): void;
}) {
  const id = React.useId();
  return (
    <Field
      id={id}
      label="Instructions"
      optional
      description="Added to every worker's brief, ahead of the request."
    >
      <textarea
        id={id}
        data-buzz-ui=""
        className="buzz-textarea"
        data-variant="default"
        data-appearance="outlined"
        rows={5}
        value={value}
        disabled={disabled}
        placeholder="Work on a branch, run the tests, and open a pull request when they pass."
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
