//go:build linux

package shm

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

func shmPath(name string) string { return filepath.Join("/dev/shm", name) }

// Create 创建（或覆盖打开）读写共享内存，大小 words 个 uint16。
func Create(name string, words int) (*Memory, error) {
	f, err := os.OpenFile(shmPath(name), os.O_CREATE|os.O_RDWR, 0o666)
	if err != nil {
		return nil, fmt.Errorf("打开 %s: %w", shmPath(name), err)
	}
	defer f.Close()
	size := words * 2
	if err := f.Truncate(int64(size)); err != nil {
		return nil, fmt.Errorf("truncate: %w", err)
	}
	return mapFile(name, f, words, syscall.PROT_READ|syscall.PROT_WRITE)
}

// Open 只读打开已存在的共享内存；不存在则报错（调用方可重试等待写端先起）。
func Open(name string, words int) (*Memory, error) {
	f, err := os.Open(shmPath(name))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if st.Size() < int64(words*2) {
		return nil, fmt.Errorf("%s 大小 %d 小于期望 %d", shmPath(name), st.Size(), words*2)
	}
	return mapFile(name, f, words, syscall.PROT_READ)
}

func mapFile(name string, f *os.File, words, prot int) (*Memory, error) {
	b, err := syscall.Mmap(int(f.Fd()), 0, words*2, prot, syscall.MAP_SHARED)
	if err != nil {
		return nil, fmt.Errorf("mmap: %w", err)
	}
	view := unsafe.Slice((*uint16)(unsafe.Pointer(&b[0])), words)
	return &Memory{
		name:  name,
		words: view,
		close: func() { _ = syscall.Munmap(b) },
	}, nil
}
