/** Light/dark toggle — "day market" vs "midnight pantry". */

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("fb.theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("fb.theme", dark ? "dark" : "light");
  }, [dark]);

  return [dark, () => setDark((value) => !value)];
}

export function ThemeToggle() {
  const [dark, toggle] = useTheme();
  return (
    <button
      className="btn-ghost h-10 w-10 !rounded-full"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Day market" : "Midnight pantry"}
    >
      {dark ? <Sun size={18} className="text-saffron-400" /> : <Moon size={18} className="text-forest-700" />}
    </button>
  );
}
