/** Phase 7 — permanent Help & How It Works centre (all roles).
 *  Simple explanations with icon illustrations; restarts the dashboard tour;
 *  links to in-app report flows. Plain language, no fabricated numbers. */

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  Compass,
  GraduationCap,
  HeartHandshake,
  LifeBuoy,
  MapPin,
  Play,
  ShieldCheck,
  Star,
  Truck,
  UtensilsCrossed,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "@/api/client";
import { useAuth } from "@/api/auth";
import { startTour } from "@/lib/tour";
import { clsx } from "clsx";

const SECTIONS = [
  { id: "getting-started", label: "Getting started", icon: GraduationCap },
  { id: "donation-process", label: "Food donation process", icon: UtensilsCrossed },
  { id: "rescue-process", label: "Volunteer rescue process", icon: HeartHandshake },
  { id: "pickup-verification", label: "Pickup verification", icon: ShieldCheck },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "trust-scores", label: "Trust scores", icon: Star },
  { id: "food-safety", label: "Food safety", icon: Truck },
  { id: "allergens", label: "Allergens", icon: AlertTriangle },
  { id: "location-privacy", label: "Location privacy", icon: MapPin },
  { id: "faq", label: "FAQs", icon: Compass },
  { id: "support", label: "Support & issues", icon: LifeBuoy },
] as const;

function Section({
  id,
  icon: Icon,
  title,
  children,
}: {
  id: (typeof SECTIONS)[number]["id"];
  icon: typeof GraduationCap;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="ticket scroll-mt-24 p-6" aria-labelledby={`help-${id}`}>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl border-2 border-forest-200 bg-forest-50 text-forest-700 dark:border-forest-800 dark:bg-forest-900/40 dark:text-forest-300">
          <Icon size={19} aria-hidden />
        </span>
        <h2 id={`help-${id}`} className="font-display text-xl font-bold">
          {title}
        </h2>
      </div>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-[color:var(--fb-ink-soft)]">{children}</div>
    </section>
  );
}

