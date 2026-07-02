// Package store SQLite 存储：建表、灌种子、采集写入。
//
// 时间戳约定：全库统一 Unix 毫秒（INTEGER）。
// 数据库持续累积，任何程序重启都不清空业务表；
// 定义/规则表（*_defi、*_rule、fault_map、ops_map）每次启动由种子覆盖重建。
package store

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"

	"shearer/dataplane/internal/defs"
)

// Open 打开（必要时创建）数据库，WAL 模式。
func Open(path string) (*sql.DB, error) {
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // 单写者
	if err := db.Ping(); err != nil {
		return nil, err
	}
	return db, nil
}

const schema = `
-- ===== 定义/规则表（每次启动由种子覆盖） =====
CREATE TABLE IF NOT EXISTS sensor_data_defi (
  "add"     INTEGER PRIMARY KEY,   -- 共享内存地址
  category  TEXT NOT NULL,         -- 部件名称
  name      TEXT NOT NULL,         -- 具体内容
  std_tag   TEXT NOT NULL UNIQUE,  -- 英文变量名
  accuracy  REAL NOT NULL,         -- 工程系数
  unit      TEXT NOT NULL,         -- 单位
  org       TEXT NOT NULL,         -- ORG 映射表达式（空=未映射）
  signed    INTEGER NOT NULL,      -- 1=按 int16 解释
  sheet     TEXT NOT NULL          -- 来源 sheet
);
CREATE TABLE IF NOT EXISTS status_data_defi (
  "add"     INTEGER PRIMARY KEY,
  category  TEXT NOT NULL,
  status    TEXT NOT NULL,
  std_tag   TEXT NOT NULL UNIQUE,
  org       TEXT NOT NULL,
  sheet     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fault_map (
  fault_code  INTEGER PRIMARY KEY, -- =共享内存地址
  org         TEXT NOT NULL,
  name        TEXT NOT NULL,
  trigger     TEXT NOT NULL,       -- bit / bit_inv / eq:N / neq:N / fifo
  module_name TEXT NOT NULL        -- 仅 fifo：BOC/HPC/MOC
);
CREATE TABLE IF NOT EXISTS ops_map (
  group_no    INTEGER PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  addr_hi     INTEGER NOT NULL,
  addr_lo     INTEGER NOT NULL,
  org_hi      INTEGER NOT NULL,
  org_lo      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fault_rule (
  fault_code INTEGER PRIMARY KEY,
  name   TEXT NOT NULL,
  type   INTEGER NOT NULL,  -- 0提示 1警告 2停机
  kind   INTEGER NOT NULL,  -- 1变频器 2电机 3模块 4传感器 5自动化 6内部 7来源
  handle TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fault_boc_hpc_rule (
  code INTEGER PRIMARY KEY, name TEXT NOT NULL, type INTEGER NOT NULL, kind INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fault_moc_rule (
  code INTEGER PRIMARY KEY, name TEXT NOT NULL, type INTEGER NOT NULL, kind INTEGER NOT NULL
);

-- ===== 业务表（持续累积） =====
CREATE TABLE IF NOT EXISTS sensor_hyper (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,        -- Unix 毫秒
  std_tag TEXT NOT NULL,
  value   REAL NOT NULL            -- 工程值（原始值×accuracy）
);
CREATE INDEX IF NOT EXISTS idx_sensor_hyper_tag_ts ON sensor_hyper(std_tag, ts);
CREATE INDEX IF NOT EXISTS idx_sensor_hyper_ts ON sensor_hyper(ts);

CREATE TABLE IF NOT EXISTS state_hyper (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,
  std_tag    TEXT NOT NULL,
  state_code INTEGER NOT NULL      -- 0/1
);
CREATE INDEX IF NOT EXISTS idx_state_hyper_tag_ts ON state_hyper(std_tag, ts);
CREATE INDEX IF NOT EXISTS idx_state_hyper_ts ON state_hyper(ts);

CREATE TABLE IF NOT EXISTS device_action (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occur_ts    INTEGER NOT NULL,
  source_type TEXT NOT NULL,       -- 输入/输出
  source_name TEXT NOT NULL,       -- 操作来源
  op_name     TEXT NOT NULL,       -- 指令内容
  action      TEXT NOT NULL        -- 按下/松开
);
CREATE INDEX IF NOT EXISTS idx_device_action_ts ON device_action(occur_ts);

CREATE TABLE IF NOT EXISTS fault_normal (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  fault_code INTEGER NOT NULL,
  occur_ts   INTEGER NOT NULL,
  clear_ts   INTEGER,              -- NULL=未结束
  status     INTEGER NOT NULL      -- 1=进行中 0=已结束
);
CREATE INDEX IF NOT EXISTS idx_fault_normal_code ON fault_normal(fault_code);
CREATE INDEX IF NOT EXISTS idx_fault_normal_occur ON fault_normal(occur_ts);
CREATE INDEX IF NOT EXISTS idx_fault_normal_open ON fault_normal(status) WHERE status=1;

CREATE TABLE IF NOT EXISTS fault_internal (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  fault_code  INTEGER NOT NULL,
  occur_ts    INTEGER NOT NULL,
  module_name TEXT NOT NULL        -- BOC/HPC/MOC
);
CREATE INDEX IF NOT EXISTS idx_fault_internal_ts ON fault_internal(occur_ts);

-- FIFO 基准持久化（跨重启比对，防止重启后把旧值当新值）
CREATE TABLE IF NOT EXISTS fifo_state (
  module_name TEXT PRIMARY KEY,    -- BOC/HPC/MOC
  w0 INTEGER NOT NULL, w1 INTEGER NOT NULL, w2 INTEGER NOT NULL, w3 INTEGER NOT NULL,
  updated_ts  INTEGER NOT NULL
);
`

