-- =============================================================================
-- Khula — 0700 Tighten anonymous EXECUTE (Supabase security advisor 0028)
--
-- Anonymous visitors only need:
--   * the public discovery RPCs (search_businesses, get_business_public,
--     list_bookable_staff, get_available_slots), and
--   * is_business_public / is_business_member, which the services_select_public
--     RLS policy evaluates as the anon role.
-- Every other helper is internal. SECURITY DEFINER helpers call each other as
-- the function owner, so anon never needs EXECUTE on the inner ones.
-- =============================================================================

revoke execute on function
  public.is_admin(),
  public.is_business_owner(uuid),
  public.can_manage_bookings(uuid),
  public.can_view_client_notes(uuid),
  public.current_staff_id(uuid),
  public.can_view_profile(uuid),
  public.is_service_role(),
  public.is_privileged_context(),
  public.try_uuid(text),
  public.app_timezone(),
  public.is_plain_text(text),
  public.is_valid_working_hours(jsonb),
  public.is_valid_appointment_transition(public.appointment_status, public.appointment_status)
from anon;
