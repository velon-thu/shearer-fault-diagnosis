// Package seed 内嵌由 tools/extract-shm-defi.py 从
// 《运维系统中的共享内存定义.xlsx》生成的种子 CSV。
// 重新生成后需重新编译两个数据面程序。
package seed

import "embed"

//go:embed *.csv
var FS embed.FS
