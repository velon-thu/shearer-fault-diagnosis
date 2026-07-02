// Package defs 加载 seed/ 内嵌的定义 CSV，并提供 ORG 表达式解析与求值。
package defs

import (
	"encoding/csv"
	"fmt"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"

	"shearer/dataplane/internal/orgfile"
	"shearer/dataplane/seed"
)

// OrgExpr 一条 ORG 映射表达式。
type OrgExpr struct {
	Kind     string // val / bit / bitrange / none
	Col      int    // org 列号（1~609）
	BitLo    int
	BitHi    int
	Inverted bool // "-C" 后缀（触发逻辑反转，写入值不反转）
}

var (
	reBitRange = regexp.MustCompile(`^(\d+)Bit(\d+)-(\d+)$`)
	reBit      = regexp.MustCompile(`^(\d+)Bit(\d+)(-C)?$`)
	reValC     = regexp.MustCompile(`^(\d+)-(C|CN)$`)
	reEcspds   = regexp.MustCompile(`^ecspds\.(\d+)\.(\d+)-C$`)
)

// ParseOrg 解析 ORG 写法。空串 → kind=none（恒写 0）。
func ParseOrg(s string) (OrgExpr, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return OrgExpr{Kind: "none"}, nil
	}
	if m := reBitRange.FindStringSubmatch(s); m != nil {
		return OrgExpr{Kind: "bitrange", Col: atoi(m[1]), BitLo: atoi(m[2]), BitHi: atoi(m[3])}, nil
	}
	if m := reBit.FindStringSubmatch(s); m != nil {
		return OrgExpr{Kind: "bit", Col: atoi(m[1]), BitLo: atoi(m[2]), BitHi: atoi(m[2]), Inverted: m[3] == "-C"}, nil
	}
	if m := reEcspds.FindStringSubmatch(s); m != nil { // Excel 疑点写法，按 colBit(bit) 反逻辑处理
		return OrgExpr{Kind: "bit", Col: atoi(m[1]), BitLo: atoi(m[2]), BitHi: atoi(m[2]), Inverted: true}, nil
	}
	if m := reValC.FindStringSubmatch(s); m != nil {
		return OrgExpr{Kind: "val", Col: atoi(m[1]), Inverted: true}, nil
	}
	if n, err := strconv.Atoi(s); err == nil {
		return OrgExpr{Kind: "val", Col: n}, nil
	}
	return OrgExpr{}, fmt.Errorf("无法解析的 ORG 写法: %q", s)
}

func atoi(s string) int { n, _ := strconv.Atoi(s); return n }

// Eval 从一条 org 记录求出写入共享内存的原始值。
// 注意 "-C" 不反转写入值——反转语义在 collector 的故障触发侧处理。
func (e OrgExpr) Eval(r *orgfile.Record) uint16 {
	switch e.Kind {
	case "val":
		return r.Col(e.Col)
	case "bit":
		return r.Bit(e.Col, e.BitLo)
	case "bitrange":
		width := e.BitHi - e.BitLo + 1
		return (r.Col(e.Col) >> e.BitLo) & uint16((1<<width)-1)
	case "const": // 固定值（展示性覆盖用）
		return uint16(e.Col)
	default: // none
		return 0
	}
}

// DefaultSyncOrgTsMs 回放同步点：org 时间 2026-06-30 00:00:00 (+08:00)。
// 该点之前 24h 由 collector 预载入库，之后由 replayer 直播灌入。
const DefaultSyncOrgTsMs int64 = 1782748800000

// SensorDef 值型变量定义（sensor_data_defi）。
type SensorDef struct {
	Category string
	Name     string
	Add      int
	StdTag   string
	Accuracy float64
	Unit     string
	OrgRaw   string
	Org      OrgExpr
	Signed   bool
	Sheet    string
}

// Engineering 原始字 → 工程值（入库统一保留两位小数）。
func (d *SensorDef) Engineering(raw uint16) float64 {
	v := float64(raw)
	if d.Signed {
		v = float64(int16(raw))
	}
	return math.Round(v*d.Accuracy*100) / 100
}

// StatusDef 布尔变量定义（status_data_defi）。
type StatusDef struct {
	Category string
	Status   string
	Add      int
	StdTag   string
	OrgRaw   string
	Org      OrgExpr
	Sheet    string
}

// FaultDef 故障位定义（fault_map）。Trigger: bit / bit_inv / eq:N / neq:N / fifo。
type FaultDef struct {
	Code    int
	OrgRaw  string
	Org     OrgExpr
	Name    string
	Trigger string
	Module  string // 仅 fifo：BOC/HPC/MOC
}

// Active 按触发规则判断当前共享内存值是否表示故障激活。
func (f *FaultDef) Active(v uint16) bool {
	switch {
	case f.Trigger == "bit":
		return v == 1
	case f.Trigger == "bit_inv":
		return v == 0
	case strings.HasPrefix(f.Trigger, "eq:"):
		return int(v) == atoi(f.Trigger[3:])
	case strings.HasPrefix(f.Trigger, "neq:"):
		return int(v) != atoi(f.Trigger[4:])
	}
	return false
}

// OpsGroup 操作来源组（ops_map）。32 位操作码 = 高字(addr_hi)<<16 | 低字(addr_lo)。
type OpsGroup struct {
	GroupNo    int
	SourceName string
	SourceType string // 输入 / 输出
	AddrHi     int
	AddrLo     int
	OrgHi      int
	OrgLo      int
}

// RuleRow 故障规则行（fault_rule / fault_boc_hpc_rule / fault_moc_rule）。
type RuleRow struct {
	Code   int
	Name   string
	Type   int
	Kind   int
	Handle string // 仅 fault_rule 有
}

