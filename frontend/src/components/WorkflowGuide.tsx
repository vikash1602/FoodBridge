/** Phase 5 — rescue workflow guidance components.
 *
 *  <WorkflowStrip>  : compact journey visual (donor or volunteer) with the
 *                     current step highlighted — used on the landing page and
 *                     at the top of My listings / My rescues / Post food.
 *  <NextActionCard> : the "what happens now" card for one item — current
 *                     status, next required action, who does it, short
 *                     instructions and a safety note.
 *  <WorkflowCard>   : labelled ticket wrapper for a strip.
 */

import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { clsx } from "clsx";

import type { NextAction } from "@/lib/workflow";

export function WorkflowStrip({
  flow,
  current,
  className,
}: {
  flow: readonly string[];
  /** Index of the step the user is currently on (-1 = nothing started). */
  current: number;
  className?: string;
}) {
  return (
    <ol className={clsx("flex flex-wrap items-center gap-x-1 gap-y-2", className)} aria-label="Rescue workflow">
      {flow.map((label, index) => (
        <li key={label} className="flex min-w-0 items-center gap-1">
          <span
            aria-current={index === current ? "step" : undefined}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold",
              index < current && "bg-forest-100 text-forest-700 line-through decoration-forest-400 dark:bg-forest-900 dark:text-forest-200",
              index === current && "bg-forest-700 text-paper shadow-card dark:bg-forest-400 dark:text-pantry-950",
              index > current && "bg-[color:var(--fb-line)]/50 text-[color:var(--fb-ink-soft)]",
            )}
          >
            <span
              className={clsx(
                "grid h-4 w-4 place-items-center rounded-full text-[9px] font-black",
                index === current ? "bg-saffron-400 text-pantry-950" : index < current ? "bg-forest-600 text-white" : "bg-[color:var(--fb-line)] text-pantry-950/60",
              )}
              aria-hidden
            >
              {index < current ? "✓" : index + 1}
            </span>
            {label}
          </span>
          {index < flow.length - 1 && <span className="h-px w-3 bg-[color:var(--fb-line)]" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

export function NextActionCard({ guide, compact }: { guide: NextAction; compact?: boolean }) {
  if (guide.instructions.length === 0 && guide.status.startsWith("delivered")) {
    return null; // completed items need no instructions
  }
  return (
    <div
      className={clsx(
        "mt-3 rounded-xl border border-forest-600/25 bg-forest-50/70 p-3 text-sm dark:bg-forest-900/25",
        compact && "p-2.5 text-xs",
      )}
      data-tour="next-action"
    >
      <p className="flex flex-wrap items-center gap-1.5 font-bold text-forest-800 dark:text-forest-200">
        <span className="chip bg-forest-700 text-paper dark:bg-forest-400 dark:text-pantry-950">{guide.status}</span>
      </p>
      <p className="mt-1.5">
        <span className="font-bold">Next up ({guide.actor}):</span>{" "}
        <span className="text-[color:var(--fb-ink-soft)]">{guide.action}</span>
      </p>
      {guide.instructions.length > 0 && (
        <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[color:var(--fb-ink-soft)]">
          {guide.instructions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {guide.safety && (
        <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-saffron-800 dark:text-saffron-200">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
          {guide.safety}
        </p>
      )}
    </div>
  );
}

/** Small labelled wrapper used when embedding the strip on a page. */
export function WorkflowCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ticket mb-4 p-4" data-tour="workflow-card">
      <p className="label">{title}</p>
      {children}
    </div>
  );
}
