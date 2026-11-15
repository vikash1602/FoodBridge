/** Volunteer's claims: stepper tracker, code entry for pickup, deliver with note, cancel. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Ban, CheckCircle2, PackageOpen, Send, Truck } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import { Confetti } from "@/components/Confetti";
import { EmptyState, ErrorState, ListingCardSkeleton, Modal } from "@/components/ui";
import { api } from "@/api/client";
import type { Claim, Paginated } from "@/api/types";
import { VOLUNTEER_FLOW, volunteerNextAction } from "@/lib/workflow";
import { NextActionCard, WorkflowCard, WorkflowStrip } from "@/components/WorkflowGuide";
import { foodTypeEmoji } from "@/lib/format";
import { clsx } from "clsx";

function CodeEntry({ claimId, onDone }: { claimId: number; onDone: () => void }) {
  const [digits, setDigits] = useState(["", "", "", ""]);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (code: string) => api.post<Claim>(`/claims/${claimId}/verify-pickup/`, { code }),
    onSuccess: () => {
      toast.success("Pickup verified — food is on the move! 🚴");
      queryClient.invalidateQueries({ queryKey: ["claims"] });
      onDone();
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const setDigit = (index: number, value: string) => {
    const clean = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = clean;
    setDigits(next);
    if (clean && index < 3) {
      document.getElementById(`code-${index + 1}`)?.focus();
    } else if (next.every((digit) => digit !== "")) {
      mutation.mutate(next.join(""));
    }
  };

  return (
    <div>
      <p className="label">Enter the 4-digit code the donor shows you</p>
      <div className="flex justify-center gap-2" role="group" aria-label="Pickup code">
        {digits.map((digit, index) => (
          <input
            key={index}
            id={`code-${index}`}
            inputMode="numeric"
            aria-label={`Digit ${index + 1}`}
            className="h-14 w-12 rounded-xl border-2 border-[color:var(--fb-line)] bg-[color:var(--fb-surface)] text-center font-display text-2xl font-black focus:border-forest-500 focus:outline-none focus:ring-2 focus:ring-forest-500/50"
            value={digit}
            onChange={(event) => setDigit(index, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !digits[index] && index > 0) {
                document.getElementById(`code-${index - 1}`)?.focus();
              }
            }}
            disabled={mutation.isPending}
          />
        ))}
      </div>
      {mutation.isError && <p className="mt-2 text-center text-xs font-bold text-tomato-600">{(mutation.error as Error).message}</p>}
    </div>
  );
}

function ClaimCard({ claim, index }: { claim: Claim; index: number }) {
  const queryClient = useQueryClient();
  const [codeEntry, setCodeEntry] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [note, setNote] = useState("");
  const [celebrate, setCelebrate] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["claims"] });
    queryClient.invalidateQueries({ queryKey: ["listings"] });
  };

  const deliverMutation = useMutation({
    mutationFn: () => api.post<Claim>(`/claims/${claim.id}/deliver/`, { delivery_note: note }),
    onSuccess: () => {
      invalidate();
      setDeliverOpen(false);
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 3200);
      toast.success("Rescue delivered! You're a hero. 🎉", { duration: 4000 });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.post<Claim>(`/claims/${claim.id}/cancel/`, { reason: "Volunteer cancelled" }),
    onSuccess: () => {
      invalidate();
      setCancelOpen(false);
      toast("Claim cancelled — listing reopened for others.", { icon: "♻️" });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const steps = [
    { key: "active", label: "Claimed", icon: CheckCircle2, done: true },
    { key: "picked_up", label: "Picked up", icon: PackageOpen, done: claim.status === "picked_up" || claim.status === "delivered" },
    { key: "delivered", label: "Delivered", icon: Truck, done: claim.status === "delivered" },
  ];

  return (
    <motion.article layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="ticket p-4">
      {celebrate && <Confetti />}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold">
            {foodTypeEmoji[claim.listing.food_type] ?? "🍱"} {claim.listing.title}
          </h2>
          <p className="text-xs text-[color:var(--fb-ink-soft)]">
            From {claim.listing.organization?.name ?? claim.donor_name} · {claim.listing.pickup_address}
          </p>
        </div>
        <span
          className={clsx(
            "chip",
            claim.status === "delivered" && "bg-forest-700 text-paper",
            claim.status === "picked_up" && "bg-saffron-100 text-saffron-800",
            claim.status === "active" && "bg-forest-100 text-forest-800",
            ["cancelled", "no_show"].includes(claim.status) && "bg-stone-200 text-stone-600",
          )}
        >
          {claim.status.replace("_", " ")}
        </span>
      </div>

      {/* tracker */}
      <ol className="mt-4 flex items-center" aria-label="Delivery progress" data-tour="rescue-tracker">
        {steps.map((step, stepIndex) => (
          <li key={step.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <span
                className={clsx(
                  "grid h-9 w-9 place-items-center rounded-full border-2",
                  step.done ? "border-forest-600 bg-forest-600 text-white" : "border-[color:var(--fb-line)] text-[color:var(--fb-ink-soft)]",
                  stepIndex === 1 && !step.done && claim.status === "active" && "border-saffron-500 bg-saffron-100 text-saffron-700",
                )}
              >
                <step.icon size={16} aria-hidden />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wide">{step.label}</span>
            </div>
            {stepIndex < steps.length - 1 && (
              <span className={clsx("mx-1 mb-5 h-0.5 flex-1", steps[stepIndex + 1]?.done || step.done ? "bg-forest-600" : "bg-[color:var(--fb-line)]")} />
            )}
          </li>
        ))}
      </ol>

      {/* Phase 5: what happens next for this rescue */}
      <NextActionCard guide={volunteerNextAction(claim.status)} compact />

      <AnimatePresence mode="wait">
        {codeEntry && claim.status === "active" ? (
          <motion.div key="code" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-3">
            <CodeEntry claimId={claim.id} onDone={() => setCodeEntry(false)} />
            <button className="btn-ghost mt-2 w-full text-xs" onClick={() => setCodeEntry(false)}>
              Not at the pickup point yet
            </button>
          </motion.div>
        ) : (
          claim.status !== "delivered" && (
            <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 flex gap-2">
              {claim.status === "active" && (
                <>
                  <button className="btn-saffron h-12 flex-[2] text-base" onClick={() => setCodeEntry(true)}>
                    <PackageOpen size={18} aria-hidden /> Verify pickup
                  </button>
                  <button className="btn-outline h-12 flex-1 text-sm" onClick={() => setCancelOpen(true)} aria-label="Cancel claim">
                    <Ban size={16} aria-hidden /> Cancel
                  </button>
                </>
              )}
              {claim.status === "picked_up" && (
                <button className="btn-primary h-12 flex-[3] text-base" onClick={() => setDeliverOpen(true)}>
                  <Truck size={18} aria-hidden /> Mark delivered
                </button>
              )}
            </motion.div>
          )
        )}
      </AnimatePresence>

      <Modal open={deliverOpen} onClose={() => setDeliverOpen(false)} title="Confirm delivery">
        <p className="text-sm text-[color:var(--fb-ink-soft)]">
          Handing over <strong>{claim.listing.title}</strong> — where did it land?
        </p>
        <textarea
          className="input mt-3 min-h-24"
          placeholder="Delivered to Ashray NGO night shelter, 42 plates…"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-label="Delivery note"
        />
        <button
          className="btn-primary mt-3 h-12 w-full text-base"
          onClick={() => deliverMutation.mutate()}
          disabled={deliverMutation.isPending}
        >
          <Send size={17} aria-hidden /> {deliverMutation.isPending ? "Delivering…" : "Deliver & celebrate 🎉"}
        </button>
      </Modal>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this claim?">
        <p className="text-sm text-[color:var(--fb-ink-soft)]">
          The listing reopens for other volunteers. Frequent cancellations lower your trust score, so only cancel when you really must.
        </p>
        <div className="mt-4 flex gap-2">
          <button className="btn-outline flex-1" onClick={() => setCancelOpen(false)}>
            Stay on it
          </button>
          <button className="btn-danger flex-1" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
            {cancelMutation.isPending ? "Cancelling…" : "Cancel claim"}
          </button>
        </div>
      </Modal>
      <span className="hidden">{index}</span>
    </motion.article>
  );
}