// Init 建表并用种子覆盖定义/规则表。
func Init(db *sql.DB, d *defs.Defs) error {
	if _, err := db.Exec(schema); err != nil {
		return fmt.Errorf("建表: %w", err)
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, t := range []string{"sensor_data_defi", "status_data_defi", "fault_map", "ops_map",
		"fault_rule", "fault_boc_hpc_rule", "fault_moc_rule"} {
		if _, err := tx.Exec("DELETE FROM " + t); err != nil {
			return err
		}
	}
	for _, s := range d.Sensors {
		if _, err := tx.Exec(`INSERT INTO sensor_data_defi("add",category,name,std_tag,accuracy,unit,org,signed,sheet)
			VALUES(?,?,?,?,?,?,?,?,?)`,
			s.Add, s.Category, s.Name, s.StdTag, s.Accuracy, s.Unit, s.OrgRaw, b2i(s.Signed), s.Sheet); err != nil {
			return fmt.Errorf("seed sensor %s: %w", s.StdTag, err)
		}
	}
	for _, s := range d.Statuses {
		if _, err := tx.Exec(`INSERT INTO status_data_defi("add",category,status,std_tag,org,sheet)
			VALUES(?,?,?,?,?,?)`,
			s.Add, s.Category, s.Status, s.StdTag, s.OrgRaw, s.Sheet); err != nil {
			return fmt.Errorf("seed status %s: %w", s.StdTag, err)
		}
	}
	for _, f := range d.Faults {
		if _, err := tx.Exec(`INSERT INTO fault_map(fault_code,org,name,trigger,module_name)
			VALUES(?,?,?,?,?)`, f.Code, f.OrgRaw, f.Name, f.Trigger, f.Module); err != nil {
			return err
		}
	}
	for _, g := range d.Ops {
		if _, err := tx.Exec(`INSERT INTO ops_map(group_no,source_name,source_type,addr_hi,addr_lo,org_hi,org_lo)
			VALUES(?,?,?,?,?,?,?)`, g.GroupNo, g.SourceName, g.SourceType, g.AddrHi, g.AddrLo, g.OrgHi, g.OrgLo); err != nil {
			return err
		}
	}
	for _, r := range d.FaultRule {
		if _, err := tx.Exec(`INSERT INTO fault_rule(fault_code,name,type,kind,handle) VALUES(?,?,?,?,?)`,
			r.Code, r.Name, r.Type, r.Kind, r.Handle); err != nil {
			return err
		}
	}
	for _, r := range d.BocHpcRule {
		if _, err := tx.Exec(`INSERT INTO fault_boc_hpc_rule(code,name,type,kind) VALUES(?,?,?,?)`,
			r.Code, r.Name, r.Type, r.Kind); err != nil {
			return err
		}
	}
	for _, r := range d.MocRule {
		if _, err := tx.Exec(`INSERT INTO fault_moc_rule(code,name,type,kind) VALUES(?,?,?,?)`,
			r.Code, r.Name, r.Type, r.Kind); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// CloseStaleFaults 关闭上次运行遗留的未结束故障（collector 启动时调用）。
func CloseStaleFaults(db *sql.DB, nowMs int64) (int64, error) {
	res, err := db.Exec(`UPDATE fault_normal SET status=0, clear_ts=? WHERE status=1`, nowMs)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// LoadFifoState 读 FIFO 基准；无记录返回 ok=false。
func LoadFifoState(db *sql.DB, module string) (w [4]uint16, ok bool, err error) {
	var a, b, c, d int
	row := db.QueryRow(`SELECT w0,w1,w2,w3 FROM fifo_state WHERE module_name=?`, module)
	switch e := row.Scan(&a, &b, &c, &d); e {
	case nil:
		return [4]uint16{uint16(a), uint16(b), uint16(c), uint16(d)}, true, nil
	case sql.ErrNoRows:
		return w, false, nil
	default:
		return w, false, e
	}
}

// SaveFifoState 写 FIFO 基准。
func SaveFifoState(db *sql.DB, module string, w [4]uint16, tsMs int64) error {
	_, err := db.Exec(`INSERT INTO fifo_state(module_name,w0,w1,w2,w3,updated_ts) VALUES(?,?,?,?,?,?)
		ON CONFLICT(module_name) DO UPDATE SET w0=?,w1=?,w2=?,w3=?,updated_ts=?`,
		module, w[0], w[1], w[2], w[3], tsMs, w[0], w[1], w[2], w[3], tsMs)
	return err
}
