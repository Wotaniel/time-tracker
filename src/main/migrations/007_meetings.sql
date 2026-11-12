-- Созвон — отдельная дорожка, а не прибавка ко времени.
--
-- Время остаётся одним: активность приложений. Созвон пишется отдельными
-- интервалами и показывается наложением, поэтому параллельная работа в Figma
-- и разговор в Meet оба видны, но день не считается дважды.
--
-- ts_end может быть NULL, пока созвон идёт: детектор продлевает интервал,
-- пока видит вкладку встречи, и закрывает его по таймауту.
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_start TEXT NOT NULL,
  ts_end TEXT,
  url TEXT,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meetings_ts_start ON meetings(ts_start);
CREATE INDEX IF NOT EXISTS idx_meetings_ts_end ON meetings(ts_end);
