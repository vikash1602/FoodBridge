/** Shared UI primitives: skeletons, empty states, modal, spinner, live dot. */

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { clsx } from "clsx";

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-xl bg-[color:var(--fb-line)]/70", className)} />;
}

export function ListingCardSkeleton() {
  return (
    <div className="ticket p-4 space-y-3">
      <div className="flex justify-between">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-12 w-12 rounded-full" />
      </div>
      <Skeleton className="h-4 w-1/3" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

/** Phase 6 empty state: explains (1) why the page is empty, (2) what the user
 *  can do next, and (3) offers a concrete action. `hint` states the why,
 *  `next` lists optional next-step bullets. Never shows fake data. */
export function EmptyState({
  emoji,
  title,
  hint,
  next,
  action,
}: {
  emoji: string;
  title: string;
  hint: string;
  next?: string[];
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[color:var(--fb-line)] px-6 py-14 text-center">
      <span className="text-5xl" role="img" aria-hidden>
        {emoji}
      </span>
      <h3 className="font-display text-xl font-bold">{title}</h3>
      <p className="max-w-sm text-sm text-[color:var(--fb-ink-soft)]">{hint}</p>
      {next && next.length > 0 && (
        <ul className="max-w-sm space-y-1 text-left text-sm text-[color:var(--fb-ink-soft)]" aria-label="What you can do next">
          {next.map((step) => (
            <li key={step} className="flex items-start gap-2">
              <span className="mt-0.5 text-forest-600 dark:text-forest-300" aria-hidden>
                →
              </span>
              {step}
            </li>
          ))}
        </ul>
      )}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-2xl border-2 border-tomato-500/40 bg-tomato-500/5 px-6 py-10 text-center"
    >
      <span className="text-4xl" aria-hidden>
        🍲💨
      </span>
      <h3 className="font-display text-lg font-bold">Something spilled</h3>
      <p className="max-w-sm text-sm text-[color:var(--fb-ink-soft)]">{message}</p>
      {onRetry && (
        <button className="btn-outline text-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("animate-spin", className)} aria-label="Loading" />;
}

export function LiveDot({ live }: { live: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
      <span className="relative flex h-2 w-2">
        {live && (
          <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-forest-500" />
        )}
        <span className={clsx("relative inline-flex h-2 w-2 rounded-full", live ? "bg-forest-500" : "bg-stone-400")} />
      </span>
      {live ? "Live" : "Polling"}
    </span>
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ open, onClose, title, children, wide }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-pantry-950/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            className={clsx(
              "ticket max-h-[88vh] w-full overflow-y-auto p-6 scrollbar-thin",
              wide ? "max-w-2xl" : "max-w-md",
            )}
            initial={{ y: 24, scale: 0.96, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 16, scale: 0.97, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">{title}</h2>
              <button
                className="btn-ghost h-9 w-9 !rounded-full p-0"
                onClick={onClose}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
