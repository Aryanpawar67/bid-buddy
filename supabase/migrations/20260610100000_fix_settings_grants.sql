-- user_roles: authenticated only had SELECT; admins need INSERT + DELETE
-- (UPDATE not needed — role changes use delete-then-insert pattern)
GRANT INSERT, DELETE ON public.user_roles TO authenticated;

-- role_permissions: no grants existed at all
-- All authenticated users need SELECT (filtered by RLS to own role)
-- Admins need UPDATE for the permission matrix
GRANT SELECT, UPDATE ON public.role_permissions TO authenticated;

-- bid_assignments: no grants existed at all
-- Admins need INSERT + DELETE; all users need SELECT (RLS already filters)
GRANT SELECT, INSERT, DELETE ON public.bid_assignments TO authenticated;
