/** Landing: required hero copy, Donate/Rescue CTAs, how-it-works stepper,
 *  live impact ticker (real API stats only), benefits, end-to-end process,
 *  safety & food handling, FAQ and a footer with contact/support links.
 *  Design system unchanged: cream paper, forest green, saffron. */

import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  ChefHat,
  Clock3,
  Code,
  HeartHandshake,
  Leaf,
  Mail,
  MapPin,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "@/api/client";
import { LangToggle } from "@/components/LangToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DONOR_FLOW, VOLUNTEER_FLOW } from "@/lib/workflow";
import { WorkflowStrip } from "@/components/WorkflowGuide";
import { usePlatformConfig, useT } from "@/lib/city";

function CountUp({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const duration = 1400;
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return (
    <span className="tabular-nums">
      {value.toLocaleString()}
      {suffix}
    </span>
  );
}

interface PlatformStats {
  rescued: { listings: number; delivered: number; meals_equivalent: number };
  users: { donors: number; volunteers: number };
}

/** Educational ticker lines (features, never invented statistics). */
const GENERIC_TICKER = [
  "🍲 Post surplus food in about 30 seconds",
  "⚡ Volunteers nearby are pinged the moment food is listed",
  "🛡️ A 4-digit pickup code verifies every handover",
  "🌿 Veg flags and allergens shown on every ticket",
  "🤝 Trust scores grow with every completed rescue",
  "🌱 Rescued meals are delivered within their safe-until window",
];

function useLocalTicker(): string[] {
  const config = usePlatformConfig();
  const { data: stats } = useQuery({
    queryKey: ["landing", "stats"],
    queryFn: () => api.get<PlatformStats>("/stats/?scope=platform").catch(() => undefined),
  });
  const { data: board } = useQuery({
    queryKey: ["landing", "leaderboard"],
    queryFn: () =>
      api
        .get<{ donors: Array<{ name: string; deliveries: number }>; volunteers: Array<{ name: string; deliveries: number }> }>(
          "/stats/?metric=leaderboard",
        )
        .catch(() => undefined),
  });

  return useMemo(() => {
    const items: string[] = [];
    const delivered = stats?.rescued.delivered ?? 0;
    if (delivered > 0) items.push(`🎉 ${delivered} rescues completed in ${config.city_name} so far`);
    if (stats?.users.volunteers) items.push(`🛵 ${stats.users.volunteers} volunteers on standby around ${config.city_name}`);
    if (stats?.users.donors) items.push(`🍽️ ${stats.users.donors} kitchens sharing surplus`);
    const topDonor = board?.donors?.[0];
    if (topDonor && topDonor.deliveries > 0) items.push(`🏆 ${topDonor.name} leads the donor board with ${topDonor.deliveries} rescues`);
    const topVolunteer = board?.volunteers?.[0];
    if (topVolunteer && topVolunteer.deliveries > 0) items.push(`⭐ ${topVolunteer.name} just delivered another rescue`);
    items.push(...GENERIC_TICKER);
    return items.slice(0, 8);
  }, [stats, board, config.city_name]);
}

const STEP_KEYS = [
  { icon: Clock3, step: "01", title: "landing.step1", text: "landing.step1t", tint: "bg-saffron-100 text-saffron-700 border-saffron-300" },
  { icon: MapPin, step: "02", title: "landing.step2", text: "landing.step2t", tint: "bg-forest-100 text-forest-800 border-forest-300" },
  { icon: ShieldCheck, step: "03", title: "landing.step3", text: "landing.step3t", tint: "bg-tomato-500/10 text-tomato-600 border-tomato-500/40" },
];

function HowItWorks() {
  const reduceMotion = useReducedMotion();
  const t = useT();
  const animated = !reduceMotion;

  return (
    <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
      <h2 className="text-center font-display text-4xl font-black tracking-tight">{t("landing.how")}</h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-[color:var(--fb-ink-soft)]">{t("landing.howSub")}</p>
      <ol className="mt-12 grid gap-6 md:grid-cols-3">
        {STEP_KEYS.map((card, index) => (
          <motion.li
            key={card.step}
            initial={animated ? { opacity: 0, y: 24 } : false}
            whileInView={animated ? { opacity: 1, y: 0 } : undefined}
            viewport={{ once: true, margin: "-40px 0px -40px 0px" }}
            transition={{ delay: index * 0.1, duration: 0.5 }}
            className="ticket relative p-6"
          >
            <div className={`mb-4 grid h-12 w-12 place-items-center rounded-xl border-2 ${card.tint}`}>
              <card.icon size={22} aria-hidden />
            </div>
            <p className="absolute right-5 top-4 font-display text-4xl font-black text-[color:var(--fb-line)]">
              {card.step}
            </p>
            <h3 className="font-display text-xl font-bold">{t(card.title)}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[color:var(--fb-ink-soft)]">{t(card.text)}</p>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

function Benefits() {
  const t = useT();
  const donorPoints = ["landing.donorB1", "landing.donorB2", "landing.donorB3", "landing.donorB4"];
  const volPoints = ["landing.volB1", "landing.volB2", "landing.volB3", "landing.volB4"];

  return (
    <section id="benefits" className="border-y border-[color:var(--fb-line)]/60 bg-[color:var(--fb-surface)] scroll-mt-20">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-center font-display text-4xl font-black tracking-tight">{t("landing.benefits")}</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-[color:var(--fb-ink-soft)]">{t("landing.benefitsSub")}</p>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="ticket flex flex-col p-6">
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl border-2 border-saffron-300 bg-saffron-100 text-saffron-700">
              <ChefHat size={22} aria-hidden />
            </div>
            <h3 className="font-display text-2xl font-bold">{t("landing.donorTitle")}</h3>
            <p className="mt-1 text-sm text-[color:var(--fb-ink-soft)]">{t("landing.donorSub")}</p>
            <ul className="mt-4 flex-1 space-y-2.5 text-sm">
              {donorPoints.map((key) => (
                <li key={key} className="flex items-start gap-2">
                  <Leaf size={15} className="mt-0.5 shrink-0 text-forest-600 dark:text-forest-300" aria-hidden />
                  {t(key)}
                </li>
              ))}
            </ul>
            <Link to="/register?role=donor" className="btn-primary mt-6 self-start text-sm">
              {t("landing.becomeDonor")} <ArrowRight size={15} aria-hidden />
            </Link>
          </div>

          <div className="ticket flex flex-col p-6">
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl border-2 border-forest-300 bg-forest-100 text-forest-800">
              <HeartHandshake size={22} aria-hidden />
            </div>
            <h3 className="font-display text-2xl font-bold">{t("landing.volTitle")}</h3>
            <p className="mt-1 text-sm text-[color:var(--fb-ink-soft)]">{t("landing.volSub")}</p>
            <ul className="mt-4 flex-1 space-y-2.5 text-sm">
              {volPoints.map((key) => (
                <li key={key} className="flex items-start gap-2">
                  <Leaf size={15} className="mt-0.5 shrink-0 text-forest-600 dark:text-forest-300" aria-hidden />
                  {t(key)}
                </li>
              ))}
            </ul>
            <Link to="/register?role=volunteer" className="btn-saffron mt-6 self-start text-sm">
              {t("landing.becomeVolunteer")} <ArrowRight size={15} aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProcessDetail() {
  const t = useT();
  return (
    <section id="process" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 scroll-mt-20">
      <h2 className="text-center font-display text-4xl font-black tracking-tight">{t("landing.process")}</h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-[color:var(--fb-ink-soft)]">{t("landing.processSub")}</p>
      <div className="mt-12 grid gap-6 md:grid-cols-2">
        <div className="ticket p-6">
          <h3 className="font-display text-xl font-bold">{t("landing.processDonorT")}</h3>
          <p className="mt-1.5 text-sm text-[color:var(--fb-ink-soft)]">{t("landing.processDonorD")}</p>
          <WorkflowStrip flow={DONOR_FLOW} current={0} className="mt-5" />
        </div>
        <div className="ticket p-6">
          <h3 className="font-display text-xl font-bold">{t("landing.processVolT")}</h3>
          <p className="mt-1.5 text-sm text-[color:var(--fb-ink-soft)]">{t("landing.processVolD")}</p>
          <WorkflowStrip flow={VOLUNTEER_FLOW} current={0} className="mt-5" />
        </div>
      </div>
    </section>
  );
}

const SAFETY_CARDS = [
  { icon: Clock3, title: "landing.s1t", text: "landing.s1d", tint: "text-forest-700 dark:text-forest-300" },
  { icon: Code, title: "landing.s2t", text: "landing.s2d", tint: "text-saffron-600 dark:text-saffron-400" },
  { icon: AlertTriangle, title: "landing.s3t", text: "landing.s3d", tint: "text-saffron-600 dark:text-saffron-400" },
  { icon: ShieldCheck, title: "landing.s4t", text: "landing.s4d", tint: "text-forest-700 dark:text-forest-300" },
];

function Safety() {
  const t = useT();
  return (
    <section id="safety" className="border-y border-[color:var(--fb-line)]/60 bg-[color:var(--fb-surface)] scroll-mt-20">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-center font-display text-4xl font-black tracking-tight">{t("landing.safety")}</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-[color:var(--fb-ink-soft)]">{t("landing.safetySub")}</p>
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {SAFETY_CARDS.map((card) => (
            <div key={card.title} className="ticket p-6">
              <div className="flex items-center gap-3">
                <span className={`grid h-10 w-10 place-items-center rounded-xl bg-[color:var(--fb-line)]/40 ${card.tint}`}>
                  <card.icon size={20} aria-hidden />
                </span>
                <h3 className="font-display text-lg font-bold">{t(card.title)}</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-[color:var(--fb-ink-soft)]">{t(card.text)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQ_KEYS: Array<readonly [string, string]> = [
  ["landing.faq1q", "landing.faq1a"],
  ["landing.faq2q", "landing.faq2a"],
  ["landing.faq3q", "landing.faq3a"],
  ["landing.faq4q", "landing.faq4a"],
  ["landing.faq5q", "landing.faq5a"],
  ["landing.faq6q", "landing.faq6a"],
];

function Faq() {
  const t = useT();
  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-20 sm:px-6 scroll-mt-20">
      <h2 className="text-center font-display text-4xl font-black tracking-tight">{t("landing.faq")}</h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-[color:var(--fb-ink-soft)]">{t("landing.faqSub")}</p>
      <div className="mt-10 space-y-3">
        {FAQ_KEYS.map(([q, a]) => (
          <details key={q} className="ticket group p-0 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 font-display text-base font-bold">
              {t(q)}
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[color:var(--fb-line)]/50 text-sm transition-transform group-open:rotate-45"
                aria-hidden
              >
                +
              </span>
            </summary>
            <p className="border-t border-dashed border-[color:var(--fb-line)] px-5 py-4 text-sm leading-relaxed text-[color:var(--fb-ink-soft)]">
              {t(a)}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  const t = useT();
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <footer className="border-t border-[color:var(--fb-line)] bg-[color:var(--fb-surface)]">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-forest-700 text-paper dark:bg-forest-400 dark:text-pantry-950">
              <ChefHat size={22} aria-hidden />
            </span>
            <span className="font-display text-2xl font-black tracking-tight">
              Food<span className="text-saffron-600 dark:text-saffron-400">Bridge</span>
            </span>
          </div>
          <p className="mt-3 max-w-sm text-sm text-[color:var(--fb-ink-soft)]">{t("landing.footerTag")}</p>
          <p className="mt-4 max-w-sm text-xs leading-relaxed text-[color:var(--fb-ink-soft)]">
            <ShieldCheck size={13} className="mr-1 inline text-forest-600 dark:text-forest-300" aria-hidden />
            {t("landing.footerNote")}
          </p>
        </div>
        <nav aria-label="Explore">
          <p className="label">{t("landing.footerExplore")}</p>
          <ul className="mt-2 space-y-2 text-sm">
            <li>
              <button className="hover:underline" onClick={() => scrollTo("how-it-works")}>
                {t("landing.footerHow")}
              </button>
            </li>
            <li>
              <button className="hover:underline" onClick={() => scrollTo("faq")}>
                {t("landing.footerFaq")}
              </button>
            </li>
            <li>
              <button className="hover:underline" onClick={() => scrollTo("safety")}>
                {t("landing.footerSafety")}
              </button>
            </li>
            <li>
              <Link to="/app/help" className="hover:underline">
                {t("landing.footerHelp")}
              </Link>
            </li>
          </ul>
        </nav>
        <div>
          <p className="label">{t("landing.footerSupport")}</p>
          <ul className="mt-2 space-y-2 text-sm">
            <li>
              <a
                className="inline-flex items-center gap-1.5 hover:underline"
                href="mailto:vikashvnb2005@gmail.com?subject=FoodBridge%20Support%20Request"
              >
                <Mail size={14} aria-hidden /> {t("landing.footerEmail")}
              </a>
            </li>
            <li>
              <Link to="/app/help" className="inline-flex items-center gap-1.5 hover:underline">
                <ScrollText size={14} aria-hidden /> {t("landing.footerHelp")}
              </Link>
            </li>
            <li>
              <button className="hover:underline" onClick={() => scrollTo("faq")}>
                {t("landing.footerPrivacy")}
              </button>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-[color:var(--fb-line)] py-4 text-center text-xs text-[color:var(--fb-ink-soft)]">
        {t("landing.footerBuilt")}
      </div>
    </footer>
  );
}

export function LandingPage() {
  const config = usePlatformConfig();
  const ticker = useLocalTicker();
  const t = useT();
  const { data: stats } = useQuery({
    queryKey: ["landing", "stats"],
    queryFn: () => api.get<PlatformStats>("/stats/?scope=platform").catch(() => undefined),
  });
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="relative overflow-x-clip">
      {/* nav */}
      <header className="sticky top-0 z-20 border-b border-[color:var(--fb-line)]/60 bg-[color:var(--fb-bg)]/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-forest-700 text-paper shadow-card dark:bg-forest-400 dark:text-pantry-950">
              <ChefHat size={22} aria-hidden />
            </span>
            <span className="shrink-0 font-display text-2xl font-black tracking-tight">
              Food<span className="text-saffron-600 dark:text-saffron-400">Bridge</span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <LangToggle />
            <ThemeToggle />
            <Link to="/login" className="btn-ghost hidden px-3 text-sm sm:inline-flex">
              {t("landing.signIn")}
            </Link>
            {/* xs screens already have the hero CTAs — the header CTA appears from sm up
                so the brand never gets squeezed into an ellipsis */}
            <Link to="/register" className="btn-primary hidden whitespace-nowrap px-3 text-sm sm:inline-flex sm:px-5">
              {t("landing.getStarted")}
            </Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-2 lg:pt-20">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 flex flex-wrap items-center gap-2"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-forest-300 bg-forest-50 px-3 py-1 text-xs font-bold uppercase tracking-widest text-forest-700 dark:border-forest-800 dark:bg-forest-900/40 dark:text-forest-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute h-full w-full animate-pulse-ring rounded-full bg-forest-500" />
                <span className="relative h-2 w-2 rounded-full bg-forest-500" />
              </span>
              {t("landing.badge")}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-saffron-400 bg-saffron-50 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-saffron-800 -rotate-1 dark:bg-saffron-900/30 dark:text-saffron-200">
              📍 {t("landing.nowLive")} {config.city_name} & nearby
            </span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="font-display text-4xl font-black leading-[1.05] tracking-tight text-balance sm:text-6xl"
          >
            {t("landing.hero1")}{" "}
            <span className="whitespace-normal sm:whitespace-nowrap">
              <span className="relative inline-block text-forest-700 dark:text-forest-300">
                {t("landing.heroAccent")}
                <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 200 12" fill="none" aria-hidden>
                  <path d="M3 9C50 3 150 3 197 8" stroke="#D98E14" strokeWidth="5" strokeLinecap="round" />
                </svg>
              </span>
              .
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="mt-6 max-w-lg text-lg text-[color:var(--fb-ink-soft)]"
          >
            {t("landing.sub")}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            className="mt-8 flex flex-wrap gap-3"
          >
            <Link to="/register?role=donor" className="btn-primary h-12 px-6 text-base">
              {t("landing.donateFood")} <ArrowRight size={18} aria-hidden />
            </Link>
            <Link to="/register?role=volunteer" className="btn-saffron h-12 px-6 text-base">
              {t("landing.rescueFood")} <HeartHandshake size={18} aria-hidden />
            </Link>
            <button
              className="btn-outline h-12 px-6 text-base"
              onClick={() => scrollTo("how-it-works")}
              aria-label="Scroll to How it works"
            >
              {t("landing.howBtn")}
            </button>
          </motion.div>

          {/* Real platform statistics from the API — never invented.
              While the API is cold we show a dash, not a placeholder number. */}
          <dl className="mt-10 grid grid-cols-3 gap-4">
            {[
              { label: "meals rescued", value: stats ? Math.round(stats.rescued.meals_equivalent) : undefined },
              { label: "active donors", value: stats?.users.donors },
              { label: "volunteers", value: stats?.users.volunteers },
            ].map((stat) => (
              <div key={stat.label} className="ticket p-3 text-center">
                <dt className="order-2 text-[11px] font-bold uppercase tracking-wider text-[color:var(--fb-ink-soft)]">
                  {stat.label}
                </dt>
                <dd className="font-display text-3xl font-black text-forest-700 dark:text-forest-300">
                  {stat.value === undefined ? (
                    <span className="text-[color:var(--fb-ink-soft)]">—</span>
                  ) : (
                    <CountUp target={stat.value} />
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* The hero plate: a big ticking dial */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 120 }}
          className="relative mx-auto hidden aspect-square w-full max-w-md lg:block"
          aria-hidden
        >
          <div className="absolute inset-0 rounded-full border-4 border-dashed border-saffron-400/70 animate-[spin_40s_linear_infinite]" />
          <div className="absolute inset-8 rounded-full bg-forest-700 shadow-lift dark:bg-forest-800" />
          <div className="absolute inset-12 rounded-full border-8 border-paper/10" />
          <div className="absolute inset-0 grid place-items-center text-center">
            <div className="text-paper dark:text-paper">
              <p className="font-display text-7xl font-black tabular-nums">1:59</p>
              <p className="mt-1 text-xs font-bold uppercase tracking-[0.3em] text-paper/70">until fresh batch spoils</p>
            </div>
          </div>
          {["🍲", "🥕", "🥐", "🥡"].map((emoji, index) => (
            <span
              key={emoji}
              className="absolute grid h-14 w-14 place-items-center rounded-full bg-paper-warm text-2xl shadow-lift ring-2 ring-pantry-950/15"
              style={{
                top: `${50 + 46 * Math.sin((index * Math.PI) / 2)}%`,
                left: `${50 + 46 * Math.cos((index * Math.PI) / 2)}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              {emoji}
            </span>
          ))}
        </motion.div>
      </section>

      {/* live ticker */}
      <div className="border-y border-[color:var(--fb-line)] bg-[color:var(--fb-surface)] py-2.5">
        <div className="flex overflow-hidden" aria-hidden>
          <div className="flex min-w-full shrink-0 animate-marquee items-center gap-10 pr-10">
            {[...ticker, ...ticker].map((item, index) => (
              <span key={index} className="whitespace-nowrap text-sm font-semibold text-[color:var(--fb-ink-soft)]">
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>

      <HowItWorks />
      <Benefits />
      <ProcessDetail />
      <Safety />
      <Faq />

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-forest-800 px-8 py-14 text-center shadow-lift dark:bg-forest-900">
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 30%, rgba(227,167,51,.5), transparent 40%), radial-gradient(circle at 80% 70%, rgba(227,167,51,.4), transparent 40%)",
            }}
            aria-hidden
          />
          <h2 className="relative font-display text-4xl font-black text-paper text-balance">{t("landing.ctaTitle")}</h2>
          <p className="relative mx-auto mt-4 max-w-lg text-paper/80">{t("landing.ctaSub")}</p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/register?role=donor" className="btn-saffron h-12 px-6 text-base">
              {t("landing.donateFood")}
            </Link>
            <Link
              to="/register?role=volunteer"
              className="btn h-12 border-2 border-paper/70 px-6 text-base font-bold text-paper hover:bg-paper/10"
            >
              {t("landing.rescueFood")}
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
