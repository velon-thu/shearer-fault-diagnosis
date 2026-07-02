# ORG 数据包解析规则（本项目版）

本文档是本项目（采煤机故障诊断点检仪）的 org 数据解析规则，提炼自 `docs/ORG数据包Go解析说明.md`，并按本项目需求做了两处关键调整：

1. **删除"按秒去重"规则**——保留毫秒级原始数据，同一秒内的多条记录全部保留；
2. 新增 **org → 共享内存** 的映射与回放约定（第 5、6 节），作为 org-replayer / collector 两个数据面程序的实现依据。

数据源文件位于 `testdata/*.org`（c2026-06-26 ~ c2026-06-30，已入库）。

## 1. 文件整体结构

文件名形如 `c2026-06-26.org`。**文件名以 `c` 开头表示文件体经过 zlib 压缩**：

```
+----------------+--------------------------------------+
| 4 字节文件头    | zlib 压缩流（deflate，带 zlib 头 78 9C）|
+----------------+--------------------------------------+
```

- **前 4 字节**：大端序（big-endian）uint32，值为**解压后数据的总字节数**，用作校验与缓冲区预分配。
- **第 5 字节起**：标准 zlib 流，Go 用 `compress/zlib` 直接解压。
- 若文件名不以 `c` 开头（无压缩原始 org），整个文件直接就是记录流，没有 4 字节头。
- 校验：解压后长度必须等于文件头声明值，且能被 1226 整除，否则视为损坏文件。

## 2. 记录格式

解压后是定长记录的连续数组，无分隔符。每条记录 **1226 字节**，小端序（little-endian）、无填充：

| 偏移 | 类型 | 数量 | 说明 |
|---|---|---|---|
| 0 | int64（小端） | 1 | Unix 时间戳，**毫秒** |
| 8 | uint16（小端） | 609 | 传感器/状态字数据 |

采样间隔不固定：实测中位约 2 秒，同一秒内可能有多条（毫秒不同），停机时段有分钟级到小时级空洞。

### 列编号约定

一条记录视作 610 列：**列 0 = 时间戳，列 1~609 = 后面的 609 个 uint16**。全文列号均按此约定。

| 列 | 含义 |
|---|---|
| 0 | 毫秒时间戳（int64） |
| 1 | 帧标志，正常记录恒为 `1`（实测偶见全零坏记录，其帧标志为 0） |
| 2~11 | 电机原始电流组（列 2 = 左截割 A 电流 U，与列 386「左截A负荷%」强相关） |

## 3. 清洗规则（本项目约定）

1. **过滤时间戳 ≤ 0 的记录**（同时能滤掉实测出现过的全零坏记录）；
2. **不做任何去重**——同一秒甚至同一毫秒的多条记录全部保留，保持文件内原始顺序；
3. 按时间戳升序稳定排序（org 文件本身基本有序，排序仅兜底）。

> 与旧版规则的差异：旧版按秒级时间戳去重（keep='last'），本项目为保留完整毫秒级信息**不再去重**。下游若需要秒级视图，在查询/聚合层做，不在解析层丢数据。

## 4. 已知列含义与数值解释

### 有符号列

uint16 需按补码重新解释为 int16 再乘精度（Go：`int16(v)`），否则负值（下坡坡度、负位置、低温）会变成 6 万多的大数。**本项目约定：所有做工程值换算的模拟量一律先按 int16 解释**（正常量程远小于 32767，无副作用）。

### 常用模拟量对照（摘自旧版文档，列号为 org 列）

| 列 | 名称 | 精度 | 备注 |
|---|---|---|---|
| 45/46/47 | 左摇臂/左牵引箱/左泵箱温度 | ×0.1 | int16 |
| 54/55/56 | 右摇臂/右牵引箱/右泵箱温度 | ×0.1 | int16 |
| 66 / 67 | 设定/实测速度 | ×0.01 | m/min |
| 68 / 69 | 左/右采高 | ×0.01 | int16 |
| 74 | 瓦斯 | ×0.01 | |
| 83 / 84 | 俯仰角 / 坡度 | ×0.1 | int16，有符号 |
| 85 | 位置(±) | ×0.01 | int16，有符号，m |
| 88 / 89 | 水路流量 / 水路压力 | ×0.1 / ×0.01 | |
| 90 / 91 | 泵箱油位 / 背压压力 | ×0.1 / ×0.01 | |
| 386~395 | 左截A/左截B/右截A/右截B/左牵/右牵/左泵/右泵/破碎/牵变 电流% | 原值 | |

完整的"org 列 → 共享内存地址 → 名称/精度/单位"映射以《运维系统中的共享内存定义.xlsx》为唯一权威来源（single source of truth），由提取脚本生成数据库定义表 `sensor_data_defi` / `status_data_defi`，不在本文档重复维护。

### 已知无效哨兵值（testdata 实测）

| 列 | 哨兵值 | 含义 |
|---|---|---|
| 67 实测速度 | ≈65529~65535（int16 视角为小负数） | 无效读数，统计前须过滤 |
| 45 左摇臂温度 | -40.0（本批数据）/ 200（旧批数据） | 传感器未接/无效 |

## 5. org → 共享内存映射约定

共享内存布局为**平铺 uint16 数组**（与真实 ecs2 工控机接口一致，映射名 `td3sharemem`；Windows 用命名文件映射，Linux/WSL 用 `/dev/shm` 下同名文件 mmap）。数组长度 4096 words（≥ 最大地址 3411）。

Excel 中 `ORG` 列的写法与写入规则：

