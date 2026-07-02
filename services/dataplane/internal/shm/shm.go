// Package shm 跨平台命名共享内存，布局为定长 uint16 数组，
// 与真实 ecs2 工控机接口一致（映射名 td3sharemem）。
//
// Windows: CreateFileMapping/OpenFileMapping 命名节；
// Linux/WSL: /dev/shm/<name> 文件 mmap（写端创建，读端只读打开）。
//
// 对齐的 16 位读写在 x86 上是原子的，单字不会撕裂；跨字无一致性保证，
// 读侧按快照语义使用（先整块拷贝再解析）。
package shm

const (
	// DefaultName 默认映射名，与真实系统一致。
	DefaultName = "td3sharemem"
	// Words 共享内存总字数。Excel 定义的最大地址为 3411，
	// 4090~4095 保留给回放器元数据（见下），其余填 0。
	Words = 4096

	// —— 本项目扩展：回放器元数据字（不属于 Excel 定义） ——
	MetaHeartbeat  = 4090 // 每写一条记录 +1（uint16 自然回绕），0=回放器尚未写入
	MetaRecordLo   = 4091 // 已写记录总数低 16 位
	MetaRecordHi   = 4092 // 已写记录总数高 16 位
	MetaFileIndex  = 4093 // 当前文件序号（1 起）
	MetaFileTotal  = 4094 // 文件总数
	MetaIntervalMs = 4095 // 回放间隔 ms
)

// Memory 一块已映射的命名共享内存（uint16 数组视图）。
type Memory struct {
	name  string
	words []uint16
	close func()
}

func (m *Memory) Name() string { return m.name }
func (m *Memory) Len() int     { return len(m.words) }

// Get 读单字；越界返回 0。
func (m *Memory) Get(addr int) uint16 {
	if addr < 0 || addr >= len(m.words) {
		return 0
	}
	return m.words[addr]
}

// Set 写单字；越界忽略。
func (m *Memory) Set(addr int, v uint16) {
	if addr >= 0 && addr < len(m.words) {
		m.words[addr] = v
	}
}

// Snapshot 把整块内存拷贝进 dst（快照语义，读侧每拍调用一次）。
func (m *Memory) Snapshot(dst []uint16) {
	copy(dst, m.words)
}

// Zero 全部清零（写端启动时调用）。
func (m *Memory) Zero() {
	for i := range m.words {
		m.words[i] = 0
	}
}

func (m *Memory) Close() {
	if m.close != nil {
		m.close()
		m.close = nil
	}
}
