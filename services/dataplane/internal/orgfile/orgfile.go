// Package orgfile 解析采煤机 .org 数据包。
// 规则见 docs/org解析规则.md：保留毫秒级数据，不做按秒去重。
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

// Record 一条原始记录：列 0 为时间戳，Values[i] 即"列 i+1"。
type Record struct {
	TimestampMs int64
	Values      [NumValues]uint16
}

// Col 按项目列号取值（col 取 1~609）。
func (r *Record) Col(col int) uint16 { return r.Values[col-1] }

// Bit 取某列的第 bit 位（0~15）。
func (r *Record) Bit(col, bit int) uint16 { return (r.Values[col-1] >> bit) & 1 }

// ParseFile 解析单个 .org 文件，含文件头与整除校验。
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
			return nil, fmt.Errorf("zlib 解压失败(%s): %w", path, err)
		}
		defer zr.Close()
		buf := bytes.NewBuffer(make([]byte, 0, wantLen))
		if _, err := io.Copy(buf, zr); err != nil {
			return nil, fmt.Errorf("zlib 读取失败(%s): %w", path, err)
		}
		data = buf.Bytes()
		if uint32(len(data)) != wantLen {
			return nil, fmt.Errorf("解压长度 %d 与文件头 %d 不符(%s)", len(data), wantLen, path)
		}
	}
	if len(data)%RecordSize != 0 {
		return nil, fmt.Errorf("数据长度 %d 不能整除记录大小 %d(%s)", len(data), RecordSize, path)
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

// Clean 本项目清洗规则：只过滤 ts<=0，不去重，稳定排序。
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
