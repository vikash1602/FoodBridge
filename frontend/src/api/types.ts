/** API shape types mirroring the Django serializers. */

export type Role = "donor" | "volunteer" | "admin";
export type Badge = "new" | "reliable" | "trusted" | "champion";

export interface User {
  id: number;
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  role: Role;
  phone: string;
  is_verified: boolean;
  trust_score: number;
  badge: Badge;
  base_lat: number | null;
  base_lng: number | null;
  notify_radius_km: number;
  is_suspended: boolean;
  has_approved_organization: boolean;
  is_admin_role: boolean;
  created_at: string;
}

export interface PublicUser {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  trust_score: number;
  badge: Badge;
}

export interface Organization {
  id: number;
  owner: PublicUser;
  name: string;
  type: "restaurant" | "hostel" | "caterer" | "ngo" | "individual";
  address: string;
  lat: number | null;
  lng: number | null;
  verification_status: "pending" | "approved" | "rejected";
  verification_note: string;
  document: string | null;
  is_approved: boolean;
  created_at: string;
}

export interface Listing {
  id: number;
  donor: PublicUser;
  organization: (Omit<Organization, "owner"> & { owner?: PublicUser }) | null;
  title: string;
  description: string;
  food_type: "cooked" | "packaged" | "raw" | "bakery" | "other";
  is_veg: boolean;
  quantity_value: number;
  quantity_unit: "meals" | "kg" | "boxes";
  quantity: string;
  allergens: string;
  photo: string | null;
  pickup_address: string;
  lat: number;
  lng: number;
  ready_from: string;
  safe_until: string;
  status: "open" | "claimed" | "picked_up" | "delivered" | "expired" | "cancelled";
  distance_km?: number | null;
  minutes_open?: number | null;
  escalation_radius_km?: number | null;
  seconds_to_expiry?: number;
  is_expired_now?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
  unread_count?: number;
}

export interface Claim {
  id: number;
  listing: Listing;
  volunteer: number;
  volunteer_name: string;
  donor_name: string;
  status: "active" | "picked_up" | "delivered" | "cancelled" | "no_show";
  pickup_code: string | null;
  claimed_at: string;
  picked_up_at: string | null;
  delivered_at: string | null;
  delivery_note: string;
  delivery_photo: string | null;
  cancel_reason: string;
}

export interface Rating {
  id: number;
  claim: number;
  rater: number;
  rater_name: string;
  ratee: number;
  ratee_name: string;
  stars: number;
  comment: string;
  created_at: string;
}

export interface Report {
  id: number;
  reporter: number;
  reporter_name: string;
  listing: number | null;
  listing_title: string | null;
  reported_user: number | null;
  reported_user_name: string | null;
  reason: string;
  details: string;
  status: "open" | "resolved";
  admin_note: string;
  resolved_at: string | null;
  created_at: string;
}

export interface Notification {
  id: number;
  type: string;
  message: string;
  listing: number | null;
  is_read: boolean;
  created_at: string;
}

export interface AdminUserRow {
  id: number;
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  role: Role;
  phone: string;
  is_verified: boolean;
  trust_score: number;
  badge: Badge;
  is_suspended: boolean;
  is_active: boolean;
  date_joined: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface SSEMessage {
  id: number;
  event: string;
  data: { type: string; payload: Record<string, unknown>; created_at: string };
}
