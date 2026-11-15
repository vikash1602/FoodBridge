/** Donor's listings: status cards, big pickup code, cancel/edit, searching-radius animation. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Ban, Pencil } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { api } from "@/api/client";
import type { Claim, Listing, Paginated } from "@/api/types";
import { CountdownRing } from "@/components/CountdownRing";
import { DONOR_FLOW, donorNextAction } from "@/lib/workflow";
import { NextActionCard, WorkflowCard, WorkflowStrip } from "@/components/WorkflowGuide";
import { EmptyState, ErrorState, ListingCardSkeleton, Modal } from "@/components/ui";
import { foodTypeEmoji } from "@/lib/format";
import { clsx } from "clsx";

const STATUS_STYLES: Record<Listing["status"], string> = {
  open: "bg-forest-100 text-forest-800 dark:bg-forest-900 dark:text-forest-200",
  claimed: "bg-saffron-100 text-saffron-800",
  picked_up: "bg-saffron-100 text-saffron-800",
  delivered: "bg-forest-700 text-paper",
  expired: "bg-stone-200 text-stone-600 dark:bg-pantry-700 dark:text-pantry-950/70",
  cancelled: "bg-tomato-500/10 text-tomato-600",
};

function StatusChip({ status }: { status: Listing["status"] }) {
  return (
    <span className={clsx("chip", STATUS_STYLES[status])} data-tour="listing-status">
      {status.replace("_", " ")}
    </span>
  );
}

export function MyListingsPage() {
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState<Listing | null>(null);
  const [editing, setEditing] = useState<Listing | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editQty, setEditQty] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["listings", "mine"],
    queryFn: () => api.get<Paginated<Listing>>("/listings/mine/?page_size=50"),
  });

  const { data: claims } = useQuery({
    queryKey: ["claims", "donor-view"],
    queryFn: () => api.get<Paginated<Claim>>("/claims/?page_size=100"),
  });

  const cancelMutation = useMutation({
    mutationFn: (listing: Listing) => api.post(`/listings/${listing.id}/cancel/`),
    onSuccess: () => {
      toast.success("Listing cancelled.");
      setCancelTarget(null);
      queryClient.invalidateQueries({ queryKey: ["listings"] });
    },
    onError: (mutationError) => toast.error((mutationError as Error).message),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      api.patch<Listing>(`/listings/${editing!.id}/`, {
        title: editTitle,
        quantity_value: Number(editQty),
      }),
    onSuccess: () => {
      toast.success("Listing updated.");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["listings"] });
    },
    onError: (mutationError) => toast.error((mutationError as Error).message),
  });

  const listings = data?.results ?? [];
  const openCount = listings.filter((listing) => listing.status === "open").length;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl font-black" data-tour="my-listings">
            My listings
          </h1>
          <p className="text-sm text-[color:var(--fb-ink-soft)]">
            {openCount > 0 ? (
              <>
                <span className="inline-block animate-pulse">◎</span> {openCount} open — alert radius grows every 20 min
              </>
            ) : (
              "Nothing open right now"
            )}
          </p>
        </div>
        <a href="/app/post" className="btn-primary text-sm">
          + Post food
        </a>
      </div>

      {/* Phase 5: the donor workflow, always visible so the next step is obvious */}
      <WorkflowCard title="How your rescue unfolds">
        <WorkflowStrip flow={DONOR_FLOW} current={Math.min(openCount > 0 ? 1 : 0, DONOR_FLOW.length - 1)} />
      </WorkflowCard>

      {isLoading && <div className="grid gap-3">{Array.from({ length: 3 }).map((_, i) => <ListingCardSkeleton key={i} />)}</div>}
      {isError && <ErrorState message={(error as Error).message} onRetry={() => refetch()} />}
      {!isLoading && !isError && listings.length === 0 && (
        <EmptyState
          emoji="🍳"
          title="Your counter is clean"
          hint="You haven't posted any surplus yet — your listings, the volunteer's claim and your 4-digit pickup code will all appear here."
          next={[
            "Post your first surplus — the wizard takes about 30 seconds.",
            "Set a short safety window (2–4 h): fresher listings get claimed faster.",
            "When a volunteer claims, show them the pickup code that appears here.",
          ]}
          action={
            <a href="/app/post" className="btn-primary">
              Post surplus food
            </a>
          }
        />
      )}

      <div className="grid gap-3">
        {listings.map((listing) => {
          const claim = claims?.results.find(
            (candidate) => candidate.listing.id === listing.id && ["active", "picked_up", "delivered"].includes(candidate.status),
          );
          return (
            <motion.article
              key={listing.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="ticket p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-lg font-bold">
                      {foodTypeEmoji[listing.food_type]} {listing.title}
                    </h2>
                    <StatusChip status={listing.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-[color:var(--fb-ink-soft)]">
                    {listing.quantity} · {listing.pickup_address} · posted {new Date(listing.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <CountdownRing safeUntil={listing.safe_until} size={46} label={false} />
              </div>

              {claim && (listing.status === "claimed" || listing.status === "picked_up") && claim.pickup_code && (
                <div
                  className="mt-3 flex items-center gap-4 rounded-xl border-2 border-dashed border-saffron-400 bg-saffron-50 p-3 dark:bg-saffron-900/20"
                  data-tour="pickup-code"
                >
                  <div>
                    <p className="label !mb-0">Pickup code — show the volunteer</p>
                    <p className="font-display text-4xl font-black tracking-[0.35em] text-saffron-700" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {claim.pickup_code}
                    </p>
                  </div>
                  <div className="ml-auto grid grid-cols-2 gap-1" aria-hidden>
                    {claim.pickup_code.split("").map((digit, index) => (
                      <span key={index} className="grid h-9 w-9 place-items-center rounded-lg bg-pantry-950 font-display text-lg font-black text-saffron-300">
                        {digit}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {listing.status === "open" && (
                <div className="mt-3 flex gap-2">
                  <button
                    className="btn-outline h-10 flex-1 text-sm"
                    onClick={() => {
                      setEditing(listing);
                      setEditTitle(listing.title);
                      setEditQty(String(listing.quantity_value));
                    }}
                  >
                    <Pencil size={14} aria-hidden /> Edit
                  </button>
                  <button className="btn-danger h-10 flex-1 text-sm" onClick={() => setCancelTarget(listing)}>
                    <Ban size={14} aria-hidden /> Cancel
                  </button>
                </div>
              )}

              {/* Phase 5: what happens next for this listing */}
              <NextActionCard guide={donorNextAction(listing.status)} compact />
            </motion.article>
          );
        })}
      </div>

      <Modal open={Boolean(cancelTarget)} onClose={() => setCancelTarget(null)} title="Cancel this listing?">
        <p className="text-sm text-[color:var(--fb-ink-soft)]">
          “{cancelTarget?.title}” will be removed from the live feed. Volunteers who were on their way will be notified.
        </p>
        <div className="mt-4 flex gap-2">
          <button className="btn-outline flex-1" onClick={() => setCancelTarget(null)}>
            Keep it
          </button>
          <button
            className="btn-danger flex-1"
            onClick={() => cancelTarget && cancelMutation.mutate(cancelTarget)}
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending ? "Cancelling…" : "Yes, cancel"}
          </button>
        </div>
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit listing">
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="edit-title">
              Title
            </label>
            <input id="edit-title" className="input" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="edit-qty">
              Quantity
            </label>
            <input id="edit-qty" type="number" className="input" value={editQty} onChange={(event) => setEditQty(event.target.value)} />
          </div>
          <button
            className="btn-primary h-11 w-full"
            onClick={() => editMutation.mutate()}
            disabled={editMutation.isPending || editTitle.trim().length < 3}
          >
            {editMutation.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
