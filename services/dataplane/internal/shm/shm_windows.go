//go:build windows

package shm

import (
	"fmt"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// x/sys/windows 没有封装 OpenFileMappingW，直接从 kernel32 取。
var (
	kernel32            = windows.NewLazySystemDLL("kernel32.dll")
	procOpenFileMapping = kernel32.NewProc("OpenFileMappingW")
)

func openFileMapping(access uint32, name *uint16) (windows.Handle, error) {
	r, _, errno := syscall.SyscallN(procOpenFileMapping.Addr(),
		uintptr(access), 0, uintptr(unsafe.Pointer(name)))
	if r == 0 {
		return 0, errno
	}
	return windows.Handle(r), nil
}

// Create 创建（或打开同名已存在的）读写共享内存，大小 words 个 uint16。
func Create(name string, words int) (*Memory, error) {
	size := uint32(words * 2)
	h, err := windows.CreateFileMapping(windows.InvalidHandle, nil,
		windows.PAGE_READWRITE, 0, size, windows.StringToUTF16Ptr(name))
	if err != nil {
		return nil, fmt.Errorf("CreateFileMapping(%s): %w", name, err)
	}
	return mapView(name, h, words, windows.FILE_MAP_WRITE|windows.FILE_MAP_READ)
}

// Open 打开已存在的命名共享内存（只读）；不存在则报错，调用方可重试。
func Open(name string, words int) (*Memory, error) {
	h, err := openFileMapping(windows.FILE_MAP_READ, windows.StringToUTF16Ptr(name))
	if err != nil {
		return nil, fmt.Errorf("OpenFileMapping(%s): %w", name, err)
	}
	return mapView(name, h, words, windows.FILE_MAP_READ)
}

func mapView(name string, h windows.Handle, words int, access uint32) (*Memory, error) {
	addr, err := windows.MapViewOfFile(h, access, 0, 0, uintptr(words*2))
	if err != nil {
		windows.CloseHandle(h)
		return nil, fmt.Errorf("MapViewOfFile(%s): %w", name, err)
	}
	view := unsafe.Slice((*uint16)(unsafe.Pointer(addr)), words)
	return &Memory{
		name:  name,
		words: view,
		close: func() {
			_ = windows.UnmapViewOfFile(addr)
			_ = windows.CloseHandle(h)
		},
	}, nil
}
