/** The reusable spotlight tour (Phase 4). Mounts once inside AppLayout.
 *
 *  Behaviour contract:
 *  - highlights exactly one element at a time (data-tour anchors);
 *  - steps can live on other routes → a "Take me there" card is offered,
 *    navigation is always user-initiated;
 *  - NEVER blocks the app: the dim overlay is click-through, any outside
 *    click or Escape ends the tour, and the card is the only interactive
 *    surface;
 *  - progress dots + Back / Skip / Next; completion persists per role;
 *  - works desktop (anchored card) and mobile (bottom-sheet card).
 *
 *  Stacking architecture (see index.css z-index hierarchy): the spotlight
 *  and tooltip are rendered through createPortal into document.body at
 *  --z-tour-backdrop (9000) / --z-tour-card (9100) — far above Leaflet's
 *  internal panes (contained per-map at .leaflet-container { z-index: 0 }),
 *  ordinary popovers (500) and modals (2000). The card's real height is
 *  measured (ResizeObserver) so collision-aware placement never clips it
 *  against the viewport bottom, and a rAF loop keeps the spotlight and the
 *  card synchronized with the target while the user scrolls, resizes or
 *  zooms.
 */

import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Compass, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { clsx } from "clsx";

import {
  TOURS,
  endTour,
  nextTourStep,
  prevTourStep,
  shouldAutoStart,
  startTour,
  useTourStore,
  type TourStep,
} from "@/lib/tour";
import { useAuth } from "@/api/auth";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

const CARD_W = 330;
const GAP = 14;
/** Fallback height until the card is measured (it is re-measured immediately). */
const EST_CARD_H = 250;
/* Explicit layers from the app-wide z-index hierarchy (index.css). Numbers,
   not var(): React's CSSOM setter silently drops var() on style.zIndex. */
const Z_TOUR_BACKDROP = 9000;
const Z_TOUR_CARD = 9100;

/** Pick the best card position for a target rect (below → above → right → left → center). */
function placeCard(rect: Rect | null, vw: number, vh: number, cardH: number): { top: number; left: number } {
  if (!rect) return { top: Math.max(16, vh / 2 - cardH / 2), left: Math.max(12, vw / 2 - CARD_W / 2) };

  const below = rect.bottom + GAP;
  const above = rect.top - GAP - cardH;
  if (below + cardH < vh - 12) return { top: below, left: clampX(rect.left, vw) };
  if (above > 60) return { top: Math.max(12, above), left: clampX(rect.left, vw) };
  if (rect.right + GAP + CARD_W < vw - 12) return { top: clampY(rect.top, vh, cardH), left: rect.right + GAP };
  if (rect.left - GAP - CARD_W > 12) return { top: clampY(rect.top, vh, cardH), left: rect.left - GAP - CARD_W };
  return { top: Math.max(16, vh / 2 - cardH / 2), left: Math.max(12, vw / 2 - CARD_W / 2) };
}

function clampX(left: number, vw: number): number {
  return Math.max(12, Math.min(left, vw - CARD_W - 12));
}
function clampY(top: number, vh: number, cardH: number): number {
  return Math.max(12, Math.min(top, vh - cardH - 12));
}

/** Mobile: bottom sheet always. */
function isCompact(vw: number): boolean {
  return vw < 640;
}

