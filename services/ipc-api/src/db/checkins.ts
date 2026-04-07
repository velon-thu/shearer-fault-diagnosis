import type {
  CheckinCalendarRecord,
  CheckinHistoryEntry,
  CheckinStatus,
  CheckinsResponse,
  CheckinsSubmitRequest,
} from "@shearer/contracts";
import { type DatabaseSync } from "node:sqlite";
import {
  checkinTodayDate,
  getInitialCheckinItems,
  initialCheckinCalendarRecords,
  initialCheckinHistoryData,
} from "../mock";
import { initializeSqlite } from "./sqlite";

type CheckinRecordRow = {
  checkin_date: string;
  status: CheckinStatus;
  shift: string;
  person: string;
  result: string;
  note: string;
  detail: string;
  checked_item_ids: string | null;
  show_in_history: number;
};

const CHECKIN_TABLE = "checkin_records";

const getCheckinTableColumns = (db: DatabaseSync) =>
  db
    .prepare(`PRAGMA table_info(${CHECKIN_TABLE})`)
    .all() as Array<{ name: string }>;

const ensureColumn = (
  db: DatabaseSync,
  columnName: string,
  definition: string,
) => {
  const existing = new Set(getCheckinTableColumns(db).map((column) => column.name));

  if (!existing.has(columnName)) {
    db.exec(`ALTER TABLE ${CHECKIN_TABLE} ADD COLUMN ${columnName} ${definition}`);
  }
};

const normalizeCheckinRows = (db: DatabaseSync) => {
  db.exec(`
    DELETE FROM ${CHECKIN_TABLE}
    WHERE id NOT IN (
      SELECT MAX(id)
      FROM ${CHECKIN_TABLE}
      GROUP BY checkin_date
    )
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_records_date_unique
    ON ${CHECKIN_TABLE}(checkin_date)
  `);

  db.exec(`
    UPDATE ${CHECKIN_TABLE}
    SET status = CASE
      WHEN result = '未打卡' THEN 'missed'
      WHEN result IN ('部分完成', '补检完成') THEN 'partial'
      ELSE 'done'
    END
    WHERE status IS NULL OR status = ''
  `);

  db.exec(`
    UPDATE ${CHECKIN_TABLE}
    SET show_in_history = 0
    WHERE show_in_history IS NULL
  `);
};

const getSeedCheckedItemIds = (date: string, status: CheckinStatus, note: string) => {
  const defaultItems = getInitialCheckinItems();

  if (date === checkinTodayDate) {
    return defaultItems.filter((item) => item.checked).map((item) => item.id);
  }

  if (status === "missed") {
    return [];
  }

  if (status === "done") {
    return defaultItems.map((item) => item.id);
  }

  const match = note.match(/^(\d+)\/(\d+)/);
  const checkedCount = match ? Number(match[1]) : Math.max(defaultItems.length - 1, 1);

  return defaultItems.slice(0, checkedCount).map((item) => item.id);
};

const upsertCheckinRecord = (
  db: DatabaseSync,
  {
    checkedItemIds,
    checkinDate,
    detail,
    note,
    person,
    result,
    shift,
    showInHistory,
    status,
  }: {
    checkinDate: string;
    status: CheckinStatus;
    shift: string;
    person: string;
    result: string;
    note: string;
    detail: string;
    checkedItemIds: string[];
    showInHistory: number;
  },
) => {
  db.prepare(
    `
      INSERT INTO ${CHECKIN_TABLE} (
        checkin_date,
        status,
        shift,
        person,
        result,
        note,
        detail,
        checked_item_ids,
        show_in_history
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(checkin_date) DO UPDATE SET
        status = excluded.status,
        shift = excluded.shift,
        person = excluded.person,
        result = excluded.result,
        note = excluded.note,
        detail = excluded.detail,
        checked_item_ids = excluded.checked_item_ids,
        show_in_history = excluded.show_in_history,
        created_at = CURRENT_TIMESTAMP
    `,
  ).run(
    checkinDate,
    status,
    shift,
    person,
    result,
    note,
    detail,
    JSON.stringify(checkedItemIds),
    showInHistory,
  );
};

