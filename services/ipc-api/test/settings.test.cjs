const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { SettingsSnapshotSchema } = require("@shearer/contracts");
const { SQLITE_SCHEMA_STATEMENTS } = require("../dist/db/schema.js");
const { readSettingsFromSqlite } = require("../dist/db/settings.js");

const legacyConnection = {
  tabletToIpc: "connected",
  hpc: "warn",
  moc: "error",
  boc: "offline",
  syncAt: "2026-10-12T00:00:00.000Z",
};

for (const [label, connection] of [
  ["旧版三个模块", legacyConnection],
  ["新版八个模块", {
    ...legacyConnection,
    axi: "ok", wcr: "warn", sgc: "error", bp1: "offline", bp2: "ok",
  }],
]) {
  test(`设置读取兼容${label}，保留已存状态且不改写配置`, () => {
    const db = new DatabaseSync(":memory:");
    try {
      for (const statement of SQLITE_SCHEMA_STATEMENTS) db.exec(statement);
      const stored = JSON.stringify(connection);
      db.prepare("INSERT INTO system_config (config_key, config_value) VALUES (?, ?)")
        .run("settings.connection", stored);

      const snapshot = SettingsSnapshotSchema.parse(readSettingsFromSqlite(db));
      assert.deepEqual(snapshot.connection, {
        axi: "offline", wcr: "offline", sgc: "offline", bp1: "offline", bp2: "offline",
        ...connection,
      });
      assert.equal(
        db.prepare("SELECT config_value FROM system_config WHERE config_key = ?")
          .get("settings.connection").config_value,
        stored,
      );
    } finally {
      db.close();
    }
  });
}
