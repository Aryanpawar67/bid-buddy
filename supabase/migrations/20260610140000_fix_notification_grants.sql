-- Grant INSERT so client-side deadline notifier (useDeadlineNotifier) can create notifications.
-- Grant DELETE so the approve flow can clean up signup notifications.
GRANT INSERT, DELETE ON public.notifications TO authenticated;

-- RLS: users may insert notifications addressed to themselves
CREATE POLICY "Users insert own notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- RLS: users may delete their own notifications (e.g. admin clearing signup alerts on approve)
CREATE POLICY "Users delete own notifications" ON public.notifications
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
