-- Раньше в meetings.title лежал источник («Google Meet», «Slack huddle»).
-- Теперь нужны оба: источник — чтобы знать, откуда созвон, title — чтобы
-- показывать название встречи (а для хаддла ещё и участника).
ALTER TABLE meetings ADD COLUMN source TEXT;

-- Переносим источник в новую колонку. У старых фоновых событий Meet
-- (миграция 008) там была строка «Meeting (background)».
UPDATE meetings
SET source = CASE WHEN title = 'Meeting (background)' THEN 'Google Meet' ELSE title END,
    title = NULL;
