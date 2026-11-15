/** Post Listing: 3-step wizard (what → quantity & safety → where & when).
 *  Location: shared Uber-style picker (fixed pin, autocomplete, quick chips). */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, MapPin } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { api } from "@/api/client";
import { useAuth } from "@/api/auth";
import type { Listing, Organization, Paginated } from "@/api/types";
import { LocationPicker } from "@/components/LocationPicker";
import { DONOR_FLOW } from "@/lib/workflow";
import { WorkflowCard, WorkflowStrip } from "@/components/WorkflowGuide";
import { EmptyState } from "@/components/ui";
import { cityCenter } from "@/lib/city";
import { foodTypeEmoji, foodTypeLabel } from "@/lib/format";
import { clsx } from "clsx";

const STEPS = ["What", "Quantity & safety", "Where & when"] as const;

/* ------------------------------------------------------------------ */

export function PostListingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // step 0 — what
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [foodType, setFoodType] = useState<Listing["food_type"]>("cooked");
  const [isVeg, setIsVeg] = useState(true);
  const [allergens, setAllergens] = useState("");
  const [organizationId, setOrganizationId] = useState<number | null>(null);

  // step 1 — quantity & safety
  const [quantityValue, setQuantityValue] = useState("");
  const [quantityUnit, setQuantityUnit] = useState<Listing["quantity_unit"]>("meals");

  // step 2 — where & when
  const [pickupAddress, setPickupAddress] = useState("");
  const [pin, setPin] = useState<[number, number]>([cityCenter().lat, cityCenter().lng]);
  const [safeHours, setSafeHours] = useState<number>(4);
  const [customHours, setCustomHours] = useState("");

  const effectiveHours = safeHours === 0 ? Math.max(0.5, Number(customHours) || 0) : safeHours;

  const { data: orgs } = useQuery({
    queryKey: ["organizations"],
    queryFn: () => api.get<Paginated<Organization>>("/organizations/"),
  });
  const approvedOrgs = useMemo(() => (orgs?.results ?? []).filter((org) => org.is_approved), [orgs]);
  const myOrg = (orgs?.results ?? [])[0] ?? null;

  // Phase 6: honest gate. The server rejects posts from unverified donors —
  // surface that state up front instead of letting them fill the form and hit
  // a 403 at the end.
  const verificationGate =
    user?.role === "donor" && orgs !== undefined && approvedOrgs.length === 0
      ? myOrg
        ? myOrg.verification_status // "pending" | "rejected"
        : "none"
      : null;

  const canNext =
    (step === 0 && title.trim().length >= 3) ||
    (step === 1 && Number(quantityValue) > 0) ||
    (step === 2 && pickupAddress.trim().length >= 4 && effectiveHours > 0);

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post<Listing>("/listings/", {
        title: title.trim(),
        description: description.trim(),
        food_type: foodType,
        is_veg: isVeg,
        allergens: allergens.trim(),
        quantity_value: Number(quantityValue),
        quantity_unit: quantityUnit,
        pickup_address: pickupAddress.trim(),
        lat: pin[0],
        lng: pin[1],
        ready_from: new Date().toISOString(),
        safe_until: new Date(Date.now() + effectiveHours * 3600_000).toISOString(),
        organization: organizationId,
      });
      toast.success("Posted! Nearby volunteers are being pinged right now. 🍲📡");
      queryClient.invalidateQueries({ queryKey: ["listings"] });
      navigate("/app/my-listings");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not post listing");
    } finally {
      setSubmitting(false);
    }
  };

  if (verificationGate) {
    return (
      <div className="mx-auto max-w-xl pt-2">
        <h1 className="font-display text-3xl font-black">Post surplus food</h1>
        <div className="mt-5">
          {verificationGate === "pending" ? (
            <EmptyState
              emoji="⏳"
              title="Organization pending verification"
              hint="Your organization is awaiting verification. You can explore the platform, but food posting becomes available after approval."
              next={[
                "Browse the live feed to see how listings reach volunteers.",
                "You'll get a notification the moment an admin reviews your organization.",
                "Rejected applications show the admin's note in Profile — you can resubmit there.",
              ]}
              action={
                <Link to="/app" className="btn-outline">
                  Explore the feed
                </Link>
              }
            />
          ) : verificationGate === "rejected" ? (
            <EmptyState
              emoji="🚫"
              title="Organization not approved"
              hint={`An admin reviewed "${myOrg?.name}" and left a note: ${myOrg?.verification_note || "no reason given"}. Update the details and resubmit.`}
              next={[
                "Fix what the admin's note points out.",
                "Resubmit from Profile or the onboarding checklist.",
                "Posting unlocks as soon as the resubmission is approved.",
              ]}
              action={
                <Link to="/app/onboarding" className="btn-primary">
                  Update & resubmit
                </Link>
              }
            />
          ) : (
            <EmptyState
              emoji="🏢"
              title="Register your organization to post"
              hint="Food is posted in a verified organization's name — it keeps the feed trustworthy. Register once; an admin verifies it, usually quickly."
              next={[
                "The onboarding checklist registers your organization in 3 short steps.",
                "While you wait for verification you can explore everything else.",
                "Your exact address stays private — only claiming volunteers see it.",
              ]}
              action={
                <Link to="/app/onboarding" className="btn-primary">
                  Register my organization
                </Link>
              }
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl pt-2">
      <h1 className="font-display text-3xl font-black" data-tour="post-food">
        Post surplus food
      </h1>
      <p className="mb-6 mt-1 text-sm text-[color:var(--fb-ink-soft)]">Three quick steps — under 30 seconds, we timed it.</p>

      {/* Phase 5: where this listing is heading */}
      <WorkflowCard title="After you post">
        <WorkflowStrip flow={DONOR_FLOW} current={0} />
      </WorkflowCard>

      {/* stepper */}
      <ol className="mb-6 flex items-center gap-2" aria-label="Wizard steps" data-tour="post-steps">
        {STEPS.map((label, index) => (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
            <span
              className={clsx(
                "grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-xs font-black",
                index < step && "border-forest-600 bg-forest-600 text-white",
                index === step && "border-saffron-500 bg-saffron-100 text-saffron-700",
                index > step && "border-[color:var(--fb-line)] text-[color:var(--fb-ink-soft)]",
              )}
              aria-current={index === step ? "step" : undefined}
            >
              {index < step ? "✓" : index + 1}
            </span>
            <span className={clsx("truncate text-xs font-bold uppercase tracking-wide", index > step && "text-[color:var(--fb-ink-soft)]")}>
              {label}
            </span>
            {index < STEPS.length - 1 && <span className="h-0.5 flex-1 bg-[color:var(--fb-line)]" aria-hidden />}
          </li>
        ))}
      </ol>

      <div className="ticket min-h-80 p-6">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div key="s0" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="space-y-4">
              <div>
                <label className="label" htmlFor="title">
                  What is it?
                </label>
                <input
                  id="title"
                  className="input text-lg font-semibold"
                  placeholder="e.g. Fresh veg meals x40"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={140}
                />
              </div>
              <div>
                <span className="label">Food type</span>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(foodTypeLabel) as Array<keyof typeof foodTypeLabel>).map((type) => (
                    <button
                      key={type}
                      onClick={() => setFoodType(type as Listing["food_type"])}
                      aria-pressed={foodType === type}
                      className={clsx(
                        "chip !px-3 !py-1.5 !text-xs",
                        foodType === type ? "bg-forest-700 text-paper" : "bg-[color:var(--fb-line)]/50",
                      )}
                    >
                      {foodTypeEmoji[type]} {foodTypeLabel[type]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                {[true, false].map((value) => (
                  <button
                    key={String(value)}
                    onClick={() => setIsVeg(value)}
                    aria-pressed={isVeg === value}
                    className={clsx(
                      "flex flex-1 items-center justify-center gap-2 rounded-xl border-2 py-2.5 text-sm font-bold",
                      isVeg === value ? "border-forest-600 bg-forest-50 dark:bg-forest-900/40" : "border-[color:var(--fb-line)]",
                    )}
                  >
                    {value ? "🌿 Veg" : "🍗 Non-veg"}
                  </button>
                ))}
              </div>
              <div>
                <label className="label" htmlFor="allergens">
                  Allergens (optional)
                </label>
                <input id="allergens" className="input" placeholder="nuts, dairy, gluten…" value={allergens} onChange={(event) => setAllergens(event.target.value)} />
              </div>
              {approvedOrgs.length > 0 && (
                <div>
                  <label className="label" htmlFor="org">
                    Post as (organization)
                  </label>
                  <select
                    id="org"
                    className="input"
                    value={organizationId ?? ""}
                    onChange={(event) => setOrganizationId(event.target.value ? Number(event.target.value) : null)}
                  >
                    <option value="">Individual</option>
                    {approvedOrgs.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="label" htmlFor="description">
                  Notes (optional)
                </label>
                <textarea id="description" className="input min-h-20" placeholder="Still warm, packed in steel containers…" value={description} onChange={(event) => setDescription(event.target.value)} />
              </div>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div key="s1" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="space-y-5">
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <div>
                  <label className="label" htmlFor="quantity">
                    How much?
                  </label>
                  <input
                    id="quantity"
                    type="number"
                    min="0.1"
                    step="0.1"
                    className="input text-lg font-bold"
                    placeholder="30"
                    value={quantityValue}
                    onChange={(event) => setQuantityValue(event.target.value)}
                  />
                </div>
                <div>
                  <span className="label">Unit</span>
                  <div className="flex gap-1.5">
                    {(["meals", "kg", "boxes"] as const).map((unit) => (
                      <button
                        key={unit}
                        onClick={() => setQuantityUnit(unit)}
                        aria-pressed={quantityUnit === unit}
                        className={clsx("chip !px-3 !py-2", quantityUnit === unit ? "bg-saffron-500 text-pantry-950" : "bg-[color:var(--fb-line)]/50")}
                      >
                        {unit}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <p className="rounded-xl bg-saffron-50 px-3 py-2 text-xs font-semibold text-saffron-800 dark:bg-saffron-900/30 dark:text-saffron-200">
                You'll set the safety window in the next step — volunteers plan their trip around it.
              </p>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="s2" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="space-y-4">
              <div>
                <label className="label" htmlFor="address">
                  Pickup address
                </label>
                <input
                  id="address"
                  className="input"
                  placeholder="Dropping the pin fills this in — edit freely"
                  value={pickupAddress}
                  onChange={(event) => setPickupAddress(event.target.value)}
                />
              </div>
              <div>
                <span className="label">
                  <MapPin size={12} className="mr-1 inline" aria-hidden /> Drag the map so the pin sits on the pickup spot
                </span>
                <LocationPicker
                  value={pin}
                  onChange={setPin}
                  address={pickupAddress}
                  onAddress={setPickupAddress}
                  showRecentPlaces
                  showOrganizationAddress
                />
              </div>
              <div>
                <span className="label">
                  <Clock3 size={12} className="mr-1 inline" aria-hidden /> How long is it safe?
                </span>
                <div className="grid grid-cols-4 gap-2">
                  {[2, 4, 6, 0].map((hours) => (
                    <button
                      key={hours}
                      onClick={() => setSafeHours(hours)}
                      aria-pressed={safeHours === hours}
                      className={clsx(
                        "rounded-xl border-2 py-3 text-center transition-all",
                        safeHours === hours
                          ? "border-forest-600 bg-forest-700 text-paper shadow-card"
                          : "border-[color:var(--fb-line)] hover:border-forest-300",
                      )}
                    >
                      <span className="block font-display text-2xl font-black">{hours === 0 ? "✏️" : `${hours}h`}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                        {hours === 0 ? "custom" : hours === 2 ? "eat soon" : hours === 4 ? "same shift" : "keep cool"}
                      </span>
                    </button>
                  ))}
                </div>
                {safeHours === 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      id="custom-hours"
                      type="number"
                      min="0.5"
                      max="24"
                      step="0.5"
                      className="input w-28"
                      placeholder="6.5"
                      value={customHours}
                      onChange={(event) => setCustomHours(event.target.value)}
                      aria-label="Custom safe hours"
                    />
                    <span className="text-sm font-semibold text-[color:var(--fb-ink-soft)]">hours from now</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-5 flex justify-between gap-2">
        <button className="btn-outline min-w-0" onClick={() => (step === 0 ? navigate("/app") : setStep(step - 1))} disabled={submitting}>
          <ArrowLeft size={16} aria-hidden /> <span className="hidden sm:inline">{step === 0 ? "Cancel" : "Back"}</span>
          <span className="sm:hidden">{step === 0 ? "Cancel" : "Back"}</span>
        </button>
        {step < 2 ? (
          <button className="btn-primary" onClick={() => setStep(step + 1)} disabled={!canNext}>
            Next <ArrowRight size={16} aria-hidden />
          </button>
        ) : (
          <button className="btn-saffron h-12 px-6 text-base font-extrabold" onClick={submit} disabled={!canNext || submitting}>
            <span
              aria-hidden
              className="mr-1 inline-grid h-7 w-7 place-items-center rounded-lg bg-pantry-950 text-sm shadow-inner"
            >
              🍲
            </span>
            {submitting ? "Posting…" : "Post it"}
          </button>
        )}
      </div>

      {step === 0 && approvedOrgs.length === 0 && (
        <div className="mt-6">
          <EmptyState
            emoji="🏢"
            title="Want a verified badge on your posts?"
            hint="Register your restaurant/hostel under Organizations — admins verify it and your listings show the official name."
          />
        </div>
      )}
      <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-[color:var(--fb-ink-soft)]">
        <CheckCircle2 size={13} className="text-forest-600" aria-hidden /> Your exact address is only shown to volunteers who claim.
      </div>
    </div>
  );
}
