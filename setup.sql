-- 北科座位系統 v1。於新的 Supabase 專案 SQL Editor 以 postgres 執行。
-- 可重複執行；不刪除既有預約。所有應用資料表加上 ntut_ 前綴。
begin;
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions;

create table if not exists public.ntut_zones (
  floor text not null check (floor in ('B1','2F')),
  zone text not null check (zone in ('A','B','C')),
  description text not null,
  features text not null,
  primary key (floor,zone)
);
create table if not exists public.ntut_seats (
  id text primary key,
  floor text not null,
  zone text not null,
  label text not null,
  row_no integer not null check (row_no between 0 and 3),
  col_no integer not null check (col_no between 0 and 3),
  has_power boolean not null default false,
  is_window boolean not null default false,
  enabled boolean not null default true,
  foreign key (floor,zone) references public.ntut_zones(floor,zone),
  unique(floor,zone,label)
);
-- 延續原專案的空間配置；此為座位目錄，不是模擬預約或占用資料。
insert into public.ntut_zones values
 ('B1','A','個人靜音閱覽席 · 鄰近靠窗採光','附電源插座 · 桌面隔板'),
 ('B1','B','標準長桌閱覽席 · 中央安靜區','雙向電源 · 檯燈照明'),
 ('B1','C','深讀研究專區 · 單人獨立席','獨立檯燈 · 禁止鍵盤聲'),
 ('2F','A','開放閱覽區 · 筆電友善座位','高速 Wi-Fi · 電源插座'),
 ('2F','B','期刊與參考書閱覽席','寬敞桌面 · 自然採光'),
 ('2F','C','數位學習與多媒體輔助區','雙螢幕支架 · 電源插座')
on conflict do nothing;
insert into public.ntut_seats(id,floor,zone,label,row_no,col_no,has_power,is_window)
 select z.floor||'-'||z.zone||lpad(n::text,2,'0'),z.floor,z.zone,z.zone||lpad(n::text,2,'0'),
 (n-1)/4,(n-1)%4,(n%2=0 or (n-1)/4=0),((n-1)/4=0 or (n-1)%4=0)
 from public.ntut_zones z cross join generate_series(1,16) n
on conflict do nothing;

create table if not exists public.ntut_reservations (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 seat_id text not null references public.ntut_seats(id),
 booking_date date not null,
 start_hour integer not null check(start_hour between 8 and 21),
 end_hour integer not null check(end_hour between 9 and 22 and end_hour > start_hour and end_hour-start_hour<=6),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 status text not null default 'upcoming' check(status in ('upcoming','checked-in','cancelled','expired','finished')),
 created_at timestamptz not null default now(),
 checked_in_at timestamptz,
 updated_at timestamptz not null default now(),
 check(starts_at=(booking_date+make_time(start_hour,0,0)) at time zone 'Asia/Taipei'),
 check(ends_at=(booking_date+make_time(end_hour,0,0)) at time zone 'Asia/Taipei'),
 constraint ntut_no_seat_overlap exclude using gist
 (seat_id with =, tstzrange(starts_at,ends_at,'[)') with &&)
 where (status in ('upcoming','checked-in')),
 constraint ntut_no_user_overlap exclude using gist
 (user_id with =, tstzrange(starts_at,ends_at,'[)') with &&)
 where (status in ('upcoming','checked-in'))
);
create index if not exists ntut_reservations_user_date on public.ntut_reservations(user_id,booking_date);
create index if not exists ntut_reservations_date on public.ntut_reservations(booking_date);
-- Realtime 只公開更新計數，不公開預約者、日期、座位或其他私人資訊。
create table if not exists public.ntut_changes (
 id integer primary key check(id=1),
 revision bigint not null default 0
);
insert into public.ntut_changes(id) values(1) on conflict do nothing;

