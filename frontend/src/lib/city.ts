/** Deployment city config — fetched from /api/v1/config/, cached for offline. */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useSyncExternalStore } from "react";

export interface PlatformConfig {
  city_name: string;
  center: { lat: number; lng: number };
  zoom: number;
  service_area_km: number;
  escalation_tiers: Array<{ minutes: number | null; radius_km: number }>;
  quick_areas: Array<{ name: string; lat: number; lng: number }>;
  timezone: string;
}

const FALLBACK: PlatformConfig = {
  city_name: (import.meta.env.VITE_CITY_NAME as string | undefined) ?? "Vaniyambadi",
  center: {
    lat: Number(import.meta.env.VITE_CENTER_LAT ?? 12.6819),
    lng: Number(import.meta.env.VITE_CENTER_LNG ?? 78.6200),
  },
  zoom: 13,
  service_area_km: 25,
  escalation_tiers: [
    { minutes: 20, radius_km: 3 },
    { minutes: 40, radius_km: 6 },
    { minutes: null, radius_km: 12 },
  ],
  quick_areas: [
    { name: "Bus Stand", lat: 12.68, lng: 78.623 },
    { name: "Amburpet", lat: 12.718, lng: 78.642 },
    { name: "Ambur", lat: 12.7874, lng: 78.7188 },
  ],
  timezone: "Asia/Kolkata",
};

const CACHE_KEY = "fb.config";

function readCached(): PlatformConfig | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as PlatformConfig) : null;
  } catch {
    return null;
  }
}

export function usePlatformConfig(): PlatformConfig {
  const { data } = useQuery({
    queryKey: ["platform-config"],
    queryFn: async () => {
      const config = await api.get<PlatformConfig>("/config/");
      localStorage.setItem(CACHE_KEY, JSON.stringify(config));
      return config;
    },
    initialData: readCached() ?? FALLBACK,
    staleTime: 10 * 60_000,
  });
  return data ?? FALLBACK;
}

/** Synchronous center for map init (cached value -> fallback). */
export function cityCenter(): { lat: number; lng: number } {
  return readCached()?.center ?? FALLBACK.center;
}

export function cityZoom(): number {
  return readCached()?.zoom ?? FALLBACK.zoom;
}

export function cityName(): string {
  return readCached()?.city_name ?? FALLBACK.city_name;
}

