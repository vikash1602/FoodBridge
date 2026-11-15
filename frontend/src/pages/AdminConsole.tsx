/** Admin console: verification queue, reports queue, user management. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, BookOpen, CheckCircle2, Search, ShieldCheck, Undo2, XCircle } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { api } from "@/api/client";
import type { AdminUserRow, Organization, Paginated, Report } from "@/api/types";
import { EmptyState, ListingCardSkeleton, Modal } from "@/components/ui";
import { TrustBadge } from "@/components/TrustBadge";
import { fullName } from "@/lib/format";
import { clsx } from "clsx";

type Tab = "verifications" | "reports" | "users";

/** Phase 8 — administrator onboarding guide: what each moderation surface
 *  does, what to check, and what the platform impact of each decision is. */
function AdminGuide() {
  const [open, setOpen] = useState(true);
  return (
    <div className="ticket mb-5 p-5" data-tour="admin-guide">
      <button
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl border-2 border-forest-200 bg-forest-50 text-forest-700 dark:border-forest-800 dark:bg-forest-900/40 dark:text-forest-300">
            <BookOpen size={17} aria-hidden />
          </span>
          <span>
            <span className="block font-display text-lg font-bold">Admin guide — read this first</span>
            <span className="block text-xs text-[color:var(--fb-ink-soft)]">
              What each queue means and what your decisions change.
            </span>
          </span>
        </span>
        <span className="chip bg-[color:var(--fb-line)]/50 text-[color:var(--fb-ink-soft)]">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <div className="rounded-xl bg-[color:var(--fb-line)]/30 p-3.5">
            <dt className="font-bold text-forest-800 dark:text-forest-200">✅ Organization verification</dt>
            <dd className="mt-1 text-[color:var(--fb-ink-soft)]">
              Donors can only post food once their organization is approved — this is the gate that keeps the feed
              trustworthy. Check the name, type and address are coherent (a real kitchen, not a test row) before
              approving. Rejections require a note: it's shown to the owner so they can fix and resubmit.
            </dd>
          </div>
          <div className="rounded-xl bg-[color:var(--fb-line)]/30 p-3.5">
            <dt className="font-bold text-forest-800 dark:text-forest-200">🛡️ Report review</dt>
            <dd className="mt-1 text-[color:var(--fb-ink-soft)]">
              Users report listings (spoiled food, wrong address, quantity mismatch…). Read the report, check the
              listing, then <em>Uphold</em> (−5 trust to the reported side) or <em>Dismiss</em>. Upholding a false or
              retaliatory report hurts the community — dismiss those.
            </dd>
          </div>
          <div className="rounded-xl bg-[color:var(--fb-line)]/30 p-3.5">
            <dt className="font-bold text-forest-800 dark:text-forest-200">🛑 User suspension</dt>
            <dd className="mt-1 text-[color:var(--fb-ink-soft)]">
              Suspend for repeated no-shows, abusive behaviour or fraudulent listings; unsuspend to reverse. Suspension
              blocks sign-in — use it when trust-score penalties alone aren't enough. Admins can't suspend other admins.
            </dd>
          </div>
          <div className="rounded-xl bg-[color:var(--fb-line)]/30 p-3.5">
            <dt className="font-bold text-forest-800 dark:text-forest-200">⭐ Trust-score moderation</dt>
            <dd className="mt-1 text-[color:var(--fb-ink-soft)]">
              Scores move automatically: +8 per delivery, +2 per 5★ rating, −6 late cancel, −10 no-show, −5 upheld
              report. You never edit scores by hand — your moderation (upheld reports, suspensions) is how the system
              adjusts. Watch the Users tab for outliers.
            </dd>
          </div>
          <div className="rounded-xl bg-[color:var(--fb-line)]/30 p-3.5 md:col-span-2">
            <dt className="font-bold text-forest-800 dark:text-forest-200">🌍 Platform impact</dt>
            <dd className="mt-1 text-[color:var(--fb-ink-soft)]">
              The Impact page (yours shows platform totals) reflects real activity only: listings ever created,
              delivered rescues, meals-equivalent and average claim time. Nothing is simulated — every number you see
              traces back to a completed rescue, and fast verifications are what keep new donors posting.
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function Verifications() {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState<Organization | null>(null);
  const [note, setNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "orgs", "pending"],
    queryFn: () => api.get<Paginated<Organization>>("/organizations/?verification_status=pending&page_size=50"),
    refetchInterval: 30_000,
  });

  const review = useMutation({
    mutationFn: ({ org, action }: { org: Organization; action: "approve" | "reject" }) =>
      api.post(`/organizations/${org.id}/${action}/`, { note }),
    onSuccess: (_data, variables) => {
      toast.success(variables.action === "approve" ? "Approved — they can post now. ✅" : "Rejected with note.");
      setRejecting(null);
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <div className="grid gap-3">
      {isLoading && Array.from({ length: 3 }).map((_, index) => <ListingCardSkeleton key={index} />)}
      {!isLoading && (data?.results ?? []).length === 0 && (
        <EmptyState emoji="🗃️" title="Queue is clear" hint="New organizations land here for verification." />
      )}
      {(data?.results ?? []).map((org) => (
        <div key={org.id} className="ticket flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="font-display font-bold">
              {org.name} <span className="chip bg-[color:var(--fb-line)]/50 text-[color:var(--fb-ink-soft)]">{org.type}</span>
            </p>
            <p className="text-xs text-[color:var(--fb-ink-soft)]">
              {org.address} · owner {fullName(org.owner)}
            </p>
          </div>
          <button className="btn-primary h-10 text-sm" onClick={() => review.mutate({ org, action: "approve" })} disabled={review.isPending}>
            <CheckCircle2 size={15} aria-hidden /> Approve
          </button>
          <button className="btn-danger h-10 text-sm" onClick={() => setRejecting(org)}>
            <XCircle size={15} aria-hidden /> Reject
          </button>
        </div>
      ))}
      <Modal open={Boolean(rejecting)} onClose={() => setRejecting(null)} title={`Reject ${rejecting?.name}?`}>
        <label className="label" htmlFor="reject-note">
          Reason (shown to the owner)
        </label>
        <textarea id="reject-note" className="input min-h-24" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Document unclear — please re-upload the FSSAI license." />
        <button
          className="btn-danger mt-3 h-11 w-full"
          onClick={() => rejecting && review.mutate({ org: rejecting, action: "reject" })}
          disabled={review.isPending || note.trim().length < 4}
        >
          Confirm rejection
        </button>
      </Modal>
    </div>
  );
}

function Reports() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "reports", "open"],
    queryFn: () => api.get<Paginated<Report>>("/reports/?status=open&page_size=50"),
    refetchInterval: 30_000,
  });

  const resolve = useMutation({
    mutationFn: ({ id, upheld }: { id: number; upheld: boolean }) =>
      api.post(`/reports/${id}/resolve/`, { upheld, admin_note: upheld ? "Upheld after review" : "Reviewed — no action" }),
    onSuccess: (_data, variables) => {
      toast.success(variables.upheld ? "Report upheld — trust adjusted. 🛡️" : "Report dismissed.");
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <div className="grid gap-3">
      {isLoading && Array.from({ length: 2 }).map((_, index) => <ListingCardSkeleton key={index} />)}
      {!isLoading && (data?.results ?? []).length === 0 && (
        <EmptyState emoji="🛡️" title="No open reports" hint="The community is behaving. Enjoy the calm." />
      )}
      {(data?.results ?? []).map((report) => (
        <div key={report.id} className="ticket p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold">
                {report.listing_title ? `Listing: ${report.listing_title}` : `User: ${report.reported_user_name ?? report.reported_user}`}
              </p>
              <p className="text-xs text-[color:var(--fb-ink-soft)]">
                “{report.reason}” {report.details && `— ${report.details}`} · by {report.reporter_name}
              </p>
            </div>
            <div className="flex gap-2">
              <button className="btn-primary h-10 text-sm" onClick={() => resolve.mutate({ id: report.id, upheld: true })} disabled={resolve.isPending}>
                Uphold (−5 trust)
              </button>
              <button className="btn-outline h-10 text-sm" onClick={() => resolve.mutate({ id: report.id, upheld: false })} disabled={resolve.isPending}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Users() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users", search],
    queryFn: () => api.get<Paginated<AdminUserRow>>(`/admin/users/${search ? `?search=${encodeURIComponent(search)}` : "?page_size=100"}`),
  });

  const toggleSuspend = useMutation({
    mutationFn: (user: AdminUserRow) => api.post(`/admin/users/${user.id}/${user.is_suspended ? "unsuspend" : "suspend"}/`),
    onSuccess: () => {
      toast.success("Done");
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  return (
    <div>
      <label className="relative mb-3 block">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--fb-ink-soft)]" aria-hidden />
        <input
          className="input pl-9"
          placeholder="Search name, email, phone…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search users"
        />
      </label>
      <div className="ticket overflow-hidden">
        {isLoading ? (
          <div className="p-8">
            <ListingCardSkeleton />
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-160 text-left text-sm">
              <thead>
                <tr className="border-b border-[color:var(--fb-line)] bg-[color:var(--fb-line)]/20 text-[10px] uppercase tracking-widest text-[color:var(--fb-ink-soft)]">
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Trust</th>
                  <th className="px-4 py-3">Verified</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--fb-line)]">
                {(data?.results ?? []).map((user) => (
                  <tr key={user.id} className={clsx(user.is_suspended && "opacity-60")}>
                    <td className="px-4 py-3">
                      <p className="font-bold">{fullName(user)}</p>
                      <p className="text-xs text-[color:var(--fb-ink-soft)]">{user.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="chip bg-[color:var(--fb-line)]/50 text-[color:var(--fb-ink-soft)]">{user.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="mr-2 font-bold tabular-nums">{user.trust_score}</span>
                      <TrustBadge badge={user.badge} />
                    </td>
                    <td className="px-4 py-3">{user.is_verified ? "✅" : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className={clsx("btn text-xs", user.is_suspended ? "btn-outline" : "btn-danger")}
                        onClick={() => toggleSuspend.mutate(user)}
                        disabled={toggleSuspend.isPending || user.role === "admin"}
                        aria-label={user.is_suspended ? `Unsuspend ${fullName(user)}` : `Suspend ${fullName(user)}`}
                      >
                        {user.is_suspended ? (
                          <>
                            <Undo2 size={13} aria-hidden /> Unsuspend
                          </>
                        ) : (
                          <>
                            <Ban size={13} aria-hidden /> Suspend
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function AdminConsolePage() {
  const [tab, setTab] = useState<Tab>("verifications");

  const tabs: Array<{ key: Tab; label: string; icon: typeof ShieldCheck }> = [
    { key: "verifications", label: "Verifications", icon: CheckCircle2 },
    { key: "reports", label: "Reports", icon: ShieldCheck },
    { key: "users", label: "Users", icon: Ban },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-3xl font-black">Admin console</h1>
      <p className="mb-5 text-sm text-[color:var(--fb-ink-soft)]">Keep the bridge safe and honest.</p>

      <AdminGuide />

      <div role="tablist" aria-label="Admin sections" className="mb-5 flex flex-wrap gap-2">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={clsx(
              "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors",
              tab === key ? "bg-forest-700 text-paper shadow-card dark:bg-forest-400 dark:text-pantry-950" : "bg-[color:var(--fb-line)]/40 hover:bg-[color:var(--fb-line)]/70",
            )}
          >
            <Icon size={15} aria-hidden /> {label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "verifications" && <Verifications />}
        {tab === "reports" && <Reports />}
        {tab === "users" && <Users />}
      </div>
    </div>
  );
}
