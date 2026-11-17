/**
 * Khula shared domain types — the single source of truth for web + mobile.
 *
 *  - Row types mirror the Postgres schema exactly (snake_case, as returned by
 *    PostgREST). Keep in sync with supabase/migrations; CI regenerates
 *    `database.generated.ts` to detect drift.
 *  - API types (camelCase) describe the Next.js BFF contract used by both
 *    the dashboard and the mobile app.
 *  - Money is ALWAYS integer cents (ZAR). Timestamps are ISO-8601 strings.
 */

// =============================================================================
// Enums (runtime arrays + literal unions, reused by Zod schemas)
// =============================================================================
export const USER_ROLES = ['admin', 'business_owner', 'staff', 'client'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const SERVICE_MODELS = ['fixed_location', 'mobile_onsite'] as const;
export type ServiceModel = (typeof SERVICE_MODELS)[number];

export const PRICING_MODELS = ['instant_book', 'quote_required'] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export const APPOINTMENT_STATUSES = ['requested', 'quoted', 'confirmed', 'completed', 'cancelled'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const JOB_PROGRESS = ['not_started', 'en_route', 'arrived', 'in_progress', 'finished'] as const;
export type JobProgress = (typeof JOB_PROGRESS)[number];

export const DEPOSIT_STATUSES = ['not_required', 'pending', 'paid', 'refunded', 'forfeited'] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export const QUOTE_STATUSES = ['pending', 'accepted', 'declined', 'expired', 'superseded'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const BOOKING_SOURCES = ['app', 'web', 'walk_in'] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export const PAYMENT_PROVIDERS = ['paystack', 'payfast'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const TRANSACTION_TYPES = ['deposit', 'balance', 'tip', 'refund'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ['pending', 'success', 'failed', 'reversed', 'refunded'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TIP_METHODS = ['cash', 'card', 'eft', 'in_app'] as const;
export type TipMethod = (typeof TIP_METHODS)[number];

export const SA_PROVINCES = [
  'eastern_cape', 'free_state', 'gauteng', 'kwazulu_natal', 'limpopo',
  'mpumalanga', 'north_west', 'northern_cape', 'western_cape',
] as const;
export type SaProvince = (typeof SA_PROVINCES)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

// =============================================================================
// Value objects
// =============================================================================
/** Integer cents (ZAR). Branded to stop accidental mixing with Rand floats. */
export type Cents = number & { readonly __brand?: 'Cents' };
/** Basis points: 10 000 = 100 %. */
export type BasisPoints = number;
/** ISO-8601 timestamp string (timestamptz). */
export type IsoDateTime = string;
/** YYYY-MM-DD in Africa/Johannesburg. */
export type IsoDate = string;
export type Uuid = string;

export interface TimeInterval {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}
export type WorkingHours = Partial<Record<Weekday, TimeInterval[]>>;

export interface GeoPoint {
  lat: number;
  lng: number;
}

// =============================================================================
// Database rows
// =============================================================================
export interface Category {
  id: number;
  slug: string;
  name: string;
  icon: string;
  sort_order: number;
  created_at: IsoDateTime;
}

export interface Profile {
  id: Uuid;
  role: UserRole;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  preference_notes: string | null;
  marketing_opt_in: boolean;
  popia_consent_at: IsoDateTime | null;
  popia_consent_version: string | null;
  anonymized_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Business {
  id: Uuid;
  owner_id: Uuid;
  name: string;
  slug: string;
  description: string | null;
  category_id: number;
  service_model: ServiceModel;
  address_line1: string | null;
  address_line2: string | null;
  suburb: string;
  city: string;
  province: SaProvince;
  postal_code: string;
  /** PostGIS geography — returned by PostgREST as hex EWKB. */
  location: string;
  travel_radius_km: number | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  paystack_subaccount_code: string | null;
  payout_bank_name: string | null;
  payout_account_last4: string | null;
  platform_fee_bps: BasisPoints;
  is_verified: boolean;
  is_active: boolean;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface StaffMember {
  id: Uuid;
  business_id: Uuid;
  profile_id: Uuid | null;
  display_name: string;
  role_title: string | null;
  avatar_url: string | null;
  invite_email: string | null;
  invite_accepted_at: IsoDateTime | null;
  commission_bps: BasisPoints;
  working_hours: WorkingHours;
  can_view_client_notes: boolean;
  can_manage_bookings: boolean;
  is_active: boolean;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Service {
  id: Uuid;
  business_id: Uuid;
  category_id: number | null;
  title: string;
  description: string | null;
  pricing_model: PricingModel;
  price_cents: Cents | null;
  duration_minutes: number;
  buffer_minutes: number;
  deposit_percent: number;
  is_active: boolean;
  sort_order: number;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Appointment {
  id: Uuid;
  business_id: Uuid;
  service_id: Uuid;
  staff_id: Uuid | null;
  client_id: Uuid | null;
  walk_in_name: string | null;
  walk_in_phone: string | null;
  source: BookingSource;
  status: AppointmentStatus;
  progress: JobProgress;
  starts_at: IsoDateTime;
  ends_at: IsoDateTime;
  buffer_minutes: number;
  blocked_until: IsoDateTime;
  is_mobile: boolean;
  client_address_line1: string | null;
  client_address_line2: string | null;
  client_suburb: string | null;
  client_city: string | null;
  client_postal_code: string | null;
  client_location: string | null;
  client_message: string | null;
  total_price_cents: Cents | null;
  deposit_cents: Cents;
  deposit_status: DepositStatus;
  hold_expires_at: IsoDateTime | null;
  commission_bps: BasisPoints | null;
  idempotency_key: Uuid | null;
  cancelled_at: IsoDateTime | null;
  cancelled_by: Uuid | null;
  cancellation_reason: string | null;
  completed_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface AppointmentQuote {
  id: Uuid;
  appointment_id: Uuid;
  business_id: Uuid;
  created_by: Uuid | null;
  amount_cents: Cents;
  message: string | null;
  proposed_starts_at: IsoDateTime | null;
  proposed_staff_id: Uuid | null;
  valid_until: IsoDateTime;
  status: QuoteStatus;
  responded_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

export type AppointmentEventType =
  | 'created' | 'status_changed' | 'progress_changed' | 'rescheduled'
  | 'quote_sent' | 'quote_responded' | 'payment_received';

export interface AppointmentEvent {
  id: number;
  appointment_id: Uuid;
  business_id: Uuid;
  actor_id: Uuid | null;
  event_type: AppointmentEventType;
  from_status: AppointmentStatus | null;
  to_status: AppointmentStatus | null;
  from_progress: JobProgress | null;
  to_progress: JobProgress | null;
  note: string | null;
  created_at: IsoDateTime;
}

/** Selectable columns only — `body_ciphertext` is never exposed. */
export interface ClientNoteMeta {
  id: Uuid;
  business_id: Uuid;
  client_id: Uuid;
  author_id: Uuid | null;
  key_version: number;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

/** Decrypted note, returned by the audited `get_client_notes` RPC. */
export interface ClientNote {
  id: Uuid;
  author_id: Uuid | null;
  author_name: string | null;
  body: string;
  created_at: IsoDateTime;
}

export interface Transaction {
  id: Uuid;
  business_id: Uuid;
  appointment_id: Uuid | null;
  client_id: Uuid | null;
  staff_id: Uuid | null;
  provider: PaymentProvider;
  type: TransactionType;
  status: TransactionStatus;
  reference: string;
  provider_transaction_id: string | null;
  amount_cents: Cents;
  currency: 'ZAR';
  platform_fee_cents: Cents;
  vendor_amount_cents: Cents;
  provider_fee_cents: Cents | null;
  subaccount_code: string | null;
  channel: string | null;
  paid_at: IsoDateTime | null;
  webhook_payload_sha256: string | null;
  signature_verified_at: IsoDateTime | null;
  requires_refund: boolean;
  failure_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface StaffTip {
  id: Uuid;
  business_id: Uuid;
  staff_id: Uuid;
  appointment_id: Uuid | null;
  transaction_id: Uuid | null;
  amount_cents: Cents;
  method: TipMethod;
  note: string | null;
  recorded_by: Uuid | null;
  created_at: IsoDateTime;
}

/** Display-safe card token metadata (the token itself is never selectable). */
export interface PaymentMethod {
  id: Uuid;
  client_id: Uuid;
  provider: PaymentProvider;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  bank: string | null;
  is_default: boolean;
  created_at: IsoDateTime;
}

export interface AuditLog {
  id: number;
  chain_seq: number;
  occurred_at: IsoDateTime;
  actor_id: Uuid | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  business_id: Uuid | null;
  metadata: Record<string, unknown>;
  prev_hash: string | null;
  row_hash: string;
}

// =============================================================================
// RPC result shapes
// =============================================================================
export interface BusinessSearchResult {
  id: Uuid;
  name: string;
  slug: string;
  description: string | null;
  category_slug: string;
  category_name: string;
  service_model: ServiceModel;
  suburb: string;
  city: string;
  province: SaProvince;
  /** Only populated for fixed_location businesses (never a mobile operator's home). */
  address_line1: string | null;
  logo_url: string | null;
  is_verified: boolean;
  travel_radius_km: number | null;
  distance_km: number | null;
  /** For mobile_onsite: does this operator travel to the searched point? */
  services_your_area: boolean | null;
  min_price_cents: Cents | null;
  has_instant_book: boolean;
  has_quote_services: boolean;
}

export interface BusinessPublic {
  id: Uuid;
  name: string;
  slug: string;
  description: string | null;
  category_slug: string;
  category_name: string;
  service_model: ServiceModel;
  suburb: string;
  city: string;
  province: SaProvince;
  address_line1: string | null;
  logo_url: string | null;
  is_verified: boolean;
  travel_radius_km: number | null;
  /** Exact for fixed_location; rounded (~1 km) for mobile_onsite. */
  latitude: number;
  longitude: number;
  accepts_payments: boolean;
}

export interface BookableStaff {
  staff_id: Uuid;
  display_name: string;
  role_title: string | null;
  avatar_url: string | null;
}

export interface AvailableSlot {
  staff_id: Uuid;
  staff_name: string;
  slot_start: IsoDateTime;
  slot_end: IsoDateTime;
}

export interface DashboardStats {
  date: IsoDate;
  /** null when the caller is staff (financials are owner-only). */
  revenue_today_cents: Cents | null;
  scheduled_revenue_cents: Cents | null;
  collected_today_cents: Cents | null;
  active_bookings: number;
  completed_today: number;
  pending_requests: number;
  booked_minutes: number;
  available_minutes: number;
  /** 0..1 */
  utilization_rate: number;
  revenue_series: Array<{ date: IsoDate; revenue_cents: Cents }>;
}

export interface StaffEarningsRow {
  staff_id: Uuid;
  display_name: string;
  commission_bps: BasisPoints;
  completed_appointments: number;
  service_revenue_cents: Cents;
  commission_cents: Cents;
  tips_cents: Cents;
  total_earnings_cents: Cents;
}

export interface ClientDataExport {
  generated_at: IsoDateTime;
  profile: Omit<Profile, 'id'> | null;
  email: string | null;
  appointments: Array<Record<string, unknown>>;
  quotes: Array<Record<string, unknown>>;
  transactions: Array<Record<string, unknown>>;
  saved_payment_methods: Array<Record<string, unknown>>;
  provider_notes: Array<Record<string, unknown>> | null;
}

/** Appointment joined with display data for lists and calendars. */
export interface AppointmentWithRelations extends Appointment {
  service: Pick<Service, 'id' | 'title' | 'duration_minutes' | 'pricing_model'> | null;
  staff: Pick<StaffMember, 'id' | 'display_name'> | null;
  client: Pick<Profile, 'id' | 'full_name' | 'phone'> | null;
}

// =============================================================================
// API contract (Next.js route handlers, consumed by web + mobile)
// =============================================================================
export type ErrorCode =
  | 'VALIDATION_FAILED' | 'AUTH_REQUIRED' | 'INVALID_CREDENTIALS' | 'FORBIDDEN'
  | 'NOT_FOUND' | 'RATE_LIMITED' | 'SLOT_UNAVAILABLE' | 'OUTSIDE_TRAVEL_RADIUS'
  | 'OUTSIDE_WORKING_HOURS' | 'TOO_MANY_OPEN_REQUESTS' | 'CONFLICT'
  | 'PAYMENT_PROVIDER_ERROR' | 'INTERNAL_ERROR' | (string & {});

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    /** Per-field messages from Zod (never echoes the submitted values). */
    fields?: Record<string, string[]>;
    /** Present on 429 responses. */
    retryAfterSeconds?: number;
  };
}

export type ApiResult<T> = { ok: true; data: T } | ({ ok: false; status: number } & ApiError);

export interface SignInRequest {
  email: string;
  password: string;
}

export interface SignUpRequest {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
  confirmPassword: string;
  accountType: Extract<UserRole, 'client' | 'business_owner'>;
  popiaConsent: true;
  marketingOptIn?: boolean;
}

export interface AuthResponse {
  userId: Uuid;
  role: UserRole;
  /** true when the user must confirm their email before signing in. */
  emailConfirmationRequired: boolean;
}

export interface BookingAddress {
  line1: string;
  line2?: string;
  suburb: string;
  city: string;
  postalCode: string;
  lat: number;
  lng: number;
}

export interface CreateBookingRequest {
  serviceId: Uuid;
  staffId?: Uuid | null;
  startsAt: IsoDateTime;
  address?: BookingAddress;
  message?: string;
  idempotencyKey: Uuid;
}

export interface CreateBookingResponse {
  appointment: Appointment;
  /** true when a deposit must be paid before the hold expires. */
  paymentRequired: boolean;
  holdExpiresAt: IsoDateTime | null;
}

export interface InitializePaymentRequest {
  appointmentId: Uuid;
  type: Extract<TransactionType, 'deposit' | 'balance' | 'tip'>;
  tipCents?: Cents;
  saveCard?: boolean;
  paymentMethodId?: Uuid;
}

export type InitializePaymentResponse =
  | { mode: 'redirect'; reference: string; authorizationUrl: string; accessCode: string }
  | { mode: 'charged'; reference: string; status: string };

export interface EraseAccountRequest {
  password: string;
  confirmation: 'DELETE MY ACCOUNT';
}

// =============================================================================
// Security states
// =============================================================================
export type AuthStatus = 'loading' | 'signed_out' | 'signed_in' | 'email_unconfirmed' | 'mfa_required';

export interface SessionState {
  status: AuthStatus;
  userId: Uuid | null;
  role: UserRole | null;
  /** Unix seconds; refresh proactively ~60 s before expiry. */
  expiresAt: number | null;
  mfaLevel: 'aal1' | 'aal2' | null;
}

export interface RateLimitState {
  limited: boolean;
  limit: number;
  remaining: number;
  /** Unix ms when the window resets. */
  resetAt: number;
}

export type RateLimitBucket = 'auth' | 'booking' | 'payment' | 'api';

export type Permission =
  | 'bookings:read' | 'bookings:manage' | 'services:manage' | 'staff:manage'
  | 'finance:read' | 'client_notes:read' | 'payouts:manage' | 'platform:admin';

/** UI-side capability hints. The database (RLS + RPC checks) is authoritative. */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: ['bookings:read', 'bookings:manage', 'services:manage', 'staff:manage', 'finance:read', 'client_notes:read', 'payouts:manage', 'platform:admin'],
  business_owner: ['bookings:read', 'bookings:manage', 'services:manage', 'staff:manage', 'finance:read', 'client_notes:read', 'payouts:manage'],
  staff: ['bookings:read'],
  client: [],
} as const;

export interface PopiaConsent {
  version: string;
  acceptedAt: IsoDateTime;
  marketingOptIn: boolean;
}

/** Current privacy-notice version; bump when the notice changes (forces re-consent). */
export const POPIA_CONSENT_VERSION = '2026-11';
