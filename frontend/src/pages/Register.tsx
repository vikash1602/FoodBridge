/** Register page — Phase 2: an informative role-selection step that explains
 *  what each role can do BEFORE registration, then the account form.
 *  The single-role account model is unchanged: exactly one role is sent to
 *  POST /auth/register/ and no duplicate accounts are created. */

import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { ArrowLeft, ChefHat, Check, HeartHandshake, UtensilsCrossed } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { z } from "zod";

import { register as registerUser } from "@/api/auth";
import { HttpError } from "@/api/client";
import { clsx } from "clsx";

const schema = z
  .object({
    full_name: z.string().min(2, "Tell us your name"),
    email: z.string().email("Enter a valid email"),
    phone: z.string().min(8, "Enter a phone number").max(20),
    password: z.string().min(8, "At least 8 characters"),
    confirm_password: z.string(),
    role: z.enum(["donor", "volunteer"]),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: "Passwords don't match",
    path: ["confirm_password"],
  });
type FormData = z.infer<typeof schema>;

interface RoleInfo {
  value: "donor" | "volunteer";
  title: string;
  description: string;
  canDo: string[];
  icon: typeof UtensilsCrossed;
  tint: string;
}

const ROLES: RoleInfo[] = [
  {
    value: "donor",
    title: "Food Donor",
    description: "I have surplus food and want to make it available to people who need it.",
    canDo: [
      "Post surplus food in about 30 seconds (type, quantity, pickup pin, safety window)",
      "Get pinged volunteers automatically — the alert radius widens until someone claims",
      "Hand over with a 4-digit pickup code that proves every collection",
      "Register your organization for a verified badge once an admin approves it",
    ],
    icon: UtensilsCrossed,
    tint: "bg-saffron-100 text-saffron-700 border-saffron-300",
  },
  {
    value: "volunteer",
    title: "Volunteer / NGO",
    description: "I want to discover nearby surplus food, collect it and deliver it.",
    canDo: [
      "Browse a live feed of surplus food near your base location",
      "Filter by distance, food type, veg-only — allergens are flagged on every ticket",
      "Claim a rescue with one tap and verify the pickup with the donor's code",
      "Deliver to people or NGOs nearby and build your trust score with every rescue",
    ],
    icon: HeartHandshake,
    tint: "bg-forest-100 text-forest-800 border-forest-300",
  },
];

