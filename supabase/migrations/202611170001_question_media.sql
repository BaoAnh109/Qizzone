insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'qizzone-question-media',
  'qizzone-question-media',
  true,
  900000,
  array['image/jpeg']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='qizzone_question_media_public_read') then
    create policy qizzone_question_media_public_read on storage.objects
      for select to anon, authenticated using (bucket_id = 'qizzone-question-media');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='qizzone_question_media_teacher_upload') then
    create policy qizzone_question_media_teacher_upload on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'qizzone-question-media'
        and public.has_role(array['teacher','admin'])
        and split_part(name, '/', 1) = public.current_uid()
      );
  end if;
end
$$;

alter table public.questions
  add column if not exists images jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'questions_images_array_check' and conrelid = 'public.questions'::regclass) then
    alter table public.questions add constraint questions_images_array_check check (jsonb_typeof(images) = 'array');
  end if;
end
$$;

create or replace function public.list_quizzes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'title', q.title, 'subject', q.subject, 'description', q.description,
    'teacherId', q.teacher_uid, 'teacherName', p.full_name, 'code', q.code,
    'status', q.status, 'settings', case
      when public.owns_quiz(q.id) then q.settings
      else jsonb_set(
        coalesce(q.settings, '{}'::jsonb),
        '{assignedEmails}',
        coalesce((
          select jsonb_agg(to_jsonb(assignment.email))
          from jsonb_array_elements_text(case
            when jsonb_typeof(q.settings->'assignedEmails') = 'array' then q.settings->'assignedEmails'
            else '[]'::jsonb
          end) as assignment(email)
          where lower(btrim(assignment.email)) = lower(btrim((
            select student_profile.email from public.profiles student_profile
            where student_profile.firebase_uid = public.current_uid()
          )))
        ), '[]'::jsonb), true
      )
    end,
    'createdAt', q.created_at, 'updatedAt', q.updated_at,
    'totalQuestions', (select count(*) from public.questions where quiz_id = q.id),
    'totalPoints', (select coalesce(sum(points), 0) from public.questions where quiz_id = q.id),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'order', x.ordinal, 'content', x.content, 'images', x.images,
        'type', x.type, 'options', x.options, 'points', x.points,
        'correctAnswers', case when public.owns_quiz(q.id) then k.correct_answers else '[]'::jsonb end,
        'explanation', case when public.owns_quiz(q.id) then k.explanation else null end
      ) order by x.ordinal), '[]'::jsonb)
      from public.questions x left join public.question_answer_keys k on k.question_id = x.id
      where x.quiz_id = q.id
    )
  ) order by q.created_at desc), '[]'::jsonb)
  from public.quizzes q join public.profiles p on p.firebase_uid = q.teacher_uid
  where public.can_read_quiz(q.id)
$$;

