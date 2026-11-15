/** App shell: desktop counter sidebar + mobile bottom dock + top bar with bell.
 *  Sidebar items prefetch their page's data on hover/focus (TanStack prefetchQuery). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  BellRing,
  ChefHat,
  ClipboardList,
  HeartHandshake,
  LifeBuoy,
  LogOut,
  MapPinIcon,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
  UtensilsCrossed,
} from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth, useLogout } from "@/api/auth";
import { api } from "@/api/client";
import type { Notification, Paginated, User } from "@/api/types";
import { LangToggle } from "@/components/LangToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ProductTour } from "@/components/product-tour/ProductTour";
import { useT } from "@/lib/city";
import { fullName, timeAgo } from "@/lib/format";
import { clsx } from "clsx";

interface NavItem {
  to: string;
  labelKey: string;
  icon: typeof MapPinIcon;
  roles?: User["role"][];
  prefetch?: () => void;
}

function makePrefetch(queryClient: ReturnType<typeof useQueryClient>, geo: { lat: number; lng: number }) {
  return (to: string): (() => void) | undefined => {
    const fetcher = (path: string) => api.get(path);
    switch (to) {
      case "/app":
        return () =>
          void queryClient.prefetchQuery({
            queryKey: ["listings", "feed", geo.lat, geo.lng, 12, false, ""],
            queryFn: () => fetcher(`/listings/?lat=${geo.lat.toFixed(5)}&lng=${geo.lng.toFixed(5)}&radius=12&page_size=30`),
            staleTime: 15_000,
          });
      case "/app/my-claims":
        return () => void queryClient.prefetchQuery({ queryKey: ["claims"], queryFn: () => fetcher("/claims/?page_size=50") });
      case "/app/my-listings":
        return () => void queryClient.prefetchQuery({ queryKey: ["listings", "mine"], queryFn: () => fetcher("/listings/mine/?page_size=50") });
      case "/app/impact":
        return () => void queryClient.prefetchQuery({ queryKey: ["stats", "me"], queryFn: () => fetcher("/stats/?scope=me"), staleTime: 30_000 });
      case "/app/leaderboard":
        return () => void queryClient.prefetchQuery({ queryKey: ["leaderboard"], queryFn: () => fetcher("/stats/?metric=leaderboard"), staleTime: 30_000 });
      case "/app/profile":
        return () => void queryClient.prefetchQuery({ queryKey: ["organizations"], queryFn: () => fetcher("/organizations/") });
      case "/app/admin":
        return () => void queryClient.prefetchQuery({ queryKey: ["admin", "orgs", "pending"], queryFn: () => fetcher("/organizations/?verification_status=pending&page_size=50") });
      default:
        return undefined;
    }
  };
}

const NAV: NavItem[] = [
  { to: "/app", labelKey: "nav.feed", icon: MapPinIcon },
  { to: "/app/my-claims", labelKey: "nav.myClaims", icon: HeartHandshake },
  { to: "/app/post", labelKey: "nav.post", icon: PlusCircle, roles: ["donor"] },
  { to: "/app/my-listings", labelKey: "nav.myListings", icon: ClipboardList, roles: ["donor"] },
  { to: "/app/impact", labelKey: "nav.impact", icon: Sparkles },
  { to: "/app/leaderboard", labelKey: "nav.leaderboard", icon: Trophy },
  { to: "/app/profile", labelKey: "nav.profile", icon: UserRound },
  { to: "/app/admin", labelKey: "nav.admin", icon: ShieldCheck, roles: ["admin"] },
  { to: "/app/help", labelKey: "nav.help", icon: LifeBuoy },
];

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="FoodBridge home">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-forest-700 text-paper shadow-card dark:bg-forest-400 dark:text-pantry-950">
        <ChefHat size={22} aria-hidden />
      </span>
      <span className="font-display text-2xl font-black tracking-tight">
        Food<span className="text-saffron-600 dark:text-saffron-400">Bridge</span>
      </span>
    </Link>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications", "bell"],
    queryFn: () => api.get<Paginated<Notification>>("/notifications/?page_size=8"),
    refetchInterval: 30_000,
  });
  const unread = data?.unread_count ?? 0;

  const markAll = useMutation({
    mutationFn: () => api.post("/notifications/read-all/"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <div className="relative">
      <button
        className="btn-ghost relative h-10 w-10 !rounded-full"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
      >
        {unread > 0 ? <BellRing size={18} className="text-saffron-600 dark:text-saffron-400" /> : <Bell size={18} />}
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-tomato-500 px-1 text-[10px] font-extrabold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            className="absolute right-0 top-12 z-40 w-80 overflow-hidden rounded-2xl border border-[color:var(--fb-line)] bg-[color:var(--fb-surface)] shadow-lift"
          >
            <div className="flex items-center justify-between border-b border-[color:var(--fb-line)] px-4 py-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-[color:var(--fb-ink-soft)]">
                Notifications
              </span>
              <button
                className="text-xs font-bold text-forest-600 hover:underline dark:text-forest-300"
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending || unread === 0}
              >
                Mark all read
              </button>
            </div>
            <ul className="max-h-80 divide-y divide-[color:var(--fb-line)] overflow-y-auto scrollbar-thin">
              {(data?.results ?? []).length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-[color:var(--fb-ink-soft)]">
                  Quiet kitchen — nothing yet.
                </li>
              )}
              {(data?.results ?? []).map((notification) => (
                <li key={notification.id}>
                  <Link
                    to="/app/notifications"
                    className={clsx(
                      "block px-4 py-3 text-sm hover:bg-forest-50 dark:hover:bg-pantry-700/50",
                      !notification.is_read && "bg-saffron-50 dark:bg-saffron-900/20",
                    )}
                    onClick={() => setOpen(false)}
                  >
                    {notification.message}
                    <span className="mt-0.5 block text-[11px] text-[color:var(--fb-ink-soft)]">
                      {timeAgo(notification.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AppLayout() {
  const { user, isLoading } = useAuth();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const queryClient = useQueryClient();
  const attachPrefetch = makePrefetch(queryClient, {
    lat: user?.base_lat ?? 12.6819,
    lng: user?.base_lng ?? 78.62,
  });
  const items = NAV.filter((item) => !item.roles || (user && item.roles.includes(user.role))).map((item) => ({
    ...item,
    prefetch: attachPrefetch(item.to),
  }));
  const isVolunteerHome = location.pathname === "/app";

  return (
    /* Application shell: one CSS Grid — sidebar column + (top bar / content).
       Desktop is an app frame (nothing scrolls at the root); mobile is normal flow. */
    <div className="min-h-dvh lg:grid lg:h-dvh lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
      {/* Desktop sidebar — the "counter" (grid col 1, spans both rows) */}
      <aside
        className="z-30 hidden w-60 shrink-0 flex-col border-r border-[color:var(--fb-line)] bg-[color:var(--fb-surface)]/80 backdrop-blur lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:flex lg:overflow-y-auto"
        data-tour="sidebar"
      >
        <div className="px-5 py-5">
          <Brand />
        </div>
        <nav className="flex-1 space-y-1 px-3" aria-label="Main">
          {items.map(({ to, labelKey, icon: Icon, prefetch }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/app"}
              onMouseEnter={prefetch}
              onFocus={prefetch}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors",
                  isActive
                    ? "bg-forest-700 text-paper shadow-card dark:bg-forest-400 dark:text-pantry-950"
                    : "text-[color:var(--fb-ink)] hover:bg-forest-100/70 dark:hover:bg-pantry-700",
                )
              }
            >
              <Icon size={18} aria-hidden />
              {t(labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-[color:var(--fb-line)] p-4">
          {user && (
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-saffron-200 font-display text-sm font-black text-pantry-950">
                {fullName(user).slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{fullName(user)}</p>
                <p className="text-[11px] uppercase tracking-wide text-[color:var(--fb-ink-soft)]">{user.role}</p>
              </div>
            </div>
          )}
          <button
            className="btn-ghost w-full justify-start text-sm !text-tomato-600"
            onClick={() => {
              logout();
              navigate("/");
            }}
          >
            <LogOut size={16} aria-hidden /> Sign out
          </button>
        </div>
      </aside>

      {/* Top bar (grid col 2, row 1) */}
      <header className="sticky top-0 z-20 border-b border-[color:var(--fb-line)] bg-[color:var(--fb-bg)]/85 backdrop-blur lg:sticky lg:top-0" data-tour="topbar">
        <div className="flex h-16 min-w-0 items-center justify-between gap-2 px-4 lg:px-6">
          <div className="min-w-0 lg:hidden">
            <Brand />
          </div>
          <div className="hidden min-w-0 items-center gap-2 lg:flex">
            <UtensilsCrossed size={16} className="shrink-0 text-saffron-600 dark:text-saffron-400" aria-hidden />
            <span className="truncate text-sm font-semibold text-[color:var(--fb-ink-soft)]">
              {isVolunteerHome
                ? "Live surplus near you — claim before the dial runs out"
                : user?.role === "donor"
                  ? "Your surplus becomes someone's dinner"
                  : "Welcome back"}
            </span>
          </div>
          <div className="flex shrink items-center gap-1 sm:gap-1.5">
            {isLoading ? null : <NotificationBell />}
            <LangToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Content (grid col 2, row 2) — scrolls independently on desktop */}
      <main className="min-h-0 px-4 pb-24 pt-6 sm:px-6 lg:overflow-y-auto lg:pb-8 lg:pr-6 xl:px-8">
        <Outlet />
      </main>

      {/* Phase 4: first-login dashboard tour (never blocks usage) */}
      <ProductTour />

      {/* Mobile bottom dock */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[color:var(--fb-line)] bg-[color:var(--fb-surface)]/95 backdrop-blur lg:hidden"
        aria-label="Main mobile"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="flex items-stretch justify-around">
          {items.slice(0, 5).map(({ to, labelKey, icon: Icon }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={to === "/app"}
                className={({ isActive }) =>
                  clsx(
                    "flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold",
                    isActive ? "text-forest-700 dark:text-saffron-400" : "text-[color:var(--fb-ink-soft)]",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={clsx(
                        "grid h-8 w-12 place-items-center rounded-full transition-colors",
                        isActive && "bg-forest-100 dark:bg-forest-900",
                      )}
                    >
                      <Icon size={19} aria-hidden />
                    </span>
                    <span className="truncate px-1">{t(labelKey)}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
