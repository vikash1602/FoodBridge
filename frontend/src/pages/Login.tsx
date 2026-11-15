/** Login: password or instant email-OTP (6-box auto-submit, resend countdown). */

import { zodResolver } from "@hookform/resolvers/zod";
import { ChefHat, KeyRound, Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { z } from "zod";

import { login } from "@/api/auth";
import { api, HttpError, qs, tokens } from "@/api/client";
import type { User } from "@/api/types";
import { clsx } from "clsx";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
type FormData = z.infer<typeof schema>;

type Mode = "password" | "otp";

function OtpBoxes({ email, initialCooldown, onBack }: { email: string; initialCooldown: number; onBack: () => void }) {
  const navigate = useNavigate();
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [cooldown, setCooldown] = useState(initialCooldown);
  const [verifying, setVerifying] = useState(false);
  const [delivery, setDelivery] = useState<"sending" | "processing" | "accepted" | "console" | "failed" | "unknown">("sending");
  const boxesRef = useRef<Array<HTMLInputElement | null>>([]);
  const submittedRef = useRef(false);

  useEffect(() => {
    boxesRef.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Honest delivery feedback: poll the outbox status for up to ~30 s so the
  // user sees the real provider outcome (accepted / failed / still pending).
  // Message wording distinguishes provider acceptance from actual delivery:
  // the outbox confirms provider acceptance; recipient-server delivery is
  // only reported when the provider states it.
  useEffect(() => {
    let cancelled = false;
    const poll = async (attempt: number): Promise<void> => {
      if (cancelled || attempt > 10) {
        if (!cancelled) setDelivery((current) => (current === "sending" ? "processing" : current));
        return;
      }
      try {
        const response = await api.get<{
          delivery: { status: string; provider: string; failure_category: string; http_status: number | null };
        }>(
          `/auth/otp/status/${qs({ email })}`,
          { auth: false },
        );
        if (cancelled) return;
        const deliveryInfo = response.delivery;
        const status = deliveryInfo?.status;
        if (status === "accepted") {
          // Console fallback never reaches here as a "real" send: it is
          // reported separately so dev cannot fake provider delivery.
          setDelivery(deliveryInfo?.provider === "console" ? "console" : "accepted");
          return;
        }
        if (status === "failed") {
          setDelivery("failed");
          return;
        }
        if (status === "sending") {
          setDelivery("processing");
          return;
        }
        // status === "pending": queued — keep waiting through the next poll.
      } catch {
        /* status checks are best-effort */
      }
      setTimeout(() => void poll(attempt + 1), 2000);
    };
    void poll(1);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async (code: string) => {
    if (verifying) return;
    setVerifying(true);
    try {
      // auth:false — a stale token must never 401 a public endpoint.
      const data = await api.post<{ user: User; access: string; refresh: string }>(
        "/auth/otp/verify/",
        { email, code },
        { auth: false },
      );
      tokens.set(data.access, data.refresh);
      toast.success(`Welcome back, ${data.user.first_name || data.user.email}!`);
      navigate(data.user.role === "admin" ? "/app/admin" : "/app");
    } catch (error) {
      const message = error instanceof HttpError ? error.body?.message ?? "Verification failed" : "Verification failed";
      toast.error(message);
      setDigits(["", "", "", "", "", ""]);
      submittedRef.current = false;
      boxesRef.current[0]?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const setDigit = (index: number, value: string) => {
    const clean = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = clean;
    setDigits(next);
    if (clean && index < 5) boxesRef.current[index + 1]?.focus();
    if (next.every((digit) => digit !== "") && !submittedRef.current) {
      submittedRef.current = true;
      void verify(next.join(""));
    }
  };

  const resend = async () => {
    try {
      const response = await api.post<{ cooldown: number }>("/auth/otp/request/", { email });
      setCooldown(response.cooldown);
      toast.success("Code sent", { icon: "✉️" });
    } catch (error) {
      const httpError = error as HttpError;
      toast.error(httpError.body?.message ?? "Could not resend");
      const retryAfter = httpError.body?.details?.retry_after;
      if (typeof retryAfter === "number") setCooldown(retryAfter);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-center text-sm text-[color:var(--fb-ink-soft)]">
        6-digit code sent to <strong>{email}</strong>
      </p>
      <div className="flex justify-center gap-1.5" role="group" aria-label="6-digit code">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => {
              boxesRef.current[index] = el;
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={`Digit ${index + 1}`}
            className={clsx(
              "h-13 w-11 rounded-xl border-2 bg-[color:var(--fb-surface)] text-center font-display text-2xl font-black focus:outline-none",
              digit ? "border-forest-500" : "border-[color:var(--fb-line)]",
              "focus:border-forest-600 focus:ring-2 focus:ring-forest-500/40",
              verifying && "opacity-60",
            )}
            value={digit}
            onChange={(event) => setDigit(index, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !digits[index] && index > 0) {
                boxesRef.current[index - 1]?.focus();
              }
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
              if (pasted.length === 6) {
                event.preventDefault();
                setDigits(pasted.split(""));
                submittedRef.current = true;
                void verify(pasted);
              }
            }}
            disabled={verifying}
          />
        ))}
      </div>
      {verifying && <p className="text-center text-xs font-bold text-forest-600">Checking…</p>}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-ghost text-xs" onClick={onBack} disabled={verifying} type="button">
          Different email
        </button>
        <button
          className="btn-outline text-xs"
          onClick={resend}
          disabled={cooldown > 0 || verifying}
          type="button"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </button>
      </div>
      <p
        role="status"
        className={clsx(
          "text-center text-[11px] font-semibold",
          delivery === "failed" ? "text-tomato-600" : "text-[color:var(--fb-ink-soft)]",
        )}
      >
        {delivery === "sending" && "Preparing your verification email..."}
        {delivery === "processing" && "Your verification email is still being processed."}
        {delivery === "accepted" && "Your email provider accepted the message. Check your inbox and spam folder."}
        {delivery === "console" && "Development mode: the code was printed to the server console (no email sent)."}
        {delivery === "failed" && "We couldn't send your verification email. Please try again."}
        {delivery === "unknown" && "Your verification email is still being processed."}
      </p>
    </div>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("password");
  const [otpEmail, setOtpEmail] = useState<string | null>(null);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpLoading, setOtpLoading] = useState(false);
  const { register, handleSubmit, getValues, formState } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      const { user } = await login(data.email, data.password);
      toast.success(`Welcome back, ${user.first_name || user.email}!`);
      navigate(user.role === "admin" ? "/app/admin" : "/app");
    } catch (error) {
      const message = error instanceof HttpError ? error.message : "Login failed";
      toast.error(message);
    }
  });

  const requestOtp = async () => {
    const email = getValues("email").trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      toast.error("Enter your email first");
      return;
    }
    setOtpLoading(true);
    try {
      // auth:false — a stale token in localStorage must never 401 this public call.
      const response = await api.post<{ cooldown: number; dev_code: string | null; send_failed: boolean }>(
        "/auth/otp/request/",
        { email },
        { auth: false },
      );
      setOtpEmail(email);
      setOtpCooldown(response.cooldown);
      setMode("otp");
      // Instant "Code sent" state — delivery happens in the background.
      toast.success("Code sent", { icon: "✉️" });
      if (response.dev_code) {
        toast(`Dev code: ${response.dev_code}`, { icon: "🛠️", duration: 8000 });
      }
      if (response.send_failed) {
        toast.error("Email delivery hiccuped — use Resend in a moment", { duration: 6000 });
      }
    } catch (error) {
      const httpError = error as HttpError;
      toast.error(httpError.body?.message ?? "Could not send code");
      const retryAfter = httpError.body?.details?.retry_after;
      if (typeof retryAfter === "number") {
        setOtpEmail(email);
        setOtpCooldown(retryAfter);
        setMode("otp");
      }
    } finally {
      setOtpLoading(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="ticket w-full max-w-md p-8">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-forest-700 text-paper dark:bg-forest-400 dark:text-pantry-950">
            <ChefHat size={26} aria-hidden />
          </span>
          <h1 className="font-display text-3xl font-black">Welcome back</h1>
          <p className="mt-1 text-sm text-[color:var(--fb-ink-soft)]">The kitchen missed you.</p>
        </div>

        {mode === "otp" && otpEmail ? (
          <OtpBoxes email={otpEmail} initialCooldown={otpCooldown} onBack={() => setMode("password")} />
        ) : (
          <>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div>
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  className="input"
                  placeholder="you@example.com"
                  {...register("email")}
                />
                {formState.errors.email && (
                  <p className="mt-1 text-xs font-semibold text-tomato-600">{formState.errors.email.message}</p>
                )}
              </div>
              <div>
                <label className="label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className="input"
                  placeholder="••••••••"
                  {...register("password")}
                />
                {formState.errors.password && (
                  <p className="mt-1 text-xs font-semibold text-tomato-600">{formState.errors.password.message}</p>
                )}
              </div>
              <button className="btn-primary h-12 w-full text-base" disabled={formState.isSubmitting}>
                {formState.isSubmitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
            <div className="my-4 flex items-center gap-3 text-xs font-bold uppercase tracking-widest text-[color:var(--fb-ink-soft)]">
              <span className="h-px flex-1 bg-[color:var(--fb-line)]" /> or <span className="h-px flex-1 bg-[color:var(--fb-line)]" />
            </div>
            <button
              className="btn-saffron h-12 w-full text-base"
              onClick={requestOtp}
              disabled={otpLoading}
              type="button"
            >
              <Mail size={18} aria-hidden />
              {otpLoading ? "Sending…" : "Email me a one-time code"}
            </button>
            <p className="mt-3 flex items-center justify-center gap-1 text-center text-[11px] text-[color:var(--fb-ink-soft)]">
              <KeyRound size={12} aria-hidden /> No password needed — the code expires in 5 minutes.
            </p>
          </>
        )}

        <p className="mt-6 text-center text-sm text-[color:var(--fb-ink-soft)]">
          New here?{" "}
          <Link to="/register" className="font-bold text-forest-700 hover:underline dark:text-forest-300">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