alter table public.ntut_zones enable row level security;
alter table public.ntut_seats enable row level security;
alter table public.ntut_reservations enable row level security;
alter table public.ntut_changes enable row level security;
revoke all on public.ntut_zones,public.ntut_seats,public.ntut_reservations,public.ntut_changes from public,anon,authenticated;
grant select on public.ntut_zones,public.ntut_seats,public.ntut_changes to anon,authenticated;
grant select on public.ntut_reservations to authenticated;
drop policy if exists ntut_zones_read on public.ntut_zones;
create policy ntut_zones_read on public.ntut_zones for select to anon,authenticated using(true);
drop policy if exists ntut_seats_read on public.ntut_seats;
create policy ntut_seats_read on public.ntut_seats for select to anon,authenticated using(true);
drop policy if exists ntut_changes_read on public.ntut_changes;
create policy ntut_changes_read on public.ntut_changes for select to anon,authenticated using(true);
drop policy if exists ntut_own_reservations on public.ntut_reservations;
create policy ntut_own_reservations on public.ntut_reservations for select to authenticated using(user_id=(select auth.uid()));
-- 沒有前端寫入 policy；變更只能通過下方驗證身份與規則的 RPC。

create or replace function public.ntut_notify_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.ntut_changes set revision=revision+1 where id=1;
 return null;
end $$;
revoke all on function public.ntut_notify_change() from public,anon,authenticated;
drop trigger if exists ntut_reservations_changed on public.ntut_reservations;
create trigger ntut_reservations_changed after insert or update or delete on public.ntut_reservations
 for each statement execute function public.ntut_notify_change();
drop trigger if exists ntut_seats_changed on public.ntut_seats;
create trigger ntut_seats_changed after insert or update or delete on public.ntut_seats
 for each statement execute function public.ntut_notify_change();
drop trigger if exists ntut_zones_changed on public.ntut_zones;
create trigger ntut_zones_changed after insert or update or delete on public.ntut_zones
 for each statement execute function public.ntut_notify_change();

-- 內部清理：呼叫時才實體更新狀態，查詢可用座位另以伺服器時間判斷。
create or replace function public.ntut_expire() returns void
language plpgsql security definer set search_path='' as $$
begin
 -- EXISTS 避免零筆 UPDATE 仍觸發 statement trigger，造成 Realtime 迴圈。
 if exists(select 1 from public.ntut_reservations where status='upcoming' and starts_at+interval '15 minutes'<now()) then
  update public.ntut_reservations set status='expired',updated_at=now()
  where status='upcoming' and starts_at+interval '15 minutes'<now();
 end if;
 if exists(select 1 from public.ntut_reservations where status='checked-in' and ends_at<=now()) then
  update public.ntut_reservations set status='finished',updated_at=now()
  where status='checked-in' and ends_at<=now();
 end if;
end $$;
revoke all on function public.ntut_expire() from public,anon,authenticated;

-- 匿名可查詢占用，不回傳 user_id、預約編號或建立時間。
create or replace function public.ntut_availability(p_date date)
returns table(seat_id text,start_hour integer,end_hour integer)
language plpgsql stable security definer set search_path='' as $$
begin
 if p_date is null or p_date<(now() at time zone 'Asia/Taipei')::date
 or p_date>(now() at time zone 'Asia/Taipei')::date+30 then
  raise exception '日期須在今天至未來 30 天內';
 end if;
 return query select r.seat_id,r.start_hour,r.end_hour from public.ntut_reservations r
 where r.booking_date=p_date and r.ends_at>now()
 and (r.status='checked-in' or (r.status='upcoming' and r.starts_at+interval '15 minutes'>=now()));
end $$;

