/** Profile: trust meter, base location picker, notify radius, org registration. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import L from "leaflet";

import { api } from "@/api/client";
import { useAuth } from "@/api/auth";
import type { Organization, Paginated, User } from "@/api/types";
import { TrustBadge } from "@/components/TrustBadge";
import { EmptyState, Modal } from "@/components/ui";
import { fullName } from "@/lib/format";

function LocationPicker({ value, onChange }: { value: [number, number]; onChange: (position: [number, number]) => void }) {
  useMapEvents; // (keep import tree-shaken false positive away)
  function Clicker() {
    useMapEvents({
      click(event) {
        onChange([event.latlng.lat, event.latlng.lng]);
      },
    });
    return null;
  }
  const pin = L.divIcon({
    className: "fb-marker",
    html: '<div class="fb-plate" style="background:#1E4533">🏠</div>',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
  return (
    <div className="h-56 overflow-hidden rounded-2xl border border-[color:var(--fb-line)]">
      <MapContainer center={value} zoom={13} className="h-full w-full" scrollWheelZoom>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
        <Clicker />
        <Marker position={value} icon={pin} />
      </MapContainer>
    </div>
  );
}

function TrustMeter({ score }: { score: number }) {
  return (
    <div className="ticket p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="label !mb-1">Trust score</p>
          <p className="font-display text-4xl font-black tabular-nums">{score}<span className="text-lg text-[color:var(--fb-ink-soft)]">/100</span></p>
        </div>
        <TrustBadge badge={score >= 90 ? "champion" : score >= 75 ? "trusted" : score >= 60 ? "reliable" : "new"} size="md" />
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-[color:var(--fb-line)]" role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="h-full rounded-full bg-gradient-to-r from-forest-600 via-saffron-400 to-saffron-600 transition-all"
          style={{ width: `${score}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-[color:var(--fb-ink-soft)]">
        +8 per delivery, +2 per 5★ rating · −6 late cancel, −10 no-show, −5 upheld report
      </p>
    </div>
  );
}

export function ProfilePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [orgOpen, setOrgOpen] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState<Organization["type"]>("restaurant");
  const [orgAddress, setOrgAddress] = useState("");
  const [baseLocation, setBaseLocation] = useState<[number, number]>([
    user?.base_lat ?? 18.5204,
    user?.base_lng ?? 73.8567,
  ]);

  const { data: orgs } = useQuery({
    queryKey: ["organizations"],
    queryFn: () => api.get<Paginated<Organization>>("/organizations/"),
    enabled: user?.role === "donor",
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Partial<User>) => api.patch<User>("/auth/me/", payload),
    onSuccess: () => {
      toast.success("Saved");
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const orgMutation = useMutation({
    mutationFn: () =>
      api.post<Organization>("/organizations/", {
        name: orgName,
        type: orgType,
        address: orgAddress,
        lat: baseLocation[0],
        lng: baseLocation[1],
      }),
    onSuccess: () => {
      toast.success("Organization submitted — an admin will verify it soon. 🕵️");
      setOrgOpen(false);
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  if (!user) return null;
  const myOrg = orgs?.results[0];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="ticket flex items-center gap-4 p-5">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-forest-700 font-display text-3xl font-black text-paper dark:bg-forest-400 dark:text-pantry-950">
          {fullName(user).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-black">{fullName(user)}</h1>
          <p className="truncate text-sm text-[color:var(--fb-ink-soft)]">{user.email}</p>
          <p className="mt-1 text-xs font-bold uppercase tracking-widest text-saffron-600 dark:text-saffron-400">
            {user.role} {user.is_verified && "· verified ✓"}
          </p>
        </div>
      </div>

      <TrustMeter score={user.trust_score} />

      {/* location & radius */}
      <div className="ticket p-5">
        <p className="label">
          <MapPin size={12} className="mr-1 inline" aria-hidden /> Base location — tap the map to move it
        </p>
        <LocationPicker value={baseLocation} onChange={setBaseLocation} />
        <div className="mt-4">
          <label className="label" htmlFor="radius">
            Notify me about food within <output className="text-forest-700 dark:text-forest-300">{user.notify_radius_km} km</output>
          </label>
          <input
            id="radius"
            type="range"
            min={1}
            max={15}
            step={1}
            defaultValue={user.notify_radius_km}
            className="w-full accent-forest-600"
            onChange={(event) => {
              const value = Number(event.target.value);
              event.target.setAttribute("aria-valuenow", String(value));
              const output = event.target.closest("div")?.querySelector("output");
              if (output) output.textContent = `${value} km`;
            }}
            onMouseUp={(event) => saveMutation.mutate({ notify_radius_km: Number((event.target as HTMLInputElement).value) })}
            onTouchEnd={(event) => saveMutation.mutate({ notify_radius_km: Number((event.target as HTMLInputElement).value) })}
          />
        </div>
        <button
          className="btn-primary mt-3 w-full"
          onClick={() => saveMutation.mutate({ base_lat: baseLocation[0], base_lng: baseLocation[1] })}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving…" : "Save base location"}
        </button>
      </div>

      {/* organizations (donors) */}
      {user.role === "donor" && (
        <div className="ticket p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Organization</h2>
            {myOrg && (
              <span
                className={
                  myOrg.verification_status === "approved"
                    ? "chip bg-forest-100 text-forest-800"
                    : myOrg.verification_status === "rejected"
                      ? "chip bg-tomato-500/10 text-tomato-600"
                      : "chip bg-saffron-100 text-saffron-800"
                }
              >
                {myOrg.verification_status}
              </span>
            )}
          </div>
          {myOrg ? (
            <div className="mt-2 text-sm">
              <p className="font-bold">{myOrg.name}</p>
              <p className="text-[color:var(--fb-ink-soft)]">{myOrg.address}</p>
              {myOrg.verification_status === "rejected" && myOrg.verification_note && (
                <p className="mt-2 rounded-lg bg-tomato-500/10 px-3 py-2 text-xs font-semibold text-tomato-600">
                  Admin note: {myOrg.verification_note}
                </p>
              )}
              {myOrg.verification_status !== "approved" && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-[color:var(--fb-ink-soft)]">
                  <ShieldQuestion size={13} aria-hidden /> You can still browse; posting unlocks after verification.
                </p>
              )}
            </div>
          ) : (
            <EmptyState
              emoji="🏢"
              title="No organization yet"
              hint="Food is posted in a verified organization's name — register yours to get the verified badge on every listing."
              next={[
                "Register your restaurant, hostel, caterer or community kitchen below.",
                "An admin verifies it; posting unlocks as soon as it's approved.",
                "You can explore the feed and set your base location meanwhile.",
              ]}
            />
          )}
          <button
            className="btn-outline mt-3 w-full"
            onClick={() => setOrgOpen(true)}
            disabled={Boolean(myOrg && myOrg.verification_status === "pending")}
          >
            {myOrg ? "Resubmit details" : "Register organization"}
          </button>
        </div>
      )}

      <Modal open={orgOpen} onClose={() => setOrgOpen(false)} title="Organization details">
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="org-name">
              Name
            </label>
            <input id="org-name" className="input" value={orgName} onChange={(event) => setOrgName(event.target.value)} placeholder="Anand Bhavan" />
          </div>
          <div>
            <label className="label" htmlFor="org-type">
              Type
            </label>
            <select id="org-type" className="input" value={orgType} onChange={(event) => setOrgType(event.target.value as Organization["type"])}>
              {["restaurant", "hostel", "caterer", "individual"].map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="org-address">
              Address
            </label>
            <input id="org-address" className="input" value={orgAddress} onChange={(event) => setOrgAddress(event.target.value)} placeholder="12 MG Road, Pune" />
          </div>
          <button
            className="btn-primary h-11 w-full"
            onClick={() => orgMutation.mutate()}
            disabled={orgMutation.isPending || orgName.trim().length < 2 || orgAddress.trim().length < 4}
          >
            {orgMutation.isPending ? "Submitting…" : "Submit for verification"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
