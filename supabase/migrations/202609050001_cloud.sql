-- Firebase UID is TEXT, never auth.uid() (which assumes UUID).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create function public.current_uid() returns text language sql stable as $$ select auth.jwt()->>'sub' $$;
create function public.app_role() returns text language sql stable as $$ select auth.jwt()->>'app_role' $$;
create table public.profiles (
 firebase_uid text primary key, email text not null unique,
 full_name text not null check(length(full_name) between 1 and 100),
 role text not null check(role in ('student','teacher','admin')),
 avatar_url text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(length(firebase_uid) between 1 and 128), check(length(email) between 3 and 320)
);
create table public.quizzes (
 id uuid primary key default gen_random_uuid(), teacher_uid text not null references public.profiles,
 title text not null check(length(title) between 1 and 300), subject text not null check(length(subject) between 1 and 100),
 description text not null default '' check(length(description)<=5000), code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),
 status text not null check(status in ('draft','published','closed')),
 settings jsonb not null check(jsonb_typeof(settings)='object'), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 legacy_id text, unique(teacher_uid,legacy_id)
);
create table public.questions (
 id uuid primary key default gen_random_uuid(), quiz_id uuid not null references public.quizzes on delete cascade,
 ordinal integer not null check(ordinal>0), content text not null check(length(content) between 1 and 20000), type text not null check(type in ('single_choice','multiple_choice','true_false')),
 options jsonb not null check(jsonb_typeof(options)='array'), points numeric not null check(points>0), legacy_id text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(quiz_id,ordinal), unique(quiz_id,legacy_id)
);
create table public.question_answer_keys (
 question_id uuid primary key references public.questions on delete cascade,
 correct_answers jsonb not null check(jsonb_typeof(correct_answers)='array' and jsonb_array_length(correct_answers) between 1 and 4), explanation text not null default '' check(length(explanation)<=20000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.exam_attempts (
 id uuid primary key default gen_random_uuid(), quiz_id uuid not null references public.quizzes,
 student_uid text not null references public.profiles, student_name text not null, student_class text,
 started_at timestamptz not null default now(), ends_at timestamptz, submitted_at timestamptz,
 duration_minutes integer not null, pass_percentage numeric not null, allow_review boolean not null,
 question_order uuid[] not null, option_order jsonb not null default '{}',
 flagged_ids jsonb not null default '[]', current_index integer not null default 0,
 revision integer not null default 0, updated_at timestamptz not null default now(), legacy_id text,
 check(duration_minutes between 0 and 1440), check(pass_percentage between 0 and 100),
 check(current_index>=0), check(revision>=0),
 unique(student_uid,legacy_id)
);
create unique index one_active_attempt on public.exam_attempts(quiz_id,student_uid) where submitted_at is null;
create index attempts_student on public.exam_attempts(student_uid);
create index attempts_quiz on public.exam_attempts(quiz_id);
create index quizzes_teacher on public.quizzes(teacher_uid);
create table public.exam_answers (
 attempt_id uuid not null references public.exam_attempts on delete cascade,
 question_id uuid not null references public.questions,
 selected_answers jsonb not null check(jsonb_typeof(selected_answers)='array'), updated_at timestamptz not null default now(),
 primary key(attempt_id,question_id)
);
create table public.exam_results (
 id uuid primary key default gen_random_uuid(), attempt_id uuid not null unique references public.exam_attempts,
 payload jsonb not null check(jsonb_typeof(payload)='object'), created_at timestamptz not null default now()
);
create table public.data_migrations (
 firebase_uid text not null references public.profiles, source_id text not null,
 version integer not null default 1 check(version>0), status text not null check(status in ('partial','completed')), report jsonb not null default '{}' check(jsonb_typeof(report)='object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(length(source_id) between 1 and 200), primary key(firebase_uid,source_id,version)
);
create table private.ai_limits (uid text primary key, bucket timestamptz not null, requests integer not null);
grant usage on schema private to service_role;
grant select,insert,update on private.ai_limits to service_role;

-- Match the server-maintained profile too: demotion takes effect even for old tokens.
create function public.has_role(roles text[]) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where firebase_uid=public.current_uid() and role=public.app_role() and role=any(roles))
$$;
create function public.owns_quiz(qid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_role(array['admin']) or (public.has_role(array['teacher']) and exists(select 1 from public.quizzes where id=qid and teacher_uid=public.current_uid()))
$$;
create function public.can_read_quiz(qid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.owns_quiz(qid) or (public.has_role(array['student']) and exists(select 1 from public.quizzes q where q.id=qid and (q.status='published' or exists(select 1 from public.exam_attempts a where a.quiz_id=qid and a.student_uid=public.current_uid()))))
$$;
alter table public.profiles enable row level security;
alter table public.quizzes enable row level security;
alter table public.questions enable row level security;
alter table public.question_answer_keys enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.exam_answers enable row level security;
alter table public.exam_results enable row level security;
alter table public.data_migrations enable row level security;
alter table private.ai_limits enable row level security;
create policy profile_read on public.profiles for select to authenticated using(firebase_uid=public.current_uid() or public.has_role(array['admin']));
create policy quiz_read on public.quizzes for select to authenticated using(public.can_read_quiz(id));
create policy question_read on public.questions for select to authenticated using(public.can_read_quiz(quiz_id));
create policy answer_key_read on public.question_answer_keys for select to authenticated using(exists(select 1 from public.questions q where q.id=question_id and public.owns_quiz(q.quiz_id)));
create policy attempt_read on public.exam_attempts for select to authenticated using(student_uid=public.current_uid() or public.owns_quiz(quiz_id));
create policy answer_read on public.exam_answers for select to authenticated using(exists(select 1 from public.exam_attempts a where a.id=attempt_id and (a.student_uid=public.current_uid() or public.owns_quiz(a.quiz_id))));
create policy migration_read on public.data_migrations for select to authenticated using(firebase_uid=public.current_uid());
-- All writes and result reads go through checked RPCs. No student can rewrite timers, owner, review flag or scores.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles,public.quizzes,public.questions,public.question_answer_keys,public.exam_attempts,public.exam_answers,public.data_migrations to authenticated;

create function public.update_my_profile(p_name text, p_avatar text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles;
begin
 if public.current_uid() is null then raise exception 'Chưa đăng nhập'; end if;
 update public.profiles set full_name=trim(p_name),avatar_url=p_avatar,updated_at=now() where firebase_uid=public.current_uid() returning * into p;
 if not found then raise exception 'Chưa có hồ sơ'; end if;
 return to_jsonb(p);
end $$;

create function public.list_quizzes() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'title',q.title,'subject',q.subject,'description',q.description,
 'teacherId',q.teacher_uid,'teacherName',p.full_name,'code',q.code,'status',q.status,'settings',q.settings,
 'createdAt',q.created_at,'updatedAt',q.updated_at,'totalQuestions',(select count(*) from public.questions where quiz_id=q.id),
 'totalPoints',(select coalesce(sum(points),0) from public.questions where quiz_id=q.id),
 'questions',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'order',x.ordinal,'content',x.content,'type',x.type,'options',x.options,'points',x.points,
 'correctAnswers',case when public.owns_quiz(q.id) then k.correct_answers else '[]'::jsonb end,
 'explanation',case when public.owns_quiz(q.id) then k.explanation else null end) order by x.ordinal),'[]') from public.questions x left join public.question_answer_keys k on k.question_id=x.id where x.quiz_id=q.id)) order by q.created_at desc),'[]')
 from public.quizzes q join public.profiles p on p.firebase_uid=q.teacher_uid where public.can_read_quiz(q.id)
