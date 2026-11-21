-- Expand the Supabase RPC path from A-D to A-E.
DO $migration$
DECLARE
  rule record;
  definition text;
  occurrences integer;
BEGIN
  FOR rule IN
    SELECT *
    FROM (VALUES
      ('public.save_quiz(jsonb,uuid,text)', 'not between 2 and 4', 'not between 2 and 5'),
      ('public.save_quiz(jsonb,uuid,text)', 'not between 1 and 4', 'not between 1 and 5'),
      ('public.save_quiz(jsonb,uuid,text)', 'not in (''A'',''B'',''C'',''D'')', 'not in (''A'',''B'',''C'',''D'',''E'')'),
      ('public.import_legacy_attempt(text,text,jsonb)', 'jsonb_array_length(item.value)>4', 'jsonb_array_length(item.value)>5'),
      ('public.save_attempt(uuid,integer,jsonb,jsonb,integer)', 'jsonb_array_length(pair.value)>4', 'jsonb_array_length(pair.value)>5'),
      ('public.check_practice_answer(uuid,uuid,jsonb)', 'not between 1 and 4', 'not between 1 and 5')
    ) AS replacements(signature, old_fragment, new_fragment)
  LOOP
    IF to_regprocedure(rule.signature) IS NULL THEN
      RAISE EXCEPTION 'Required function % was not found', rule.signature;
    END IF;

    definition := pg_get_functiondef(to_regprocedure(rule.signature));
    occurrences := (length(definition) - length(replace(definition, rule.old_fragment, ''))) / length(rule.old_fragment);
    IF occurrences <> 1 THEN
      RAISE EXCEPTION 'Expected one % guard in %, found %', rule.old_fragment, rule.signature, occurrences;
    END IF;

    EXECUTE replace(definition, rule.old_fragment, rule.new_fragment);
  END LOOP;
END
$migration$;

ALTER TABLE public.question_answer_keys
  DROP CONSTRAINT question_answer_keys_correct_answers_check;
ALTER TABLE public.question_answer_keys
  ADD CONSTRAINT question_answer_keys_correct_answers_check
  CHECK (
    jsonb_typeof(correct_answers) = 'array'
    AND jsonb_array_length(correct_answers) BETWEEN 1 AND 5
  ) NOT VALID;
ALTER TABLE public.question_answer_keys
  VALIDATE CONSTRAINT question_answer_keys_correct_answers_check;

ALTER TABLE public.practice_answers
  DROP CONSTRAINT practice_answers_selected_answers_check;
ALTER TABLE public.practice_answers
  ADD CONSTRAINT practice_answers_selected_answers_check
  CHECK (
    jsonb_typeof(selected_answers) = 'array'
    AND jsonb_array_length(selected_answers) BETWEEN 1 AND 5
  ) NOT VALID;
ALTER TABLE public.practice_answers
  VALIDATE CONSTRAINT practice_answers_selected_answers_check;
