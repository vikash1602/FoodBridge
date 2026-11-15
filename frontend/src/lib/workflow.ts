/** Phase 5 — workflow definitions and next-action guidance.
 *  Pure data/logic (no components) so it can be shared by pages and the
 *  WorkflowGuide components without breaking fast refresh.
 *
 *  These are guidance only: every real transition still goes through the API,
 *  which enforces who may do what (the frontend never bypasses permissions).
 */

export const DONOR_FLOW = ["Post", "Volunteer claims", "Pickup code", "Food collected", "Delivered"] as const;
export const VOLUNTEER_FLOW = ["Discover", "Inspect", "Claim", "Collect", "Verify pickup", "Deliver"] as const;

export interface NextAction {
  status: string;
  /** What has to happen next, in plain words. */
  action: string;
  /** Who performs it ("You", "The volunteer", "The donor"…). */
  actor: string;
  /** Short how-to lines. */
  instructions: string[];
  /** Food-safety note relevant at this stage. */
  safety?: string;
}

const SAFETY_NOTES = {
  waiting: "Keep food at safe temperature and seal containers — fresh and labelled claims faster and feeds people safely.",
  handover: "Check the handover: containers sealed, quantity matches the listing, food still within its safe-until window. If anything looks or smells off, don't hand it over — cancel instead.",
  transport: "Transport food upright and covered; get it to people within the safe-until window. Never leave food unattended mid-journey.",
  receive: "Before accepting: containers sealed, quantity matches, food is still within its safe-until window. If anything seems off, refuse and report the listing.",
  serve: "Serve or distribute promptly — rescued food should reach plates well before the safe-until time.",
} as const;

/** Guidance for a DONOR viewing their listing at a given status. */
export function donorNextAction(status: string): NextAction {
  switch (status) {
    case "open":
      return {
        status: "open — waiting for a volunteer",
        action: "Watch for a claim; the alert radius widens every 20 minutes until someone claims.",
        actor: "A nearby volunteer",
        instructions: [
          "Keep the food ready and sealed at the pickup point.",
          "You'll hear a ping the moment someone claims.",
        ],
        safety: SAFETY_NOTES.waiting,
      };
    case "claimed":
      return {
        status: "claimed — a volunteer is on the way",
        action: "Show the 4-digit pickup code when the volunteer arrives.",
        actor: "You",
        instructions: [
          "The code is on your listing — show it, don't type it for them.",
          "Hand over exactly the quantity listed.",
        ],
        safety: SAFETY_NOTES.handover,
      };
    case "picked_up":
      return {
        status: "collected — food is on the move",
        action: "Nothing to do — the volunteer is delivering now.",
        actor: "The volunteer",
        instructions: ["You'll be notified when delivery is confirmed."],
      };
    case "delivered":
      return {
        status: "delivered — rescue complete 🎉",
        action: "Optionally rate the volunteer — ratings build both trust scores.",
        actor: "You",
        instructions: ["Find the rescue under Impact or Notifications."],
        safety: SAFETY_NOTES.serve,
      };
    case "expired":
      return {
        status: "expired — the safety window closed",
        action: "Post again next time you have surplus — fresher listings get claimed faster.",
        actor: "You",
        instructions: ["Shorter safe windows (2–4 h) usually claim quicker."],
      };
    default:
      return {
        status: "cancelled",
        action: "Nothing pending — the listing is closed.",
        actor: "—",
        instructions: [],
      };
  }
}

/** Guidance for a VOLUNTEER viewing their claim at a given status. */
export function volunteerNextAction(status: string): NextAction {
  switch (status) {
    case "active":
      return {
        status: "claimed — go collect it",
        action: "Go to the pickup point, then verify the pickup with the donor's 4-digit code.",
        actor: "You",
        instructions: [
          "Tap “Verify pickup” below and enter the code the donor shows you.",
          "Running late or can't make it? Cancel early so the food reopens for others.",
        ],
        safety: SAFETY_NOTES.receive,
      };
    case "picked_up":
      return {
        status: "collected — deliver it now",
        action: "Take the food to the people who need it, then mark it delivered.",
        actor: "You",
        instructions: [
          "Add a short delivery note — where it landed and how many people it fed.",
          "Deliver before the food's safe-until time.",
        ],
        safety: SAFETY_NOTES.transport,
      };
    case "delivered":
      return {
        status: "delivered — rescue complete 🎉",
        action: "Nothing left to do — trust score updated. Rescue again anytime!",
        actor: "—",
        instructions: [],
      };
    default:
      return {
        status: status.replace("_", " "),
        action: "This rescue is closed.",
        actor: "—",
        instructions: [],
      };
  }
}
