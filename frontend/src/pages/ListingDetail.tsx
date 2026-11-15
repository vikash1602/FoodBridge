/** Listing detail: progress tracker, escalation ring info, claim action, report. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Flag, MapPin, PackageCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";

import { api, HttpError } from "@/api/client";
import { useAuth } from "@/api/auth";
import type { Claim, Listing } from "@/api/types";
import { CountdownRing } from "@/components/CountdownRing";
import { TrustBadge } from "@/components/TrustBadge";
import { donorNextAction, volunteerNextAction } from "@/lib/workflow";
import { NextActionCard } from "@/components/WorkflowGuide";
import { ErrorState, Modal, Skeleton } from "@/components/ui";
import { foodTypeEmoji, foodTypeLabel, fullName } from "@/lib/format";
import { clsx } from "clsx";

const TRACK_STEPS = [
  { key: "open", label: "Posted" },
  { key: "claimed", label: "Claimed" },
  { key: "picked_up", label: "Picked up" },
  { key: "delivered", label: "Delivered" },
] as const;

function ProgressTracker({ listing }: { listing: Listing }) {
  const order: Listing["status"][] = ["open", "claimed", "picked_up", "delivered"];
  const index = order.indexOf(listing.status);
  const done = index < 0 ? 0 : index;
  return (
    <ol className="flex items-center gap-0" aria-label="Rescue progress">
      {TRACK_STEPS.map((step, stepIndex) => {
        const state = stepIndex < done ? "done" : stepIndex === done && listing.status !== "expired" && listing.status !== "cancelled" ? "current" : "todo";
        return (
          <li key={step.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <span
                className={clsx(
                  "grid h-8 w-8 place-items-center rounded-full border-2 text-xs font-black transition-colors",
                  state === "done" && "border-forest-600 bg-forest-600 text-white",
                  state === "current" && "border-saffron-500 bg-saffron-100 text-saffron-700 animate-pulse",
                  state === "todo" && "border-[color:var(--fb-line)] text-[color:var(--fb-ink-soft)]",
                )}
                aria-current={state === "current" ? "step" : undefined}
              >
                {state === "done" ? "✓" : stepIndex + 1}
              </span>
              <span className={clsx("text-[10px] font-bold uppercase tracking-wide", state === "todo" && "text-[color:var(--fb-ink-soft)]")}>
                {step.label}
              </span>
            </div>
            {stepIndex < TRACK_STEPS.length - 1 && (
              <span className={clsx("mx-1 mb-4 h-0.5 flex-1", stepIndex < done ? "bg-forest-600" : "bg-[color:var(--fb-line)]")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function ListingDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");

  const { data: listing, isLoading, isError, error } = useQuery({
    queryKey: ["listing", id],
    queryFn: () => api.get<Listing>(`/listings/${id}/`),
    enabled: Boolean(id),
  });

  const { data: claims } = useQuery({
    queryKey: ["claims", "for-listing", id],
    queryFn: () => api.get<{ results: Claim[] }>(`/claims/?page_size=50`),
    enabled: Boolean(id),
  });
  const activeClaim = claims?.results.find((claim) => claim.listing.id === Number(id));

  const claimMutation = useMutation({
    mutationFn: () => api.post<Claim>(`/listings/${id}/claim/`),
    onSuccess: () => {
      toast.success("Claimed! Head to My rescues for the pickup flow. 🫡");
      queryClient.invalidateQueries({ queryKey: ["listing", id] });
      queryClient.invalidateQueries({ queryKey: ["listings"] });
      navigate("/app/my-claims");
    },
    onError: (mutationError) => {
      const httpError = mutationError as HttpError;
      toast.error(httpError.body?.message ?? "Could not claim");
      queryClient.invalidateQueries({ queryKey: ["listing", id] });
    },
  });

  const reportMutation = useMutation({
    mutationFn: () => api.post("/reports/", { listing: Number(id), reason: reportReason }),
    onSuccess: () => {
      toast.success("Report sent to the admins. Thank you for keeping us honest.");
      setReportOpen(false);
      setReportReason("");
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !listing) {
    return <ErrorState message={(error as Error)?.message ?? "Listing not found"} onRetry={() => navigate("/app")} />;
  }

  const claimable = listing.status === "open" && !listing.is_expired_now;

  return (
    <div className="mx-auto max-w-2xl">
      <button className="btn-ghost mb-4 -ml-2 text-sm" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} aria-hidden /> Back to feed
      </button>

      <article className="ticket overflow-hidden">
        <div className="border-b border-dashed border-[color:var(--fb-line)] bg-gradient-to-br from-forest-700 to-forest-900 p-6 text-paper">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl font-black leading-tight">
                <span aria-hidden>{foodTypeEmoji[listing.food_type]}</span> {listing.title}
              </h1>
              <p className="mt-1 text-sm text-paper/80">
                {foodTypeLabel[listing.food_type]} · {listing.quantity}
                {listing.is_veg && " · veg 🌿"}
              </p>
            </div>
            <CountdownRing safeUntil={listing.safe_until} size={64} />
          </div>
        </div>

        <div className="space-y-5 p-6">
          {listing.photo && (
            <img
              src={listing.photo}
              alt={`Photo of ${listing.title}`}
              className="max-h-96 w-full rounded-2xl border border-[color:var(--fb-line)] object-cover shadow-card"
              loading="lazy"
            />
          )}

          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-[color:var(--fb-line)]/30 p-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-saffron-200 font-display font-black text-pantry-950">
              {fullName(listing.donor).slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{fullName(listing.donor)}</p>
              <p className="truncate text-xs text-[color:var(--fb-ink-soft)]">
                {listing.organization?.name ?? "Individual"} · {listing.pickup_address}
              </p>
            </div>
            <TrustBadge badge={listing.donor.badge} score={listing.donor.trust_score} size="md" />
          </div>

          {listing.description && <p className="text-sm leading-relaxed">{listing.description}</p>}
          {listing.allergens && (
            <p className="rounded-xl bg-saffron-100 px-3 py-2 text-sm font-semibold text-saffron-800">
              ⚠️ Allergens: {listing.allergens}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-[color:var(--fb-line)] p-3">
              <p className="label !mb-0.5">Ready from</p>
              <p className="font-bold">{new Date(listing.ready_from).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
            </div>
            <div className="rounded-xl border border-[color:var(--fb-line)] p-3">
              <p className="label !mb-0.5">Safe until</p>
              <p className="font-bold">{new Date(listing.safe_until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
            </div>
          </div>

          {listing.escalation_radius_km && listing.status === "open" && (
            <p className="text-center text-xs font-bold uppercase tracking-widest text-saffron-600 dark:text-saffron-400">
              <span className="inline-block animate-pulse">◎</span> Searching {listing.escalation_radius_km} km radius
            </p>
          )}

          <ProgressTracker listing={listing} />

          {claimable && (
            <button
              className="btn-saffron h-14 w-full text-lg"
              onClick={() => claimMutation.mutate()}
              disabled={claimMutation.isPending}
            >
              <PackageCheck size={20} aria-hidden />
              {claimMutation.isPending ? "Claiming…" : "Claim this rescue"}
            </button>
          )}

          {activeClaim && (
            <div className="rounded-xl border-2 border-forest-600/30 bg-forest-50 p-4 text-sm dark:bg-forest-900/30">
              <p className="font-bold">Rescue in progress</p>
              <p className="mt-1 text-[color:var(--fb-ink-soft)]">
                {activeClaim.pickup_code
                  ? `Pickup code (show this to the volunteer): ${activeClaim.pickup_code}`
                  : `Status: ${activeClaim.status.replace("_", " ")} — claimed by ${activeClaim.volunteer_name}.`}
              </p>
            </div>
          )}

          {/* Phase 5: status → next action → who → how, per role */}
          {activeClaim && activeClaim.status !== "delivered" && (
            <NextActionCard
              guide={user && user.id === listing.donor.id ? donorNextAction(activeClaim.status) : volunteerNextAction(activeClaim.status)}
            />
          )}

          <div className="flex items-center justify-between border-t border-[color:var(--fb-line)] pt-3">
            <p className="flex items-center gap-1 text-xs text-[color:var(--fb-ink-soft)]">
              <MapPin size={12} aria-hidden /> {listing.pickup_address}
            </p>
            <button
              className="inline-flex items-center gap-1 text-xs font-bold text-[color:var(--fb-ink-soft)] hover:text-tomato-600"
              onClick={() => setReportOpen(true)}
            >
              <Flag size={12} aria-hidden /> Report
            </button>
          </div>
        </div>
      </article>

      <Modal open={reportOpen} onClose={() => setReportOpen(false)} title="Report this listing">
        <div className="space-y-3">
          {["Food already spoiled", "Wrong address", "Quantity mismatch", "Suspicious listing", "Other"].map((reason) => (
            <button
              key={reason}
              className={clsx(
                "w-full rounded-xl border-2 p-3 text-left text-sm font-semibold transition-colors",
                reportReason === reason
                  ? "border-tomato-500 bg-tomato-500/10"
                  : "border-[color:var(--fb-line)] hover:border-tomato-400",
              )}
              onClick={() => setReportReason(reason)}
            >
              {reason}
            </button>
          ))}
          <button
            className="btn-danger h-11 w-full"
            disabled={!reportReason || reportMutation.isPending}
            onClick={() => reportMutation.mutate()}
          >
            {reportMutation.isPending ? "Sending…" : "Send report"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
