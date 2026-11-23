\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
CREATE FUNCTION public.t_err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'NO ERROR'; EXCEPTION WHEN OTHERS THEN RETURN 'ERROR: ' || SQLERRM; END $$;
GRANT EXECUTE ON FUNCTION public.t_err(text) TO anon, authenticated, service_role;
CREATE FUNCTION public.t_check(label text, ok boolean) RETURNS text LANGUAGE sql AS $$ SELECT CASE WHEN ok THEN 'PASS ' ELSE 'FAIL ' END || label $$;
GRANT EXECUTE ON FUNCTION public.t_check(text, boolean) TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email) VALUES
 ('00000000-0000-0000-0000-00000000000a','a@x.test'),
 ('00000000-0000-0000-0000-00000000000b','b@x.test'),
 ('00000000-0000-0000-0000-00000000000c','c@x.test'),
 ('00000000-0000-0000-0000-00000000000d','d@x.test');
SELECT t_check('trigger created 4 profiles', (SELECT count(*) FROM profiles) = 4);
UPDATE profiles SET username = 'alice', display_name = 'Alice', onboarded_at = now() WHERE id = '00000000-0000-0000-0000-00000000000a';
UPDATE profiles SET username = 'bob', display_name = 'Bob', onboarded_at = now() WHERE id = '00000000-0000-0000-0000-00000000000b';
UPDATE profiles SET username = 'carol', display_name = 'Carol', onboarded_at = now(), is_private = true WHERE id = '00000000-0000-0000-0000-00000000000c';
UPDATE profiles SET username = 'dave', display_name = 'Dave', onboarded_at = now() WHERE id = '00000000-0000-0000-0000-00000000000d';
SELECT t_check('58 global exercises seeded', (SELECT count(*) FROM exercises WHERE is_global) = 58);

SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
INSERT INTO workouts (id, user_id, title, visibility, completed_at, total_volume_kg) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','A private','private', now(), 1000),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a','A friends','friends', now(), 2000),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-00000000000a','A public','public', now(), 3000);
INSERT INTO workout_exercises (id, workout_id, exercise_name) VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Bench Press'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Squat');
INSERT INTO workout_sets (workout_exercise_id, set_index, reps, weight_kg) VALUES
 ('20000000-0000-0000-0000-000000000001',0,5,100),('20000000-0000-0000-0000-000000000002',0,5,140);
INSERT INTO posts (id, user_id, post_type, workout_id, visibility) VALUES
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','workout','10000000-0000-0000-0000-000000000002','friends');
INSERT INTO meals (id, user_id, meal_type) VALUES ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','lunch');
INSERT INTO meal_items (meal_id, name, calories) VALUES ('40000000-0000-0000-0000-000000000001','Rice',300);
INSERT INTO body_measurements (user_id, weight_kg) VALUES ('00000000-0000-0000-0000-00000000000a', 80);
SELECT t_check('A sees all 3 own workouts', (SELECT count(*) FROM workouts) = 3);
SELECT t_check('A can create own custom exercise', t_err($$INSERT INTO exercises (user_id, name, is_global) VALUES ('00000000-0000-0000-0000-00000000000a','My Press', false)$$) = 'NO ERROR');
SELECT t_check('A cannot create a global exercise', t_err($$INSERT INTO exercises (user_id, name, is_global) VALUES ('00000000-0000-0000-0000-00000000000a','Fake', true)$$) LIKE 'ERROR%');
SELECT t_check('A cannot write products', t_err($$INSERT INTO products (product_name) VALUES ('x')$$) LIKE 'ERROR%');
SELECT t_check('storage: A uploads own progress photo', t_err($$INSERT INTO storage.objects (bucket_id, name) VALUES ('progress-photos','00000000-0000-0000-0000-00000000000a/p1.webp')$$) = 'NO ERROR');
SELECT t_check('storage: A cannot upload into B folder', t_err($$INSERT INTO storage.objects (bucket_id, name) VALUES ('progress-photos','00000000-0000-0000-0000-00000000000b/p1.webp')$$) LIKE 'ERROR%');
SELECT t_check('storage: A uploads post media', t_err($$INSERT INTO storage.objects (bucket_id, name) VALUES ('post-media','00000000-0000-0000-0000-00000000000a/m1.webp')$$) = 'NO ERROR');
INSERT INTO posts (id, user_id, post_type, body, media_path, visibility) VALUES
 ('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a','photo','pic','00000000-0000-0000-0000-00000000000a/m1.webp','friends');
