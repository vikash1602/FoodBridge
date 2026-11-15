/** Guided dashboard tour: step definitions, per-role completion state
 *  (localStorage `fb.tour.v1`), and a tiny external store for the active run.
 *
 *  Design rules (Phase 4):
 *  - one component highlighted at a time; never blocks the app (overlay is
 *    click-through and any outside click / Escape ends the tour);
 *  - completion persists per role and can be restarted from the Help centre;
 *  - steps may live on different routes — when the tour reaches one, the user
 *    is offered a "Take me there" card instead of being yanked around.
 */

import { useSyncExternalStore } from "react";

export type TourRole = "volunteer" | "donor";

export interface TourStep {
  id: string;
  /** Page this step's target lives on. */
  route: string;
  /** CSS selector (we use data-tour attributes) for the highlighted element. */
  target: string;
  title: string;
  body: string;
}

export const TOURS: Record<TourRole, TourStep[]> = {
  volunteer: [
    {
      id: "feed",
      route: "/app",
      target: '[data-tour="feed-heading"]',
      title: "The rescue feed",
      body: "Live surplus food near you, sorted by urgency × distance. It refreshes by itself — when a kitchen posts, it appears here with a ping.",
    },
    {
      id: "badges",
      route: "/app",
      target: '[data-tour="listing-badges"]',
      title: "Quantity & dietary badges",
      body: "Each ticket shows how much food there is (meals, kg or boxes) and a green 🌿 badge when it's vegetarian. Trust badge = the donor's rating.",
    },
    {
      id: "allergens",
      route: "/app",
      target: '[data-tour="listing-allergens"]',
      title: "Allergen information",
      body: "When a donor lists allergens (nuts, dairy, gluten…) they're flagged right on the ticket with a ⚠️ chip — and again on the detail page. Always double-check before handing food onward.",
    },
    {
      id: "countdown",
      route: "/app",
      target: '[data-tour="listing-countdown"]',
      title: "Urgency countdown",
      body: "The dial on each ticket counts down to the food's safe-until time. When it hits zero the listing expires — claim what you can reach in time.",
    },
    {
      id: "map",
      route: "/app",
      target: '[data-tour="map"]',
      title: "Map markers",
      body: "Every plate marker is a pickup point. Hover a feed card to spotlight it on the map, or tap a marker on mobile to peek at the listing.",
    },
    {
      id: "filters",
      route: "/app",
      target: '[data-tour="filters"]',
      title: "Distance & filters",
      body: "Filter by radius (3–12 km), veg-only and food type. Distances on each ticket are measured from your saved base location.",
    },
    {
      id: "claim",
      route: "/app",
      target: '[data-tour="claim-button"]',
      title: "Claim button",
      body: "One tap reserves the food for you. You'll get the donor's 4-digit pickup code on the next screen — claim only what you can collect soon, others are counting on you.",
    },
    {
      id: "my-rescues",
      route: "/app/my-claims",
      target: '[data-tour="my-rescues"]',
      title: "My Rescues",
      body: "Your active rescues live here with a step tracker: claimed → picked up → delivered. Verify the pickup code at the donor's door, then mark delivered.",
    },
    {
      id: "impact",
      route: "/app/impact",
      target: '[data-tour="impact"]',
      title: "Impact dashboard",
      body: "Every finished rescue lands here: meals rescued, deliveries and your trust score. Trust grows with each delivery and 5★ rating.",
    },
  ],
  donor: [
    {
      id: "dashboard",
      route: "/app",
      target: '[data-tour="sidebar"]',
      title: "Your dashboard",
      body: "This sidebar is your control panel: the live feed, Post food, My listings, Impact and Profile. On phones the same pages sit in the bottom dock.",
    },
    {
      id: "post-food",
      route: "/app/post",
      target: '[data-tour="post-food"]',
      title: "Post Food",
      body: "Surplus to share? This wizard posts food in about 30 seconds — nearby volunteers get pinged instantly and the alert radius grows the longer it waits.",
    },
    {
      id: "listing-info",
      route: "/app/post",
      target: '[data-tour="post-steps"]',
      title: "Listing information",
      body: "Three short steps: what it is (type, veg flag, allergens), how much, and where/when to pick up with a safety window. Clear info = faster claims.",
    },
    {
      id: "pickup-code",
      route: "/app/my-listings",
      target: '[data-tour="my-listings"]',
      title: "Pickup code",
      body: "When a volunteer claims your food, a 4-digit code appears here. Show it to them at handover — they'll enter it to verify the pickup.",
    },
    {
      id: "my-listings",
      route: "/app/my-listings",
      target: '[data-tour="my-listings"]',
      title: "My Listings",
      body: "All your posts with live status. Open listings can be edited or cancelled; the countdown ring shows the safety window closing.",
    },
    {
      id: "progress",
      route: "/app/my-listings",
      target: '[data-tour="listing-status"]',
      title: "Rescue progress",
      body: "Status chips track each rescue: open → claimed → picked up → delivered. You'll be notified at every hop.",
    },
    {
      id: "impact",
      route: "/app/impact",
      target: '[data-tour="impact"]',
      title: "Impact dashboard",
      body: "See the meals your kitchen rescued, deliveries completed and your trust score — proof of the waste you prevented.",
    },
  ],
};

/* ---------------- state: per-role completion (persisted) ---------------- */

const KEY = "fb.tour.v1";

type TourRecord = Partial<Record<TourRole, "completed" | "skipped">>;

interface TourStore {
  record: TourRecord;
  /** The in-flight run (not persisted — refresh ends it gracefully). */
  active: { role: TourRole; index: number } | null;
}

function readRecord(): TourRecord {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as TourRecord) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

let store: TourStore = { record: readRecord(), active: null };
const listeners = new Set<() => void>();

function emit(): void {
  store = { ...store };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTourStore(): TourStore {
  return useSyncExternalStore(subscribe, () => store, () => store);
}

export function tourStatus(role: TourRole): "completed" | "skipped" | undefined {
  return store.record[role];
}

/** Auto-start only for people who have never finished or skipped the tour. */
export function shouldAutoStart(role: TourRole): boolean {
  return store.record[role] === undefined;
}

export function startTour(role: TourRole, index = 0): void {
  store.active = { role, index };
  emit();
}

export function goToTourStep(index: number): void {
  if (!store.active) return;
  const steps = TOURS[store.active.role];
  store.active = { ...store.active, index: Math.max(0, Math.min(index, steps.length - 1)) };
  emit();
}

export function endTour(mark: "completed" | "skipped"): void {
  if (!store.active) return;
  const { role } = store.active;
  store.active = null;
  store.record = { ...store.record, [role]: mark };
  try {
    localStorage.setItem(KEY, JSON.stringify(store.record));
  } catch {
    /* private mode */
  }
  emit();
}

/** Advance to the next step (used by the Next button on normal steps). */
export function nextTourStep(): void {
  if (!store.active) return;
  const steps = TOURS[store.active.role];
  if (store.active.index >= steps.length - 1) endTour("completed");
  else goToTourStep(store.active.index + 1);
}

export function prevTourStep(): void {
  if (!store.active) return;
  goToTourStep(store.active.index - 1);
}
