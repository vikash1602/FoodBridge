/** The signature listing card: a kitchen receipt with punch-hole, timer dial, claim button. */

import { motion } from "framer-motion";
import { Leaf, MapPin, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

import { CountdownRing } from "@/components/CountdownRing";
import { TrustBadge } from "@/components/TrustBadge";
import type { Listing } from "@/api/types";
import { foodTypeEmoji, fullName } from "@/lib/format";
import { clsx } from "clsx";

interface Props {
  listing: Listing;
  onClaim?: (listing: Listing) => void;
  claiming?: boolean;
  highlighted?: boolean;
  isNew?: boolean;
}

export function ListingTicket({ listing, onClaim, claiming, highlighted, isNew }: Props) {
  const claimable = listing.status === "open" && Boolean(onClaim) && !listing.is_expired_now;

  return (
    <motion.article
      layout
      initial={isNew ? { opacity: 0, y: -18, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className={clsx(
        "ticket card-hover group p-4 pl-5",
        highlighted && "ring-2 ring-forest-500 shadow-glow-green",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/listings/${listing.id}`}
            className="font-display text-lg font-bold leading-tight hover:underline decoration-saffron-400 decoration-2 underline-offset-2"
          >
            <span className="mr-1.5" aria-hidden>
              {foodTypeEmoji[listing.food_type]}
            </span>
            {listing.title}
          </Link>
          <p className="mt-0.5 truncate text-xs text-[color:var(--fb-ink-soft)]">
            {fullName(listing.donor)} · {listing.organization?.name ?? "Individual donor"}
          </p>
        </div>
        <span data-tour="listing-countdown">
          <CountdownRing safeUntil={listing.safe_until} size={46} label={false} />
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5" data-tour="listing-badges">
        <span className="chip bg-forest-100 text-forest-800 dark:bg-forest-900 dark:text-forest-200">
          {listing.quantity}
        </span>
        {listing.is_veg && (
          <span className="chip bg-forest-600 text-white">
            <Leaf size={10} aria-hidden /> Veg
          </span>
        )}
        {listing.allergens && (
          <span
            className="chip bg-saffron-100 text-saffron-800"
            title={`Allergens: ${listing.allergens}`}
            data-tour="listing-allergens"
          >
            <AlertTriangle size={10} aria-hidden /> {listing.allergens}
          </span>
        )}
        {listing.distance_km !== undefined && listing.distance_km !== null && (
          <span className="chip bg-[color:var(--fb-line)]/60 text-[color:var(--fb-ink-soft)]">
            <MapPin size={10} aria-hidden /> {listing.distance_km} km
          </span>
        )}
        <TrustBadge badge={listing.donor.badge} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        {claimable && (
          <button
            className="btn-saffron h-11 flex-1 text-[15px]"
            onClick={() => onClaim?.(listing)}
            disabled={claiming}
            aria-label={`Claim ${listing.title}`}
            data-tour="claim-button"
          >
            {claiming ? "Claiming…" : "Claim this rescue"}
          </button>
        )}
        <Link to={`/listings/${listing.id}`} className="btn-outline h-11 text-sm">
          Details
        </Link>
      </div>
    </motion.article>
  );
}