export function HelpPage() {
  const { user } = useAuth();
  const [tourMsg, setTourMsg] = useState("");
  const role = user?.role === "donor" ? "donor" : user?.role === "volunteer" ? "volunteer" : null;

  const { data: stats } = useQuery({
    queryKey: ["stats", "platform"],
    queryFn: () =>
      api.get<{ rescued: { delivered: number } }>("/stats/?scope=platform").catch(() => undefined),
    staleTime: 30_000,
  });

  const restartTour = () => {
    if (!role) return;
    startTour(role, 0);
    setTourMsg("Tour started — follow the highlighted steps. You can leave the tour anytime by clicking elsewhere or pressing Escape.");
  };

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-display text-3xl font-black">Help & how it works</h1>
      <p className="mt-1 text-sm text-[color:var(--fb-ink-soft)]">
        Everything you need to rescue food with confidence — no jargon, no guesswork.
      </p>

      {/* quick actions — label left, buttons beside it; wraps on tablet,
          stacks full-width on mobile; never escapes the card (Phase 1) */}
      <div className="ticket mt-4 p-4 sm:p-5">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-3">
          <p className="min-w-0 text-sm font-bold sm:mr-auto">First time here?</p>
          {role ? (
            <button
              className="btn-primary h-10 w-full whitespace-nowrap px-4 text-sm sm:w-auto"
              onClick={restartTour}
            >
              <Play size={14} aria-hidden /> Restart the {role} tour
            </button>
          ) : (
            <p className="min-w-0 text-sm text-[color:var(--fb-ink-soft)]">
              Sign in to take the guided dashboard tour.
            </p>
          )}
          <Link to="/register" className="btn-outline h-10 w-full whitespace-nowrap px-4 text-sm sm:w-auto">
            Create an account
          </Link>
        </div>
        {tourMsg && (
          <p className="mt-3 text-xs font-semibold text-forest-700 dark:text-forest-300">{tourMsg}</p>
        )}
      </div>

      {/* section chips */}
      <nav aria-label="Help sections" className="mt-4 flex flex-wrap gap-2">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="chip bg-[color:var(--fb-line)]/50 hover:bg-forest-100 dark:hover:bg-forest-900"
          >
            {section.label}
          </a>
        ))}
      </nav>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Section id="getting-started" icon={GraduationCap} title="Getting started">
          <p>
            <strong>1.</strong> Create an account and pick your role: <strong>Food Donor</strong> (you have surplus) or{" "}
            <strong>Volunteer / NGO</strong> (you collect and deliver). One account, one role.
          </p>
          <p>
            <strong>2.</strong> A short setup wizard runs once: donors register their organization for verification;
            volunteers set a base location and alert radius.
          </p>
          <p>
            <strong>3.</strong> The first time your dashboard opens, a guided tour highlights each part of the screen —
            Next / Back / Skip, restartable here anytime.
          </p>
          {stats?.rescued.delivered ? (
            <p>
              You're joining {stats.rescued.delivered} completed rescues so far — every one of them real food that
              reached people instead of a bin.
            </p>
          ) : null}
        </Section>

        <Section id="donation-process" icon={UtensilsCrossed} title="Food donation process">
          <ol className="list-inside list-decimal space-y-1.5">
            <li><strong>Post</strong> — the wizard asks what it is, how much, where, and a safety window (2–6 h).</li>
            <li><strong>Volunteer claims</strong> — nearby volunteers are pinged; the alert radius widens over time.</li>
            <li><strong>Pickup code</strong> — a 4-digit code appears on your listing when someone claims.</li>
            <li><strong>Food collected</strong> — show the code; the volunteer types it in to verify.</li>
            <li><strong>Delivered</strong> — you're notified; your impact counters update.</li>
          </ol>
          <p>Posting unlocks after your organization is verified — explore freely while you wait.</p>
        </Section>

        <Section id="rescue-process" icon={HeartHandshake} title="Volunteer rescue process">
          <ol className="list-inside list-decimal space-y-1.5">
            <li><strong>Discover</strong> — the live feed shows food near your base, sorted by urgency × distance.</li>
            <li><strong>Inspect</strong> — open a ticket: quantity, veg flag, allergens, safe-until countdown.</li>
            <li><strong>Claim</strong> — one tap reserves it for you; it disappears for others.</li>
            <li><strong>Collect</strong> — go to the pickup address (exact location shared only with you).</li>
            <li><strong>Verify pickup</strong> — enter the donor's 4-digit code.</li>
            <li><strong>Deliver</strong> — hand it to people/NGOs who need it and mark delivered with a note.</li>
          </ol>
          <p>Can't make it? Cancel early — the food reopens for others. Frequent late cancellations lower your trust score.</p>
        </Section>

        <Section id="pickup-verification" icon={ShieldCheck} title="Pickup verification">
          <p>
            When a claim is made, the donor's listing shows a <strong>4-digit pickup code</strong>. At handover the
            donor shows it and the volunteer types it in — only the right code marks the food "picked up".
          </p>
          <p>
            This proves the handover happened, protects both sides, and feeds the trust scores. Codes are single-use
            per claim and can't be guessed by replaying old ones.
          </p>
        </Section>

        <Section id="notifications" icon={Bell} title="Notifications">
          <p>
            In-app notifications land in the bell menu and the Notifications page. When food is posted near you, a
            live event pings the feed instantly (SSE) — allow browser notifications when prompted to get pings even
            when you're on another page.
          </p>
          <p>Donors hear about claims, pickups and deliveries; volunteers hear about new nearby food and status changes.</p>
        </Section>

        <Section id="trust-scores" icon={Star} title="Trust scores">
          <p>
            Everyone starts at 50 and builds from there: <strong>+8</strong> per completed delivery, <strong>+2</strong>{" "}
            per 5★ rating. Late cancellations <strong>−6</strong>, no-shows <strong>−10</strong>, an upheld report{" "}
            <strong>−5</strong>.
          </p>
          <p>
            Badges grow with the score: new → reliable → trusted → champion. Higher trust makes your claims and
            listings more attractive — it's the platform's reputation currency.
          </p>
        </Section>

        <Section id="food-safety" icon={Truck} title="Food safety">
          <ul className="list-inside list-disc space-y-1.5">
            <li>Donors set an explicit <strong>safe-until window</strong>; listings expire when it closes.</li>
            <li>Volunteers check seals, quantity and freshness at pickup and can refuse anything questionable.</li>
            <li>Keep food covered and upright in transit; deliver within the window.</li>
            <li>Not sure? Don't hand it over — cancel the claim and, if needed, report the listing.</li>
          </ul>
          <p>FoodBridge coordinates rescues; the final judgement on any handover stays with the people doing it.</p>
        </Section>

        <Section id="allergens" icon={LifeBuoy} title="Allergens">
          <p>
            Donors declare allergens (nuts, dairy, gluten…) when posting. They're shown as a ⚠️ chip right on the
            ticket and repeated on the detail page.
          </p>
          <p>
            Volunteers should pass allergen information on when delivering — never re-package or re-label rescued
            food. When in doubt, ask the donor before delivering.
          </p>
        </Section>

        <Section id="location-privacy" icon={MapPin} title="Location privacy">
          <p>
            Browsing shows <strong>lightly fuzzed</strong> locations, not exact coordinates. The exact pickup address
            is shared only with the volunteer holding the active claim.
          </p>
          <p>
            Your base location is used only for distances and alerts, and you choose the alert radius. You can move
            your base anytime from Profile.
          </p>
        </Section>

        <Section id="faq" icon={Compass} title="FAQs">
          <p><strong>Is it free?</strong> Yes — no fees for donors or volunteers.</p>
          <p><strong>Can I be both donor and volunteer?</strong> One account holds one role; register a second account with the other role if you truly need both.</p>
          <p><strong>What if nobody claims?</strong> The alert radius widens in steps; if the safety window closes, the listing expires — nothing is ever promised that isn't rescued.</p>
          <p><strong>Who sees my address?</strong> Only the volunteer with an active claim on your food.</p>
        </Section>

        <Section id="support" icon={LifeBuoy} title="Support & report issues">
          <p>
            <strong>Report a listing:</strong> open it and use the{" "}
            <em>Report</em> button — administrators review every report
            and take appropriate action.
          </p>

          <p>
            <strong>Account problems:</strong> contact the FoodBridge
            owner directly at{" "}
            <a
              className="font-bold text-forest-700 underline dark:text-forest-300"
              href="mailto:vikashvnb2005@gmail.com?subject=FoodBridge%20Support%20Request"
            >
              vikashvnb2005@gmail.com
            </a>{" "}
            for login issues, account assistance, technical problems or
            general platform support.
          </p>

          <p>
            <strong>Safety emergencies:</strong> contact your local
            authorities first — FoodBridge is a coordination platform,
            not an emergency service.
          </p>
        </Section>
      </div>

      <p className={clsx("mt-6 text-center text-xs text-[color:var(--fb-ink-soft)]")}>
        Tip: this page lives in the sidebar (and the landing-page footer) — bookmark it for newcomers.
      </p>
    </div>
  );
}