create or replace function public.save_quiz(p_data jsonb, p_id uuid default null, p_legacy_id text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  qid uuid; item jsonb; opt jsonb; qkey uuid; n integer := 0; st jsonb := p_data->'settings';
  image_value text; media_length integer;
begin
  if not public.has_role(array['teacher','admin']) then raise exception 'Chỉ giáo viên được tạo đề'; end if;
  if p_id is not null and not public.owns_quiz(p_id) then raise exception 'Không có quyền sửa đề'; end if;
  if jsonb_typeof(p_data->'questions') is distinct from 'array' or jsonb_array_length(p_data->'questions') not between 1 and 500 then raise exception 'Đề phải có 1-500 câu'; end if;
  if st is null or (st->>'durationMinutes')::integer is null or (st->>'maxAttempts')::integer is null or (st->>'passPercentage')::numeric is null
    or (st->>'durationMinutes')::integer not between 0 and 1440 or (st->>'maxAttempts')::integer not between 0 and 100
    or (st->>'passPercentage')::numeric not between 0 and 100 then raise exception 'Cấu hình đề không hợp lệ'; end if;
  if p_legacy_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(public.current_uid() || p_legacy_id, 0));
    select id into qid from public.quizzes where teacher_uid = public.current_uid() and legacy_id = p_legacy_id;
    if found then return qid; end if;
  end if;
  if p_id is not null then
    perform 1 from public.quizzes where id = p_id for update;
    if exists(select 1 from public.exam_attempts where quiz_id = p_id) then raise exception 'Đề đã có lượt làm: hãy nhân bản để chỉnh sửa nội dung'; end if;
    update public.quizzes set title=trim(p_data->>'title'),subject=trim(p_data->>'subject'),description=coalesce(p_data->>'description',''),
      settings=st,status=p_data->>'status',updated_at=now() where id=p_id;
    qid := p_id;
    delete from public.questions where quiz_id = qid;
  else
    insert into public.quizzes(teacher_uid,title,subject,description,status,settings,legacy_id)
      values(public.current_uid(),trim(p_data->>'title'),trim(p_data->>'subject'),coalesce(p_data->>'description',''),coalesce(p_data->>'status','draft'),st,p_legacy_id)
      returning id into qid;
  end if;

  for item in select value from jsonb_array_elements(p_data->'questions') loop
    n := n + 1;
    if length(trim(coalesce(item->>'content',''))) = 0 or jsonb_typeof(item->'options') is distinct from 'array'
      or jsonb_array_length(item->'options') not between 2 and 4 or jsonb_typeof(item->'correctAnswers') is distinct from 'array'
      or jsonb_array_length(item->'correctAnswers') not between 1 and 4 then raise exception 'Câu hỏi hoặc đáp án không hợp lệ'; end if;
    if item ? 'images' and jsonb_typeof(item->'images') is distinct from 'array' then raise exception 'Ảnh câu hỏi không hợp lệ'; end if;
    if jsonb_array_length(coalesce(item->'images','[]'::jsonb)) > 8 then raise exception 'Mỗi câu chỉ được có tối đa 8 ảnh'; end if;
    media_length := 0;
    for image_value in select value from jsonb_array_elements_text(coalesce(item->'images','[]'::jsonb)) as images(value) loop
      if image_value not like 'storage://qizzone-question-media/%' or length(image_value) > 512 or position('..' in image_value) > 0 then raise exception 'Ảnh câu hỏi phải được lưu trong kho hình đề thi'; end if;
      media_length := media_length + length(image_value);
    end loop;
    if media_length > 4000000 then raise exception 'Tổng ảnh trong câu hỏi vượt quá 4 MB'; end if;
    if (select count(distinct v->>'id') from jsonb_array_elements(item->'options') v) <> jsonb_array_length(item->'options') then raise exception 'Phương án bị trùng'; end if;
    for opt in select value from jsonb_array_elements(item->'options') loop
      if coalesce(opt->>'id','') not in ('A','B','C','D') or length(trim(coalesce(opt->>'content',''))) = 0 then raise exception 'Phương án không hợp lệ'; end if;
      if opt ? 'images' and jsonb_typeof(opt->'images') is distinct from 'array' then raise exception 'Ảnh phương án không hợp lệ'; end if;
      if jsonb_array_length(coalesce(opt->'images','[]'::jsonb)) > 8 then raise exception 'Mỗi phương án chỉ được có tối đa 8 ảnh'; end if;
      for image_value in select value from jsonb_array_elements_text(coalesce(opt->'images','[]'::jsonb)) as images(value) loop
        if image_value not like 'storage://qizzone-question-media/%' or length(image_value) > 512 or position('..' in image_value) > 0 then raise exception 'Ảnh phương án phải được lưu trong kho hình đề thi'; end if;
        media_length := media_length + length(image_value);
      end loop;
      if media_length > 4000000 then raise exception 'Tổng ảnh trong câu hỏi vượt quá 4 MB'; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements_text(item->'correctAnswers') v where not exists(select 1 from jsonb_array_elements(item->'options') o where o->>'id'=v))
      or (item->>'type' <> 'multiple_choice' and jsonb_array_length(item->'correctAnswers') <> 1) then raise exception 'Đáp án không khớp phương án'; end if;
    insert into public.questions(quiz_id,ordinal,content,images,type,options,points,legacy_id)
      values(qid,n,item->>'content',coalesce(item->'images','[]'::jsonb),item->>'type',item->'options',(item->>'points')::numeric,item->>'id')
      returning id into qkey;
    insert into public.question_answer_keys(question_id,correct_answers,explanation)
      values(qkey,item->'correctAnswers',coalesce(item->>'explanation',''));
  end loop;
  if p_legacy_id is not null then
    insert into public.data_migrations(firebase_uid,source_id,status,report)
      values(public.current_uid(),p_legacy_id,'completed',jsonb_build_object('quizId',qid)) on conflict do nothing;
  end if;
  return qid;
end
$$;

