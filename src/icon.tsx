// The harness's mark, drawn for this plugin: a dot with a ring and a short
// arc, for one coordinator and its workers. Not Orca's logo.
import { React } from "./react";

export function OrcaIcon({
  size = "1em",
  ...props
}: { size?: number | string } & Record<string, unknown>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <circle cx={16} cy={16} r={4.5} fill="#3B82F6" />
      <circle
        cx={16}
        cy={16}
        r={10}
        fill="none"
        stroke="#3B82F6"
        strokeWidth={2.4}
        strokeDasharray="44 19"
        strokeLinecap="round"
        transform="rotate(-60 16 16)"
      />
    </svg>
  );
}
// React is read when the component renders, after the plugin applies.
void React;
