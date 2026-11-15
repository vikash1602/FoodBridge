/** Small formatting helpers shared across the UI. */

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

export function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return "expired";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Urgency bucket driving colors: green -> saffron -> tomato. */
export type Urgency = "fresh" | "soon" | "urgent" | "gone";

export function urgencyFromSeconds(secondsLeft: number): Urgency {
  if (secondsLeft <= 0) return "gone";
  if (secondsLeft <= 20 * 60) return "urgent";
  if (secondsLeft <= 60 * 60) return "soon";
  return "fresh";
}

export const urgencyColors: Record<Urgency, { ring: string; text: string; bg: string; hex: string }> = {
  fresh: { ring: "stroke-forest-500", text: "text-forest-600", bg: "bg-forest-100 text-forest-800", hex: "#3B8A60" },
  soon: { ring: "stroke-saffron-400", text: "text-saffron-600", bg: "bg-saffron-100 text-saffron-800", hex: "#E3A733" },
  urgent: { ring: "stroke-tomato-500", text: "text-tomato-600", bg: "bg-tomato-500/15 text-tomato-600", hex: "#E14B2E" },
  gone: { ring: "stroke-stone-400", text: "text-stone-500", bg: "bg-stone-200 text-stone-600", hex: "#78716c" },
};

export const badgeStyles: Record<string, string> = {
  new: "bg-stone-200 text-stone-700 border-stone-300 dark:bg-pantry-700 dark:text-pantry-950/80",
  reliable: "bg-forest-100 text-forest-800 border-forest-300",
  trusted: "bg-saffron-100 text-saffron-800 border-saffron-300",
  champion: "bg-gradient-to-r from-saffron-300 to-tomato-400 text-pantry-950 border-saffron-500",
};

export const badgeEmoji: Record<string, string> = {
  new: "🌱",
  reliable: "🤝",
  trusted: "⭐",
  champion: "🏆",
};

export const foodTypeEmoji: Record<string, string> = {
  cooked: "🍲",
  packaged: "🥡",
  raw: "🥕",
  bakery: "🥐",
  other: "🍱",
};

export const foodTypeLabel: Record<string, string> = {
  cooked: "Cooked meal",
  packaged: "Packaged",
  raw: "Raw ingredients",
  bakery: "Bakery",
  other: "Other",
};

export function fullName(user: { first_name: string; last_name: string; username: string } | undefined | null): string {
  if (!user) return "Someone";
  const name = `${user.first_name} ${user.last_name}`.trim();
  return name || user.username;
}
