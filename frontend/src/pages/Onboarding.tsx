/** Phase 3 — role-specific guided onboarding.
 *
 *  DONOR: personal info → organization info → org address & location →
 *         review + submit for verification → status (pending explainer /
 *         approved → first listing CTA).
 *  VOLUNTEER: personal info → base location → notification radius → how
 *         nearby discovery works → intro to the rescue feed & map.
 *
 *  Layout: a step rail + one card per step. Completed steps can be revisited.
 *  Personal info is auto-confirmed when the account already has name+phone
 *  (registration collects them), so returning users land on the first
 *  unfinished step. Volunteers can always take the quick path: the location
 *  picker's own "Save & start" confirm finishes onboarding immediately.
 *
 *  API contracts unchanged: PATCH /auth/me/ (first_name, last_name, phone,
 *  base_lat, base_lng, notify_radius_km) and POST /organizations/.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Compass, MapPin, Megaphone, ShieldQuestion, UserRound, UtensilsCrossed } from "lucide-react";

import { api } from "@/api/client";
import { useAuth } from "@/api/auth";
import type { Organization, Paginated } from "@/api/types";
import { cityZoom, haversineFromCenter, usePlatformConfig } from "@/lib/city";
import { LocationPicker } from "@/components/LocationPicker";
import { Spinner } from "@/components/ui";
import { clsx } from "clsx";

type Role = "donor" | "volunteer";

interface StepDef {
  key: string;
  label: string;
  icon: typeof UserRound;
}

const DONOR_STEPS: StepDef[] = [
  { key: "personal", label: "Personal info", icon: UserRound },
  { key: "org", label: "Organization", icon: UtensilsCrossed },
  { key: "address", label: "Address & pin", icon: MapPin },
  { key: "review", label: "Review & submit", icon: Check },
  { key: "status", label: "Verification", icon: ShieldQuestion },
];

const VOLUNTEER_STEPS: StepDef[] = [
  { key: "personal", label: "Personal info", icon: UserRound },
  { key: "location", label: "Base location", icon: MapPin },
  { key: "radius", label: "Alert radius", icon: Compass },
  { key: "discovery", label: "How discovery works", icon: Megaphone },
  { key: "feed", label: "Feed & map", icon: UtensilsCrossed },
];

/* ------------------------------- step rail ------------------------------- */

