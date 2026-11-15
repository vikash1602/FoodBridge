/** EN / தமிழ் switch for the main labels. */

import { useLang } from "@/lib/city";
import { clsx } from "clsx";

export function LangToggle() {
  const [lang, set] = useLang();
  return (
    <div
      className="flex items-center rounded-full border border-[color:var(--fb-line)] bg-[color:var(--fb-surface)] p-0.5 text-[11px] font-extrabold"
      role="group"
      aria-label="Language / மொழி"
    >
      {(["en", "ta"] as const).map((option) => (
        <button
          key={option}
          onClick={() => set(option)}
          aria-pressed={lang === option}
          className={clsx(
            "rounded-full px-2 py-0.5 transition-colors",
            option === "ta" && "leading-none",
            lang === option ? "bg-forest-700 text-paper" : "text-[color:var(--fb-ink-soft)]",
          )}
        >
          {option === "en" ? "EN" : "தமிழ்"}
        </button>
      ))}
    </div>
  );
}
