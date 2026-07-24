-- Add 'questionnaire' to the bid_documents type check constraint
alter table public.bid_documents
  drop constraint bid_documents_type_check;

alter table public.bid_documents
  add constraint bid_documents_type_check
    check (type in ('rfp','proposal','legal','template','reference','questionnaire'));
