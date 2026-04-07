import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SQLITE_SCHEMA_STATEMENTS } from "./schema";

const packageRoot = resolve(__dirname, "..", "..");
const dataDirectory = resolve(packageRoot, "data");
const sqlitePath = resolve(dataDirectory, "ipc.db");

let sqlite: DatabaseSync | null = null;

export const getSqlitePath = () => sqlitePath;

export const initializeSqlite = () => {
  if (sqlite) {
    return sqlite;
  }

  mkdirSync(dataDirectory, {
    recursive: true,
  });

  sqlite = new DatabaseSync(sqlitePath);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA journal_mode = WAL;");

  for (const statement of SQLITE_SCHEMA_STATEMENTS) {
    sqlite.exec(statement);
  }

  return sqlite;
};