create or replace function private.finalize_attempt(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.exam_attempts; q public.quizzes; total integer; answered integer; correct integer;
  earned numeric; maximum numeric; pct numeric; details jsonb; rid uuid := gen_random_uuid();
begin
  select * into a from public.exam_attempts where id=p_id for update;
  if not found or exists(select 1 from public.exam_results where attempt_id=p_id) then return; end if;
  select * into q from public.quizzes where id=a.quiz_id;
  with graded as (
    select x.*, k.correct_answers, k.explanation, coalesce(y.selected_answers,'[]'::jsonb) selected,
      (coalesce(y.selected_answers,'[]'::jsonb) @> k.correct_answers and k.correct_answers @> coalesce(y.selected_answers,'[]'::jsonb)) ok
    from public.questions x join public.question_answer_keys k on k.question_id=x.id
    left join public.exam_answers y on y.question_id=x.id and y.attempt_id=a.id where x.quiz_id=a.quiz_id
  )
  select count(*),count(*) filter(where jsonb_array_length(selected)>0),count(*) filter(where ok),
    coalesce(sum(points) filter(where ok),0),sum(points),
    jsonb_agg(jsonb_build_object('questionId',id,'order',ordinal,'content',content,'images',images,'options',options,
      'selectedAnswers',selected,'correctAnswers',correct_answers,'isCorrect',ok,'pointsEarned',case when ok then points else 0 end,
      'maxPoints',points,'explanation',explanation) order by ordinal)
  into total,answered,correct,earned,maximum,details from graded;
  pct := round(earned/nullif(maximum,0)*100,2);
  insert into public.exam_results(id,attempt_id,payload) values(rid,a.id,jsonb_build_object(
    'id',rid,'quizId',q.id,'quizTitle',q.title,'subject',q.subject,'roomCode',q.code,'studentId',a.student_uid,
    'studentName',a.student_name,'studentClass',a.student_class,'totalQuestions',total,'answeredCount',answered,
    'correctCount',correct,'incorrectCount',answered-correct,'skippedCount',total-answered,
    'score',round(earned/nullif(maximum,0)*10,2),'totalPointsEarned',earned,'maxTotalPoints',maximum,
    'percentage',pct,'isPassed',pct>=a.pass_percentage,'passPercentage',a.pass_percentage,
    'academicRank',case when pct>=90 then 'Xuất sắc' when pct>=80 then 'Giỏi' when pct>=65 then 'Khá' when pct>=50 then 'Trung bình' else 'Yếu' end,
    'timeSpentSeconds',greatest(0,floor(extract(epoch from (least(now(),coalesce(a.ends_at,now()))-a.started_at)))),
    'details',details,'submittedAt',now()));
  update public.exam_attempts set submitted_at=now(),updated_at=now() where id=a.id;
end
$$;

create or replace function public.finish_practice(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.practice_sessions; current_status text; current_updated_at timestamptz;
  answered_count integer; correct_count integer; total_count integer; pct numeric; duration_seconds integer;
  details jsonb; result_payload jsonb;
  message text := 'Đề đã bị giáo viên đóng, xóa hoặc chỉnh sửa trong lúc luyện tập. Lượt này không thể hoàn tất; hãy quay lại mục Luyện tập.';
begin
  if not public.has_role(array['student']) then raise exception 'Chỉ học sinh được kết thúc lượt luyện tập'; end if;
  select * into s from public.practice_sessions where id=p_session_id and student_uid=public.current_uid() for update;
  if not found then raise exception 'Không tìm thấy lượt luyện tập hoặc bạn không có quyền truy cập'; end if;
  if s.status='completed' then return s.result; end if;
  if s.status='invalidated' then return jsonb_build_object('status',s.status,'message',coalesce(s.failure_message,message)); end if;
  select q.status,q.updated_at into current_status,current_updated_at from public.quizzes q where q.id=s.quiz_id;
  if not found or current_status<>'published' or current_updated_at is distinct from s.quiz_updated_at then
    update public.practice_sessions set status='invalidated',finished_at=now(),failure_message=message where id=s.id;
    return jsonb_build_object('status','invalidated','message',message);
  end if;
  total_count := cardinality(s.question_order);
  select count(*)::integer,count(*) filter(where is_correct)::integer into answered_count,correct_count
    from public.practice_answers where session_id=s.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'questionId',q.id,'order',requested.position,'content',q.content,'images',q.images,'type',q.type,'options',q.options,
    'optionOrder',s.option_order->q.id::text,'selectedAnswers',coalesce(a.selected_answers,'[]'::jsonb),
    'correctAnswers',coalesce(a.correct_answers,'[]'::jsonb),'isCorrect',coalesce(a.is_correct,false),
    'checked',a.question_id is not null,'explanation',coalesce(a.explanation,'')
  ) order by requested.position),'[]'::jsonb) into details
  from unnest(s.question_order) with ordinality as requested(question_id,position)
  join public.questions q on q.id=requested.question_id and q.quiz_id=s.quiz_id
  join public.question_answer_keys k on k.question_id=q.id
  left join public.practice_answers a on a.session_id=s.id and a.question_id=q.id;
  if jsonb_array_length(details)<>total_count then
    update public.practice_sessions set status='invalidated',finished_at=now(),failure_message=message where id=s.id;
    return jsonb_build_object('status','invalidated','message',message);
  end if;
  pct := round(correct_count::numeric/nullif(total_count,0)*100,2);
  duration_seconds := greatest(0,floor(extract(epoch from (clock_timestamp()-s.started_at)))::integer);
  result_payload := jsonb_build_object(
    'id',s.id,'sessionId',s.id,'quizId',s.quiz_id,'quizTitle',s.quiz_title,'subject',s.subject,
    'studentId',s.student_uid,'startedAt',s.started_at,'finishedAt',clock_timestamp(),
    'totalQuestions',total_count,'answeredCount',answered_count,'correctCount',correct_count,
    'incorrectCount',answered_count-correct_count,'skippedCount',total_count-answered_count,
    'percentage',pct,'durationSeconds',duration_seconds,'details',details);
  update public.practice_sessions set status='completed',finished_at=(result_payload->>'finishedAt')::timestamptz,result=result_payload where id=s.id;
  return result_payload;
end
$$;

