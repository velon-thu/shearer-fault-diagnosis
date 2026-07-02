# ORG 数据包格式与 Go 解析说明

本文档描述采煤机 `.org` 数据包的二进制格式，以及如何用 Go 语言解析。格式与本仓库 `backend/analysis.py` / `backend/analysis_plus.py` 中 `parse_org()` 的 Python 解析逻辑完全一致，并已在 `data-org/baodian-7360/` 与 `data-org/qiuji-890/` 下全部 12 个文件上验证通过（每个文件解包后字节数恰好整除记录大小，余数为 0）。

## 1. 文件整体结构

文件名形如 `c2025-10-16.org`。**文件名以 `c` 开头表示文件体经过 zlib 压缩**：

```
+----------------+--------------------------------------+
| 4 字节文件头    | zlib 压缩流（deflate, 带 zlib 头 78 9C）|
+----------------+--------------------------------------+
```

- **前 4 字节**：大端序（big-endian）uint32，值为**解压后数据的总字节数**。
  例如 `c2025-04-26.org` 头部为 `02 1B 71 68` = 35,352,936，与 zlib 解压后长度完全一致。可用作校验，也可用于预分配缓冲区。
- **第 5 字节起**：标准 zlib 流，用 `compress/zlib` 直接解压。
- 若文件名不以 `c` 开头（无压缩的原始 org），则整个文件直接就是记录流，没有 4 字节头。

## 2. 记录格式

解压后的数据是定长记录的连续数组，**无任何分隔符**。每条记录对应 Python 的 `struct` 格式 `'q609H'`（x86 本机字节序 = **小端序 little-endian**，无填充字节）：

| 偏移 | 类型 | 数量 | 说明 |
|---|---|---|---|
| 0 | int64（小端） | 1 | Unix 时间戳，**毫秒** |
| 8 | uint16（小端） | 609 | 传感器/状态字数据 |

- **每条记录固定 1226 字节**（8 + 609×2）。
- 记录数 = 解压后字节数 ÷ 1226（应整除，余数非 0 说明文件损坏）。
- 采样间隔不固定，实测约 2~12 秒一条，停机时段可能有几分钟的空洞。

### 列编号约定

本项目代码中把一条记录视作 610 列：**列 0 = 时间戳，列 1~609 = 后面的 609 个 uint16**。下文列号均按此约定。

### 前三列

| 列 | 含义 | 说明 |
|---|---|---|
| 0 | 时间戳 | int64 毫秒，项目内统一 `÷1000` 转为秒使用 |
| 1 | 帧标志 | 实测 12 个文件中恒为 `1`，项目代码未按名称使用，可视作记录有效标志 |
| 2 | 左截割电机 A 电流 | 原始电流值（与列 386「左截A电流%」相关系数 0.96~0.99）；列 3 同理为左截 B 电流 |

> 说明：项目中另有 `avg`/`max` 格式，其列映射恰好是 org 列号整体 -2（如 org 列 85=位置 ↔ avg 列 83），据此可知 org 列 2~11 对应电机原始电流组。

## 3. 已知列含义对照表（摘自项目代码）

### 模拟量（来自 `analysis.py` 的 `fu_zai_su_du` / `chuan_gan_qi_shu_ju`）

| 列 | 名称 | 换算 | 备注 |
|---|---|---|---|
| 0 | 日期（时间戳） | ÷1000 → 秒 | int64 |
| 45 | 左摇臂温度 | ÷10 | 先转 int16 |
| 46 | 左牵引箱温度 | ÷10 | 先转 int16 |
| 47 | 左泵箱温度 | ÷10 | 先转 int16；值 200 表示无效，此时取右泵箱温度 |
| 54 | 右摇臂温度 | ÷10 | 先转 int16 |
| 55 | 右牵引箱温度 | ÷10 | 先转 int16 |
| 56 | 右泵箱温度 | ÷10 | 先转 int16 |
| 66 | 设定速度 | ÷100 | m/min |
| 67 | 实测速度 | ÷100 | m/min（断轴检测中按 ÷100 转 m/s 使用） |
| 68 | 左采高 | ÷100 | 先转 int16 |
| 69 | 右采高 | ÷100 | 先转 int16 |
| 74 | 瓦斯 | ÷100 | |
| 83 | 俯仰角 | ÷10 | **有符号**，先转 int16 |
| 84 | 坡度 | ÷10 | **有符号**，先转 int16 |
| 85 | 位置(±) | ÷100 | **有符号**，先转 int16，单位 m |
| 88 | 水路流量 | ÷10 | |
| 89 | 水路压力 | ÷100 | |
| 90 | 泵箱油位 | ÷10 | |
| 91 | 背压压力 | ÷100 | |
| 386~395 | 左截A/左截B/右截A/右截B/左牵/右牵/左泵/右泵/破碎/牵变 电流% | 原值 | 依次对应 |

> 注意「有符号」列：uint16 需按补码重新解释为 int16 再做换算（Go 中 `int16(v)`），否则负值（如下坡坡度、负位置）会变成 6 万多的大数。

