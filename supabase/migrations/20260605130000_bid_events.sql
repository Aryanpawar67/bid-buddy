CREATE TABLE public.bid_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  event_date  timestamptz NOT NULL,
  created_by  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bid_events_created_by_idx ON public.bid_events(created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bid_events TO authenticated;
GRANT ALL ON public.bid_events TO service_role;
ALTER TABLE public.bid_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All users read bid_events" ON public.bid_events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users insert own events" ON public.bid_events
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users update own events" ON public.bid_events
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users delete own events" ON public.bid_events
  FOR DELETE TO authenticated USING (created_by = auth.uid());
