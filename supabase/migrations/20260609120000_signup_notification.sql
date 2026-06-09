-- Notify all admin users when a new profile is created with status='pending'
CREATE OR REPLACE FUNCTION public.notify_admins_new_signup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (user_id, bid_id, type, title, body)
  SELECT ur.user_id,
         NULL,
         'new_user_signup',
         'New signup: ' || COALESCE(NEW.full_name, NEW.email),
         COALESCE(NEW.full_name, NEW.email) || ' (' || NEW.email || ') is requesting access.'
  FROM public.user_roles ur
  WHERE ur.role = 'admin';

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_profile_created_notify_admins
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.notify_admins_new_signup();
