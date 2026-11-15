/** Leaderboard: podium for top donors & volunteers. */

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";

import { api } from "@/api/client";
import { ErrorState, ListingCardSkeleton } from "@/components/ui";
import { TrustBadge } from "@/components/TrustBadge";

interface Entry {
  id: number;
  name: string;
  trust_score: number;
  badge: string;
  deliveries: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];

function Podium({ entries, title }: { entries: Entry[]; title: string }) {
  return (
    <div className="ticket p-5">
      <h2 className="font-display text-lg font-bold">{title}</h2>
      <ol className="mt-3 space-y-2">
        {entries.slice(0, 3).map((entry, index) => (
          <motion.li
            key={entry.id}
            initial={{ x: -12, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: index * 0.08 }}
            className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-saffron-100/70 to-transparent p-3 dark:from-saffron-900/20"
          >
            <span className="text-2xl" aria-hidden>
              {MEDALS[index]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{entry.name}</p>
              <TrustBadge badge={entry.badge} />
            </div>
            <span className="font-display text-2xl font-black text-saffron-700">{entry.deliveries}</span>
          </motion.li>
        ))}
        {entries.slice(3).map((entry, index) => (
          <li key={entry.id} className="flex items-center gap-3 rounded-xl px-3 py-2">
            <span className="w-6 text-center text-sm font-bold text-[color:var(--fb-ink-soft)]">{index + 4}</span>
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">{entry.name}</p>
            <span className="text-sm font-bold tabular-nums">{entry.deliveries}</span>
          </li>
        ))}
        {entries.length === 0 && <li className="py-4 text-center text-sm text-[color:var(--fb-ink-soft)]">No deliveries yet — be the first!</li>}
      </ol>
    </div>
  );
}

export function LeaderboardPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: () => api.get<{ donors: Entry[]; volunteers: Entry[] }>("/stats/?metric=leaderboard"),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-3xl font-black">Leaderboard</h1>
      <p className="mb-6 text-sm text-[color:var(--fb-ink-soft)]">Ties break on trust score — the reliable rise.</p>

      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => <ListingCardSkeleton key={index} />)}
        </div>
      )}
      {isError && <ErrorState message={(error as Error).message} onRetry={() => refetch()} />}

      {data && (
        <div className="grid gap-4 md:grid-cols-2">
          <Podium entries={data.donors} title="🍗 Top donors" />
          <Podium entries={data.volunteers} title="🛵 Top volunteers" />
        </div>
      )}
    </div>
  );
}
