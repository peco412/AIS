-- Manual attendance replaces GPS input. Historical GPS data is retained, read only.
begin;
create or replace function workspace_dept(p_code text) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from employees e join departments d on d.id=e.department_id where e.id=current_employee_id() and e.status='active' and d.code=p_code);
$$;
create table if not exists attendance_periods(
 id uuid primary key default gen_random_uuid(),employee_id uuid not null references employees(id),year int not null check(year between 2020 and 2100),month int not null check(month between 1 and 12),standard_days numeric(5,2) not null default 26 check(standard_days>0 and standard_days<=31),status text not null default 'draft' check(status in('draft','submitted','locked')),version int not null default 1,created_by uuid not null default current_employee_id() references employees(id),updated_at timestamptz not null default now(),submitted_by uuid references employees(id),locked_by uuid references employees(id),locked_at timestamptz,unique(employee_id,year,month)
);
create table if not exists attendance_days(
 period_id uuid not null references attendance_periods(id) on delete cascade,work_date date not null,status text not null check(status in('work','paid_leave','holiday','unpaid_leave','absent','off')),units numeric(3,2) not null default 1 check(units in(0,0.5,1)),note text not null default '',primary key(period_id,work_date),check((status='off' and units=0) or(status<>'off' and units>0))
);
create table if not exists attendance_audit(id bigint generated always as identity primary key,period_id uuid not null references attendance_periods(id),actor_id uuid references employees(id),action text not null,before_data jsonb,after_data jsonb,created_at timestamptz not null default now());
alter table attendance_periods enable row level security;alter table attendance_days enable row level security;alter table attendance_audit enable row level security;
create policy attendance_period_read on attendance_periods for select to authenticated using(employee_id=current_employee_id() or workspace_dept('HR') or workspace_dept('ACC') or is_executive_or_tech());
create policy attendance_day_read on attendance_days for select to authenticated using(exists(select 1 from attendance_periods p where p.id=period_id));
create policy attendance_audit_read on attendance_audit for select to authenticated using(workspace_dept('HR') or workspace_dept('ACC') or is_executive_or_tech());
-- All writes use locked RPCs; no client write policies.
create or replace function save_attendance_period(p_employee_id uuid,p_year int,p_month int,p_standard_days numeric,p_days jsonb,p_expected_version int default 0) returns uuid language plpgsql security definer set search_path=public as $$
declare v attendance_periods%rowtype;v_id uuid;v_start date;v_end date;v_item jsonb;v_date date;v_total numeric;
begin
 if not workspace_dept('HR') then raise exception 'Chỉ HCNS được lập bảng công.';end if;
 v_start:=make_date(p_year,p_month,1);v_end:=(v_start+interval '1 month')::date;
 if not exists(select 1 from employees where id=p_employee_id and status='active') then raise exception 'Nhân viên không hoạt động.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text||':'||p_year||':'||p_month,0));
 select * into v from attendance_periods where employee_id=p_employee_id and year=p_year and month=p_month for update;
 if found then
  if v.status<>'draft' then raise exception 'Bảng công đã gửi hoặc chốt, không được sửa.';end if;
  if v.version<>p_expected_version then raise exception 'Dữ liệu đã thay đổi. Tải lại trước khi lưu.';end if;
  v_id:=v.id;
 else
  if p_expected_version<>0 then raise exception 'Bảng công không còn tồn tại.';end if;
  insert into attendance_periods(employee_id,year,month,standard_days) values(p_employee_id,p_year,p_month,p_standard_days) returning id into v_id;
 end if;
 if jsonb_typeof(p_days)<>'array' or jsonb_array_length(p_days)>31 then raise exception 'Dữ liệu ngày công không hợp lệ.';end if;
 delete from attendance_days where period_id=v_id;
 for v_item in select value from jsonb_array_elements(p_days) loop
  v_date:=(v_item->>'date')::date;
  if v_date<v_start or v_date>=v_end then raise exception 'Ngày công ngoài kỳ.';end if;
  insert into attendance_days(period_id,work_date,status,units,note) values(v_id,v_date,v_item->>'status',(v_item->>'units')::numeric,coalesce(v_item->>'note',''));
 end loop;
 update attendance_periods set standard_days=p_standard_days,version=version+1,updated_at=now() where id=v_id;
 insert into attendance_audit(period_id,actor_id,action,before_data,after_data) values(v_id,current_employee_id(),'save',to_jsonb(v),p_days);
 return v_id;
