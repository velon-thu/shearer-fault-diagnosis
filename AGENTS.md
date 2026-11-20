# 便携式采煤机故障诊断点检仪

## 基本守则
- When you start thinking, tell me what u are about to reason. During thinking, at key stages inform user about your thoughs.
- Do not keep user waiting for you to think without info for a long time.
- Notify user about your decisions, steps, and milestones.
- Always ask questions if you are unsure or need input from users or making assumptions that are gonna shape your implementation.
- If you have trouble doing some tasks (stuck for a while), stop searching for walkarounds, ask user to provide more info.

- Talk to me  ELI5  by default and go deeper if I ask.

- print "velon,i am here" when u read this AGENTS.md

## 项目信息

### 项目背景
我们是上海天地采掘装备科技有限公司，主要是做采煤机智能化。
便携式采煤机故障诊断点检仪（下面简称点检仪）是由两部分硬件组成：数据服务模块+手持防爆平板。
数据服务模块是一台ubuntu工控机，这个项目工程的软件就是部署在工控机上，由它来加载前端和后端服务，工控机放在采煤机电控箱的内部，和BOC（采煤机主控中心）连接
在一个交换机上，从BOC上获取数据（现在这个软件的数据获取方式暂时是模拟的）。
手持防爆平板和数据服务模块连接了同一个wifi，然后它是通过游览器打开页面对这个软件系统进行访问与操作的。

### 硬件规格参数
#### 数据服务模块
产品名称：MindEdge L100；产品工艺铝合金CNC：喷沙氧化；产品尺寸：整机尺寸：200*140*70mm；操作系统：Ubuntu 22.04；
CPU：Cortex-A78 2.4GHz*12核；内存：LPDDR5 32GB；硬盘：EMMC 64GB/128G，支持SSD扩展（M.2 2280）；算力：综合算力50TOPS（INT8）GPU：渲染3TFLOPS，AI 30TOPS NPU：20 TOPS
下面是接口配置：
以太网 4*RJ45(10/100/1000Mbps)
Wifi 802.11a/b/g/n/ac/ax 2T2R
显示器 HDMI*1，DP*1
音频输出 3.5mm接口*1，4Ω3W凤凰端子*2
音频输入 3.5mm接口*1
USB USB3.0 TYPE-A*4，USB3.0 TYPE-C*1，USB2.0*1（烧录专用）
串口
2xRS-232/RS-422/RS-485(软件功能自定义）DB9座子
2xRS-422/RS-485(软件功能自定义）凤凰端子
2xRS-232凤凰端子
GPIO 4xDO(0、3.3V、5V、12V、24V)凤凰端子
CAN CAN FD凤凰端子*2
#### 手持防爆平板
裸机：276.0*180.5*22.5mm/1138g 
屏幕尺寸：10.1英寸，16:10
屏幕分辨率：1920*1200
屏幕亮度：700cd/㎡
触摸屏：10点触控 G+G，硬度≥7H，支持医用橡胶手套触摸屏
电池：7.6V 5550mAh高压锂电池，不可拆卸，续航≥7h（播放1080P高清视频，50%亮度 50%声音）
摄像头：前摄：13.0MP定焦；后摄：13.0MP自动对焦摄像头
按键：开机键*1，音量键*2，Vol+，Vol-，自定义按键*2，P键、F键
喇叭：*2，喇叭 1.2W/8Ω，*1，MIC
CPU	RK3588 八核，4x ARM Cortex-A76 (@2.4GHz) + 4x ARM Cortex-A55 (@1.8GHz)
RAM/ROM	8G+128GB+SSD(最大支持4T)，  可选16G+256GB+SSD(最大支持4T)
陀螺仪，重力感应：支持
操作系统：ubuntu24.04.2
WIFI	WIFI 802.11(a/b/g/n/ac/ax)  支持WiFi6
蓝牙	Bluetooth 5.0  传输距离：10m
接口：
M.2 SSD接口	*1，主板预留，支持M.2 2280 SSD PCIE协议 FAT32格式(最大4TB)
TYPE-C	*1，Type-C USB3.0（支持数据传输）
Type -A	*1，Type-A USB3.0
DB9接口	*1，RS232
耳机接口	*1，3.5mm标准耳机接口
TF Card	*1，最大支持2TB扩展
SIM Card	*1，标准 Micro SIM 卡槽
HDMI	*1，Micro HDMI
DC接口	*1，12V-4A（DC插头外径3.5mm 内径1.35mm）
网口	*1，100/1000M
POGO PIN	*1，12Pin USB+充电