function Tooltip({
  step,
  index,
  total,
  traveling,
  onNext,
  onBack,
  onSkip,
  onTravel,
}: {
  step: TourStep;
  index: number;
  total: number;
  traveling: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onTravel: () => void;
}) {
  const last = index === total - 1;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className="ticket relative w-full p-4 shadow-lift"
      style={{ maxWidth: CARD_W }}
      data-testid="tour-card"
      aria-live="polite"
      aria-label={`Tour step ${index + 1} of ${total}`}
    >
      <button
        className="btn-ghost absolute right-2 top-2 h-8 w-8 !rounded-full p-0"
        onClick={onSkip}
        aria-label="Skip tour"
      >
        <X size={15} aria-hidden />
      </button>

      {traveling ? (
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-saffron-100 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-saffron-800">
          <Compass size={11} aria-hidden /> Next stop
        </p>
      ) : null}

      <p className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--fb-ink-soft)]">
        Step {index + 1} of {total}
      </p>
      <h2 className="font-display text-lg font-bold leading-snug">{step.title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-[color:var(--fb-ink-soft)]">{step.body}</p>

      {/* progress dots */}
      <div className="mt-3 flex items-center gap-1.5" aria-hidden>
        {Array.from({ length: total }).map((_, dot) => (
          <span
            key={dot}
            className={clsx(
              "h-1.5 rounded-full transition-all",
              dot === index ? "w-5 bg-saffron-500" : dot < index ? "w-1.5 bg-forest-500" : "w-1.5 bg-[color:var(--fb-line)]",
            )}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button className="btn-ghost text-xs" onClick={onBack} disabled={index === 0}>
          Back
        </button>
        <span className="flex-1" />
        {traveling ? (
          <button className="btn-saffron h-10 px-4 text-sm" onClick={onTravel}>
            Take me there →
          </button>
        ) : (
          <button className="btn-primary h-10 px-5 text-sm" onClick={onNext}>
            {last ? "Finish 🎉" : "Next"}
          </button>
        )}
      </div>
    </motion.div>
  );
}

export function ProductTour() {
  const { active } = useTourStore();
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [rect, setRect] = useState<Rect | null>(null);
  const [traveling, setTraveling] = useState(false);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [cardH, setCardH] = useState(EST_CARD_H);
  const scrolledForStep = useRef<string>("");
  const cardRef = useRef<HTMLDivElement | null>(null);

  // keep viewport size for placement
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // measure the real card height so placement math never clips it
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measure = () => setCardH(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [active?.role, active?.index, traveling]);

  // Auto-start once per role, on the dashboard home, after onboarding basics exist.
  useEffect(() => {
    if (isLoading || !user || active) return;
    const role = user.role === "donor" ? "donor" : user.role === "volunteer" ? "volunteer" : null;
    if (!role) return;
    if (location.pathname !== "/app") return;
    // Volunteers without a base location still need onboarding first.
    if (role === "volunteer" && (user.base_lat == null || user.base_lng == null)) return;
    if (!shouldAutoStart(role)) return;
    const timer = setTimeout(() => startTour(role), 900);
    return () => clearTimeout(timer);
  }, [user, isLoading, active, location.pathname]);

  const role = active?.role;
  const steps = role ? TOURS[role] : [];
  const step = active ? steps[active.index] : undefined;

  // Track the step's target: either we're on its route (highlight) or traveling.
  useEffect(() => {
    if (!active || !step) return;
    setRect(null);
    const onRoute = location.pathname === step.route || (step.route !== "/app" && location.pathname.startsWith(step.route));
    setTraveling(!onRoute);
    if (!onRoute) return;

    let raf = 0;
    const tick = () => {
      const el = document.querySelector(step.target);
      if (el) {
        const box = el.getBoundingClientRect();
        setRect((prev) => {
          const next = {
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            bottom: box.bottom,
            right: box.right,
          };
          if (
            prev &&
            Math.abs(prev.top - next.top) < 0.5 &&
            Math.abs(prev.left - next.left) < 0.5 &&
            Math.abs(prev.width - next.width) < 0.5 &&
            Math.abs(prev.height - next.height) < 0.5
          ) {
            return prev;
          }
          return next;
        });
        // bring the target comfortably into view once when the step opens
        const margin = 140;
        if (scrolledForStep.current !== step.id && (box.top < 70 || box.bottom > window.innerHeight - margin)) {
          scrolledForStep.current = step.id;
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      } else {
        setRect(null);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, step, location.pathname]);

  // Escape / outside-pointerdown ends the tour — it can never trap the user.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") endTour("skipped");
    };
    const onPointer = (event: PointerEvent) => {
      const card = document.querySelector('[data-testid="tour-card"]');
      if (card && event.target instanceof Node && card.contains(event.target)) return;
      endTour("skipped");
    };
    window.addEventListener("keydown", onKey);
    // pointerdown in capture phase so clicks pass through to the app untouched
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [active]);

  if (!active || !step || !role) return null;

  const compact = isCompact(viewport.w);
  const cardPos = compact
    ? null // bottom sheet
    : placeCard(traveling ? null : rect, viewport.w, viewport.h, cardH);

  const rectBox =
    rect && !traveling && rect.width > 0
      ? {
          top: rect.top - 6,
          left: rect.left - 6,
          width: rect.width + 12,
          height: rect.height + 12,
        }
      : null;

  return createPortal(
    <AnimatePresence>
      {/* click-through dim layer (no pointer events of its own) */}
      {rectBox && (
        <motion.div
          key="spotlight"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-none fixed rounded-2xl transition-all duration-200"
          style={{
            top: rectBox.top,
            left: rectBox.left,
            width: rectBox.width,
            height: rectBox.height,
            zIndex: Z_TOUR_BACKDROP,
            boxShadow: "0 0 0 4px rgba(217,142,20,.75), 0 0 0 200vmax rgba(21,16,9,.55)",
          }}
          aria-hidden
        />
      )}

      {/* card: anchored on desktop, bottom sheet on mobile — portaled to body so
          nothing in the app tree (Leaflet panes, overflow, transforms) can bury it */}
      <motion.div
        key="tour-card-layer"
        className={clsx("fixed", compact ? "inset-x-3 bottom-3" : "")}
        style={{
          zIndex: Z_TOUR_CARD,
          ...(cardPos ? { top: cardPos.top, left: cardPos.left, width: CARD_W } : {}),
        }}
        initial={false}
      >
        <div ref={cardRef}>
          <AnimatePresence mode="wait">
            <Tooltip
              key={`${active.role}-${active.index}-${traveling ? "travel" : "here"}`}
              step={step}
              index={active.index}
              total={steps.length}
              traveling={traveling}
              onNext={() => nextTourStep()}
              onBack={() => prevTourStep()}
              onSkip={() => endTour("skipped")}
              onTravel={() => navigate(step.route)}
            />
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