### 状态字（位域，按 bit 解码）

| 列 | 名称 |
|---|---|
| 166~171, 177 | BP1 变频器状态/故障/报警字 |
| 258~277, 282~284 | 各类电机过载、温度、漏电等保护标志字 |
| 291 | 记忆截割状态字 |
| 300 | 状态字（自动化统计相关） |

每个 bit 的具体含义见 `backend/analysis_plus.py` 顶部的 `ANOMALY_MAPPING` 字典（列号 → bit 位 → 中文描述）。

## 4. Go 解析代码

```go
package orgparser

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
	NumValues  = 609                // 每条记录的 uint16 数量
	RecordSize = 8 + NumValues*2    // 1226 字节
)

// Record 一条原始记录：列0为时间戳，Values[i] 即“列 i+1”
type Record struct {
	TimestampMs int64             // 列0：毫秒时间戳
	Values      [NumValues]uint16 // 列1~609
}

// Col 按项目列号取值（col 取 1~609）
func (r *Record) Col(col int) uint16 { return r.Values[col-1] }

// ColInt16 按有符号读取（用于 位置85/俯仰角83/坡度84 等列）
func (r *Record) ColInt16(col int) int16 { return int16(r.Values[col-1]) }

// ParseOrgFile 解析单个 .org 文件
func ParseOrgFile(path string) ([]Record, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	stem := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	var data []byte
	if strings.HasPrefix(stem, "c") {
		// 前4字节：大端 uint32 = 解压后长度（可用于校验）
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
	} else {
		data = raw
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

// CleanRecords 复刻项目的清洗逻辑：
// 1) 过滤时间戳 <= 0 的记录；2) 按秒级时间戳去重（保留最后一条）；3) 按时间排序
func CleanRecords(records []Record) []Record {
	bySec := make(map[int64]Record, len(records))
	for _, r := range records {
		if r.TimestampMs <= 0 {
			continue
		}
		bySec[r.TimestampMs/1000] = r // 同一秒保留最后出现的记录
	}
	out := make([]Record, 0, len(bySec))
	for _, r := range bySec {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TimestampMs < out[j].TimestampMs })
	return out
}
```

使用示例：

```go
records, err := orgparser.ParseOrgFile("data-org/qiuji-890/c2025-10-16.org")
if err != nil {
	log.Fatal(err)
}
records = orgparser.CleanRecords(records)

for _, r := range records[:5] {
	tsSec := r.TimestampMs / 1000
	pos := float64(r.ColInt16(85)) / 100  // 位置，m
	vSet := float64(r.Col(66)) / 100      // 设定速度
	vReal := float64(r.Col(67)) / 100     // 实测速度
	fmt.Println(tsSec, pos, vSet, vReal)
}
```

## 5. 清洗与使用约定（与 Python 端保持一致）

1. 时间戳毫秒 → 秒：`ts / 1000`（项目内所有统计均用秒级时间戳）。
2. 过滤 `时间戳 <= 0` 的异常记录。
3. 按时间戳去重，**保留最后一条**（`keep='last'`），然后升序排序。
4. 有符号列（85 位置、83 俯仰角、84 坡度、温度列等）必须先按 int16 解释再除以换算系数。
5. Python 端会在 org 文件旁生成 `.pkl` 缓存文件（pandas pickle，zip 压缩），那是项目内部缓存，Go 解析时直接忽略即可。

## 6. 实测文件结构验证结果

| 文件 | 原始大小 | 解压后 | 记录数 |
|---|---|---|---|
| baodian-7360/c2025-04-26.org | 3,571,253 | 35,352,936 | 28,836 |
| baodian-7360/c2025-04-27.org | 3,747,068 | 35,752,612 | 29,162 |
| baodian-7360/c2025-04-28.org | 2,921,946 | 30,222,126 | 24,651 |
| baodian-7360/c2025-04-29.org | 4,122,501 | 42,745,716 | 34,866 |
| baodian-7360/c2025-04-30.org | 3,183,631 | 31,791,406 | 25,931 |
| baodian-7360/c2025-05-01.org | 3,447,732 | 34,048,472 | 27,772 |
| qiuji-890/c2025-10-13.org | 1,303,954 | 10,466,362 | 8,537 |
| qiuji-890/c2025-10-14.org | 1,072,627 | 8,279,178 | 6,753 |
| qiuji-890/c2025-10-15.org | 556,946 | 4,293,452 | 3,502 |
| qiuji-890/c2025-10-16.org | 1,422,957 | 11,631,062 | 9,487 |
| qiuji-890/c2025-10-17.org | 1,464,707 | 12,423,058 | 10,133 |
| qiuji-890/c2025-10-18.org | 1,480,909 | 11,729,142 | 9,567 |

所有文件解压后长度均与 4 字节文件头一致，且能被 1226 整除（余数 0）；首列时间戳与文件名日期吻合（如 1745596800000 ms = 2025-04-26 00:00:00 CST）。
