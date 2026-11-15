/** Full notifications page. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";

import { api } from "@/api/client";
import type { Notification, Paginated } from "@/api/types";
import { EmptyState, ErrorState, ListingCardSkeleton } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { clsx } from "clsx";

const TYPE_EMOJI: Record<string, string> = {
  listing_new: "🍲",
  listing_claimed: "⚡",
  listing_picked_up: "🚴",
  listing_delivered: "🎉",
  listing_cancelled: "♻️",
  listing_expired: "⌛",
  org_verified: "✅",
  org_rejected: "🚫",
  rating_received: "⭐",
  report_resolved: "🛡️",
  account_suspended: "🛑",
};

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["notifications", "page"],
    queryFn: () => api.get<Paginated<Notification>>("/notifications/?page_size=50"),
  });

  const markAll = useMutation({
    mutationFn: () => api.post("/notifications/read-all/"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOne = useMutation({
    mutationFn: (id: number) => api.post(`/notifications/${id}/read/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="font-display text-3xl font-black">Notifications</h1>
        <button className="btn-outline text-xs" onClick={() => markAll.mutate()} disabled={markAll.isPending || (data?.unread_count ?? 0) === 0}>
          <CheckCheck size={14} aria-hidden /> Mark all read
        </button>
      </div>

      {isLoading && <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <ListingCardSkeleton key={index} />)}</div>}
      {isError && <ErrorState message={(error as Error).message} onRetry={() => refetch()} />}
      {!isLoading && !isError && (data?.results ?? []).length === 0 && (
        <EmptyState
          emoji="🔔"
          title="All quiet"
          hint="No notifications yet — claims, pickups, deliveries, verification results and ratings will all land here."
          next={[
            "Post food or claim a rescue to get things moving.",
            "Allow browser notifications when prompted for instant pings.",
            "This list is also mirrored in the bell menu at the top.",
          ]}
        />
      )}

      <ul className="grid gap-2">
        {(data?.results ?? []).map((notification) => (
          <li key={notification.id}>
            <button
              className={clsx(
                "flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
                notification.is_read
                  ? "border-[color:var(--fb-line)] bg-[color:var(--fb-surface)]"
                  : "border-saffron-400/60 bg-saffron-50 dark:bg-saffron-900/20",
              )}
              onClick={() => !notification.is_read && markOne.mutate(notification.id)}
            >
              <span className="text-xl" aria-hidden>
                {TYPE_EMOJI[notification.type] ?? "📌"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{notification.message}</span>
                <span className="mt-0.5 block text-[11px] text-[color:var(--fb-ink-soft)]">{timeAgo(notification.created_at)}</span>
              </span>
              {!notification.is_read && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-saffron-500" aria-label="unread" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