const parseCheckedItemIds = (raw: string | null): string[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const toHistoryEntry = (row: CheckinRecordRow): CheckinHistoryEntry => ({
  date: row.checkin_date,
  shift: row.shift,
  person: row.person,
  result: row.result,
  note: row.note,
});

const toCalendarRecord = (row: CheckinRecordRow): CheckinCalendarRecord => ({
  status: row.status,
  shift: row.shift,
  person: row.person,
  result: row.result,
  note: row.note,
  detail: row.detail,
});

const readCheckinRows = (db: DatabaseSync) =>
  db.prepare(
    `
      SELECT
        checkin_date,
        status,
        shift,
        person,
        result,
        note,
        detail,
        checked_item_ids,
        show_in_history
      FROM ${CHECKIN_TABLE}
      ORDER BY checkin_date DESC
    `,
  ).all() as CheckinRecordRow[];

export const initializeCheckinStore = (db: DatabaseSync = initializeSqlite()) => {
  ensureColumn(db, "status", "TEXT");
  ensureColumn(db, "show_in_history", "INTEGER NOT NULL DEFAULT 0");
  normalizeCheckinRows(db);

  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${CHECKIN_TABLE}`).get() as { count: number };

  if (row.count > 0) {
    return db;
  }

  const historyVisibleDates = new Set(initialCheckinHistoryData.map((item) => item.date));

  for (const [date, record] of Object.entries(initialCheckinCalendarRecords)) {
    upsertCheckinRecord(db, {
      checkinDate: date,
      status: record.status,
      shift: record.shift,
      person: record.person,
      result: record.result,
      note: record.note,
      detail: record.detail,
      checkedItemIds: getSeedCheckedItemIds(date, record.status, record.note),
      showInHistory: historyVisibleDates.has(date) ? 1 : 0,
    });
  }

  return db;
};

export const readCheckinsFromSqlite = (
  db: DatabaseSync = initializeCheckinStore(),
): CheckinsResponse => {
  const rows = readCheckinRows(initializeCheckinStore(db));
  const currentTodayRow = rows.find((row) => row.checkin_date === checkinTodayDate);
  const checkedIds = new Set(
    currentTodayRow
      ? parseCheckedItemIds(currentTodayRow.checked_item_ids)
      : getInitialCheckinItems()
          .filter((item) => item.checked)
          .map((item) => item.id),
  );

  return {
    todayDate: checkinTodayDate,
    todayItems: getInitialCheckinItems().map((item) => ({
      ...item,
      checked: checkedIds.has(item.id),
    })),
    historyData: rows.filter((row) => row.show_in_history === 1).map(toHistoryEntry),
    calendarRecords: Object.fromEntries(
      rows.map((row) => [row.checkin_date, toCalendarRecord(row)]),
    ),
  };
};

export const saveCheckinToSqlite = (
  payload: CheckinsSubmitRequest,
  db: DatabaseSync = initializeCheckinStore(),
): CheckinsResponse => {
  const defaultItems = getInitialCheckinItems();
  const validIds = new Set(defaultItems.map((item) => item.id));
  const checkedItemIds = payload.checkedItemIds.filter((itemId) => validIds.has(itemId));
  const checkedCount = checkedItemIds.length;
  const total = defaultItems.length;
  const status: CheckinStatus =
    checkedCount === total ? "done" : checkedCount > 0 ? "partial" : "missed";
  const result =
    status === "done" ? "已完成" : status === "partial" ? "部分完成" : "未打卡";
  const note = `${checkedCount}/${total} 项已确认`;

  upsertCheckinRecord(initializeCheckinStore(db), {
    checkinDate: checkinTodayDate,
    status,
    shift: "当前班次",
    person: "当前点检员",
    result,
    note,
    detail: "由平板端提交的当日点检记录（原型示意）。",
    checkedItemIds,
    showInHistory: 1,
  });

  return readCheckinsFromSqlite(db);
};