| ORG 写法 | 含义 | 写入共享内存的值 |
|---|---|---|
| `2`（纯数字） | org 第 2 列的原始 uint16 | 原值直写 |
| `282Bit12` | org 第 282 列按位解析后的 bit12 | 0 或 1（布尔） |
| `156Bit2-C` | 同上，但**故障触发逻辑反转**（bit=1 表示正常，bit=0 表示故障） | 仍写原始 bit 值，反转语义由 collector 处理 |
| `291-C`（带状态值 16385） | org 第 291 列原值直写；**值 == 状态值时触发故障** | 原值直写 |
| `514-CN`（带状态值 64005） | org 第 514 列原值直写；**值 == 状态值时故障消除，其余值均为故障**（全 0 启动瞬间除外） | 原值直写 |
| 空白 | 无 org 数据源 | 恒写 0 |

时间戳（org 列 0）**不写入**共享内存——回放的时间轴见第 6 节。

## 6. 回放时间轴约定

- org 原始时间戳仅用于文件内排序，回放时**完全丢弃**；
- 记录**紧密按当前系统时间逐行写入**：不还原原始采样间隔，不管原始数据的空洞，每隔固定间隔写下一条（间隔可配置，默认 100ms，与 collector 扫描周期一致）；
- 多个 org 文件按文件名日期顺序连播；
- 每次启动回放器从头开始写（共享内存内容不跨次保留），但 collector 侧数据库**持续累积**，不因重启清空。

## 7. Excel 定义表疑点记录（待与现场复核）

| # | 位置 | 问题 | 当前处理 |
|---|---|---|---|
| 1 | 操作 sheet 地址 1918/1919「系统保护操作1/2」 | ORG 标为 133/134，但 134 已被 1902「左端头站1」占用，且 132 空缺，疑似应为 132/133 | **按 Excel 原样映射**，解码出的"系统保护"操作可能失真，待复核后修正 |
| 2 | 变频器 sheet 地址 661「右变频器输出频率」 | ORG 为空白，按左右对称推断应为 77 | 恒写 0，定义表照录并标记未映射 |
| 3 | 状态 sheet 地址 2128「软件无授权」 | 无 ORG 映射 | 恒写 0，定义表照录并标记未映射 |

## 8. Go 解析参考实现

```go
package orgfile

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	NumValues  = 609             // 每条记录的 uint16 数量
	RecordSize = 8 + NumValues*2 // 1226 字节
)

// Record 一条原始记录：列 0 为时间戳，Values[i] 即"列 i+1"
type Record struct {
	TimestampMs int64
	Values      [NumValues]uint16
}

// Col 按项目列号取值（col 取 1~609）
func (r *Record) Col(col int) uint16 { return r.Values[col-1] }

// ColInt16 按有符号读取（温度/位置/角度等模拟量换算前使用）
func (r *Record) ColInt16(col int) int16 { return int16(r.Values[col-1]) }

// Bit 取某列的第 bit 位（0~15）
func (r *Record) Bit(col, bit int) uint16 { return (r.Values[col-1] >> bit) & 1 }

// ParseFile 解析单个 .org 文件（含结构校验）
func ParseFile(path string) ([]Record, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	stem := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	data := raw
	if strings.HasPrefix(stem, "c") {
		if len(raw) < 4 {
			return nil, fmt.Errorf("文件过短: %s", path)
		}
		wantLen := binary.BigEndian.Uint32(raw[:4])
		zr, err := zlib.NewReader(bytes.NewReader(raw[4:]))
		if err != nil {
			return nil, fmt.Errorf("zlib 解压失败: %w", err)
		}
		defer zr.Close()
		buf := bytes.NewBuffer(make([]byte, 0, wantLen))
		if _, err := io.Copy(buf, zr); err != nil {
			return nil, fmt.Errorf("zlib 读取失败: %w", err)
		}
		data = buf.Bytes()
		if uint32(len(data)) != wantLen {
			return nil, fmt.Errorf("解压长度 %d 与文件头 %d 不符", len(data), wantLen)
		}
	}
	if len(data)%RecordSize != 0 {
		return nil, fmt.Errorf("数据长度 %d 不能整除记录大小 %d", len(data), RecordSize)
	}

	n := len(data) / RecordSize
	records := make([]Record, 0, n)
	for i := 0; i < n; i++ {
		off := i * RecordSize
		var rec Record
		rec.TimestampMs = int64(binary.LittleEndian.Uint64(data[off : off+8]))
		for j := 0; j < NumValues; j++ {
			rec.Values[j] = binary.LittleEndian.Uint16(data[off+8+j*2:])
		}
		records = append(records, rec)
	}
	return records, nil
}

// Clean 本项目清洗规则：只过滤 ts<=0，不去重，稳定排序保留毫秒级数据
func Clean(records []Record) []Record {
	out := make([]Record, 0, len(records))
	for _, r := range records {
		if r.TimestampMs > 0 {
			out = append(out, r)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].TimestampMs < out[j].TimestampMs })
	return out
}
```

## 9. testdata 实测校验结果（2026-07-01）

| 文件 | 原始大小 | 解压后 | 记录数 | 时间覆盖 |
|---|---|---|---|---|
| c2026-06-26.org | 4,293,003 | 43,583,074 | 35,549 | 全天（含 1 条全零坏记录） |
| c2026-06-27.org | 2,270,106 | 31,598,924 | 25,774 | 00:00~22:57 |
| c2026-06-28.org | 84,502 | 2,122,206 | 1,731 | 仅 11:36~12:56，全程停机 |
| c2026-06-29.org | 2,156,079 | 22,142,786 | 18,061 | 07:33 起 |
| c2026-06-30.org | 5,387,976 | 56,559,058 | 46,133 | 全天 |

全部文件头长度匹配、整除 1226、时间戳与文件名日期吻合。