function RoleChoice({ onPick }: { onPick: (role: "donor" | "volunteer") => void }) {
  return (
    <div>
      <fieldset>
        <legend className="font-display text-xl font-bold">Choose your role</legend>
        <p className="mt-1 text-sm text-[color:var(--fb-ink-soft)]">
          One account, one role — pick the side of the counter that's yours. You can't be both on the same account.
        </p>
      </fieldset>
      <div className="mt-5 grid gap-4">
        {ROLES.map((role) => (
          <motion.button
            key={role.value}
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => onPick(role.value)}
            className="ticket group p-5 text-left transition-shadow hover:shadow-lift"
            aria-label={`Register as ${role.title}`}
          >
            <div className="flex items-start gap-4">
              <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl border-2 ${role.tint}`}>
                <role.icon size={22} aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-xl font-bold">Option {role.value === "donor" ? "A" : "B"}: {role.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-[color:var(--fb-ink-soft)]">{role.description}</p>
              </div>
            </div>
            <p className="mt-4 text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--fb-ink-soft)]">
              What this role can do
            </p>
            <ul className="mt-2 space-y-1.5">
              {role.canDo.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <Check size={15} className="mt-0.5 shrink-0 text-forest-600 dark:text-forest-300" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
            <span className="btn-primary mt-4 inline-flex text-sm">Continue as {role.title} →</span>
          </motion.button>
        ))}
      </div>
      <p className="mt-6 text-center text-sm text-[color:var(--fb-ink-soft)]">
        Already bridging?{" "}
        <Link to="/login" className="font-bold text-forest-700 hover:underline dark:text-forest-300">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preset = params.get("role") === "donor" || params.get("role") === "volunteer" ? params.get("role") : null;
  const [role, setRole] = useState<"donor" | "volunteer" | null>(preset as "donor" | "volunteer" | null);
  const { register, handleSubmit, formState, setValue } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      role: (preset as "donor" | "volunteer" | null) ?? "volunteer",
      full_name: "",
      email: "",
      phone: "",
      password: "",
      confirm_password: "",
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      await registerUser(data);
      toast.success("Account created — welcome to FoodBridge! 🌱");
      navigate("/login");
    } catch (error) {
      const message = error instanceof HttpError ? error.message : "Registration failed";
      toast.error(message);
    }
  });

  const activeRole = ROLES.find((candidate) => candidate.value === role);

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="ticket w-full max-w-md p-8">
        <div className={clsx("text-center", role ? "mb-4" : "mb-6")}>
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-forest-700 text-paper dark:bg-forest-400 dark:text-pantry-950">
            <ChefHat size={26} aria-hidden />
          </span>
          <h1 className="font-display text-3xl font-black">Join the bridge</h1>
          {!role && <p className="mt-1 text-sm text-[color:var(--fb-ink-soft)]">Two minutes to your first rescue.</p>}
        </div>

        {!role ? (
          <RoleChoice
            onPick={(picked) => {
              setRole(picked);
              setValue("role", picked);
            }}
          />
        ) : (
          <>
            {/* chosen role summary — always visible so the choice stays informed */}
            {activeRole && (
              <div className="mb-5 flex items-start gap-3 rounded-2xl border-2 border-forest-200 bg-forest-50 p-3.5 dark:border-forest-800 dark:bg-forest-900/40">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border-2 ${activeRole.tint}`}>
                  <activeRole.icon size={18} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold">{activeRole.title}</p>
                  <p className="text-xs leading-snug text-[color:var(--fb-ink-soft)]">{activeRole.description}</p>
                </div>
                <button
                  className="btn-ghost h-9 shrink-0 text-xs"
                  onClick={() => setRole(null)}
                  aria-label="Change role"
                >
                  <ArrowLeft size={14} aria-hidden /> Change
                </button>
              </div>
            )}

            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div>
                <label className="label" htmlFor="full_name">
                  Full name
                </label>
                <input id="full_name" className="input" autoComplete="name" {...register("full_name")} />
                {formState.errors.full_name && (
                  <p className="mt-1 text-xs font-semibold text-tomato-600">{formState.errors.full_name.message}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="email">
                    Email
                  </label>
                  <input id="email" type="email" className="input" autoComplete="email" {...register("email")} />
                  {formState.errors.email && (
                    <p className="mt-1 text-xs font-semibold text-tomato-600">{formState.errors.email.message}</p>
                  )}
                </div>
                <div>
                  <label className="label" htmlFor="phone">
                    Phone
                  </label>
                  <input id="phone" type="tel" className="input" autoComplete="tel" {...register("phone")} />
                  {formState.errors.phone && (
                    <p className="mt-1 text-xs font-semibold text-tomato-600">{formState.errors.phone.message}</p>
                  )}
                </div>
              </div>
              <div>
                <label className="label" htmlFor="password">
                  Password
                </label>
                <input id="password" type="password" className="input" autoComplete="new-password" {...register("password")} />
                {formState.errors.password && (
                  <p className="mt-1 text-xs font-semibold text-tomato-600">{formState.errors.password.message}</p>
                )}
              </div>
              <div>
                <label className="label" htmlFor="confirm_password">
                  Confirm password
                </label>
                <input
                  id="confirm_password"
                  type="password"
                  className="input"
                  autoComplete="new-password"
                  {...register("confirm_password")}
                />
                {formState.errors.confirm_password && (
                  <p className="mt-1 text-xs font-semibold text-tomato-600">
                    {formState.errors.confirm_password.message}
                  </p>
                )}
              </div>
              <p className="text-xs text-[color:var(--fb-ink-soft)]">
                {activeRole?.value === "donor"
                  ? "After signup, a short setup wizard registers your organization for verification — posting unlocks once it's approved."
                  : "After signup, a short setup wizard sets your base location and notification radius."}
              </p>
              <button className="btn-primary h-12 w-full text-base" disabled={formState.isSubmitting}>
                {formState.isSubmitting ? "Creating…" : "Create account"}
              </button>
            </form>
            <p className="mt-6 text-center text-sm text-[color:var(--fb-ink-soft)]">
              Already bridging?{" "}
              <Link to="/login" className="font-bold text-forest-700 hover:underline dark:text-forest-300">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