create or replace function public.ntut_book(p_seat_id text,p_date date,p_start integer,p_end integer)
returns public.ntut_reservations
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_start timestamptz; v_end timestamptz; v_result public.ntut_reservations;
begin
 if v_uid is null then raise exception '請先登入'; end if;
 if p_date is null or p_start is null or p_end is null or p_start<8 or p_start>21 or p_end>22
 or p_end<=p_start or p_end-p_start>6 then raise exception '時間須為 08:00–22:00，每次最多 6 小時'; end if;
 if p_date<(now() at time zone 'Asia/Taipei')::date or p_date>(now() at time zone 'Asia/Taipei')::date+30 then
  raise exception '日期須在今天至未來 30 天內';
 end if;
 v_start:=(p_date+make_time(p_start,0,0)) at time zone 'Asia/Taipei';
 v_end:=(p_date+make_time(p_end,0,0)) at time zone 'Asia/Taipei';
 if v_start<=now() then raise exception '不能預約已開始的時段'; end if;
 -- 每個使用者序列化，避免同時送出繞過每日上限。
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
 perform public.ntut_expire();
 perform 1 from public.ntut_seats where id=p_seat_id and enabled for share;
 if not found then raise exception '座位不存在或已停用'; end if;
 if (select coalesce(sum(end_hour-start_hour),0) from public.ntut_reservations
 where user_id=v_uid and booking_date=p_date and status in ('upcoming','checked-in','finished'))+p_end-p_start>6 then
  raise exception '單日累計預約不得超過 6 小時';
 end if;
 insert into public.ntut_reservations(user_id,seat_id,booking_date,start_hour,end_hour,starts_at,ends_at)
 values(v_uid,p_seat_id,p_date,p_start,p_end,v_start,v_end) returning * into v_result;
 return v_result;
exception when exclusion_violation then
 raise exception '座位已被預約，或您在相同時段已有預約，請重新選擇';
end $$;

create or replace function public.ntut_my_reservations()
returns setof public.ntut_reservations
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception '請先登入'; end if;
 perform public.ntut_expire();
 return query select * from public.ntut_reservations where user_id=auth.uid() order by starts_at desc;
end $$;

create or replace function public.ntut_change_reservation(p_id uuid,p_action text)
returns public.ntut_reservations
language plpgsql security definer set search_path='' as $$
declare r public.ntut_reservations;
begin
 if auth.uid() is null then raise exception '請先登入'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 perform public.ntut_expire();
 select * into r from public.ntut_reservations where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception '找不到您的預約'; end if;
 if p_action='cancel' then
  if r.status<>'upcoming' then raise exception '只有待報到預約可取消'; end if;
  update public.ntut_reservations set status='cancelled',updated_at=now() where id=r.id returning * into r;
 elsif p_action='check-in' then
  if r.status<>'upcoming' then raise exception '此預約無法報到'; end if;
  if now()<r.starts_at-interval '15 minutes' or now()>r.starts_at+interval '15 minutes' then
   raise exception '請於開始前 15 分鐘至開始後 15 分鐘內報到'; end if;
  update public.ntut_reservations set status='checked-in',checked_in_at=now(),updated_at=now() where id=r.id returning * into r;
 elsif p_action='finish' then
  if r.status<>'checked-in' then raise exception '只有已報到預約可辦理離席'; end if;
  update public.ntut_reservations set status='finished',updated_at=now() where id=r.id returning * into r;
 else raise exception '不支援的操作';
 end if;
 return r;
end $$;

revoke all on function public.ntut_availability(date),public.ntut_book(text,date,integer,integer),public.ntut_my_reservations(),public.ntut_change_reservation(uuid,text) from public,anon,authenticated;
grant execute on function public.ntut_availability(date) to anon,authenticated;
grant execute on function public.ntut_book(text,date,integer,integer),public.ntut_my_reservations(),public.ntut_change_reservation(uuid,text) to authenticated;
-- Supabase 已有此 publication；本段也讓全新測試環境可執行。
do $$ begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
  create publication supabase_realtime;
 end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='ntut_changes') then
  alter publication supabase_realtime add table public.ntut_changes;
 end if;
end $$;
commit;
