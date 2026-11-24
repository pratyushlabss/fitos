-- food_vocabulary() returns one row per word, and PostgREST caps responses at 1,000 rows. After the food DB import
-- there are ~10,900 words, so the gate only saw the first 1,000 and rejected "dosa", "sambar"... as unknown.
-- One array value isn't subject to the row cap.
CREATE OR REPLACE FUNCTION public.food_vocabulary_words()
RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE(array_agg(word ORDER BY word), '{}') FROM public.food_vocabulary();
$$;
GRANT EXECUTE ON FUNCTION public.food_vocabulary_words() TO authenticated, service_role;