$$;

create function public.save_quiz(p_data jsonb, p_id uuid default null, p_legacy_id text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare qid uuid; item jsonb; opt jsonb; qkey uuid; n integer:=0; st jsonb:=p_data->'settings';
begin
 if not public.has_role(array['teacher','admin']) then raise exception 'Chỉ giáo viên được tạo đề'; end if;
 if p_id is not null and not public.owns_quiz(p_id) then raise exception 'Không có quyền sửa đề'; end if;
 if jsonb_typeof(p_data->'questions') is distinct from 'array' or jsonb_array_length(p_data->'questions') not between 1 and 500 then raise exception 'Đề phải có 1-500 câu'; end if;
 if st is null or (st->>'durationMinutes')::integer is null or (st->>'maxAttempts')::integer is null or (st->>'passPercentage')::numeric is null
 or (st->>'durationMinutes')::integer not between 0 and 1440 or (st->>'maxAttempts')::integer not between 0 and 100
 or (st->>'passPercentage')::numeric not between 0 and 100 then raise exception 'Cấu hình đề không hợp lệ'; end if;
 if p_legacy_id is not null then
  perform pg_advisory_xact_lock(hashtextextended(public.current_uid()||p_legacy_id,0));
  select id into qid from public.quizzes where teacher_uid=public.current_uid() and legacy_id=p_legacy_id;
  if found then return qid; end if;
 end if;
 if p_id is not null then
  perform 1 from public.quizzes where id=p_id for update;
  if exists(select 1 from public.exam_attempts where quiz_id=p_id) then raise exception 'Đề đã có lượt làm: hãy nhân bản để chỉnh sửa nội dung'; end if;
  update public.quizzes set title=trim(p_data->>'title'),subject=trim(p_data->>'subject'),description=coalesce(p_data->>'description',''),settings=st,status=p_data->>'status',updated_at=now() where id=p_id;
  qid:=p_id;
  delete from public.questions where quiz_id=qid;
 else
  insert into public.quizzes(teacher_uid,title,subject,description,status,settings,legacy_id) values(public.current_uid(),trim(p_data->>'title'),trim(p_data->>'subject'),coalesce(p_data->>'description',''),coalesce(p_data->>'status','draft'),st,p_legacy_id) returning id into qid;
 end if;
 for item in select value from jsonb_array_elements(p_data->'questions') loop
  n:=n+1;
  if length(trim(coalesce(item->>'content','')))=0 or jsonb_typeof(item->'options') is distinct from 'array'
  or jsonb_array_length(item->'options') not between 2 and 4 or jsonb_typeof(item->'correctAnswers') is distinct from 'array'
  or jsonb_array_length(item->'correctAnswers') not between 1 and 4 then raise exception 'Câu hỏi hoặc đáp án không hợp lệ'; end if;
  if (select count(distinct v->>'id') from jsonb_array_elements(item->'options') v) <> jsonb_array_length(item->'options') then raise exception 'Phương án bị trùng'; end if;
  for opt in select value from jsonb_array_elements(item->'options') loop
   if coalesce(opt->>'id','') not in ('A','B','C','D') or length(trim(coalesce(opt->>'content','')))=0 then raise exception 'Phương án không hợp lệ'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements_text(item->'correctAnswers') v where not exists(select 1 from jsonb_array_elements(item->'options') o where o->>'id'=v))
  or (item->>'type'<>'multiple_choice' and jsonb_array_length(item->'correctAnswers')<>1) then raise exception 'Đáp án không khớp phương án'; end if;
  insert into public.questions(quiz_id,ordinal,content,type,options,points,legacy_id) values(qid,n,item->>'content',item->>'type',item->'options',(item->>'points')::numeric,item->>'id') returning id into qkey;
  insert into public.question_answer_keys(question_id,correct_answers,explanation) values(qkey,item->'correctAnswers',coalesce(item->>'explanation',''));
 end loop;
 if p_legacy_id is not null then
 insert into public.data_migrations(firebase_uid,source_id,status,report) values(public.current_uid(),p_legacy_id,'completed',jsonb_build_object('quizId',qid)) on conflict do nothing;
 end if;
 return qid;
