-- Allow pre_sales and admin to update (overwrite) existing objects in bid-documents.
-- Required for upsert: true when a file at the same path already exists.
create policy "pre_sales and admin can update bid-documents"
  on storage.objects for update
  using (
    bucket_id = 'bid-documents'
    and auth.uid() is not null
    and exists (
      select 1 from public.user_roles
      where user_id = auth.uid()
      and role in ('pre_sales', 'admin')
    )
  )
  with check (
    bucket_id = 'bid-documents'
    and auth.uid() is not null
    and exists (
      select 1 from public.user_roles
      where user_id = auth.uid()
      and role in ('pre_sales', 'admin')
    )
  );
