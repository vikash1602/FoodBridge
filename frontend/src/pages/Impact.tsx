/** Impact dashboard: count-up counters from the real stats API.
 *  Zero-data states are explicit (Phase 6); no synthetic statistics are shown —
 *  the weekly chart only appears once there are real deliveries, and it is
 *  clearly captioned as a trend visualisation. */

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "@/api/client";
import { useAuth } from "@/api/auth";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { TrustBadge } from "@/components/TrustBadge";

const RescuesAreaChart = lazy(() => import("@/components/ImpactCharts").then((m) => ({ default: m.RescuesAreaChart })));

interface PersonalStats {
  role: string;
  rescued: {
    listings_created: number;
    delivered_as_donor: number;
    delivered_as_volunteer: number;
    meals_equivalent: number;
  };
  trust_score: number;
  badge: string;
}

interface PlatformStats {
  users: { donors: number; volunteers: number; active_volunteers: number };
  rescued: { listings: number; delivered: number; meals_equivalent: number };
  avg_time_to_claim_seconds: number | null;
}

/** Deterministic demo series derived from the delivered count (UI visual only). */
function buildSeries(delivered: number) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const base = Math.max(1, Math.round(delivered / 7));
  return days.map((day, index) => ({
    day,
    rescues: Math.max(0, base + Math.round(Math.sin(index * 1.7) * base * 0.5)),
  }));
}



function CountUpCard({ label, value, suffix = "", accent }: { label: string; value: number; suffix?: string; accent: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - start) / 1200);
      setDisplay(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`ticket p-4 ${accent}`}>
      <p className="font-display text-4xl font-black tabular-nums">
        {display.toLocaleString()}
        {suffix}
      </p>
      <p className="mt-0.5 text-[11px] font-bold uppercase tracking-widest opacity-70">{label}</p>
    </motion.div>
  );
}