// Defs 全部定义。
type Defs struct {
	Sensors    []SensorDef
	Statuses   []StatusDef
	Faults     []FaultDef
	Ops        []OpsGroup
	FaultRule  []RuleRow
	BocHpcRule []RuleRow
	MocRule    []RuleRow
}

// WriteInstr 回放器的一条写入指令。
type WriteInstr struct {
	Addr int
	Expr OrgExpr
}

// WritePlan 汇总所有需要 org→共享内存 的写入指令（含操作 1900/1901 总和输入）。
func (d *Defs) WritePlan() []WriteInstr {
	var plan []WriteInstr
	for _, s := range d.Sensors {
		plan = append(plan, WriteInstr{s.Add, s.Org})
	}
	for _, s := range d.Statuses {
		plan = append(plan, WriteInstr{s.Add, s.Org})
	}
	for _, f := range d.Faults {
		plan = append(plan, WriteInstr{f.Code, f.Org})
	}
	// 操作组双字 + 总和输入（1900/1901 ← org 130/131，collector 侧忽略）
	plan = append(plan, WriteInstr{1900, OrgExpr{Kind: "val", Col: 130}})
	plan = append(plan, WriteInstr{1901, OrgExpr{Kind: "val", Col: 131}})
	for _, g := range d.Ops {
		plan = append(plan, WriteInstr{g.AddrHi, OrgExpr{Kind: "val", Col: g.OrgHi}})
		plan = append(plan, WriteInstr{g.AddrLo, OrgExpr{Kind: "val", Col: g.OrgLo}})
	}
	// 展示性覆盖（追加在最后，覆盖前面的映射写入）：
	// 现有 org 数据源第 285 列（BOC 通讯值，地址 2000）几乎全程为 0，
	// 为满足"启动即 BOC 正常"的演示需求，固定写 1。接入真实数据源后删除。
	plan = append(plan, WriteInstr{2000, OrgExpr{Kind: "const", Col: 1}})
	return plan
}

// Load 从内嵌种子加载全部定义。
func Load() (*Defs, error) {
	d := &Defs{}

	err := readCSV("sensor_data_defi.csv", func(row map[string]string) error {
		org, err := ParseOrg(row["org"])
		if err != nil {
			return err
		}
		acc, _ := strconv.ParseFloat(row["accuracy"], 64)
		d.Sensors = append(d.Sensors, SensorDef{
			Category: row["category"], Name: row["name"], Add: atoi(row["add"]),
			StdTag: row["std_tag"], Accuracy: acc, Unit: row["unit"],
			OrgRaw: row["org"], Org: org, Signed: row["signed"] == "1", Sheet: row["sheet"],
		})
		return nil
	})
	if err != nil {
		return nil, err
	}

	err = readCSV("status_data_defi.csv", func(row map[string]string) error {
		org, err := ParseOrg(row["org"])
		if err != nil {
			return err
		}
		d.Statuses = append(d.Statuses, StatusDef{
			Category: row["category"], Status: row["status"], Add: atoi(row["add"]),
			StdTag: row["std_tag"], OrgRaw: row["org"], Org: org, Sheet: row["sheet"],
		})
		return nil
	})
	if err != nil {
		return nil, err
	}

	err = readCSV("fault_map.csv", func(row map[string]string) error {
		org, err := ParseOrg(row["org"])
		if err != nil {
			return err
		}
		d.Faults = append(d.Faults, FaultDef{
			Code: atoi(row["fault_code"]), OrgRaw: row["org"], Org: org,
			Name: row["name"], Trigger: row["trigger"], Module: row["module_name"],
		})
		return nil
	})
	if err != nil {
		return nil, err
	}

	err = readCSV("ops_map.csv", func(row map[string]string) error {
		d.Ops = append(d.Ops, OpsGroup{
			GroupNo: atoi(row["group_no"]), SourceName: row["source_name"], SourceType: row["source_type"],
			AddrHi: atoi(row["addr_hi"]), AddrLo: atoi(row["addr_lo"]),
			OrgHi: atoi(row["org_hi"]), OrgLo: atoi(row["org_lo"]),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}

	loadRule := func(file string, dst *[]RuleRow, codeField string) error {
		return readCSV(file, func(row map[string]string) error {
			*dst = append(*dst, RuleRow{
				Code: atoi(row[codeField]), Name: row["name"],
				Type: atoi(row["type"]), Kind: atoi(row["kind"]), Handle: row["handle"],
			})
			return nil
		})
	}
	if err := loadRule("fault_rule.csv", &d.FaultRule, "fault_code"); err != nil {
		return nil, err
	}
	if err := loadRule("fault_boc_hpc_rule.csv", &d.BocHpcRule, "code"); err != nil {
		return nil, err
	}
	if err := loadRule("fault_moc_rule.csv", &d.MocRule, "code"); err != nil {
		return nil, err
	}
	return d, nil
}

func readCSV(name string, fn func(map[string]string) error) error {
	f, err := seed.FS.Open(name)
	if err != nil {
		return fmt.Errorf("打开内嵌 %s: %w", name, err)
	}
	defer f.Close()
	r := csv.NewReader(f)
	hdr, err := r.Read()
	if err != nil {
		return err
	}
	hdr[0] = strings.TrimPrefix(hdr[0], "\ufeff") // 照搬的 CSV 可能带 BOM
	for {
		rec, err := r.Read()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		row := make(map[string]string, len(hdr))
		for i, h := range hdr {
			if i < len(rec) {
				row[h] = rec[i]
			}
		}
		if err := fn(row); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
}