end $$;

create function public.set_quiz_status(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.owns_quiz(p_id) then raise exception 'Không có quyền'; end if;
 update public.quizzes set status=p_status,updated_at=now() where id=p_id;
end $$;
create function public.delete_quiz(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.owns_quiz(p_id) then raise exception 'Không có quyền'; end if;
 if exists(select 1 from public.exam_attempts where quiz_id=p_id) then raise exception 'Đề đã có bài làm. Hãy đóng đề để giữ kết quả'; end if;
 delete from public.quizzes where id=p_id;
end $$;

create function public.import_legacy_attempt(p_legacy_id text,p_quiz_legacy_id text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quizzes; a public.exam_attempts; item record; mapped uuid; ids uuid[]; answers jsonb:='{}'::jsonb; duration integer; submitted boolean; v text;
begin
 if not public.has_role(array['student']) then raise exception 'Chỉ học sinh được import bài làm'; end if;
 if p_legacy_id is null or length(p_legacy_id)>200 or p_quiz_legacy_id is null then raise exception 'Dữ liệu migration không hợp lệ'; end if;
 select * into q from public.quizzes where legacy_id=p_quiz_legacy_id limit 1;
 if not found then raise exception 'Không tìm thấy đề cũ đã import'; end if;
 select * into a from public.exam_attempts where student_uid=public.current_uid() and legacy_id=p_legacy_id;
 if found then return private.session_json(a); end if;
 select array_agg(id order by ordinal) into ids from public.questions where quiz_id=q.id;
 if ids is null or array_length(ids,1)=0 then raise exception 'Đề chưa có câu hỏi'; end if;
 for item in select * from jsonb_each(coalesce(p_data->'answers','{}'::jsonb)) loop
  select id into mapped from public.questions where quiz_id=q.id and legacy_id=item.key;
  if mapped is not null then
   if jsonb_typeof(item.value)<>'array' or jsonb_array_length(item.value)>4
   or ((select type from public.questions where id=mapped)<>'multiple_choice' and jsonb_array_length(item.value)>1) then
    raise exception 'Đáp án migration không hợp lệ';
   end if;
   for v in select value from jsonb_array_elements_text(item.value) as values(value) loop
    if not exists(select 1 from public.questions x,jsonb_array_elements(x.options) o where x.id=mapped and o->>'id'=v) then
     raise exception 'Phương án migration không hợp lệ';
    end if;
   end loop;
   answers:=answers || jsonb_build_object(mapped::text,item.value);
  end if;
 end loop;
 duration:=(q.settings->>'durationMinutes')::integer;
 submitted:=coalesce((p_data->>'isSubmitted')::boolean,false);
 insert into public.exam_attempts(quiz_id,student_uid,student_name,student_class,started_at,ends_at,submitted_at,duration_minutes,pass_percentage,allow_review,question_order,legacy_id)
 values(q.id,public.current_uid(),(select full_name from public.profiles where firebase_uid=public.current_uid()),left(p_data->>'studentClass',100),coalesce(to_timestamp(((p_data->>'startTime')::numeric)/1000),now()),case when duration=0 then null else coalesce(to_timestamp(((p_data->>'endTime')::numeric)/1000),now()+make_interval(mins=>duration)) end,case when submitted then now() else null end,duration,(q.settings->>'passPercentage')::numeric,coalesce((q.settings->>'allowReview')::boolean,false),ids,p_legacy_id) returning * into a;
 insert into public.exam_answers(attempt_id,question_id,selected_answers) select a.id,key::uuid,value from jsonb_each(answers);
 if submitted then perform private.finalize_attempt(a.id); select * into a from public.exam_attempts where id=a.id; end if;
 return private.session_json(a);
end $$;
create function public.mark_data_migration(p_source_id text,p_status text,p_report jsonb default '{}'::jsonb) returns void language sql security definer set search_path='' as $$
 insert into public.data_migrations(firebase_uid,source_id,status,report,updated_at) values(public.current_uid(),p_source_id,p_status,p_report,now())
 on conflict(firebase_uid,source_id,version) do update set status=excluded.status,report=excluded.report,updated_at=excluded.updated_at
$$;

create function private.session_json(a public.exam_attempts) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',a.id,'quizId',a.quiz_id,'studentId',a.student_uid,'studentName',a.student_name,'studentClass',a.student_class,
 'startTime',extract(epoch from a.started_at)*1000,'endTime',coalesce(extract(epoch from a.ends_at)*1000,0),
 'durationMinutes',a.duration_minutes,'answers',(select coalesce(jsonb_object_agg(question_id,selected_answers),'{}') from public.exam_answers where attempt_id=a.id),
 'flaggedQuestionIds',a.flagged_ids,'currentQuestionIndex',a.current_index,'isSubmitted',a.submitted_at is not null,'lastSavedAt',a.updated_at,
 'revision',a.revision,'questionOrder',to_jsonb(a.question_order),'optionOrder',a.option_order)
$$;
create function public.list_sessions() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(private.session_json(a) order by a.started_at),'[]') from public.exam_attempts a where a.student_uid=public.current_uid() and a.submitted_at is null
$$;
create function public.list_results() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(r.payload || jsonb_build_object('id',r.id,'details',case when a.allow_review or public.owns_quiz(a.quiz_id) then r.payload->'details' else '[]'::jsonb end) order by r.created_at desc),'[]') from public.exam_results r join public.exam_attempts a on a.id=r.attempt_id where a.student_uid=public.current_uid() or public.owns_quiz(a.quiz_id)
$$;
create function public.start_attempt(p_quiz_id uuid,p_class text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quizzes; a public.exam_attempts; duration integer; max_tries integer; ids uuid[]; opts jsonb;
begin
 if not public.has_role(array['student']) then raise exception 'Chỉ học sinh được làm bài'; end if;
 -- Lock quiz before checking count to serialize starts and edits.
 select * into q from public.quizzes where id=p_quiz_id for update;
 if not found then raise exception 'Không tìm thấy đề'; end if;
 select * into a from public.exam_attempts where quiz_id=p_quiz_id and student_uid=public.current_uid() and submitted_at is null;
 if found then return private.session_json(a); end if;
 if q.status<>'published' then raise exception 'Đề chưa mở'; end if;
 max_tries:=(q.settings->>'maxAttempts')::integer;
 if max_tries>0 and (select count(*) from public.exam_attempts where quiz_id=q.id and student_uid=public.current_uid())>=max_tries then raise exception 'Bạn đã hết lượt làm bài'; end if;
 duration:=(q.settings->>'durationMinutes')::integer;
 select array_agg(id order by case when (q.settings->>'shuffleQuestions')::boolean then random() else ordinal::float end) into ids from public.questions where quiz_id=q.id;
 select jsonb_object_agg(x.id,(select jsonb_agg(o->>'id' order by case when (q.settings->>'shuffleOptions')::boolean then random() else z::float end) from jsonb_array_elements(x.options) with ordinality t(o,z))) into opts from public.questions x where quiz_id=q.id;
 insert into public.exam_attempts(quiz_id,student_uid,student_name,student_class,ends_at,duration_minutes,pass_percentage,allow_review,question_order,option_order)
 values(q.id,public.current_uid(),(select full_name from public.profiles where firebase_uid=public.current_uid()),left(p_class,100),case when duration=0 then null else now()+make_interval(mins=>duration) end,duration,(q.settings->>'passPercentage')::numeric,coalesce((q.settings->>'allowReview')::boolean,false),ids,opts) returning * into a;
 return private.session_json(a);
end $$;
create function public.save_attempt(p_id uuid,p_revision integer,p_answers jsonb,p_flags jsonb,p_index integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.exam_attempts; pair record; v text;
begin
 select * into a from public.exam_attempts where id=p_id and student_uid=public.current_uid() for update;
 if not found or not public.has_role(array['student']) then raise exception 'Không có quyền'; end if;
 if a.submitted_at is not null then raise exception 'Bài đã nộp'; end if;
 if a.ends_at is not null and now()>=a.ends_at then raise exception 'Hết giờ: nộp các đáp án đã lưu'; end if;
 if a.revision<>p_revision then raise exception 'CONFLICT: Bài đã được cập nhật trên thiết bị khác. Tải lại trước khi tiếp tục'; end if;
 if jsonb_typeof(p_answers) is distinct from 'object' or jsonb_typeof(p_flags) is distinct from 'array' then raise exception 'Dữ liệu không hợp lệ'; end if;
 for pair in select * from jsonb_each(p_answers) loop
  if not (pair.key::uuid=any(a.question_order)) or jsonb_typeof(pair.value)<>'array' or jsonb_array_length(pair.value)>4 then raise exception 'Đáp án không hợp lệ'; end if;
  if (select type from public.questions where id=pair.key::uuid)<>'multiple_choice' and jsonb_array_length(pair.value)>1 then raise exception 'Chỉ chọn một đáp án'; end if;
  for v in select value from jsonb_array_elements_text(pair.value) as values(value) loop
   if not exists(select 1 from public.questions q,jsonb_array_elements(q.options) o where q.id=pair.key::uuid and o->>'id'=v) then raise exception 'Phương án không hợp lệ'; end if;
  end loop;
 end loop;
 if exists(select 1 from jsonb_array_elements_text(p_flags) as flags(value) where not (flags.value::uuid=any(a.question_order))) then raise exception 'Cờ không hợp lệ'; end if;
 delete from public.exam_answers existing where existing.attempt_id=a.id
 and not exists(select 1 from jsonb_each(p_answers) incoming where incoming.key::uuid=existing.question_id);
 insert into public.exam_answers(attempt_id,question_id,selected_answers)
 select a.id,key::uuid,value from jsonb_each(p_answers)
 on conflict(attempt_id,question_id) do update
 set selected_answers=excluded.selected_answers,updated_at=now();
 update public.exam_attempts set flagged_ids=p_flags,current_index=greatest(0,least(p_index,array_length(question_order,1)-1)),revision=revision+1,updated_at=now() where id=a.id returning * into a;
 return private.session_json(a);
end $$;
create function private.finalize_attempt(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare a public.exam_attempts; q public.quizzes; total integer; answered integer; correct integer; earned numeric; maximum numeric; pct numeric; details jsonb; rid uuid:=gen_random_uuid();
begin
 select * into a from public.exam_attempts where id=p_id for update;
 if not found or exists(select 1 from public.exam_results where attempt_id=p_id) then return; end if;
 select * into q from public.quizzes where id=a.quiz_id;
 with graded as (
  select x.*,k.correct_answers,k.explanation,coalesce(y.selected_answers,'[]'::jsonb) selected,
  (coalesce(y.selected_answers,'[]'::jsonb) @> k.correct_answers and k.correct_answers @> coalesce(y.selected_answers,'[]'::jsonb)) ok
  from public.questions x join public.question_answer_keys k on k.question_id=x.id left join public.exam_answers y on y.question_id=x.id and y.attempt_id=a.id where x.quiz_id=a.quiz_id
 ) select count(*),count(*) filter(where jsonb_array_length(selected)>0),count(*) filter(where ok),coalesce(sum(points) filter(where ok),0),sum(points),
 jsonb_agg(jsonb_build_object('questionId',id,'order',ordinal,'content',content,'options',options,'selectedAnswers',selected,'correctAnswers',correct_answers,'isCorrect',ok,'pointsEarned',case when ok then points else 0 end,'maxPoints',points,'explanation',explanation) order by ordinal)
 into total,answered,correct,earned,maximum,details from graded;
 pct:=round(earned/nullif(maximum,0)*100,2);
 insert into public.exam_results(id,attempt_id,payload) values(rid,a.id,jsonb_build_object('id',rid,'quizId',q.id,'quizTitle',q.title,'subject',q.subject,'roomCode',q.code,'studentId',a.student_uid,'studentName',a.student_name,'studentClass',a.student_class,
 'totalQuestions',total,'answeredCount',answered,'correctCount',correct,'incorrectCount',answered-correct,'skippedCount',total-answered,'score',round(earned/nullif(maximum,0)*10,2),'totalPointsEarned',earned,'maxTotalPoints',maximum,'percentage',pct,'isPassed',pct>=a.pass_percentage,'passPercentage',a.pass_percentage,
 'academicRank',case when pct>=90 then 'Xuất sắc' when pct>=80 then 'Giỏi' when pct>=65 then 'Khá' when pct>=50 then 'Trung bình' else 'Yếu' end,
 'timeSpentSeconds',greatest(0,floor(extract(epoch from (least(now(),coalesce(a.ends_at,now()))-a.started_at)))),'details',details,'submittedAt',now()));
 update public.exam_attempts set submitted_at=now(),updated_at=now() where id=a.id;
end $$;
create function public.submit_attempt(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.exam_attempts; r public.exam_results;
begin
 select * into a from public.exam_attempts where id=p_id and student_uid=public.current_uid();
 if not found or not public.has_role(array['student']) then raise exception 'Không có quyền'; end if;
 perform private.finalize_attempt(p_id);
 select * into r from public.exam_results where attempt_id=p_id;
 return r.payload || jsonb_build_object('details',case when a.allow_review then r.payload->'details' else '[]'::jsonb end);
end $$;
create function public.finalize_expired() returns void language plpgsql security definer set search_path='' as $$
declare a record;
begin
 for a in select id from public.exam_attempts where ends_at<=now() and submitted_at is null and (student_uid=public.current_uid() or public.owns_quiz(quiz_id)) loop
 perform private.finalize_attempt(a.id);
 end loop;
end $$;
create function public.consume_ai_quota(p_uid text) returns boolean language plpgsql security definer set search_path='' as $$
declare hits integer;
begin
 insert into private.ai_limits values(p_uid,date_trunc('minute',now()),1)
 on conflict(uid) do update set bucket=excluded.bucket,requests=case when private.ai_limits.bucket=excluded.bucket then private.ai_limits.requests+1 else 1 end returning requests into hits;
 return hits<=20;
end $$;

revoke execute on all functions in schema private from public,anon,authenticated;
revoke execute on all functions in schema public from public,anon;
grant execute on function public.current_uid(),public.app_role(),public.has_role(text[]),public.owns_quiz(uuid),public.can_read_quiz(uuid),public.update_my_profile(text,text),public.list_quizzes(),public.save_quiz(jsonb,uuid,text),public.set_quiz_status(uuid,text),public.delete_quiz(uuid),public.import_legacy_attempt(text,text,jsonb),public.mark_data_migration(text,text,jsonb),public.list_sessions(),public.list_results(),public.start_attempt(uuid,text),public.save_attempt(uuid,integer,jsonb,jsonb,integer),public.submit_attempt(uuid),public.finalize_expired() to authenticated;
revoke execute on function public.consume_ai_quota(text) from authenticated;
grant execute on function public.consume_ai_quota(text) to service_role;
grant all on all tables in schema public to service_role;
