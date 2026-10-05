-- Event details expire after 30 days. UUID receipts retain replay protection.
CREATE TABLE event_receipts (
  event_id TEXT PRIMARY KEY
) WITHOUT ROWID;

CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('page', 'article', 'search')),
  page TEXT NOT NULL,
  item_id TEXT NOT NULL,
  period TEXT NOT NULL,
  at TEXT NOT NULL,
  visitor TEXT,
  CHECK ((kind = 'page' AND item_id = '' AND visitor IS NOT NULL)
    OR (kind <> 'page' AND item_id <> '' AND visitor IS NULL))
);
CREATE INDEX events_recent_search ON events(kind, at DESC);
CREATE INDEX events_expiration ON events(at);

CREATE TABLE metrics (
  period TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('page', 'article', 'search', 'visitor')),
  item_id TEXT NOT NULL,
  count INTEGER NOT NULL,
  last_at TEXT NOT NULL,
  PRIMARY KEY (period, kind, item_id)
) WITHOUT ROWID;

CREATE TABLE unique_visitors (
  period TEXT NOT NULL,
  visitor TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (period, visitor)
) WITHOUT ROWID;

CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TRIGGER count_new_visitor AFTER INSERT ON unique_visitors BEGIN
  INSERT INTO metrics(period, kind, item_id, count, last_at)
    VALUES (NEW.period, 'visitor', '', 1, NEW.at)
    ON CONFLICT(period, kind, item_id) DO UPDATE SET
      count = count + 1, last_at = MAX(last_at, excluded.last_at);
END;

CREATE TRIGGER count_new_event AFTER INSERT ON events BEGIN
  INSERT INTO event_receipts(event_id) VALUES (NEW.event_id);
  INSERT INTO metadata(key, value) VALUES ('started_at', NEW.at)
    ON CONFLICT(key) DO UPDATE SET value = MIN(value, excluded.value);

  INSERT INTO metrics(period, kind, item_id, count, last_at)
    VALUES ('all', NEW.kind, CASE WHEN NEW.kind = 'page' THEN NEW.page ELSE NEW.item_id END, 1, NEW.at)
    ON CONFLICT(period, kind, item_id) DO UPDATE SET
      count = count + 1, last_at = MAX(last_at, excluded.last_at);
  INSERT INTO metrics(period, kind, item_id, count, last_at)
    VALUES (NEW.period, NEW.kind, CASE WHEN NEW.kind = 'page' THEN NEW.page ELSE NEW.item_id END, 1, NEW.at)
    ON CONFLICT(period, kind, item_id) DO UPDATE SET
      count = count + 1, last_at = MAX(last_at, excluded.last_at);

  INSERT INTO unique_visitors(period, visitor, at)
    SELECT 'all', NEW.visitor, NEW.at WHERE NEW.kind = 'page'
    ON CONFLICT(period, visitor) DO NOTHING;
  INSERT INTO unique_visitors(period, visitor, at)
    SELECT NEW.period, NEW.visitor, NEW.at WHERE NEW.kind = 'page'
    ON CONFLICT(period, visitor) DO NOTHING;
END;
