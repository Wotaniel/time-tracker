-- Перенос исторических событий Google Meet в отдельную дорожку созвонов.
--
-- Старый код писал созвон параллельным событием, и время считалось дважды
-- (созвон + работа в тех же SUM(duration)). Код исправлен, но в базе остались
-- такие записи. Переносим их в meetings, чтобы прошлые дни тоже не складывали
-- созвон с работой.
--
-- ts_end нормализуем: у двух записей он оказался раньше ts_start (гонка при
-- закрытии фонового события), и интервал с отрицательной длительностью
-- нарисовать нельзя.
INSERT INTO meetings (ts_start, ts_end, url, title)
SELECT ts_start,
       CASE WHEN ts_end < ts_start THEN ts_start ELSE ts_end END,
       url,
       window_title
FROM events
WHERE app_name = 'Google Meet' AND is_afk = 0;

DELETE FROM events
WHERE app_name = 'Google Meet' AND is_afk = 0;