export function MyClaimsPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["claims"],
    queryFn: () => api.get<Paginated<Claim>>("/claims/?page_size=50"),
    refetchInterval: 20_000,
  });

  const claims = data?.results ?? [];
  const active = claims.filter((claim) => ["active", "picked_up"].includes(claim.status));
  const past = claims.filter((claim) => !["active", "picked_up"].includes(claim.status));

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-3xl font-black" data-tour="my-rescues">My rescues</h1>
      <p className="mb-6 text-sm text-[color:var(--fb-ink-soft)]">
        {active.length > 0 ? `${active.length} in motion — finish the trip!` : "Claim something from the feed to get going."}
      </p>

      {active.length > 0 && (
        <WorkflowCard title="Where you are in the rescue workflow">
          <WorkflowStrip
            flow={VOLUNTEER_FLOW}
            current={
              active.some((claim) => claim.status === "picked_up")
                ? 4
                : 3 /* claimed → collecting */
            }
          />
        </WorkflowCard>
      )}

      {isLoading && <div className="grid gap-3">{Array.from({ length: 2 }).map((_, i) => <ListingCardSkeleton key={i} />)}</div>}
      {isError && <ErrorState message={(error as Error).message} onRetry={() => refetch()} />}

      <div className="grid gap-3">
        {active.map((claim) => <ClaimCard key={claim.id} claim={claim} index={0} />)}
      </div>

      {past.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-xs font-bold uppercase tracking-widest text-[color:var(--fb-ink-soft)]">Past rescues</h2>
          <div className="grid gap-3 opacity-90">
            {past.map((claim) => <ClaimCard key={claim.id} claim={claim} index={1} />)}
          </div>
        </>
      )}

      {!isLoading && !isError && claims.length === 0 && (
        <EmptyState
          emoji="🫶"
          title="No rescues yet"
          hint="You haven't claimed any food yet — your active rescues, pickup verification and delivery tracking will all live here."
          next={[
            "Open the rescue feed and pick something close by.",
            "Check the countdown dial — claim only what you can reach before it expires.",
            "After claiming, come back here to verify the pickup code and mark delivery.",
          ]}
          action={
            <Link to="/app" className="btn-primary">
              Open the rescue feed
            </Link>
          }
        />
      )}
    </div>
  );
}
