begin;
create table employee_documents(
 id uuid primary key default gen_random_uuid(),code text not null unique,template_code text not null,creator_id uuid not null references employees(id),manager_id uuid not null references employees(id),hr_id uuid not null references employees(id),director_id uuid not null references employees(id),payload jsonb not null,source_table text,source_id uuid,current_step int not null default 0 check(current_step between 0 and 4),status text not null default 'signing' check(status in('signing','approved','rejected')),version int not null default 1,pdf_path text,reject_reason text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(creator_id<>manager_id and creator_id<>hr_id and creator_id<>director_id and manager_id<>hr_id and manager_id<>director_id and hr_id<>director_id)
);
create table employee_document_signatures(
 document_id uuid not null references employee_documents(id),step int not null check(step between 0 and 3),signer_id uuid not null references employees(id),signer_name text not null,signature_path text not null,pdf_path text not null,pdf_sha256 text not null check(pdf_sha256 ~ '^[0-9a-f]{64}$'),signed_at timestamptz not null default now(),primary key(document_id,step)
);
alter table employee_documents enable row level security;alter table employee_document_signatures enable row level security;
create policy documents_read on employee_documents for select to authenticated using(current_employee_id() in(creator_id,manager_id,hr_id,director_id) or workspace_dept('HR') or is_executive_or_tech());
create policy document_signatures_read on employee_document_signatures for select to authenticated using(exists(select 1 from employee_documents d where d.id=document_id));
grant select on employee_documents,employee_document_signatures to authenticated;
create or replace function create_employee_document(p_type text,p_data jsonb,p_manager uuid,p_hr uuid,p_director uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare v_employee employees%rowtype;v_id uuid:=gen_random_uuid();v_source uuid;v_table text;v_group text;v_days numeric;v_code text;
begin
 select * into v_employee from employees where id=current_employee_id() and status='active';
 if not found then raise exception 'Tài khoản không hoạt động.';end if;
 if not exists(select 1 from employees e join system_roles r on r.id=e.role_id where e.id=p_manager and e.status='active' and ((e.department_id=v_employee.department_id and r.code in('DEPT_HEAD','DEPT_DEPUTY')) or(e.center_id=v_employee.center_id and r.code='CENTER_MANAGER'))) then raise exception 'Quản lý không đúng đơn vị.';end if;
 if not exists(select 1 from employees e join departments d on d.id=e.department_id join system_roles r on r.id=e.role_id where e.id=p_hr and d.code='HR' and r.code in('DEPT_HEAD','DEPT_DEPUTY') and e.status='active') then raise exception 'Người ký HCNS không hợp lệ.';end if;
 if not exists(select 1 from employees e join system_roles r on r.id=e.role_id where e.id=p_director and r.code='EXECUTIVE' and e.status='active') then raise exception 'Giám đốc không hợp lệ.';end if;
 if p_type in('06.Donxinhoandoingaynghi','07.Donxinnghiphepcanbo','08.Donxinnghibu','09.Donxinnghikhongluongcanbo','10.Donxinhoandoilichdaydaybu','11.Donxinnghiphep','12.Donxinnghibu','13.Donxinnghikhongluonggiaovien') then
  v_days:=(p_data->>'days')::numeric;if v_days<=0 or v_days>366 or mod(v_days*2,1)<>0 then raise exception 'Số ngày không hợp lệ.';end if;
  if length(trim(coalesce(p_data->>'reason_note','')))=0 then raise exception 'Thiếu lý do.';end if;
  if nullif(p_data->>'return_date','')::date<(p_data->>'start_date')::date then raise exception 'Ngày đi làm lại không hợp lệ.';end if;
  v_group:=case when left(p_type,2)::int>=10 then 'teacher' else 'office' end;
  insert into leave_requests(employee_id,form_code,staff_group,leave_type,start_date,days,return_date,reason_note,detail_items,status)
   values(v_employee.id,p_type,v_group,case when p_type in('09.Donxinnghikhongluongcanbo','13.Donxinnghikhongluonggiaovien') then 'unpaid'::leave_type else 'annual'::leave_type end,(p_data->>'start_date')::date,v_days,nullif(p_data->>'return_date','')::date,p_data->>'reason_note',jsonb_build_array(p_data),'draft') returning id into v_source;
  v_table:='leave_requests';
 elsif p_type='business_trip' then
  v_days:=(p_data->>'days')::numeric;if v_days<=0 or v_days>366 then raise exception 'Số ngày không hợp lệ.';end if;
  insert into business_trips(employee_id,title,content,origin_address,destination_address,distance_km,trip_date,days,status) values(v_employee.id,p_data->>'title',p_data->>'content',p_data->>'origin_address',p_data->>'destination_address',nullif(p_data->>'distance_km','')::numeric,(p_data->>'trip_date')::date,v_days,'draft') returning id into v_source;
  v_table:='business_trips';
 elsif p_type='administrative_request' then
  if length(trim(coalesce(p_data->>'title','')))=0 or length(trim(coalesce(p_data->>'content','')))=0 then raise exception 'Thiếu nội dung đơn.';end if;
 else raise exception 'Mẫu đơn không hợp lệ.';end if;
 v_code:='AIS-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(v_id::text,'-',''),1,12));
 insert into employee_documents(id,code,template_code,creator_id,manager_id,hr_id,director_id,payload,source_table,source_id) values(v_id,v_code,p_type,v_employee.id,p_manager,p_hr,p_director,p_data,v_table,v_source);
 return v_id;
end;$$;
create or replace function sign_employee_document(p_id uuid,p_step int,p_expected_version int,p_pdf_path text,p_sha256 text,p_signature_path text) returns void language plpgsql security definer set search_path=public as $$
declare v employee_documents%rowtype;v_signer uuid;v_employee employees%rowtype;v_next uuid;
begin
 select * into v from employee_documents where id=p_id for update;
 if not found or v.status<>'signing' or v.current_step<>p_step or v.version<>p_expected_version then raise exception 'Hồ sơ đã đổi trạng thái. Tải lại trước khi ký.';end if;
 v_signer:=case p_step when 0 then v.creator_id when 1 then v.manager_id when 2 then v.hr_id when 3 then v.director_id end;
 select * into v_employee from employees where id=current_employee_id() and status='active';
 if v_signer is distinct from v_employee.id or v_employee.signature_url is null then raise exception 'Không đến lượt ký hoặc chưa cập nhật chữ ký.';end if;
 if p_step=1 and not is_direct_manager_of(v.creator_id) then raise exception 'Quyền quản lý đã thay đổi.';end if;
 if p_step=2 and (not workspace_dept('HR') or current_role_code() not in('DEPT_HEAD','DEPT_DEPUTY')) then raise exception 'Không còn quyền HCNS.';end if;
 if p_step=3 and current_role_code()<>'EXECUTIVE' then raise exception 'Không còn quyền Giám đốc.';end if;
 if p_pdf_path not like 'employee-documents/'||v.id::text||'/'||p_step||'-%' or not exists(select 1 from storage.objects where bucket_id='attachments' and name=p_pdf_path) then raise exception 'File PDF chưa được lưu.';end if;
 if p_signature_path not like 'employee-documents/'||v.id::text||'/signatures/'||p_step||'-%' or not exists(select 1 from storage.objects where bucket_id='attachments' and name=p_signature_path) then raise exception 'Chữ ký chưa được lưu.';end if;
 perform set_config('ais.document_sync',v.id::text,true);
 if v.source_table='leave_requests' then
  if p_step=0 then update leave_requests set status='submitted',file_url=p_pdf_path where id=v.source_id;
  elsif p_step=1 then update leave_requests set status='approved_1',level1_approver_id=v_employee.id,level1_approved_at=now(),file_url=p_pdf_path where id=v.source_id;
  elsif p_step=2 then update leave_requests set status='approved_2',level2_approver_id=v_employee.id,level2_approved_at=now(),file_url=p_pdf_path where id=v.source_id;
  else perform finalize_leave_request_v2(v.source_id);update leave_requests set file_url=p_pdf_path where id=v.source_id;end if;
 elsif v.source_table='business_trips' then
  if p_step=0 then update business_trips set status='submitted',attachment_url=p_pdf_path where id=v.source_id;
  elsif p_step=1 then update business_trips set status='approved_1',manager_signed_by=v_employee.id,manager_signed_at=now(),attachment_url=p_pdf_path where id=v.source_id;
  elsif p_step=2 then update business_trips set status='approved_2',hr_signed_by=v_employee.id,hr_signed_at=now(),attachment_url=p_pdf_path where id=v.source_id;
  else update business_trips set status='approved_3',approved_by=v_employee.id,approved_at=now(),attachment_url=p_pdf_path where id=v.source_id;end if;
 end if;
 insert into employee_document_signatures(document_id,step,signer_id,signer_name,signature_path,pdf_path,pdf_sha256) values(v.id,p_step,v_employee.id,v_employee.full_name,p_signature_path,p_pdf_path,p_sha256);
 update employee_documents set current_step=p_step+1,status=case when p_step=3 then 'approved' else 'signing' end,version=version+1,pdf_path=p_pdf_path,updated_at=now() where id=v.id;
 if p_step<3 then
  v_next:=case p_step when 0 then v.manager_id when 1 then v.hr_id when 2 then v.director_id end;
  insert into notifications(scope,target_employee_id,title,content,link_url,created_by) values('personal',v_next,'Hồ sơ cần ký duyệt',v.code||' đã đến lượt bạn.','/documents.html',v_employee.id);
 end if;
end;$$;
create or replace function reject_employee_document(p_id uuid,p_expected_version int,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare v employee_documents%rowtype;v_signer uuid;
begin
 select * into v from employee_documents where id=p_id for update;
 if not found or v.status<>'signing' or v.version<>p_expected_version or v.current_step=0 then raise exception 'Không thể từ chối hồ sơ.';end if;
 v_signer:=case v.current_step when 1 then v.manager_id when 2 then v.hr_id when 3 then v.director_id end;
 if v_signer<>current_employee_id() or length(trim(p_reason))=0 then raise exception 'Không đúng người duyệt hoặc thiếu lý do.';end if;
 perform set_config('ais.document_sync',v.id::text,true);
 if v.source_table='leave_requests' then update leave_requests set status='rejected',reject_reason=p_reason,rejected_by=v_signer,rejected_at=now() where id=v.source_id;
 elsif v.source_table='business_trips' then update business_trips set status='rejected' where id=v.source_id;end if;
 update employee_documents set status='rejected',reject_reason=p_reason,version=version+1,updated_at=now() where id=v.id;
 insert into notifications(scope,target_employee_id,title,content,link_url,created_by) values('personal',v.creator_id,'Hồ sơ bị từ chối',v.code||': '||p_reason,'/documents.html',v_signer);
end;$$;
-- Linked source records cannot bypass their document signature workflow.
create or replace function guard_document_source() returns trigger language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 select id into v_id from employee_documents where source_table=tg_table_name and source_id=old.id;
 if v_id is not null and coalesce(current_setting('ais.document_sync',true),'')<>v_id::text then raise exception 'Hồ sơ này phải xử lý tại Mẫu đơn & ký duyệt.';end if;
 return new;
end;$$;
create trigger document_leave_guard before update on leave_requests for each row execute function guard_document_source();
create trigger document_trip_guard before update on business_trips for each row execute function guard_document_source();
revoke all on function create_employee_document(text,jsonb,uuid,uuid,uuid),sign_employee_document(uuid,int,int,text,text,text),reject_employee_document(uuid,int,text) from public;
grant execute on function create_employee_document(text,jsonb,uuid,uuid,uuid),sign_employee_document(uuid,int,int,text,text,text),reject_employee_document(uuid,int,text) to authenticated;
-- Restrictive policies supplement the existing attachments policies.
create or replace function workspace_document_storage_allowed(p_name text,p_write boolean) returns boolean language plpgsql stable security definer set search_path=public as $$
declare v employee_documents%rowtype;v_id text;v_signer uuid;
begin
 v_id:=split_part(p_name,'/',2);
 if v_id !~ '^[0-9a-f-]{36}$' then return false;end if;
 select * into v from employee_documents where id=v_id::uuid;if not found then return false;end if;
 if not p_write then return current_employee_id() in(v.creator_id,v.manager_id,v.hr_id,v.director_id) or workspace_dept('HR') or is_executive_or_tech();end if;
 v_signer:=case v.current_step when 0 then v.creator_id when 1 then v.manager_id when 2 then v.hr_id when 3 then v.director_id end;
 return v.status='signing' and v_signer=current_employee_id() and (p_name like 'employee-documents/'||v.id::text||'/'||v.current_step||'-%' or p_name like 'employee-documents/'||v.id::text||'/signatures/'||v.current_step||'-%');
end;$$;
create policy workspace_document_storage_read on storage.objects as restrictive for select to authenticated using(bucket_id<>'attachments' or name not like 'employee-documents/%' or workspace_document_storage_allowed(name,false));
create policy workspace_document_storage_insert on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'attachments' or name not like 'employee-documents/%' or workspace_document_storage_allowed(name,true));
create policy workspace_document_storage_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'attachments' or name not like 'employee-documents/%') with check(bucket_id<>'attachments' or name not like 'employee-documents/%');
create policy workspace_document_storage_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'attachments' or name not like 'employee-documents/%');
commit;