SELECT t_check('A cannot post media from B folder', t_err($$INSERT INTO posts (user_id, post_type, media_path, visibility) VALUES ('00000000-0000-0000-0000-00000000000a','photo','00000000-0000-0000-0000-00000000000b/x.webp','public')$$) LIKE 'ERROR%');

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
SELECT t_check('B cannot attach A workout to own post', t_err($$INSERT INTO posts (user_id, post_type, workout_id, visibility) VALUES ('00000000-0000-0000-0000-00000000000b','workout','10000000-0000-0000-0000-000000000003','public')$$) LIKE 'ERROR%');
SELECT t_check('B follows A -> accepted', follow_user('00000000-0000-0000-0000-00000000000a') = 'accepted');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false);
SELECT t_check('D cannot insert accepted follow on private C', t_err($$INSERT INTO follows (follower_id, following_id, status) VALUES ('00000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-00000000000c','accepted')$$) LIKE 'ERROR%');
SELECT t_check('D follows C via RPC -> pending', follow_user('00000000-0000-0000-0000-00000000000c') = 'pending');
SELECT t_err($$UPDATE follows SET status = 'accepted' WHERE follower_id = '00000000-0000-0000-0000-00000000000d'$$);
SELECT t_check('D cannot self-accept', (SELECT status FROM follows WHERE follower_id = '00000000-0000-0000-0000-00000000000d') = 'pending');

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
SELECT t_check('B sees A friends+public workouts only', (SELECT array_agg(title ORDER BY title) FROM workouts) = ARRAY['A friends','A public']);
SELECT t_check('B sees sets of A friends workout only', (SELECT count(*) FROM workout_sets) = 1);
SELECT t_check('B sees A friends posts', (SELECT count(*) FROM posts) = 2);
SELECT t_check('B cannot see A meals', (SELECT count(*) FROM meals) = 0 AND (SELECT count(*) FROM meal_items) = 0);
SELECT t_check('B cannot see A body data', (SELECT count(*) FROM body_measurements) = 0);
SELECT t_check('B can read A post media', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'post-media') = 1);
SELECT t_check('B cannot read A progress photo', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'progress-photos') = 0);
SELECT t_check('B comments on visible post', t_err($$INSERT INTO comments (post_id, user_id, body) VALUES ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','Nice')$$) = 'NO ERROR');
SELECT t_check('B likes visible post', t_err($$INSERT INTO post_reactions (post_id, user_id, kind) VALUES ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','like')$$) = 'NO ERROR');
SELECT t_check('get_feed for B: 2 posts, counts', (SELECT count(*) FROM get_feed()) = 2 AND (SELECT count(*) FROM get_feed() WHERE like_count = 1 AND comment_count = 1 AND liked_by_me) = 1);
SELECT t_check('get_feed joins workout title', (SELECT workout_title FROM get_feed() WHERE workout_id IS NOT NULL) = 'A friends');
SELECT t_check('profile card A for B: 2 shared workouts', (SELECT workouts FROM get_profile_card('00000000-0000-0000-0000-00000000000a')) = 2);
SELECT t_check('leaderboard for B: 2 rows, A volume 5000', (SELECT count(*) FROM weekly_leaderboard()) = 2 AND (SELECT volume_kg FROM weekly_leaderboard() WHERE username = 'alice') = 5000);
SELECT t_check('A streak seen by B is 1', get_streak('00000000-0000-0000-0000-00000000000a') = 1);

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false);
SELECT t_check('D sees only A public workout', (SELECT array_agg(title) FROM workouts) = ARRAY['A public']);
SELECT t_check('D sees no A friends posts', (SELECT count(*) FROM posts) = 0);
SELECT t_check('D cannot comment on invisible post', t_err($$INSERT INTO comments (post_id, user_id, body) VALUES ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000d','hi')$$) LIKE 'ERROR%');
SELECT t_check('D cannot read comments on invisible post', (SELECT count(*) FROM comments) = 0);
SELECT t_check('D cannot save invisible post', t_err($$INSERT INTO post_saves (user_id, post_id) VALUES ('00000000-0000-0000-0000-00000000000d','30000000-0000-0000-0000-000000000001')$$) LIKE 'ERROR%');
SELECT t_check('D cannot read A post media', (SELECT count(*) FROM storage.objects) = 0);
SELECT t_check('search al finds alice', (SELECT count(*) FROM search_profiles('al') WHERE username = 'alice') = 1);
SELECT t_check('search treats % literally', (SELECT count(*) FROM search_profiles('%')) = 0);
SELECT t_check('blank search excludes self', (SELECT count(*) FROM search_profiles('') WHERE username = 'dave') = 0);

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
INSERT INTO workouts (user_id, title, visibility, completed_at) VALUES ('00000000-0000-0000-0000-00000000000c','C public','public', now());
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false);
SELECT t_check('pending D cannot see private C public workout', (SELECT count(*) FROM workouts WHERE title = 'C public') = 0);
SELECT t_check('profile card C hides stats from D', (SELECT can_view = false AND workouts IS NULL AND follow_status = 'pending' FROM get_profile_card('00000000-0000-0000-0000-00000000000c')));
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
SELECT t_check('C sees follow request', (SELECT count(*) FROM get_notifications() WHERE kind = 'follow_request') = 1);
SELECT respond_follow_request('00000000-0000-0000-0000-00000000000d', true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false);
SELECT t_check('after accept D sees C workout', (SELECT count(*) FROM workouts WHERE title = 'C public') = 1);

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
SELECT t_check('A notified of B like and comment', (SELECT count(*) FROM get_notifications() WHERE kind IN ('like','comment')) = 2);
INSERT INTO blocks (blocker_id, blocked_id) VALUES ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000d');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false);
SELECT t_check('blocked D cannot see A profile', (SELECT count(*) FROM profiles WHERE username = 'alice') = 0);
SELECT t_check('blocked D cannot see A public workout', (SELECT count(*) FROM workouts WHERE title = 'A public') = 0);
SELECT t_check('blocked D cannot follow A', t_err($$SELECT follow_user('00000000-0000-0000-0000-00000000000a')$$) LIKE 'ERROR%');
SELECT t_check('search hides A from D', (SELECT count(*) FROM search_profiles('alice')) = 0);
SELECT t_check('profile card A empty for D', (SELECT count(*) FROM get_profile_card('00000000-0000-0000-0000-00000000000a')) = 0);
SELECT t_check('D cannot see blocks rows', (SELECT count(*) FROM blocks) = 0);

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
SELECT set_config('t.ab', get_or_create_direct_conversation('00000000-0000-0000-0000-00000000000b')::text, false);
SELECT t_check('same conversation reused', get_or_create_direct_conversation('00000000-0000-0000-0000-00000000000b')::text = current_setting('t.ab'));
INSERT INTO messages (conversation_id, sender_id, body) VALUES (current_setting('t.ab')::uuid, '00000000-0000-0000-0000-00000000000a', 'hey bob');
SELECT t_check('A cannot message blocked D', t_err($$SELECT get_or_create_direct_conversation('00000000-0000-0000-0000-00000000000d')$$) LIKE 'ERROR%');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
SELECT t_check('B has 1 unread', (SELECT unread FROM list_conversations()) = 1);
SELECT mark_conversation_read(current_setting('t.ab')::uuid);
SELECT t_check('B 0 unread after read', (SELECT unread FROM list_conversations()) = 0);
SELECT t_check('B to private C needs follow', t_err($$SELECT get_or_create_direct_conversation('00000000-0000-0000-0000-00000000000c')$$) LIKE '%follow_required%');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
SELECT set_config('t.cd', get_or_create_direct_conversation('00000000-0000-0000-0000-00000000000d')::text, false);
INSERT INTO messages (conversation_id, sender_id, body) VALUES (current_setting('t.cd')::uuid, '00000000-0000-0000-0000-00000000000c', 'hi dave');
SELECT t_check('C cannot read A-B messages (old bug)', (SELECT count(*) FROM messages WHERE body = 'hey bob') = 0);
SELECT t_check('C sees only own conversation', (SELECT count(*) FROM conversations) = 1 AND (SELECT count(*) FROM messages) = 1);
SELECT t_check('C cannot post into A-B conversation', t_err(format($$INSERT INTO messages (conversation_id, sender_id, body) VALUES (%L, '00000000-0000-0000-0000-00000000000c', 'x')$$, current_setting('t.ab'))) LIKE 'ERROR%');
SELECT t_check('conversation_members no recursion', t_err($$SELECT count(*) FROM conversation_members$$) = 'NO ERROR');
SELECT t_check('authenticated cannot consume_ai_call', t_err($$SELECT consume_ai_call('00000000-0000-0000-0000-00000000000c', 30)$$) LIKE '%permission denied%');
RESET ROLE;
SET ROLE service_role;
SELECT t_check('ai call 1 leaves 1', consume_ai_call('00000000-0000-0000-0000-00000000000c', 2) = 1);
SELECT t_check('ai call 2 leaves 0', consume_ai_call('00000000-0000-0000-0000-00000000000c', 2) = 0);
SELECT t_check('ai call 3 refused', consume_ai_call('00000000-0000-0000-0000-00000000000c', 2) = -1);
-- nutrition pipeline (009/010)
INSERT INTO foods (id, name, source, verified, cuisine) VALUES ('50000000-0000-0000-0000-000000000001','Rice, raw','ifct',true,'indian'),('50000000-0000-0000-0000-000000000002','Urad dal','ifct',true,'indian'),('50000000-0000-0000-0000-000000000003','Ghee','ifct',true,'indian');
INSERT INTO food_nutrition (food_id, calories, protein_g, carbs_g, fat_g, fiber_g) VALUES ('50000000-0000-0000-0000-000000000001',356,7.9,78,0.5,2.8),('50000000-0000-0000-0000-000000000002',333,24,59,1.4,11),('50000000-0000-0000-0000-000000000003',897,0,0,99.7,0);
INSERT INTO foods (id, name, source, is_dish, cuisine, aliases) VALUES ('50000000-0000-0000-0000-000000000010','Masala dosa','ai',true,'south_indian',ARRAY['dosai']);
INSERT INTO dish_ingredients (dish_food_id, ingredient_food_id, grams_per_serving) VALUES ('50000000-0000-0000-0000-000000000010','50000000-0000-0000-0000-000000000001',40),('50000000-0000-0000-0000-000000000010','50000000-0000-0000-0000-000000000002',15),('50000000-0000-0000-0000-000000000010','50000000-0000-0000-0000-000000000003',5);
SELECT t_check('dish nutrition = sum of ingredients (60 g serving)', (SELECT serving_grams FROM foods WHERE id='50000000-0000-0000-0000-000000000010') = 60 AND (SELECT round(calories) FROM food_nutrition WHERE food_id='50000000-0000-0000-0000-000000000010') = round((356*0.4+333*0.15+897*0.05)/60*100));
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
SELECT t_check('user sees global foods', (SELECT count(*) FROM foods WHERE owner_id IS NULL) >= 4);
SELECT t_check('user cannot write global foods', t_err($$INSERT INTO foods (name, source) VALUES ('Fake global','ifct')$$) LIKE 'ERROR%');
SELECT t_check('user cannot mark own food verified', t_err($$INSERT INTO foods (owner_id, name, source, verified) VALUES ('00000000-0000-0000-0000-00000000000b','Mine','user',true)$$) LIKE 'ERROR%');
SELECT t_check('user creates own food', t_err($$INSERT INTO foods (id, owner_id, name, source) VALUES ('50000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000b','Bob protein shake','user')$$) = 'NO ERROR');
SELECT t_check('user adds nutrition to own food', t_err($$INSERT INTO food_nutrition (food_id, calories, protein_g) VALUES ('50000000-0000-0000-0000-0000000000b1', 120, 24)$$) = 'NO ERROR');
SELECT t_check('user cannot edit global nutrition', t_err($$UPDATE food_nutrition SET calories = 1 WHERE food_id = '50000000-0000-0000-0000-000000000001'$$) = 'NO ERROR' AND (SELECT calories FROM food_nutrition WHERE food_id='50000000-0000-0000-0000-000000000001') = 356);
SELECT t_check('match_foods trigram finds masala dosa', (SELECT name FROM match_foods('masala dosa') LIMIT 1) = 'Masala dosa');
SELECT t_check('match_foods finds alias dosai', (SELECT count(*) FROM match_foods('dosai') WHERE name = 'Masala dosa') = 1);
SELECT t_check('match_foods returns generic servings', (SELECT servings @> '[{"unit":"katori"}]' FROM match_foods('masala dosa') LIMIT 1));
INSERT INTO meals (id, user_id, meal_type, log_date) VALUES ('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','breakfast','2026-11-20');
INSERT INTO meal_items (meal_id, food_id, name, amount_grams, calories, protein_g, carbs_g, fat_g, fibre_g, source) VALUES ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000010', 'Masala dosa', 120, 300, 8, 45, 9, 3, 'text_ai'), ('60000000-0000-0000-0000-000000000001', NULL, 'Coffee', 150, 80, 3, 9, 3, 0, 'manual');
SELECT t_check('nutrition_daily trigger totals 380 kcal', (SELECT kcal FROM nutrition_daily WHERE log_date='2026-11-20') = 380 AND (SELECT (per_meal->'breakfast'->>'items')::int FROM nutrition_daily WHERE log_date='2026-11-20') = 2);
UPDATE meals SET meal_type = 'lunch' WHERE id = '60000000-0000-0000-0000-000000000001';
SELECT t_check('moving meal updates per_meal', (SELECT per_meal ? 'lunch' AND NOT per_meal ? 'breakfast' FROM nutrition_daily WHERE log_date='2026-11-20'));
DELETE FROM meal_items WHERE name = 'Coffee';
SELECT t_check('delete item updates total', (SELECT kcal FROM nutrition_daily WHERE log_date='2026-11-20') = 300);
DELETE FROM meals WHERE id = '60000000-0000-0000-0000-000000000001';
SELECT t_check('deleting meal clears the day', NOT EXISTS (SELECT 1 FROM nutrition_daily WHERE log_date='2026-11-20'));
SELECT t_check('goals view shows only me', (SELECT count(*) FROM nutrition_goals) = 1 AND (SELECT user_id FROM nutrition_goals) = '00000000-0000-0000-0000-00000000000b');
SELECT t_check('food photo own folder allowed', t_err($$INSERT INTO storage.objects (bucket_id, name) VALUES ('food-photos','00000000-0000-0000-0000-00000000000b/x.webp')$$) = 'NO ERROR');
SELECT t_check('food photo other folder denied', t_err($$INSERT INTO storage.objects (bucket_id, name) VALUES ('food-photos','00000000-0000-0000-0000-00000000000a/x.webp')$$) LIKE 'ERROR%');
INSERT INTO favourite_meals (id, user_id, name) VALUES ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','My usual breakfast');
INSERT INTO coach_memory (user_id, note) VALUES ('00000000-0000-0000-0000-00000000000b','I am vegetarian');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
SELECT t_check('A cannot see B own food', (SELECT count(*) FROM foods WHERE name = 'Bob protein shake') = 0);
SELECT t_check('A cannot see B favourites or coach memory', (SELECT count(*) FROM favourite_meals) = 0 AND (SELECT count(*) FROM coach_memory) = 0);
SELECT t_check('A cannot read B food photo', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'food-photos') = 0);
SELECT t_check('A match_foods excludes B own food', (SELECT count(*) FROM match_foods('protein shake') WHERE name = 'Bob protein shake') = 0);
RESET ROLE;
SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);
SELECT t_check('anon cannot read profiles', t_err($$SELECT * FROM profiles$$) LIKE '%permission denied%');
SELECT t_check('anon cannot call get_feed', t_err($$SELECT * FROM get_feed()$$) LIKE '%permission denied%');
SELECT t_check('anon cannot call private helper', t_err($$SELECT private.is_blocked_between(gen_random_uuid(), gen_random_uuid())$$) LIKE '%permission denied%');
RESET ROLE;
SELECT t_check('every public table has RLS', NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity));
