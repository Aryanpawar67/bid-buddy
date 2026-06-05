-- ============ NOTIFICATIONS TABLE ============
CREATE TABLE public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bid_id     uuid REFERENCES public.bids(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_idx ON public.notifications(user_id);
CREATE INDEX notifications_unread_idx ON public.notifications(user_id, read) WHERE read = false;

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============ HELPER: fan out to all pre_sales + admin ============
CREATE OR REPLACE FUNCTION public.notify_eligible_users(
  _bid_id   uuid,
  _type     text,
  _title    text,
  _body     text,
  _actor_id uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, bid_id, type, title, body)
  SELECT ur.user_id, _bid_id, _type, _title, _body
  FROM public.user_roles ur
  WHERE ur.role IN ('pre_sales', 'admin')
    AND (_actor_id IS NULL OR ur.user_id <> _actor_id);
END;
$$;

-- ============ TRIGGER 1: stage change ============
CREATE OR REPLACE FUNCTION public._trigger_notify_stage_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid;
BEGIN
  IF NEW.stage = OLD.stage THEN RETURN NEW; END IF;
  BEGIN _actor := (current_setting('request.jwt.claims', true)::json->>'sub')::uuid;
  EXCEPTION WHEN OTHERS THEN _actor := NULL; END;
  PERFORM public.notify_eligible_users(
    NEW.id,
    'stage_change',
    NEW.client_name || ' moved to ' || NEW.stage,
    'Stage changed from ' || OLD.stage,
    _actor
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_stage_change
  AFTER UPDATE OF stage ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public._trigger_notify_stage_change();

-- ============ TRIGGER 2: bid created ============
CREATE OR REPLACE FUNCTION public._trigger_notify_bid_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid;
BEGIN
  BEGIN _actor := (current_setting('request.jwt.claims', true)::json->>'sub')::uuid;
  EXCEPTION WHEN OTHERS THEN _actor := NULL; END;
  PERFORM public.notify_eligible_users(
    NEW.id,
    'bid_created',
    'New pursuit: ' || NEW.title,
    'Created for ' || NEW.client_name,
    _actor
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_bid_created
  AFTER INSERT ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public._trigger_notify_bid_created();

-- ============ TRIGGER 3: Go/No-Go decision ============
CREATE OR REPLACE FUNCTION public._trigger_notify_gonogo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid;
BEGIN
  IF OLD.gonogo_decision IS NOT NULL OR NEW.gonogo_decision IS NULL THEN RETURN NEW; END IF;
  BEGIN _actor := (current_setting('request.jwt.claims', true)::json->>'sub')::uuid;
  EXCEPTION WHEN OTHERS THEN _actor := NULL; END;
  PERFORM public.notify_eligible_users(
    NEW.id,
    'gonogo',
    NEW.client_name || ' — Go/No-Go: ' || NEW.gonogo_decision,
    'Decision recorded on ' || NEW.client_name,
    _actor
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_gonogo
  AFTER UPDATE OF gonogo_decision ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public._trigger_notify_gonogo();

-- ============ TRIGGER 4a: question done ============
CREATE OR REPLACE FUNCTION public._trigger_notify_question_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor  uuid;
  _client text;
BEGIN
  IF OLD.status = 'done' OR NEW.status <> 'done' THEN RETURN NEW; END IF;
  SELECT client_name INTO _client FROM public.bids WHERE id = NEW.bid_id;
  BEGIN _actor := (current_setting('request.jwt.claims', true)::json->>'sub')::uuid;
  EXCEPTION WHEN OTHERS THEN _actor := NULL; END;
  PERFORM public.notify_eligible_users(
    NEW.bid_id,
    'task_done',
    _client || ' — task completed',
    '"' || left(NEW.question_text, 60) || '" marked done',
    _actor
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_question_done
  AFTER UPDATE OF status ON public.bid_questions
  FOR EACH ROW EXECUTE FUNCTION public._trigger_notify_question_done();

-- ============ TRIGGER 4b: deliverable done ============
CREATE OR REPLACE FUNCTION public._trigger_notify_deliverable_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor  uuid;
  _client text;
BEGIN
  IF OLD.status = 'done' OR NEW.status <> 'done' THEN RETURN NEW; END IF;
  SELECT client_name INTO _client FROM public.bids WHERE id = NEW.bid_id;
  BEGIN _actor := (current_setting('request.jwt.claims', true)::json->>'sub')::uuid;
  EXCEPTION WHEN OTHERS THEN _actor := NULL; END;
  PERFORM public.notify_eligible_users(
    NEW.bid_id,
    'task_done',
    _client || ' — task completed',
    '"' || left(NEW.label, 60) || '" marked done',
    _actor
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_deliverable_done
  AFTER UPDATE OF status ON public.bid_deliverables
  FOR EACH ROW EXECUTE FUNCTION public._trigger_notify_deliverable_done();