end;$$;
create or replace function transition_attendance_period(p_id uuid,p_action text,p_expected_version int,p_note text default '') returns void language plpgsql security definer set search_path=public as $$
declare v attendance_periods%rowtype;v_count int;v_total numeric;
begin
 select * into v from attendance_periods where id=p_id for update;
 if not found then raise exception 'Không tìm thấy bảng công.';end if;
 if v.version<>p_expected_version then raise exception 'Dữ liệu đã thay đổi.';end if;
 if p_action='submit' then
  if not workspace_dept('HR') or v.status<>'draft' then raise exception 'Không được gửi bảng công.';end if;
  select count(*),coalesce(sum(units),0) into v_count,v_total from attendance_days where period_id=v.id;
  if v_count<>extract(day from(make_date(v.year,v.month,1)+interval '1 month - 1 day')) then raise exception 'Phải nhập mọi ngày, kể cả ngày nghỉ.';end if;
  if v_total>v.standard_days then raise exception 'Tổng đơn vị công vượt số công chuẩn.';end if;
  update attendance_periods set status='submitted',submitted_by=current_employee_id(),version=version+1,updated_at=now() where id=v.id;
 elsif p_action='lock' then
  if not workspace_dept('ACC') or v.status<>'submitted' then raise exception 'Chỉ kế toán được chốt bảng đã gửi.';end if;
  if v.submitted_by=current_employee_id() then raise exception 'Người gửi không được tự chốt.';end if;
  update attendance_periods set status='locked',locked_by=current_employee_id(),locked_at=now(),version=version+1,updated_at=now() where id=v.id;
 elsif p_action='return' then
  if not workspace_dept('ACC') or v.status<>'submitted' or length(trim(p_note))=0 then raise exception 'Chỉ kế toán được trả bảng kèm lý do.';end if;
  update attendance_periods set status='draft',version=version+1,updated_at=now() where id=v.id;
 else raise exception 'Thao tác không hợp lệ.';end if;
 insert into attendance_audit(period_id,actor_id,action,before_data,after_data) values(v.id,current_employee_id(),p_action,to_jsonb(v),jsonb_build_object('note',p_note));
end;$$;
create or replace view attendance_summary with(security_invoker=true) as
 select p.id,p.employee_id,p.year,p.month,p.standard_days,p.status,p.version,
 coalesce(sum(d.units) filter(where d.status in('work','paid_leave','holiday')),0) paid_days,
 coalesce(sum(d.units) filter(where d.status='unpaid_leave'),0) unpaid_days,
 coalesce(sum(d.units) filter(where d.status='absent'),0) absent_days,
 coalesce(sum(d.units) filter(where d.status='paid_leave'),0) leave_days,
 count(d.work_date) entered_days
 from attendance_periods p left join attendance_days d on d.period_id=p.id group by p.id;
revoke all on function save_attendance_period(uuid,int,int,numeric,jsonb,int) from public;
revoke all on function transition_attendance_period(uuid,text,int,text) from public;
grant execute on function save_attendance_period(uuid,int,int,numeric,jsonb,int),transition_attendance_period(uuid,text,int,text) to authenticated;
grant select on attendance_periods,attendance_days,attendance_audit,attendance_summary to authenticated;
-- Payroll takes the immutable locked period as its source. Never subtract leave twice.
alter table payroll add column if not exists attendance_period_id uuid references attendance_periods(id);
alter table payroll add column if not exists standard_working_days numeric(5,2) not null default 26;
alter table payroll add column if not exists paid_working_days numeric(5,2);
create table if not exists workspace_settings(id boolean primary key default true check(id),manual_payroll_from date not null default date_trunc('month',current_date)::date);
insert into workspace_settings(id) values(true) on conflict do nothing;
alter table workspace_settings enable row level security;
create policy workspace_settings_read on workspace_settings for select to authenticated using(true);
grant select on workspace_settings to authenticated;
create or replace function bind_manual_payroll() returns trigger language plpgsql security definer set search_path=public as $$
declare v attendance_summary%rowtype;v_from date;
begin
 select manual_payroll_from into v_from from workspace_settings where id=true;
 if new.attendance_period_id is null and make_date(new.year,new.month,1)>=v_from then
  select * into v from attendance_summary where employee_id=new.employee_id and year=new.year and month=new.month and status='locked';
  if not found then raise exception 'Chưa có bảng công đã chốt. Không tính lương từ GPS hoặc dữ liệu thiếu.';end if;
  new.attendance_period_id:=v.id;
 elsif new.attendance_period_id is not null then
  select * into v from attendance_summary where id=new.attendance_period_id and employee_id=new.employee_id and year=new.year and month=new.month and status='locked';
  if not found then raise exception 'Bảng công không khớp kỳ hoặc chưa chốt.';end if;
 else return new;end if;
 new.standard_working_days:=v.standard_days;new.paid_working_days:=least(v.paid_days,v.standard_days);new.absent_days:=v.absent_days;new.unpaid_leave_days:=v.unpaid_days;new.leave_days:=v.leave_days;new.absent_days_override:=null;
 return new;
end;$$;
drop trigger if exists payroll_manual_source on payroll;
create trigger payroll_manual_source before insert or update on payroll for each row execute function bind_manual_payroll();
alter table payroll drop column net_salary;
alter table payroll add column net_salary numeric(14,2) generated always as(
 case when attendance_period_id is not null then base_salary*paid_working_days/nullif(standard_working_days,0)
 else base_salary-(coalesce(absent_days_override,absent_days)+unpaid_leave_days)*(base_salary/26.0) end
 +performance_bonus+urgent_bonus+housing_allowance+transport_allowance+other_allowance-penalty_amount-advance_deduction-insurance_deduction-tax_deduction) stored;
-- Disable new GPS submissions; retain history for reconciliation.
create or replace function reject_retired_gps() returns trigger language plpgsql as $$begin raise exception 'Chấm công GPS đã ngừng. Dùng bảng công HCNS.';end;$$;
drop trigger if exists retired_gps_insert on attendance_checkins;
create trigger retired_gps_insert before insert on attendance_checkins for each row execute function reject_retired_gps();
commit;
