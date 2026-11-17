/**
 * Typed Supabase schema for `createClient<Database>()`.
 *
 * Hand-maintained to match supabase/migrations so the repo type-checks without
 * a running database. CI runs `npm run db:types` against a local stack and
 * diffs the generated file to catch drift.
 */
import type * as T from './index';

/** Converts an interface to a plain object type (satisfies Record<string, unknown>). */
type Plain<O> = { [K in keyof O]: O[K] };
type Ins<Row, Required extends keyof Row> = Plain<Pick<Row, Required> & Partial<Omit<Row, Required>>>;
type Upd<Row> = Plain<Partial<Row>>;

type Rel<FK extends string, Cols extends string[], Ref extends string, RefCols extends string[], One extends boolean = false> = {
  foreignKeyName: FK;
  columns: Cols;
  isOneToOne: One;
  referencedRelation: Ref;
  referencedColumns: RefCols;
};

export type Database = {
  public: {
    Tables: {
      categories: {
        Row: Plain<T.Category>;
        Insert: Ins<T.Category, 'slug' | 'name'>;
        Update: Upd<T.Category>;
        Relationships: [];
      };
      profiles: {
        Row: Plain<T.Profile>;
        Insert: Ins<T.Profile, 'id'>;
        Update: Upd<Pick<T.Profile, 'full_name' | 'phone' | 'avatar_url' | 'preference_notes' | 'marketing_opt_in'>>;
        Relationships: [];
      };
      businesses: {
        Row: Plain<T.Business>;
        Insert: Ins<
          Omit<T.Business, 'id' | 'owner_id' | 'is_verified' | 'platform_fee_bps' | 'paystack_subaccount_code' | 'payout_bank_name' | 'payout_account_last4' | 'is_active' | 'created_at' | 'updated_at'> & { owner_id?: string },
          'name' | 'slug' | 'category_id' | 'service_model' | 'suburb' | 'city' | 'province' | 'postal_code' | 'location'
        >;
        Update: Upd<Omit<T.Business, 'id' | 'owner_id' | 'slug' | 'is_verified' | 'platform_fee_bps' | 'paystack_subaccount_code' | 'payout_bank_name' | 'payout_account_last4' | 'created_at' | 'updated_at'>>;
        Relationships: [
          Rel<'businesses_category_id_fkey', ['category_id'], 'categories', ['id']>,
          Rel<'businesses_owner_id_fkey', ['owner_id'], 'profiles', ['id']>,
        ];
      };
      staff_members: {
        Row: Plain<T.StaffMember>;
        Insert: Ins<
          Pick<T.StaffMember, 'business_id' | 'display_name' | 'role_title' | 'avatar_url' | 'invite_email' | 'commission_bps' | 'working_hours' | 'can_view_client_notes' | 'can_manage_bookings' | 'is_active'>,
          'business_id' | 'display_name'
        >;
        Update: Upd<Pick<T.StaffMember, 'display_name' | 'role_title' | 'avatar_url' | 'invite_email' | 'commission_bps' | 'working_hours' | 'can_view_client_notes' | 'can_manage_bookings' | 'is_active'>>;
        Relationships: [
          Rel<'staff_members_business_id_fkey', ['business_id'], 'businesses', ['id']>,
          Rel<'staff_members_profile_id_fkey', ['profile_id'], 'profiles', ['id']>,
        ];
      };
      services: {
        Row: Plain<T.Service>;
        Insert: Ins<
          Pick<T.Service, 'business_id' | 'category_id' | 'title' | 'description' | 'pricing_model' | 'price_cents' | 'duration_minutes' | 'buffer_minutes' | 'deposit_percent' | 'is_active' | 'sort_order'>,
          'business_id' | 'title' | 'duration_minutes'
        >;
        Update: Upd<Pick<T.Service, 'category_id' | 'title' | 'description' | 'pricing_model' | 'price_cents' | 'duration_minutes' | 'buffer_minutes' | 'deposit_percent' | 'is_active' | 'sort_order'>>;
        Relationships: [
          Rel<'services_business_id_fkey', ['business_id'], 'businesses', ['id']>,
          Rel<'services_category_id_fkey', ['category_id'], 'categories', ['id']>,
        ];
      };
      appointments: {
        Row: Plain<T.Appointment>;
        Insert: never; // RPC-only (book_appointment / create_walk_in_appointment)
        Update: never; // RPC-only (update_appointment_status / reschedule_appointment / ...)
        Relationships: [
          Rel<'appointments_service_fk', ['service_id', 'business_id'], 'services', ['id', 'business_id']>,
          Rel<'appointments_staff_fk', ['staff_id', 'business_id'], 'staff_members', ['id', 'business_id']>,
          Rel<'appointments_client_id_fkey', ['client_id'], 'profiles', ['id']>,
          Rel<'appointments_business_id_fkey', ['business_id'], 'businesses', ['id']>,
        ];
      };
      appointment_quotes: {
        Row: Plain<T.AppointmentQuote>;
        Insert: never;
        Update: never;
        Relationships: [
          Rel<'appointment_quotes_appointment_fk', ['appointment_id', 'business_id'], 'appointments', ['id', 'business_id']>,
        ];
      };
      appointment_events: {
        Row: Plain<T.AppointmentEvent>;
        Insert: never;
        Update: never;
        Relationships: [Rel<'appointment_events_appointment_id_fkey', ['appointment_id'], 'appointments', ['id']>];
      };
      client_notes: {
        Row: Plain<T.ClientNoteMeta>;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      transactions: {
        Row: Plain<T.Transaction>;
        Insert: never;
        Update: never;
        Relationships: [
          Rel<'transactions_appointment_id_fkey', ['appointment_id'], 'appointments', ['id']>,
          Rel<'transactions_staff_id_fkey', ['staff_id'], 'staff_members', ['id']>,
        ];
      };
      staff_tips: {
        Row: Plain<T.StaffTip>;
        Insert: Ins<Pick<T.StaffTip, 'business_id' | 'staff_id' | 'appointment_id' | 'amount_cents' | 'method' | 'note' | 'recorded_by'>, 'business_id' | 'staff_id' | 'amount_cents' | 'method' | 'recorded_by'>;
        Update: never;
        Relationships: [
          Rel<'staff_tips_staff_fk', ['staff_id', 'business_id'], 'staff_members', ['id', 'business_id']>,
        ];
      };
      payment_methods: {
        Row: Plain<T.PaymentMethod>;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      audit_logs: {
        Row: Plain<T.AuditLog>;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      search_businesses: {
        Args: {
          p_lat?: number | null;
          p_lng?: number | null;
          p_radius_km?: number;
          p_category?: string | null;
          p_query?: string | null;
          p_service_model?: T.ServiceModel | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Plain<T.BusinessSearchResult>[];
      };
      get_business_public: { Args: { p_business_id: string }; Returns: Plain<T.BusinessPublic>[] };
      list_bookable_staff: { Args: { p_business_id: string }; Returns: Plain<T.BookableStaff>[] };
      get_available_slots: {
        Args: { p_service_id: string; p_date: string; p_staff_id?: string | null };
        Returns: Plain<T.AvailableSlot>[];
      };
      book_appointment: {
        Args: {
          p_service_id: string;
          p_starts_at: string;
          p_staff_id?: string | null;
          p_address?: Record<string, unknown> | null;
          p_client_message?: string | null;
          p_idempotency_key?: string | null;
          p_source?: T.BookingSource;
        };
        Returns: Plain<T.Appointment>;
      };
      create_walk_in_appointment: {
        Args: {
          p_business_id: string;
          p_service_id: string;
          p_staff_id: string;
          p_starts_at: string;
          p_walk_in_name: string;
          p_walk_in_phone?: string | null;
          p_price_cents?: number | null;
        };
        Returns: Plain<T.Appointment>;
      };
      update_appointment_status: {
        Args: { p_appointment_id: string; p_status: T.AppointmentStatus; p_reason?: string | null };
        Returns: Plain<T.Appointment>;
      };
      update_job_progress: {
        Args: { p_appointment_id: string; p_progress: T.JobProgress };
        Returns: Plain<T.Appointment>;
      };
      reschedule_appointment: {
        Args: { p_appointment_id: string; p_starts_at: string; p_staff_id?: string | null };
        Returns: Plain<T.Appointment>;
      };
      submit_quote: {
        Args: {
          p_appointment_id: string;
          p_amount_cents: number;
          p_message?: string | null;
          p_valid_hours?: number;
          p_proposed_starts_at?: string | null;
          p_proposed_staff_id?: string | null;
        };
        Returns: Plain<T.AppointmentQuote>;
      };
      respond_to_quote: { Args: { p_quote_id: string; p_accept: boolean }; Returns: Plain<T.Appointment> };
      accept_staff_invite: { Args: { p_staff_id: string }; Returns: Plain<T.StaffMember> };
      add_client_note: { Args: { p_business_id: string; p_client_id: string; p_body: string }; Returns: string };
      get_client_notes: { Args: { p_business_id: string; p_client_id: string }; Returns: Plain<T.ClientNote>[] };
      delete_client_note: { Args: { p_note_id: string }; Returns: undefined };
      get_business_dashboard_stats: { Args: { p_business_id: string; p_date?: string | null }; Returns: Plain<T.DashboardStats> };
      get_staff_earnings: {
        Args: { p_business_id: string; p_from: string; p_to: string };
        Returns: Plain<T.StaffEarningsRow>[];
      };
      export_client_data: { Args: { p_client_id?: string | null }; Returns: Plain<T.ClientDataExport> };
      anonymize_client: {
        Args: { p_client_id: string; p_reason: string; p_force?: boolean };
        Returns: Record<string, unknown>;
      };
      admin_set_user_role: { Args: { p_user_id: string; p_role: T.UserRole }; Returns: undefined };
      admin_set_business_verification: {
        Args: { p_business_id: string; p_verified: boolean; p_platform_fee_bps?: number | null };
        Returns: undefined;
      };
      verify_audit_chain: { Args: Record<string, never>; Returns: { chain_seq: number; problem: string }[] };
      write_audit_log: {
        Args: { p_action: string; p_entity_type: string; p_entity_id: string | null; p_business_id: string | null; p_metadata?: Record<string, unknown> };
        Returns: number;
      };
    };
    Enums: {
      user_role: T.UserRole;
      service_model: T.ServiceModel;
      pricing_model: T.PricingModel;
      appointment_status: T.AppointmentStatus;
      job_progress: T.JobProgress;
      deposit_status: T.DepositStatus;
      quote_status: T.QuoteStatus;
      booking_source: T.BookingSource;
      payment_provider: T.PaymentProvider;
      transaction_type: T.TransactionType;
      transaction_status: T.TransactionStatus;
      tip_method: T.TipMethod;
      sa_province: T.SaProvince;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<N extends keyof Database['public']['Tables']> = Database['public']['Tables'][N]['Row'];
export type RpcArgs<N extends keyof Database['public']['Functions']> = Database['public']['Functions'][N]['Args'];
export type RpcReturns<N extends keyof Database['public']['Functions']> = Database['public']['Functions'][N]['Returns'];