export function ImpactPage() {
  const { user } = useAuth();
  const isAdmin = user?.is_admin_role ?? false;

  const personal = useQuery({
    queryKey: ["stats", "me"],
    queryFn: () => api.get<PersonalStats>("/stats/?scope=me"),
  });
  const platform = useQuery({
    queryKey: ["stats", "platform"],
    queryFn: () => api.get<PlatformStats>("/stats/?scope=platform"),
    enabled: isAdmin,
  });

  const series = useMemo(
    () => buildSeries(personal.data?.rescued.delivered_as_volunteer ?? 0),
    [personal.data],
  );

  if (personal.isError) return <ErrorState message={(personal.error as Error).message} onRetry={() => personal.refetch()} />;

  const stats = personal.data;
  const minutes = platform.data?.avg_time_to_claim_seconds ? Math.round(platform.data.avg_time_to_claim_seconds / 60) : null;

  const deliveredTotal = (stats?.rescued.delivered_as_volunteer ?? 0) + (stats?.rescued.delivered_as_donor ?? 0);
  const postedTotal = stats?.rescued.listings_created ?? 0;
  const hasAnyImpact = deliveredTotal > 0 || postedTotal > 0;

  if (!hasAnyImpact) {
    return (
      <div className="mx-auto max-w-4xl" data-tour="impact">
        <h1 className="font-display text-3xl font-black">Impact</h1>
        <p className="mb-6 text-sm text-[color:var(--fb-ink-soft)]">
          {isAdmin ? "Platform-wide pulse." : "Your personal rescue footprint."}
        </p>
        <EmptyState
          emoji="🌱"
          title="No impact data yet"
          hint="Impact numbers appear here once real rescues happen — nothing is shown until then."
          next={
            user?.role === "donor"
              ? [
                  "Post your first surplus food — a wizard walks you through it.",
                  "When a volunteer delivers, your meals-rescued counter starts here.",
                ]
              : [
                  "Claim a rescue from the live feed.",
                  "Verify the pickup code and mark delivery — your counter updates instantly.",
                ]
          }
          action={
            <Link to={user?.role === "donor" ? "/app/post" : "/app"} className="btn-primary h-11 px-6">
              {user?.role === "donor" ? "Post surplus food" : "Open the rescue feed"}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-3xl font-black" data-tour="impact">
        Impact
      </h1>
      <p className="mb-6 text-sm text-[color:var(--fb-ink-soft)]">
        {isAdmin ? "Platform-wide pulse." : "Your personal rescue footprint."}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountUpCard label="meals rescued" value={Math.round(stats?.rescued.meals_equivalent ?? 0)} accent="bg-forest-700 text-paper dark:bg-forest-400 dark:text-pantry-950" />
        <CountUpCard label="deliveries" value={deliveredTotal} accent="bg-saffron-500 text-pantry-950" />
        {isAdmin ? (
          <>
            <CountUpCard label="active volunteers" value={platform.data?.users.active_volunteers ?? 0} accent="bg-forest-100 text-forest-800 dark:bg-pantry-800 dark:text-paper" />
            <CountUpCard label="min to claim" value={minutes ?? 0} suffix=" min" accent="bg-saffron-100 text-saffron-800 dark:bg-pantry-800 dark:text-paper" />
          </>
        ) : (
          <>
            <CountUpCard label="listings posted" value={postedTotal} accent="bg-forest-100 text-forest-800 dark:bg-pantry-800 dark:text-paper" />
            <CountUpCard label="trust score" value={stats?.trust_score ?? 50} accent="bg-saffron-100 text-saffron-800 dark:bg-pantry-800 dark:text-paper" />
          </>
        )}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {deliveredTotal > 0 ? (
          <div className="ticket p-5">
            <h2 className="font-display text-lg font-bold">Rescues this week</h2>
            <Suspense fallback={<Skeleton className="mt-4 h-52" />}>
              <div className="mt-4">
                <RescuesAreaChart data={series} />
              </div>
            </Suspense>
            <p className="mt-2 text-[11px] text-[color:var(--fb-ink-soft)]">
              Trend visualisation based on your total deliveries ({deliveredTotal}) — a per-day history view is on the
              way. The total is real; the daily shape is illustrative.
            </p>
          </div>
        ) : (
          <div className="ticket p-5">
            <h2 className="font-display text-lg font-bold">Rescues this week</h2>
            <p className="mt-4 text-sm text-[color:var(--fb-ink-soft)]">
              The weekly chart appears here after your first delivery.
            </p>
          </div>
        )}

        {/* Real record, not a synthetic food-type split */}
        <div className="ticket p-5">
          <h2 className="font-display text-lg font-bold">Your rescue record</h2>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex items-center justify-between rounded-xl bg-[color:var(--fb-line)]/30 px-3 py-2.5">
              <dt className="text-[color:var(--fb-ink-soft)]">Listings posted</dt>
              <dd className="font-display text-lg font-black tabular-nums">{postedTotal}</dd>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-[color:var(--fb-line)]/30 px-3 py-2.5">
              <dt className="text-[color:var(--fb-ink-soft)]">Delivered as donor</dt>
              <dd className="font-display text-lg font-black tabular-nums">{stats?.rescued.delivered_as_donor ?? 0}</dd>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-[color:var(--fb-line)]/30 px-3 py-2.5">
              <dt className="text-[color:var(--fb-ink-soft)]">Delivered as volunteer</dt>
              <dd className="font-display text-lg font-black tabular-nums">{stats?.rescued.delivered_as_volunteer ?? 0}</dd>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-[color:var(--fb-line)]/30 px-3 py-2.5">
              <dt className="text-[color:var(--fb-ink-soft)]">Meals equivalent rescued</dt>
              <dd className="font-display text-lg font-black tabular-nums">{Math.round(stats?.rescued.meals_equivalent ?? 0)}</dd>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-[color:var(--fb-line)]/30 px-3 py-2.5">
              <dt className="text-[color:var(--fb-ink-soft)]">Trust badge</dt>
              <dd>
                <TrustBadge badge={stats?.badge === "champion" ? "champion" : stats?.badge === "trusted" ? "trusted" : stats?.badge === "reliable" ? "reliable" : "new"} />
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] text-[color:var(--fb-ink-soft)]">
            Trust grows +8 per delivery and +2 per 5★ rating; late cancels and no-shows reduce it.
          </p>
        </div>
      </div>

      {isAdmin && platform.data && (
        <div className="ticket mt-4 p-5">
          <h2 className="font-display text-lg font-bold">Platform totals</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {[
              ["Donors", platform.data.users.donors],
              ["Volunteers", platform.data.users.volunteers],
              ["Listings ever", platform.data.rescued.listings],
              ["Delivered", platform.data.rescued.delivered],
              ["Meals equivalent", platform.data.rescued.meals_equivalent],
              ["Avg claim time", minutes ? `${minutes} min` : "—"],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl bg-[color:var(--fb-line)]/30 p-3">
                <dt className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--fb-ink-soft)]">{label}</dt>
                <dd className="font-display text-xl font-black">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
