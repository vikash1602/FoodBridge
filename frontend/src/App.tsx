/** Router + the live-events backbone (SSE -> toasts, browser notifications, query refresh).
 *  Every page is route-level code-split (React.lazy) — the landing page stays eager. */

import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import toast from "react-hot-toast";

import { useAuth } from "@/api/auth";
import { AppLayout } from "@/components/Layout";
import { ListingCardSkeleton } from "@/components/ui";
import { useLiveEvents } from "@/lib/sse";

const LandingPage = lazy(() => import("@/pages/Landing").then((m) => ({ default: m.LandingPage })));
const LoginPage = lazy(() => import("@/pages/Login").then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import("@/pages/Register").then((m) => ({ default: m.RegisterPage })));
const VolunteerHomePage = lazy(() => import("@/pages/VolunteerHome").then((m) => ({ default: m.VolunteerHomePage })));
const OnboardingPage = lazy(() => import("@/pages/Onboarding").then((m) => ({ default: m.OnboardingPage })));
const PostListingPage = lazy(() => import("@/pages/PostListing").then((m) => ({ default: m.PostListingPage })));
const MyListingsPage = lazy(() => import("@/pages/MyListings").then((m) => ({ default: m.MyListingsPage })));
const MyClaimsPage = lazy(() => import("@/pages/MyClaims").then((m) => ({ default: m.MyClaimsPage })));
const ListingDetailPage = lazy(() => import("@/pages/ListingDetail").then((m) => ({ default: m.ListingDetailPage })));
const NotificationsPage = lazy(() => import("@/pages/Notifications").then((m) => ({ default: m.NotificationsPage })));
const ProfilePage = lazy(() => import("@/pages/Profile").then((m) => ({ default: m.ProfilePage })));
const ImpactPage = lazy(() => import("@/pages/Impact").then((m) => ({ default: m.ImpactPage })));
const LeaderboardPage = lazy(() => import("@/pages/Leaderboard").then((m) => ({ default: m.LeaderboardPage })));
const AdminConsolePage = lazy(() => import("@/pages/AdminConsole").then((m) => ({ default: m.AdminConsolePage })));
const HelpPage = lazy(() => import("@/pages/Help").then((m) => ({ default: m.HelpPage })));

function PageFallback() {
  return (
    <div className="grid gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      <ListingCardSkeleton />
      <ListingCardSkeleton />
    </div>
  );
}

const LIVE_EVENT_MESSAGES: Record<string, string> = {
  "listing.new_nearby": "New rescue near you! 🍲",
  "listing.claimed": "Someone just claimed this. ⚡",
  "listing.delivered": "A rescue was delivered! 🎉",
  "listing.reopened": "A listing just reopened ♻️",
};

function LiveEvents() {
  const queryClient = useQueryClient();
  const { isLoggedIn } = useAuth();
  const location = useLocation();

  const mode = useLiveEvents((message) => {
    switch (message.event) {
      case "listing.created":
      case "listing.new_nearby":
        queryClient.invalidateQueries({ queryKey: ["listings"] });
        if (message.event === "listing.new_nearby") {
          const title = String(message.payload.title ?? "New food nearby");
          toast(`${title} — rescue it!`, { icon: "🍲" });
          if (Notification.permission === "granted") {
            new Notification("FoodBridge — new food nearby", { body: title });
          }
        }
        break;
      case "listing.claimed":
      case "listing.picked_up":
      case "listing.delivered":
      case "listing.reopened":
      case "listing.cancelled":
        queryClient.invalidateQueries({ queryKey: ["listings"] });
        queryClient.invalidateQueries({ queryKey: ["claims"] });
        queryClient.invalidateQueries({ queryKey: ["listing"] });
        if (LIVE_EVENT_MESSAGES[message.event] && location.pathname === "/app") {
          toast(LIVE_EVENT_MESSAGES[message.event] ?? "Update ⚡", { icon: "⚡" });
        }
        break;
      case "notif.org_verified":
      case "notif.org_rejected":
        queryClient.invalidateQueries({ queryKey: ["me"] });
        queryClient.invalidateQueries({ queryKey: ["organizations"] });
        break;
      default:
        if (message.event.startsWith("notif.")) {
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
        }
    }
  }, isLoggedIn);

  useEffect(() => {
    document.documentElement.dataset.liveMode = mode;
  }, [mode]);

  return null;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isLoading } = useAuth();
  if (!isLoggedIn && !isLoading) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireRole({ roles, children }: { roles: Array<"donor" | "volunteer" | "admin">; children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (!isLoading && (!user || !roles.includes(user.role))) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <LiveEvents />
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/app"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<VolunteerHomePage />} />
            <Route path="onboarding" element={<OnboardingPage />} />
            <Route
              path="post"
              element={
                <RequireRole roles={["donor"]}>
                  <PostListingPage />
                </RequireRole>
              }
            />
            <Route
              path="my-listings"
              element={
                <RequireRole roles={["donor"]}>
                  <MyListingsPage />
                </RequireRole>
              }
            />
            <Route path="my-claims" element={<MyClaimsPage />} />
            <Route path="listings/:id" element={<ListingDetailPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="impact" element={<ImpactPage />} />
            <Route path="leaderboard" element={<LeaderboardPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route
              path="admin"
              element={
                <RequireRole roles={["admin"]}>
                  <AdminConsolePage />
                </RequireRole>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