function StepRail({
  steps,
  current,
  doneKeys,
  onJump,
}: {
  steps: StepDef[];
  current: number;
  doneKeys: Set<string>;
  onJump: (index: number) => void;
}) {
  return (
    <ol className="flex gap-1.5 overflow-x-auto lg:flex-col lg:gap-1 lg:overflow-visible" aria-label="Onboarding steps">
      {steps.map((step, index) => {
        const done = doneKeys.has(step.key);
        const isCurrent = index === current;
        const clickable = done || index < current;
        return (
          <li key={step.key} className="shrink-0">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onJump(index)}
              aria-current={isCurrent ? "step" : undefined}
              className={clsx(
                "flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-colors",
                isCurrent
                  ? "bg-forest-700 text-paper shadow-card dark:bg-forest-400 dark:text-pantry-950"
                  : done
                    ? "text-forest-700 hover:bg-forest-50 dark:text-forest-300 dark:hover:bg-forest-900/40"
                    : "text-[color:var(--fb-ink-soft)]",
                clickable && !isCurrent && "cursor-pointer",
              )}
            >
              <span
                className={clsx(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black",
                  done ? "bg-forest-600 text-white" : isCurrent ? "bg-saffron-400 text-pantry-950" : "bg-[color:var(--fb-line)] text-pantry-950/60",
                )}
                aria-hidden
              >
                {done ? "✓" : index + 1}
              </span>
              <span className="whitespace-nowrap">{step.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="ticket p-6" data-tour="onboarding-step">
      <h1 className="font-display text-2xl font-black">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-[color:var(--fb-ink-soft)]">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </div>
  );
}

/* -------------------------------- page -------------------------------- */

export function OnboardingPage() {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const config = usePlatformConfig();

  const role: Role | null = user?.role === "donor" ? "donor" : user?.role === "volunteer" ? "volunteer" : null;
  const steps = role === "donor" ? DONOR_STEPS : VOLUNTEER_STEPS;

  // personal info form state
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");

  // organization form state (donor)
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState<Organization["type"]>("restaurant");
  const [orgAddress, setOrgAddress] = useState("");

  // shared location state
  const [position, setPosition] = useState<[number, number]>([
    user?.base_lat ?? config.center.lat,
    user?.base_lng ?? config.center.lng,
  ]);
  const [volAddress, setVolAddress] = useState("");
  const [radius, setRadius] = useState<number>(user?.notify_radius_km ?? 5);
  const [busy, setBusy] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState<Organization | null>(null);

  // Donors may already have an organization (returning visit) — its status
  // decides the landing step and what the verification step shows.
  const { data: orgs } = useQuery({
    queryKey: ["organizations"],
    queryFn: () => api.get<Paginated<Organization>>("/organizations/"),
    enabled: user?.role === "donor",
  });
  const existingOrg = orgs?.results?.[0] ?? null;
  const jumpedRef = useRef(false);
  const [current, setCurrent] = useState<number | null>(null);

  // personal info is "done" when the account already has a name and phone
  // (registration collects both) — returning users skip straight to setup.
  const personalComplete = Boolean(
    user && (user.first_name || "").trim().length >= 2 && (user.phone ?? "").trim().length >= 8,
  );

  // Land on the first unfinished step once the user is known.
  useEffect(() => {
    if (!user || jumpedRef.current) return;
    jumpedRef.current = true;
    if (!personalComplete) setCurrent(0);
    else setCurrent(1);
  }, [user, personalComplete]);

  // Returning donor with an organization already on file → status step.
  useEffect(() => {
    if (!jumpedRef.current || !existingOrg) return;
    setCurrent(DONOR_STEPS.length - 1);
  }, [existingOrg]);

  const distanceKm = haversineFromCenter(position[0], position[1]);
  const outsideArea = distanceKm > config.service_area_km;

  const savePersonal = async (): Promise<boolean> => {
    if (firstName.trim().length < 2) {
      toast.error("Tell us your name (at least 2 characters)");
      return false;
    }
    if (phone.trim().length < 8) {
      toast.error("Enter a phone number volunteers/donors can reach you on");
      return false;
    }
    setBusy(true);
    try {
      await api.patch("/auth/me/", {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
      });
      return true;
    } catch (error) {
      toast.error((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Save base location (+ notification permission) — the quick "Save & start". */
  const finishLocation = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.patch("/auth/me/", { base_lat: position[0], base_lng: position[1] });
      if ("Notification" in window && Notification.permission === "default") {
        try {
          await Notification.requestPermission();
        } catch {
          /* ignore */
        }
      }
      toast.success("You're all set! 🎉");
      navigate("/app");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveRadius = async (): Promise<boolean> => {
    setBusy(true);
    try {
      await api.patch("/auth/me/", { notify_radius_km: radius, base_lat: position[0], base_lng: position[1] });
      return true;
    } catch (error) {
      toast.error((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitOrganization = async (): Promise<void> => {
    if (orgName.trim().length < 2 || orgAddress.trim().length < 4) {
      toast.error("Give the organization a name and an address");
      return;
    }
    setBusy(true);
    try {
      const org = await api.post<Organization>("/organizations/", {
        name: orgName.trim(),
        type: orgType,
        address: orgAddress.trim(),
        lat: position[0],
        lng: position[1],
      });
      setJustSubmitted(org);
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("Submitted for verification — an admin will review it soon. 🕵️");
      setCurrent(steps.length - 1);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || !user || !role) {
    return (
      <div className="grid place-items-center py-20">
        <Spinner className="h-8 w-8 text-forest-600" />
      </div>
    );
  }

  const doneKeys = new Set<string>();
  if (personalComplete) doneKeys.add("personal");
  if (role === "volunteer" && user.base_lat != null && user.base_lng != null) doneKeys.add("location");
  if (role === "donor" && (justSubmitted ?? existingOrg)) {
    doneKeys.add("org");
    doneKeys.add("address");
    doneKeys.add("review");
  }
  if (current !== null) {
    // mark everything before the current step as done for the rail
    for (let i = 0; i < current; i += 1) doneKeys.add(steps[i]?.key ?? "");
  }

  const stepIndex = Math.min(current ?? 0, steps.length - 1);
  const step = steps[stepIndex];

  return (
    <div className="mx-auto grid max-w-4xl gap-5 pt-2 lg:grid-cols-[220px_minmax(0,1fr)]">
      {/* rail */}
      <aside className="ticket h-fit p-4">
        <p className="label">{role === "donor" ? "Donor setup" : "Volunteer setup"}</p>
        <StepRail steps={steps} current={stepIndex} doneKeys={doneKeys} onJump={setCurrent} />
        <p className="mt-3 hidden text-[11px] leading-relaxed text-[color:var(--fb-ink-soft)] lg:block">
          Five short steps. You can leave and come back — finished steps stay green.
        </p>
      </aside>

      {/* step card */}
      <div className="min-w-0">
        {step?.key === "personal" && (
          <StepCard
            title="First, your personal details"
            subtitle="Volunteers and donors see your name on listings — the phone is only shared for an active handover."
          >
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="ob-first">
                    First name
                  </label>
                  <input id="ob-first" className="input" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="ob-last">
                    Last name (optional)
                  </label>
                  <input id="ob-last" className="input" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="ob-phone">
                  Phone
                </label>
                <input id="ob-phone" type="tel" className="input" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <p className="mt-1 text-xs text-[color:var(--fb-ink-soft)]">Used only to coordinate an active pickup — never shown publicly.</p>
              </div>
              <button
                className="btn-primary h-12 w-full text-base"
                disabled={busy}
                onClick={async () => {
                  if (await savePersonal()) setCurrent(stepIndex + 1);
                }}
              >
                Save & continue →
              </button>
            </div>
          </StepCard>
        )}

        {role === "donor" && step?.key === "org" && (
          <StepCard
            title="Your organization"
            subtitle="Food is posted in your organization's name once it's verified — this is what volunteers see."
          >
            <div className="space-y-4">
              <div>
                <label className="label" htmlFor="ob-org-name">
                  Organization name
                </label>
                <input id="ob-org-name" className="input" placeholder="Anand Bhavan" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
              </div>
              <div>
                <span className="label">Type</span>
                <div className="flex flex-wrap gap-2">
                  {(["restaurant", "hostel", "caterer", "individual", "ngo"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setOrgType(type)}
                      aria-pressed={orgType === type}
                      className={clsx(
                        "chip !px-3 !py-1.5 !text-xs capitalize",
                        orgType === type ? "bg-forest-700 text-paper" : "bg-[color:var(--fb-line)]/50",
                      )}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="btn-primary h-12 w-full text-base"
                disabled={busy || orgName.trim().length < 2}
                onClick={async () => {
                  await savePersonal(); // best effort — personal already valid
                  setCurrent(stepIndex + 1);
                }}
              >
                Next: address & location →
              </button>
            </div>
          </StepCard>
        )}

        {role === "donor" && step?.key === "address" && (
          <StepCard
            title="Organization address & location"
            subtitle="Drop the pin on your usual pickup spot — volunteers navigate here. The exact address is only shared with the volunteer who claims your food."
          >
            <div className="space-y-4">
              <div>
                <label className="label" htmlFor="ob-org-address">
                  Address
                </label>
                <input
                  id="ob-org-address"
                  className="input"
                  placeholder="12 MG Road, Vaniyambadi"
                  value={orgAddress}
                  onChange={(e) => setOrgAddress(e.target.value)}
                />
              </div>
              <LocationPicker
                value={position}
                onChange={setPosition}
                address={orgAddress}
                onAddress={setOrgAddress}
                confirmLabel={`Use this location (${cityZoom()} zoom)`}
                onConfirm={() => setCurrent(stepIndex + 1)}
              />
              <button className="btn-primary h-12 w-full text-base" onClick={() => setCurrent(stepIndex + 1)}>
                Next: review →
              </button>
            </div>
          </StepCard>
        )}

        {role === "donor" && step?.key === "review" && (
          <StepCard title="Review & submit for verification" subtitle="An admin checks the details before food posting unlocks. This keeps the feed trustworthy.">
            <dl className="space-y-2 text-sm">
              {[
                ["Your name", `${firstName} ${lastName}`.trim()],
                ["Phone", phone],
                ["Organization", `${orgName} (${orgType})`],
                ["Address", orgAddress],
                ["Pin", `${position[0].toFixed(5)}, ${position[1].toFixed(5)}`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-3 rounded-xl bg-[color:var(--fb-line)]/30 px-3 py-2">
                  <dt className="shrink-0 font-bold">{label}</dt>
                  <dd className="text-right text-[color:var(--fb-ink-soft)]">{value || "—"}</dd>
                </div>
              ))}
            </dl>
            <button className="btn-primary mt-5 h-12 w-full text-base" disabled={busy} onClick={submitOrganization}>
              {busy ? "Submitting…" : "Submit for verification 🛡️"}
            </button>
          </StepCard>
        )}

        {role === "donor" && step?.key === "status" && (
          <StepCard title="Verification status">
            {(() => {
              const org = justSubmitted ?? existingOrg;
              const approved = org?.verification_status === "approved";
              const rejected = org?.verification_status === "rejected";
              return (
                <div className="space-y-4">
                  {approved ? (
                    <>
                      <div className="rounded-xl border-2 border-forest-300 bg-forest-50 p-4 text-sm font-semibold text-forest-800 dark:border-forest-700 dark:bg-forest-900/40 dark:text-forest-200">
                        ✅ {org?.name} is verified — food posting is unlocked.
                      </div>
                      <p className="text-sm text-[color:var(--fb-ink-soft)]">
                        Ready for your first rescue? The Post Food wizard walks you through it in about 30 seconds.
                      </p>
                      <button className="btn-primary h-12 w-full text-base" onClick={() => navigate("/app/post")}>
                        🍲 Create your first food listing
                      </button>
                    </>
                  ) : rejected ? (
                    <>
                      <div className="rounded-xl border-2 border-tomato-500/40 bg-tomato-500/5 p-4 text-sm font-semibold text-tomato-600">
                        🚫 Your organization was not approved. Admin note: {org?.verification_note || "—"}
                      </div>
                      <button className="btn-outline w-full" onClick={() => setCurrent(1)}>
                        Update details & resubmit
                      </button>
                    </>
                  ) : (
                    <>
                      <div
                        role="status"
                        className="rounded-xl border-2 border-saffron-300 bg-saffron-50 p-4 text-sm font-semibold text-saffron-800 dark:border-saffron-700 dark:bg-saffron-900/30 dark:text-saffron-200"
                      >
                        ⏳ Your organization is awaiting verification. You can explore the platform, but food posting
                        becomes available after approval.
                      </div>
                      <p className="text-sm text-[color:var(--fb-ink-soft)]">
                        While you wait you can browse the live feed, look at how listings work, and fill in your base
                        location — everything except posting.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button className="btn-outline flex-1" onClick={() => navigate("/app")}>
                          Explore the feed
                        </button>
                        <button
                          className="btn-ghost flex-1 text-sm"
                          onClick={async () => {
                            await api.patch("/auth/me/", { base_lat: position[0], base_lng: position[1] });
                            navigate("/app");
                          }}
                        >
                          Save base location & explore
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </StepCard>
        )}

        {role === "volunteer" && step?.key === "location" && (
          <StepCard
            title="Where do you usually cook / deliver?"
            subtitle="We use this as your home base — feeds, alerts and distances all anchor here."
          >
            <div className="ticket p-5">
              <LocationPicker
                value={position}
                onChange={setPosition}
                address={volAddress}
                onAddress={setVolAddress}
                confirmLabel={`Save & start (zoom ${cityZoom()} default radius)`}
                onConfirm={finishLocation}
              />
            </div>
            {outsideArea && (
              <div
                role="status"
                className="mt-3 rounded-xl border-2 border-dashed border-saffron-400 bg-saffron-50 px-4 py-3 text-sm font-semibold text-saffron-800 dark:bg-saffron-900/20 dark:text-saffron-200"
              >
                🌱 FoodBridge is starting in {config.city_name} — you're {Math.round(distanceKm)} km out. You can still
                explore the app; alerts are tuned for the {config.city_name} region.
              </div>
            )}
            <button
              className="btn-outline mt-4 w-full"
              disabled={busy}
              onClick={async () => {
                if (await saveRadius()) setCurrent(stepIndex + 1);
              }}
            >
              Next: notification radius → (also saves this location)
            </button>
          </StepCard>
        )}

        {role === "volunteer" && step?.key === "radius" && (
          <StepCard title="How far should we look for food?" subtitle="Food within this radius shows in your feed and triggers alerts. You can change it anytime in Profile.">
            <label className="label" htmlFor="ob-radius">
              Notify me about food within <output className="font-black text-forest-700 dark:text-forest-300">{radius} km</output>
            </label>
            <input
              id="ob-radius"
              type="range"
              min={1}
              max={15}
              step={1}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="mt-2 w-full accent-forest-600"
              aria-valuenow={radius}
            />
            <div className="mt-1 flex justify-between text-[10px] font-bold uppercase tracking-wide text-[color:var(--fb-ink-soft)]">
              <span>1 km — walk</span>
              <span>8 km</span>
              <span>15 km — scooter</span>
            </div>
            <button
              className="btn-primary mt-6 h-12 w-full text-base"
              disabled={busy}
              onClick={async () => {
                if (await saveRadius()) setCurrent(stepIndex + 1);
              }}
            >
              Save & continue →
            </button>
          </StepCard>
        )}

        {role === "volunteer" && step?.key === "discovery" && (
          <StepCard title="How nearby food discovery works" subtitle="FoodBridge races the clock — the longer food waits, the harder it looks for a rescuer.">
            <ol className="space-y-3">
              {(config.escalation_tiers ?? []).map((tier, index) => (
                <li key={index} className="flex items-start gap-3 rounded-xl bg-[color:var(--fb-line)]/30 p-3 text-sm">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-forest-700 font-display text-xs font-black text-paper dark:bg-forest-400 dark:text-pantry-950">
                    {index + 1}
                  </span>
                  <p>
                    <strong>
                      {tier.minutes == null ? "Until someone claims" : `After ${tier.minutes} minutes open`}
                    </strong>{" "}
                    — the alert radius widens to <strong>{tier.radius_km} km</strong>. Volunteers inside the circle get a
                    live ping.
                  </p>
                </li>
              ))}
              <li className="flex items-start gap-3 rounded-xl bg-[color:var(--fb-line)]/30 p-3 text-sm">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-saffron-500 font-display text-xs font-black text-pantry-950">
                  ⌛
                </span>
                <p>
                  Every listing carries a <strong>safe-until countdown</strong>. If nobody claims before it hits zero,
                  the food is never promised to anyone — the listing simply expires.
                </p>
              </li>
            </ol>
            <button className="btn-primary mt-5 h-12 w-full text-base" onClick={() => setCurrent(stepIndex + 1)}>
              Got it — show me the feed →
            </button>
          </StepCard>
        )}

        {role === "volunteer" && step?.key === "feed" && (
          <StepCard title="The rescue feed & map" subtitle="Your dashboard is a live market of surplus food — here's how to read it.">
            <ul className="space-y-2.5 text-sm">
              {[
                "🍽️ Tickets show what it is, how much, veg flag, allergens and the donor's trust badge.",
                "⏳ The dial on each ticket counts down to the safe-until time — claim what you can reach in time.",
                "🗺️ The map shows every pickup point; hover a ticket (or tap on mobile) to spotlight it.",
                "⚡ One tap on Claim reserves the food for you; My rescues then walks you through code verification and delivery.",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2 rounded-xl bg-[color:var(--fb-line)]/30 p-3">
                  {line}
                </li>
              ))}
            </ul>
            <button
              className="btn-primary mt-5 h-12 w-full text-base"
              disabled={busy}
              onClick={async () => {
                if (await saveRadius()) navigate("/app");
              }}
            >
              Open the rescue feed 🍽️
            </button>
            <p className="mt-2 text-center text-xs text-[color:var(--fb-ink-soft)]">
              Tip: the first time you open the dashboard, a short guided tour is offered — skippable anytime.
            </p>
          </StepCard>
        )}
      </div>
    </div>
  );
}
