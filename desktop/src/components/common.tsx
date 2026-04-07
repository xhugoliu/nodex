import type { ReactNode } from "react";

import type { PatchOpSummary } from "../app-helpers";

export const panelClass =
  "surface-panel surface-blur rounded-2xl border border-[color:var(--line)] p-4 shadow-[var(--shadow)]";
export const cardClass =
  "surface-card rounded-xl border border-[color:var(--line-soft)] p-4";
export const inputClass =
  "w-full rounded-xl border border-[color:var(--line)] bg-white px-3 py-2.5 text-sm text-[color:var(--text)] outline-none focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[rgba(17,24,39,0.08)]";
export const textareaClass = `${inputClass} min-h-[7rem] resize-y`;
export const patchTextareaClass = `${inputClass} min-h-[20rem] resize-y`;
export const subtleTextClass = "text-sm leading-6 text-[color:var(--muted)]";
export const actionButtonClass =
  "rounded-xl border border-transparent px-3.5 py-2 text-sm font-medium text-[color:var(--text)] transition disabled:cursor-not-allowed disabled:opacity-60";
export const secondaryButtonClass = `${actionButtonClass} bg-[color:var(--bg-warm)] hover:bg-[rgba(229,231,235,0.9)]`;
export const primaryButtonClass = `${actionButtonClass} bg-[color:var(--accent)] text-white hover:bg-[color:var(--accent-strong)]`;
export const dangerButtonClass =
  `${actionButtonClass} bg-[rgba(180,35,24,0.12)] text-[color:var(--danger)] hover:bg-[rgba(180,35,24,0.18)]`;
export const ghostButtonClass =
  `${actionButtonClass} border-[color:var(--line)] bg-transparent hover:bg-white`;

export function SectionHeader(props: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="space-y-1">
        <h2
          className="text-base font-semibold leading-none text-[color:var(--text)]"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {props.title}
        </h2>
        {props.subtitle ? <p className={subtleTextClass}>{props.subtitle}</p> : null}
      </div>
    </div>
  );
}

export function CardHeader(props: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3
        className="text-lg leading-none text-[color:var(--text)]"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {props.title}
      </h3>
      {props.action}
    </div>
  );
}

export function LabeledField(props: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-2 ${props.className ?? ""}`}>
      <span className="text-sm font-medium text-[color:var(--muted)]">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}

export function EmptyBox(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-dashed border-[color:var(--line)] bg-white/40 px-4 py-5 text-sm text-[color:var(--muted)] ${props.className ?? ""}`}
    >
      {props.children}
    </div>
  );
}

export function EmptyState(props: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 text-center">
      <div className="text-base font-semibold text-[color:var(--text)]">
        {props.title}
      </div>
      <p className={`${subtleTextClass} whitespace-pre-wrap`}>{props.body}</p>
    </div>
  );
}

export function PatchDraftBanner(props: {
  title: string;
  meta: string;
  ops: PatchOpSummary[];
  actions?: Array<{
    label: string;
    onClick: () => void;
  }>;
  tone: "success" | "error" | "neutral";
}) {
  const toneClass =
    props.tone === "success"
      ? "border-[rgba(15,118,110,0.18)] bg-[rgba(15,118,110,0.08)]"
      : props.tone === "error"
        ? "border-[rgba(180,35,24,0.18)] bg-[rgba(180,35,24,0.08)]"
        : "border-[color:var(--line)] bg-white/60";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="font-medium text-[color:var(--text)]">{props.title}</div>
          <div className="text-sm leading-6 text-[color:var(--muted)]">
            {props.meta}
          </div>
          {props.ops.length ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {props.ops.map((op) => (
                <span
                  key={op.type}
                  className="rounded-full border border-[color:var(--line)] bg-white/80 px-3 py-1 text-xs text-[color:var(--text)]"
                >
                  {op.count > 1 ? `${op.type} x${op.count}` : op.type}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {props.actions?.length ? (
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {props.actions.map((action) => (
              <button
                key={action.label}
                className={ghostButtonClass}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
