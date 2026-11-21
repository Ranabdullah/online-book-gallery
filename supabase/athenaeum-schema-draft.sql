-- Athenaeum: private shared libraries, member-visible notes, recommendations and account progress.
-- Run only in a dedicated Athenaeum Supabase project after review.
-- No book files are made public by this migration.
create extension if not exists pgcrypto;

create table if not exists public.athenaeum_libraries (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);

create table if not exists public.athenaeum_memberships (
 library_id uuid not null references public.athenaeum_libraries(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check (role in ('owner','editor','reader')),
 created_at timestamptz not null default now(),
 primary key (library_id,user_id)
);

create table if not exists public.athenaeum_books (
 id uuid primary key default gen_random_uuid(),
 library_id uuid not null references public.athenaeum_libraries(id) on delete cascade,
 legacy_id text,
 title text not null,
 author text,
 category text,
 description text,
 summary text,
 format text not null,
 storage_path text,
 cover_path text,
 sha256 text,
 uploader_id uuid references auth.users(id),
 created_at timestamptz not null default now(),
 unique (library_id,legacy_id)
);

create table if not exists public.athenaeum_book_notes (
 id uuid primary key default gen_random_uuid(),
 library_id uuid not null references public.athenaeum_libraries(id) on delete cascade,
 book_id uuid not null references public.athenaeum_books(id) on delete cascade,
 author_id uuid not null references auth.users(id) on delete cascade,
 body text not null check (char_length(body) between 1 and 20000),
 page_label text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint athenaeum_notes_library_book_fk foreign key (book_id,library_id)
   references public.athenaeum_books(id,library_id)
);
-- Composite uniqueness for FK consistency.
create unique index if not exists athenaeum_books_id_library_idx on public.athenaeum_books(id,library_id);
create index if not exists athenaeum_notes_book_created_idx on public.athenaeum_book_notes(book_id,created_at desc);

create table if not exists public.athenaeum_recommendations (
 id uuid primary key default gen_random_uuid(),
 library_id uuid not null references public.athenaeum_libraries(id) on delete cascade,
 author_id uuid not null references auth.users(id) on delete cascade,
 matched_book_id uuid references public.athenaeum_books(id),
 suggested_title text not null,
 suggested_author text,
 comment text,
 created_at timestamptz not null default now()
);
create index if not exists athenaeum_recs_library_idx on public.athenaeum_recommendations(library_id,created_at desc);

create table if not exists public.athenaeum_reading_progress (
 user_id uuid not null references auth.users(id) on delete cascade,
 book_id uuid not null references public.athenaeum_books(id) on delete cascade,
 locator text,
 percentage numeric(5,2) check (percentage between 0 and 100),
 updated_at timestamptz not null default now(),
 primary key (user_id,book_id)
);

alter table public.athenaeum_libraries enable row level security;
alter table public.athenaeum_memberships enable row level security;
alter table public.athenaeum_books enable row level security;
alter table public.athenaeum_book_notes enable row level security;
alter table public.athenaeum_recommendations enable row level security;
alter table public.athenaeum_reading_progress enable row level security;

create policy "read own membership" on public.athenaeum_memberships for select to authenticated
using (user_id=(select auth.uid()));
create policy "member library read" on public.athenaeum_libraries for select to authenticated
using (exists (select 1 from public.athenaeum_memberships m where m.library_id=id and m.user_id=(select auth.uid())));
create policy "member books read" on public.athenaeum_books for select to authenticated
using (exists (select 1 from public.athenaeum_memberships m where m.library_id=athenaeum_books.library_id and m.user_id=(select auth.uid())));
create policy "editor books insert" on public.athenaeum_books for insert to authenticated
with check (uploader_id=(select auth.uid()) and exists (select 1 from public.athenaeum_memberships m where m.library_id=athenaeum_books.library_id and m.user_id=(select auth.uid()) and m.role in ('owner','editor')));
create policy "editor books update" on public.athenaeum_books for update to authenticated
using (exists (select 1 from public.athenaeum_memberships m where m.library_id=athenaeum_books.library_id and m.user_id=(select auth.uid()) and m.role in ('owner','editor')))
with check (exists (select 1 from public.athenaeum_memberships m where m.library_id=athenaeum_books.library_id and m.user_id=(select auth.uid()) and m.role in ('owner','editor')));

create policy "member notes read" on public.athenaeum_book_notes for select to authenticated
using (exists (select 1 from public.athenaeum_memberships m where m.library_id=athenaeum_book_notes.library_id and m.user_id=(select auth.uid())));
create policy "member notes insert" on public.athenaeum_book_notes for insert to authenticated
with check (author_id=(select auth.uid()) and exists (select 1 from public.athenaeum_memberships m where m.library_id=athenaeum_book_notes.library_id and m.user_id=(select auth.uid())));
create policy "author notes update" on public.athenaeum_book_notes for update to authenticated
using (author_id=(select auth.uid()))
with check (author_id=(select auth.uid()) and exists (select 1 from public.athenaeum_memberships m where m.library_id=athenaeum_book_notes.library_id and m.user_id=(select auth.uid())));
create policy "author notes delete" on public.athenaeum_book_notes for delete to authenticated
using (author_id=(select auth.uid()));

create policy "member recs read" on public.athenaeum_recommendations for select to authenticated
using (exists (select 1 from public.athenaeum_memberships m where m.library_id=athenaeum_recommendations.library_id and m.user_id=(select auth.uid())));
create policy "member recs insert" on public.athenaeum_recommendations for insert to authenticated
with check (author_id=(select auth.uid()) and exists (select 1 from public.athenaeum_memberships m where m.library_id=athenaeum_recommendations.library_id and m.user_id=(select auth.uid())));
create policy "author recs delete" on public.athenaeum_recommendations for delete to authenticated
using (author_id=(select auth.uid()));

create policy "own progress read" on public.athenaeum_reading_progress for select to authenticated
using (user_id=(select auth.uid()));
create policy "own progress insert" on public.athenaeum_reading_progress for insert to authenticated
with check (user_id=(select auth.uid()) and exists (
  select 1 from public.athenaeum_books b join public.athenaeum_memberships m on m.library_id=b.library_id
  where b.id=book_id and m.user_id=(select auth.uid())));
create policy "own progress update" on public.athenaeum_reading_progress for update to authenticated
using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()));
