
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('pre_sales','legal','finance','admin');
CREATE TYPE public.bid_type AS ENUM ('rfp','rfi','rfq','direct');
CREATE TYPE public.bid_status AS ENUM ('active','submitted','won','lost','no_go','on_hold');
CREATE TYPE public.bid_stage AS ENUM ('deal_qualification','rfi','rfp','orals','due_diligence','bafo','contract_closure','post_closure');
CREATE TYPE public.priority_level AS ENUM ('high','medium','low');
CREATE TYPE public.assigned_team AS ENUM ('pre_sales','legal','finance','product','engineering');
CREATE TYPE public.task_status AS ENUM ('pending','in_progress','done','blocked');
CREATE TYPE public.deliverable_type AS ENUM ('document','approval','review','action');
CREATE TYPE public.gonogo_decision AS ENUM ('go','conditional_go','no_go');

-- ============ updated_at helper ============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles readable by authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ============ has_role helper (security definer) ============
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid()
  ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'pre_sales' THEN 2 WHEN 'legal' THEN 3 WHEN 'finance' THEN 4 END
  LIMIT 1;
$$;

-- Allow admin policy to also let admins read all roles
CREATE POLICY "Admins can read all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ handle_new_user trigger: profile + default pre_sales role ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)), NEW.email);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'pre_sales');
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ BIDS ============
CREATE TABLE public.bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL,
  title text NOT NULL,
  type public.bid_type NOT NULL,
  value numeric(14,2) NOT NULL DEFAULT 0,
  status public.bid_status NOT NULL DEFAULT 'active',
  stage public.bid_stage NOT NULL DEFAULT 'deal_qualification',
  deadline date NOT NULL,
  clarification_deadline date,
  orals_date date,
  priority public.priority_level NOT NULL DEFAULT 'medium',
  procurement_portal text,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  hubspot_deal_id text,
  gonogo_score numeric(5,2),
  gonogo_decision public.gonogo_decision,
  gonogo_completed_at timestamptz,
  gonogo_completed_by uuid REFERENCES public.profiles(id),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bids TO authenticated;
GRANT ALL ON public.bids TO service_role;
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read bids" ON public.bids
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Pre-sales/admin can insert bids" ON public.bids
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(),'pre_sales') OR public.has_role(auth.uid(),'admin')
  );
CREATE POLICY "Pre-sales/admin can update bids" ON public.bids
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(),'pre_sales') OR public.has_role(auth.uid(),'admin')
  ) WITH CHECK (
    public.has_role(auth.uid(),'pre_sales') OR public.has_role(auth.uid(),'admin')
  );
CREATE POLICY "Admin can delete bids" ON public.bids
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER bids_updated_at BEFORE UPDATE ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX bids_stage_idx ON public.bids(stage);
CREATE INDEX bids_owner_idx ON public.bids(owner_id);
CREATE INDEX bids_deadline_idx ON public.bids(deadline);

-- ============ STAGE HISTORY ============
CREATE TABLE public.bid_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id uuid NOT NULL REFERENCES public.bids(id) ON DELETE CASCADE,
  stage public.bid_stage NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT now(),
  exited_at timestamptz,
  moved_by uuid REFERENCES public.profiles(id)
);
GRANT SELECT, INSERT, UPDATE ON public.bid_stage_history TO authenticated;
GRANT ALL ON public.bid_stage_history TO service_role;
ALTER TABLE public.bid_stage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth can read stage history" ON public.bid_stage_history
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Pre-sales/admin can write stage history" ON public.bid_stage_history
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(),'pre_sales') OR public.has_role(auth.uid(),'admin')
  );
CREATE POLICY "Pre-sales/admin can update stage history" ON public.bid_stage_history
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(),'pre_sales') OR public.has_role(auth.uid(),'admin')
  );

-- ============ QUESTIONS ============
CREATE TABLE public.bid_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id uuid NOT NULL REFERENCES public.bids(id) ON DELETE CASCADE,
  stage public.bid_stage NOT NULL,
  question_text text NOT NULL,
  assigned_team public.assigned_team NOT NULL,
  assigned_to uuid REFERENCES public.profiles(id),
  status public.task_status NOT NULL DEFAULT 'pending',
  response_text text,
  internal_notes text,
  due_date date,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bid_questions TO authenticated;
GRANT ALL ON public.bid_questions TO service_role;
ALTER TABLE public.bid_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth can read questions" ON public.bid_questions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Pre-sales/admin full write questions" ON public.bid_questions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'pre_sales') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'pre_sales') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Legal can update own team questions" ON public.bid_questions
  FOR UPDATE TO authenticated
  USING (assigned_team = 'legal' AND public.has_role(auth.uid(),'legal'))
  WITH CHECK (assigned_team = 'legal' AND public.has_role(auth.uid(),'legal'));
CREATE POLICY "Finance can update own team questions" ON public.bid_questions
  FOR UPDATE TO authenticated
  USING (assigned_team = 'finance' AND public.has_role(auth.uid(),'finance'))
  WITH CHECK (assigned_team = 'finance' AND public.has_role(auth.uid(),'finance'));

CREATE TRIGGER bid_questions_updated_at BEFORE UPDATE ON public.bid_questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX bid_questions_bid_idx ON public.bid_questions(bid_id);
CREATE INDEX bid_questions_assigned_idx ON public.bid_questions(assigned_to);

-- ============ DELIVERABLES ============
CREATE TABLE public.bid_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id uuid NOT NULL REFERENCES public.bids(id) ON DELETE CASCADE,
  stage public.bid_stage NOT NULL,
  label text NOT NULL,
  type public.deliverable_type NOT NULL DEFAULT 'action',
  status public.task_status NOT NULL DEFAULT 'pending',
  assigned_team public.assigned_team NOT NULL DEFAULT 'pre_sales',
  assigned_to uuid REFERENCES public.profiles(id),
  due_date date,
  storage_path text,
  version integer NOT NULL DEFAULT 1,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bid_deliverables TO authenticated;
GRANT ALL ON public.bid_deliverables TO service_role;
ALTER TABLE public.bid_deliverables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth can read deliverables" ON public.bid_deliverables
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Pre-sales/admin full write deliverables" ON public.bid_deliverables
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'pre_sales') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'pre_sales') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Legal can update own deliverables" ON public.bid_deliverables
  FOR UPDATE TO authenticated
  USING (assigned_team = 'legal' AND public.has_role(auth.uid(),'legal'))
  WITH CHECK (assigned_team = 'legal' AND public.has_role(auth.uid(),'legal'));
CREATE POLICY "Finance can update own deliverables" ON public.bid_deliverables
  FOR UPDATE TO authenticated
  USING (assigned_team = 'finance' AND public.has_role(auth.uid(),'finance'))
  WITH CHECK (assigned_team = 'finance' AND public.has_role(auth.uid(),'finance'));

CREATE TRIGGER bid_deliverables_updated_at BEFORE UPDATE ON public.bid_deliverables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX bid_deliverables_bid_idx ON public.bid_deliverables(bid_id);
CREATE INDEX bid_deliverables_assigned_idx ON public.bid_deliverables(assigned_to);

-- ============ ACTIVITY LOG ============
CREATE TABLE public.bid_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id uuid NOT NULL REFERENCES public.bids(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id),
  action text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.bid_activity_log TO authenticated;
GRANT ALL ON public.bid_activity_log TO service_role;
ALTER TABLE public.bid_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth can read activity" ON public.bid_activity_log
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth can insert own activity" ON public.bid_activity_log
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE INDEX bid_activity_bid_idx ON public.bid_activity_log(bid_id);