/** Distance in km from the deployment city centre. */
export function haversineFromCenter(lat: number, lng: number): number {
  const center = cityCenter();
  const R = 6371;
  const dLat = ((lat - center.lat) * Math.PI) / 180;
  const dLng = ((lng - center.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((center.lat * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ------------------------------------------------------------------ */
/* Simple i18n: English / தமிழ் via a tiny external store.            */
/* ------------------------------------------------------------------ */

export type Lang = "en" | "ta";

const STRINGS: Record<string, Record<Lang, string>> = {
  // nav / shell
  "nav.feed": { en: "Rescue feed", ta: "மீட்பு பட்டியல்" },
  "nav.myClaims": { en: "My rescues", ta: "என் மீட்புகள்" },
  "nav.post": { en: "Post food", ta: "உணவு பதிவு" },
  "nav.myListings": { en: "My listings", ta: "என் பதிவுகள்" },
  "nav.impact": { en: "Impact", ta: "தாக்கம்" },
  "nav.leaderboard": { en: "Leaderboard", ta: "தரவரிசை" },
  "nav.profile": { en: "Profile", ta: "சுயவிவரம்" },
  "nav.admin": { en: "Admin", ta: "நிர்வாகம்" },
  "nav.help": { en: "Help", ta: "உதவி" },
  "nav.signOut": { en: "Sign out", ta: "வெளியேறு" },
  "nav.notifications": { en: "Notifications", ta: "அறிவிப்புகள்" },
  // landing
  "landing.badge": { en: "Live surplus food network", ta: "நேரடி உணவு மீட்பு வலையமைப்பு" },
  "landing.nowLive": { en: "Now live", ta: "இப்போது இயங்குகிறது" },
  "landing.hero1": { en: "Good food deserves", ta: "நல்ல உணவு" },
  "landing.heroAccent": { en: "another destination", ta: "வேறொரு இலக்கை அடைய தகுதியுடையது" },
  "landing.sub": {
    en: "FoodBridge connects surplus food from restaurants, caterers and communities with nearby volunteers and NGOs who can rescue it.",
    ta: "FoodBridge உணவகங்கள், விருந்தோம்பல் நிறுவனங்கள் மற்றும் சமூகங்களின் மிஞ்சிய உணவை அருகிலுள்ள தன்னார்வலர்கள் மற்றும் NGO-க்களுடன் இணைத்து மீட்க உதவுகிறது.",
  },
  "landing.donateFood": { en: "Donate Food", ta: "உணவு வழங்கு" },
  "landing.rescueFood": { en: "Rescue Food", ta: "உணவை மீட்க" },
  "landing.howBtn": { en: "Discover How It Works", ta: "எப்படி இயங்குகிறது என்று பாருங்கள்" },
  "landing.getStarted": { en: "Get started", ta: "தொடங்கு" },
  "landing.signIn": { en: "Sign in", ta: "உள்நுழை" },
  "landing.how": { en: "How a rescue happens", ta: "ஒரு மீட்பு எப்படி நடக்கிறது" },
  "landing.howSub": { en: "Three steps, one hot meal saved from the bin.", ta: "மூன்று படிகள் — ஒரு சூடான உணவு வீணாகாமல் காப்பாற்றப்படும்." },
  "landing.step1": { en: "Post in 30 seconds", ta: "30 வினாடியில் பதிவு" },
  "landing.step1t": {
    en: "A wizard walks the donor through what, how much, and where. Pin the spot on the map, tap “safe for 4h”, done.",
    ta: "என்ன, எவ்வளவு, எங்கே — வழிகாட்டி சொல்லி தரும். வரைபடத்தில் இடத்தை குறி, “4 மணி நேரம்” தட்டி முடிக்கவும்.",
  },
  "landing.step2": { en: "Nearby heroes pinged live", ta: "அருகிலுள்ள தன்னார்வலர்களுக்கு உடனடி அறிவிப்பு" },
  "landing.step2t": {
    en: "The alert radius grows the longer food waits — until someone claims it.",
    ta: "உணவு காத்திருக்கும் நேரத்திற்கு ஏற்ப அறிவிப்பு வட்டம் விரியும் — யாரோ ஏற்கும் வரை.",
  },
  "landing.step3": { en: "Code, pickup, deliver", ta: "குறியீடு, எடுத்தல், வழங்கல்" },
  "landing.step3t": {
    en: "A 4-digit pickup code proves handoff. Both sides rate each other; trust grows with every rescue.",
    ta: "4 இலக்க குறியீடு கைமாற்றை உறுதி செய்யும். இரு தரப்பினரும் மதிப்பிடுவர்; ஒவ்வொரு மீட்பிலும் நம்பிக்கை வளரும்.",
  },
  // benefits
  "landing.benefits": { en: "Built for both sides of the counter", ta: "இரு தரப்பினருக்கும் உதவும் தளம்" },
  "landing.benefitsSub": {
    en: "Kitchens share surplus with dignity; volunteers and NGOs turn it into meals for people who need them.",
    ta: "சமையலறைகள் மிஞ்சிய உணவை கண்ணியத்துடன் பகிரும்; தன்னார்வலர்களும் NGO-க்களும் அதை தேவைப்படுவோருக்கு உணவாக்குகிறார்கள்.",
  },
  "landing.donorTitle": { en: "For food donors", ta: "உணவு வழங்குவோருக்கு" },
  "landing.donorSub": { en: "Restaurants, caterers, hostels, community kitchens and home cooks.", ta: "உணவகங்கள், விருந்தோம்பல் நிறுவனங்கள், விடுதிகள், சமூக சமையலறைகள்." },
  "landing.donorB1": { en: "Post surplus in about 30 seconds — type, quantity, pin, safety window.", ta: "30 வினாடிகளில் மிஞ்சிய உணவைப் பதிவு செய்யுங்கள்." },
  "landing.donorB2": { en: "Alerts widen automatically: nearby volunteers hear first, then the wider area.", ta: "அறிவிப்பு வட்டம் தானாக விரியும்: அருகிலுள்ளவர்கள் முதலில் அறிவர்." },
  "landing.donorB3": { en: "A 4-digit pickup code proves the handover — no phone-tag.", ta: "4 இலக்க குறியீடு கையளிப்பை உறுதி செய்யும்." },
  "landing.donorB4": { en: "Your organization gets a verified badge; trust grows with every rescue.", ta: "உங்கள் நிறுவனம் சரிபார்க்கப்பட்ட சின்னம் பெறும்; ஒவ்வொரு மீட்பிலும் நம்பிக்கை வளரும்." },
  "landing.volTitle": { en: "For volunteers & NGOs", ta: "தன்னார்வலர்கள் & NGO-க்களுக்கு" },
  "landing.volSub": { en: "Anyone with a bike, a backpack and half an hour.", ta: "ஒரு வாகனம், ஒரு பை, அரை மணி நேரம் இருப்பவர்கள் யாரும்." },
  "landing.volB1": { en: "See live surplus food near you with urgency countdowns.", ta: "அருகிலுள்ள மிஞ்சிய உணவை நேரலையில் காணுங்கள்." },
  "landing.volB2": { en: "Filter by distance, veg-only and food type; allergens are flagged.", ta: "தூரம், சைவம், உணவு வகை வடிகட்டி; ஒவ்வாமைகள் குறிக்கப்படும்." },
  "landing.volB3": { en: "Claim with one tap — the food is reserved for you.", ta: "ஒரு தட்டில் ஏற்கவும் — உணவு உங்களுக்காக ஒதுக்கப்படும்." },
  "landing.volB4": { en: "Deliver to people or NGOs nearby and build your trust score.", ta: "அருகிலுள்ளவர்களுக்கு வழங்கி உங்கள் நம்பிக்கை மதிப்பெண்ணை வளர்க்கவும்." },
  "landing.becomeDonor": { en: "Join as a food donor", ta: "உணவு வழங்குபவராக சேருங்கள்" },
  "landing.becomeVolunteer": { en: "Join as a volunteer", ta: "தன்னார்வலராக சேருங்கள்" },
  // process
  "landing.process": { en: "The rescue process, end to end", ta: "மீட்பு பயணம் முழுமையாக" },
  "landing.processSub": {
    en: "Every handover is tracked and verified — here is the exact journey for each side.",
    ta: "ஒவ்வொரு கையளிப்பும் கண்காணிக்கப்பட்டு சரிபார்க்கப்படும் — ஒவ்வொரு தரப்பினருக்குமான பயணம் இதோ.",
  },
  "landing.processDonorT": { en: "The donor's journey", ta: "வழங்குபவரின் பயணம்" },
  "landing.processDonorD": {
    en: "Post the food → a volunteer claims it → you show them your pickup code → they collect → you get a delivery confirmation.",
    ta: "உணவைப் பதிவு செய்யுங்கள் → தன்னார்வலர் ஏற்பார் → நீங்கள் குறியீட்டைக் காட்டுவீர்கள் → அவர்கள் எடுத்துக்கொள்வர் → வழங்கல் உறுதி செய்யப்படும்.",
  },
  "landing.processVolT": { en: "The volunteer's journey", ta: "தன்னார்வலரின் பயணம்" },
  "landing.processVolD": {
    en: "Discover food nearby → inspect the listing → claim it → collect from the donor → verify the pickup code → deliver.",
    ta: "அருகில் உணவைக் கண்டறியுங்கள் → விவரங்களைப் பாருங்கள் → ஏற்கவும் → எடுத்துக்கொள்ளுங்கள் → குறியீட்டை சரிபார்க்கவும் → வழங்குங்கள்.",
  },
  // safety
  "landing.safety": { en: "Safety & food handling", ta: "பாதுகாப்பு & உணவு கவனிப்பு" },
  "landing.safetySub": {
    en: "FoodBridge is built so that no plate is ever a gamble.",
    ta: "எந்த தட்டும் சூதாட்டமாக இருக்காது என FoodBridge உறுதி செய்கிறது.",
  },
  "landing.s1t": { en: "Explicit safe-until windows", ta: "வெளிப்படையான பாதுகாப்பு நேரம்" },
  "landing.s1d": {
    en: "Donors declare how long food is safe (2–6 h, custom allowed). A countdown runs on every ticket and listings expire when the window closes — food can't silently go stale on the feed.",
    ta: "உணவு எவ்வளவு நேரம் பாதுகாப்பானது என வழங்குபவர் குறிப்பர் (2–6 மணி). ஒவ்வொரு டிக்கெட்டிலும் கவுண்டவுன் ஓடும்; நேரம் முடிந்ததும் பதிவு காலாவதியாகும்.",
  },
  "landing.s2t": { en: "Verified pickup codes", ta: "சரிபார்க்கப்பட்ட எடுப்பு குறியீடு" },
  "landing.s2d": {
    en: "The donor shows a 4-digit code; the volunteer types it in to confirm collection. Every handover is provable, and trust scores reward reliable behaviour.",
    ta: "வழங்குபவர் 4 இலக்க குறியீட்டைக் காட்டுவார்; தன்னார்வலர் அதை உள்ளிட்டு எடுப்பை உறுதி செய்வார். நம்பிக்கை மதிப்பெண் நம்பகமான நடத்தையை ஊக்குவிக்கும்.",
  },
  "landing.s3t": { en: "Allergens in the open", ta: "ஒவ்வாமை தகவல் வெளிப்படை" },
  "landing.s3d": {
    en: "Donors declare allergens (nuts, dairy, gluten…) and the info is shown right on the ticket and detail page — before anyone claims.",
    ta: "வழங்குபவர் ஒவ்வாமைகளை (கொட்டை, பால், கோதுமை…) குறிப்பர்; தகவல் டிக்கெட்டிலும் விவரப்பகுதியிலும் தெரியும்.",
  },
  "landing.s4t": { en: "Inspect before you accept", ta: "ஏற்கும் முன் சோதியுங்கள்" },
  "landing.s4d": {
    en: "Volunteers check seals, quantity and freshness at pickup and can cancel on the spot. Anything suspicious can be reported to admins in one tap.",
    ta: "தன்னார்வலர்கள் எடுப்பின் போது முத்திரை, அளவு, புத்துணர்ச்சி பார்ப்பர்; சந்தேகம் இருந்தால் நிர்வாகிகளுக்கு தெரிவிக்கலாம்.",
  },
  // FAQ
  "landing.faq": { en: "Frequently asked questions", ta: "அடிக்கடி கேட்கும் கேள்விகள்" },
  "landing.faqSub": { en: "Short answers to what people ask us most.", ta: "அதிகம் கேட்கும் கேள்விகளுக்கு சுருக்கமான பதில்கள்." },
  "landing.faq1q": { en: "Is FoodBridge free?", ta: "FoodBridge இலவசமா?" },
  "landing.faq1a": {
    en: "Yes — FoodBridge is a community rescue network. There are no listing fees, no commissions and no charges for volunteers.",
    ta: "ஆம் — FoodBridge ஒரு சமூக மீட்பு வலையமைப்பு. கட்டணம் இல்லை; தன்னார்வலர்களுக்கு கட்டணம் இல்லை.",
  },
  "landing.faq2q": { en: "Who can donate food?", ta: "யார் உணவு வழங்கலாம்?" },
  "landing.faq2a": {
    en: "Restaurants, caterers, hostels, community kitchens, event organisers and home cooks. Register as a Food Donor, add your organization, and once an admin verifies it, posting unlocks.",
    ta: "உணவகங்கள், விருந்தோம்பல் நிறுவனங்கள், விடுதிகள், சமூக சமையலறைகள், நிகழ்வு ஏற்பாட்டாளர்கள். Food Donor ஆக பதிவு செய்து, நிறுவனத்தை சேர்த்து, நிர்வாக அனுமதிக்கும்போது பதிவு திறக்கும்.",
  },
  "landing.faq3q": { en: "How do I know the food is safe to eat?", ta: "உணவு பாதுகாப்பானது என எப்படி அறிவது?" },
  "landing.faq3a": {
    en: "Every listing carries an explicit safe-until window with a live countdown, allergen declarations, and a verified pickup handover. Volunteers inspect the food at collection and can refuse or report anything questionable.",
    ta: "ஒவ்வொரு பதிவிலும் வாழ்க்கை கவுண்டவுனுடன் பாதுகாப்பு நேரம், ஒவ்வாமை தகவல், சரிபார்க்கப்பட்ட கையளிப்பு இருக்கும். தன்னார்வலர்கள் எடுக்கும்போது சோதித்து, சந்தேகம் இருந்தால் மறுக்கலாம்.",
  },
  "landing.faq4q": { en: "Where does rescued food go?", ta: "மீட்கப்பட்ட உணவு எங்கு செல்லும்?" },
  "landing.faq4a": {
    en: "Volunteers deliver to nearby people and NGOs who need it — shelters, community kitchens, families. Each delivery is recorded with a note, so donors can see where their food landed.",
    ta: "தன்னார்வலர்கள் அருகிலுள்ள தேவைப்படுவோர் மற்றும் NGO-க்களுக்கு வழங்குவர். ஒவ்வொரு வழங்கலும் குறிப்புடன் பதிவாகும்.",
  },
  "landing.faq5q": { en: "Is my location private?", ta: "எனது இருப்பிடம் தனிப்பட்டதா?" },
  "landing.faq5a": {
    en: "Browsing shows lightly fuzzed locations, not exact coordinates. The exact pickup address is shared only with the volunteer who claims the food, and your base location is used just for distances and alerts.",
    ta: "உலாவினும்போது இருப்பிடம் சற்று மறைக்கப்படும். துல்லியமான முகவரி உணவை ஏற்கும் தன்னார்வலருக்கு மட்டுமே தெரியும்.",
  },
  "landing.faq6q": { en: "What if nobody claims my food?", ta: "யாரும் என் உணவை ஏற்கவில்லை என்றால்?" },
  "landing.faq6a": {
    en: "The alert radius widens step by step — nearby volunteers first, then further out. If the safety window closes with no claim, the listing simply expires. FoodBridge never promises food it can't rescue.",
    ta: "அறிவிப்பு வட்டம் படிப்படியாக விரியும். பாதுகாப்பு நேரம் முடிந்தால் பதிவு காலாவதியாகும். FoodBridge மீட்க முடியாத உணவை உறுதி செய்யாது.",
  },
  // footer
  "landing.footerTag": { en: "Reducing food waste. Sharing goodness.", ta: "உணவு வீணை குறைத்தல். நன்மையை பகிர்தல்." },
  "landing.footerExplore": { en: "Explore", ta: "ஆராய்க" },
  "landing.footerSupport": { en: "Contact & support", ta: "தொடர்பு & உதவி" },
  "landing.footerHow": { en: "How it works", ta: "எப்படி இயங்குகிறது" },
  "landing.footerFaq": { en: "FAQ", ta: "கேள்விகள்" },
  "landing.footerHelp": { en: "Help centre", ta: "உதவி மையம்" },
  "landing.footerSafety": { en: "Food safety", ta: "உணவு பாதுகாப்பு" },
  "landing.footerPrivacy": { en: "Location privacy", ta: "இருப்பிட தனியுரிமை" },
  "landing.footerEmail": { en: "Email the team", ta: "குழுவுக்கு மின்னஞ்சல்" },
  "landing.footerNote": {
    en: "Exact pickup locations are never public. Food-handling decisions stay with the people who make them — check every handover.",
    ta: "துல்லியமான எடுப்பு இடம் பொதுவில் தெரியாது. ஒவ்வொரு கையளிப்பையும் சரிபார்க்கவும்.",
  },
  "landing.footerBuilt": {
    en: "Built with Django, React, Leaflet & SSE — no food was wasted in the making of this site.",
    ta: "Django, React, Leaflet & SSE-உடன் உருவாக்கப்பட்டது — இந்த தளத்தை உருவாக்க எந்த உணவும் வீணாகவில்லை.",
  },
  "landing.ctaTitle": { en: "Tonight, somewhere, a vat of dal goes cold.", ta: "இன்று இரவு, எங்கோ ஒரு பாத்திரம் சூடான சாம்பார் வீணாகிறது." },
  "landing.ctaSub": { en: "Be the bridge between a full kitchen and an empty plate.", ta: "நிறைந்த சமையலறைக்கும் காலி தட்டிற்கும் நீர் பாலமாகுக." },
  "landing.join": { en: "Join FoodBridge", ta: "FoodBridge-இல் சேருங்கள்" },
  // common
  "c.claim": { en: "Claim this rescue", ta: "இந்த மீட்பை ஏற்குக" },
  "c.details": { en: "Details", ta: "விவரங்கள்" },
  "c.live": { en: "Live", ta: "நேரலை" },
  "c.filters": { en: "Filters", ta: "வடிகட்டி" },
  "c.vegOnly": { en: "Veg only", ta: "சைவம் மட்டும்" },
  "c.radius": { en: "Radius", ta: "தூரம்" },
};

let currentLang: Lang = (localStorage.getItem("fb.lang") as Lang) || "en";
const listeners = new Set<() => void>();

export function setLang(lang: Lang): void {
  currentLang = lang;
  localStorage.setItem("fb.lang", lang);
  listeners.forEach((listener) => listener());
}

export function useLang(): [Lang, (lang: Lang) => void] {
  const lang = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => currentLang,
  );
  return [lang, setLang];
}

export function t(key: string): string {
  return STRINGS[key]?.[currentLang] ?? key;
}

/** Subscribing variant — components using it re-render when the language flips. */
export function useT(): (key: string) => string {
  useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => currentLang,
  );
  return t;
}
