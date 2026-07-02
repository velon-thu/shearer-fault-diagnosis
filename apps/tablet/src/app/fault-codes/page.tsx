"use client";

import { useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";

/**
 * 故障代码查询：
 *   入口（系统/变频器）→ 20 个常用代码铺满屏 → 点击弹出大字详情（点外部收起）
 *   底部"自定义故障查询"→ 大键盘（26 字母 + 10 数字）输入代码 → 详情
 *
 * TODO: 以下为 mock 占位数据，等系统/变频器故障代码仓库到位后替换为真实数据源。
 */
type FaultEntry = {
  code: string;
  name: string;
  description: string;
  suggestions: string[];
};

const SYSTEM_FAULTS: FaultEntry[] = [
  { code: "2400", name: "左截割电机过载反时限保护动作", description: "左截割电机电流持续超过额定值，反时限保护动作，系统已停机保护。", suggestions: ["检查左截割电机运行状态与负载情况。", "检查电流互感器与参数设置。", "降低牵引速度运行，观察电流变化。"] },
  { code: "2402", name: "右截割电机过载反时限保护动作", description: "右截割电机电流持续超过额定值，反时限保护动作，系统已停机保护。", suggestions: ["检查右截割电机运行状态与负载情况。", "检查电流互感器与参数设置。", "降低牵引速度运行，观察电流变化。"] },
  { code: "2404", name: "左牵引电机过载反时限保护动作", description: "左牵引电机长时间过载，保护动作。", suggestions: ["检查牵引部机械阻力是否异常。", "检查滚筒截割阻力与工作面煤质。", "适当降低牵引速度。"] },
  { code: "2406", name: "泵电机过载反时限保护动作", description: "泵电机电流长时间超限，保护动作。", suggestions: ["检查液压系统压力是否异常升高。", "检查泵站溢流阀设定值。", "检查泵电机绝缘与轴承状态。"] },
  { code: "2420", name: "左截割电机温度高保护", description: "左截割电机绕组温度超过保护阈值。", suggestions: ["检查冷却水路流量与压力。", "停机等待电机冷却后再启动。", "检查温度传感器接线是否可靠。"] },
  { code: "2422", name: "右截割电机温度高保护", description: "右截割电机绕组温度超过保护阈值。", suggestions: ["检查冷却水路流量与压力。", "停机等待电机冷却后再启动。", "检查温度传感器接线是否可靠。"] },
  { code: "2440", name: "左摇臂温度高报警", description: "左摇臂减速箱油温超过报警阈值。", suggestions: ["检查摇臂油位与油质。", "检查冷却水路是否畅通。", "持续超温需停机检查齿轮箱。"] },
  { code: "2460", name: "左水路压力低保护", description: "左侧冷却水路压力低于保护阈值，截割电机禁止启动。", suggestions: ["检查供水管路与阀门开度。", "检查水路过滤器是否堵塞。", "检查水压传感器读数是否正常。"] },
  { code: "2462", name: "右水路压力低保护", description: "右侧冷却水路压力低于保护阈值。", suggestions: ["检查供水管路与阀门开度。", "检查水路过滤器是否堵塞。", "检查水压传感器读数是否正常。"] },
  { code: "2480", name: "瓦斯浓度超限保护", description: "工作面瓦斯浓度超过安全阈值，系统立即停机。", suggestions: ["立即按矿方安全规程处置。", "加强通风，确认瓦斯浓度回落。", "浓度正常后方可复位启动。"] },
  { code: "2500", name: "泵箱油位低报警", description: "泵箱油位低于下限，液压系统存在吸空风险。", suggestions: ["补充液压油至规定油位。", "检查泵箱与管路是否渗漏。", "检查油位传感器是否正常。"] },
  { code: "2520", name: "俯仰角超限报警", description: "机身俯仰角超过安全范围。", suggestions: ["检查工作面底板起伏情况。", "调整采高与行走姿态。", "确认倾角传感器安装牢固。"] },
  { code: "2613", name: "系统处于满载限速状态", description: "截割负荷达到上限，系统自动限制牵引速度。", suggestions: ["属于自动保护，可等待负荷回落。", "持续满载建议降低采高或牵引速度。", "检查煤层硬度变化情况。"] },
  { code: "2724", name: "牵引保护控制模块CAN通信未检出", description: "HPC 模块 CAN 总线通信中断。", suggestions: ["检查模块供电与 CAN 接线端子。", "检查总线终端电阻。", "尝试断电重启该模块。"] },
  { code: "2728", name: "电机启停控制模块CAN通信未检出", description: "MOC 模块 CAN 总线通信中断。", suggestions: ["检查模块供电与 CAN 接线端子。", "检查总线终端电阻。", "尝试断电重启该模块。"] },
  { code: "2733", name: "顺槽工控机网络通信未检出", description: "顺槽工控机与机载系统网络中断。", suggestions: ["检查顺槽通信链路与交换机。", "检查网线/光纤接头。", "确认顺槽工控机运行正常。"] },
  { code: "2760", name: "左遥控器与WCR通讯未建立", description: "左遥控器未与接收模块建立通讯。", suggestions: ["检查遥控器电池电量。", "重新对码配对。", "确认接收天线连接可靠。"] },
  { code: "2761", name: "右遥控器与WCR通讯未建立", description: "右遥控器未与接收模块建立通讯。", suggestions: ["检查遥控器电池电量。", "重新对码配对。", "确认接收天线连接可靠。"] },
  { code: "2762", name: "因通讯中断导致系统停机", description: "关键模块通讯中断，系统执行保护性停机。", suggestions: ["查看具体中断的模块并恢复通讯。", "检查供电与总线接线。", "通讯恢复后复位重启。"] },
  { code: "2771", name: "人员接近保护系统无效", description: "人员接近探测系统离线或自检失败。", suggestions: ["检查探测终端供电与通讯。", "确认系统自检通过后再作业。", "按安全规程降级运行或停机。"] },
];

const INVERTER_FAULTS: FaultEntry[] = [
  { code: "0x0001", name: "变频器过流保护", description: "输出电流瞬时超过保护阈值。", suggestions: ["检查电机及电缆是否短路或绝缘下降。", "检查负载是否突变或卡死。", "复位后重新启动，记录发生工况。"] },
  { code: "0x0002", name: "母线过压保护", description: "直流母线电压超过上限，常见于制动能量回馈过大。", suggestions: ["检查供电电压是否偏高。", "检查制动单元与制动电阻。", "适当延长减速时间。"] },
  { code: "0x0003", name: "母线欠压保护", description: "直流母线电压低于下限。", suggestions: ["检查供电电压与上级开关。", "检查整流模块。", "确认供电容量满足要求。"] },
  { code: "0x0004", name: "IGBT过温保护", description: "功率模块温度超过保护阈值。", suggestions: ["检查冷却水路流量与水温。", "清理散热器。", "降低负载运行观察温升。"] },
  { code: "0x0005", name: "输出缺相保护", description: "变频器输出侧检测到缺相。", suggestions: ["检查输出电缆与接线端子。", "检查电机接线盒。", "测量三相输出平衡度。"] },
  { code: "0x0006", name: "输入缺相保护", description: "变频器输入侧检测到缺相。", suggestions: ["检查输入电缆及上级开关。", "检查快速熔断器。", "测量三相输入电压。"] },
  { code: "0x0007", name: "接地故障保护", description: "检测到输出对地漏电流超限。", suggestions: ["检查电机与电缆对地绝缘。", "排查水汽侵入。", "绝缘恢复后复位。"] },
  { code: "0x0008", name: "电机过载保护", description: "电机热模型累计过载。", suggestions: ["检查负载是否长期偏重。", "核对电机额定参数设置。", "冷却后复位启动。"] },
  { code: "0x0009", name: "变频器过载保护", description: "变频器输出能力累计过载。", suggestions: ["降低负载或牵引速度。", "检查变频器容量匹配。", "检查散热条件。"] },
  { code: "0x000A", name: "编码器故障", description: "速度反馈信号丢失或异常。", suggestions: ["检查编码器接线与屏蔽。", "检查编码器供电。", "必要时更换编码器。"] },
  { code: "0x000B", name: "通讯超时故障", description: "变频器与主控通讯超时。", suggestions: ["检查通讯电缆与终端电阻。", "检查通讯参数设置。", "重启变频器观察。"] },
  { code: "0x000C", name: "参数校验失败", description: "参数存储区校验错误。", suggestions: ["恢复出厂参数后重新设置。", "记录故障前的参数操作。", "反复出现需更换控制板。"] },
  { code: "0x000D", name: "预充电故障", description: "上电预充电过程未完成。", suggestions: ["检查预充电回路与接触器。", "检查母线电容状态。", "测量预充电电阻。"] },
  { code: "0x000E", name: "风机故障", description: "冷却风机运行异常。", suggestions: ["检查风机供电与转动是否卡阻。", "清理风道。", "更换故障风机。"] },
  { code: "0x000F", name: "制动单元故障", description: "制动斩波器回路异常。", suggestions: ["检查制动电阻阻值。", "检查制动单元接线。", "复位后监测母线电压。"] },
  { code: "0x2201", name: "左端头站急停停机", description: "接收到来自左端头站的急停操作指令。", suggestions: ["确认左端头站急停按钮状态。", "排除现场急停原因。", "旋出急停按钮后复位。"] },
  { code: "0x2301", name: "右端头站急停停机", description: "接收到来自右端头站的急停操作指令。", suggestions: ["确认右端头站急停按钮状态。", "排除现场急停原因。", "旋出急停按钮后复位。"] },
  { code: "0x2401", name: "左遥控器急停停机", description: "接收到来自左遥控器的急停操作指令。", suggestions: ["确认遥控器急停按键状态。", "排除现场急停原因后复位。", "检查遥控器通讯是否正常。"] },
  { code: "0x2601", name: "顺槽远程急停停机", description: "接收到来自顺槽控制站的远程急停指令。", suggestions: ["与顺槽操作人员确认急停原因。", "排除原因后远程复位。", "检查顺槽通讯链路。"] },
  { code: "0x00FF", name: "未知内部故障", description: "变频器内部未定义故障码。", suggestions: ["记录完整故障码并联系厂家。", "断电 5 分钟后重新上电。", "反复出现需返厂检测。"] },
];

const CATALOGS = {
  system: { title: "系统故障代码查询", faults: SYSTEM_FAULTS },
  inverter: { title: "变频器故障代码查询", faults: INVERTER_FAULTS },
} as const;

type Category = keyof typeof CATALOGS;

const KEY_ROWS: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
];

type ViewMode = "menu" | "grid" | "custom";

export default function FaultCodesPage() {
  const shellState = useAppShellState();
  const [view, setView] = useState<ViewMode>("menu");
  const [category, setCategory] = useState<Category>("system");
  const [modalFault, setModalFault] = useState<FaultEntry | null>(null);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  const [input, setInput] = useState("");

  const catalog = CATALOGS[category];

  const openCategory = (next: Category) => {
    setCategory(next);
    setView("grid");
  };

  const lookupCustom = () => {
    const typed = input.trim();
    if (!typed) {
      return;
    }
    const normalized = typed.toUpperCase().replace(/^0X/, "0x");
    const hit = catalog.faults.find(
      (f) => f.code.toUpperCase().replace(/^0X/, "0x").toUpperCase() === normalized.toUpperCase(),
    );
    if (hit) {
      setModalFault(hit);
      setNotFoundCode(null);
    } else {
      setModalFault(null);
      setNotFoundCode(typed.toUpperCase());
    }
  };

  const closeModal = () => {
    setModalFault(null);
    setNotFoundCode(null);
  };

  return (
    <AppShell hideFloatingHome={view === "custom"} shellState={shellState} title="故障代码查询">
      <section className="page active">
        {view === "menu" ? (
          /* ===== 入口：二选一 ===== */
          <div className="fc-menu">
            <button className="fc-menu-card" onClick={() => openCategory("system")} type="button">
              <span className="fc-menu-icon" style={{ background: "linear-gradient(180deg, #54a5ff, #2e6be6)" }}>系</span>
              <span className="fc-menu-title">系统故障代码查询</span>
            </button>
            <button className="fc-menu-card" onClick={() => openCategory("inverter")} type="button">
              <span className="fc-menu-icon" style={{ background: "linear-gradient(180deg, #ffb03a, #f07b22)" }}>变</span>
              <span className="fc-menu-title">变频器故障代码查询</span>
            </button>
          </div>
        ) : view === "grid" ? (
          /* ===== 常见故障代码方块 ===== */
          <>
            <div className="sensor-detail-head">
              <button className="sensor-back-btn" onClick={() => setView("menu")} type="button">
                ‹ 返回
              </button>
              <h1 className="sensor-detail-title">{catalog.title}</h1>
            </div>
            <div className="fc-grid">
              {catalog.faults.map((fault) => (
                <button
                  className="fc-tile"
                  key={fault.code}
                  onClick={() => setModalFault(fault)}
                  type="button"
                >
                  <span className="fc-tile-code">{fault.code}</span>
                  <span className="fc-tile-name">{fault.name}</span>
                </button>
              ))}
            </div>
            <div className="sensor-pager" style={{ justifyContent: "center" }}>
              <button
                className="sensor-settings-btn"
                onClick={() => {
                  setInput("");
                  setView("custom");
                }}
                type="button"
              >
                自定义故障查询
              </button>
            </div>
          </>
        ) : (
          /* ===== 自定义查询：大键盘 ===== */
          <>
            <div className="sensor-detail-head">
              <button className="sensor-back-btn" onClick={() => setView("grid")} type="button">
                ‹ 返回
              </button>
              <h1 className="sensor-detail-title">{catalog.title} · 自定义</h1>
            </div>
            <div className="fc-custom">
              <div className="fc-input-display">{input || "请输入故障代码"}</div>
              <div className="fc-keyboard">
                {KEY_ROWS.map((row, rowIndex) => (
                  <div className="fc-key-row" key={rowIndex}>
                    {row.map((key) => (
                      <button
                        className="fc-key"
                        key={key}
                        onClick={() => setInput((v) => (v.length < 12 ? v + key : v))}
                        type="button"
                      >
                        {key}
                      </button>
                    ))}
                  </div>
                ))}
                <div className="fc-key-row">
                  <button className="fc-key fc-key-wide" onClick={() => setInput("")} type="button">
                    清空
                  </button>
                  <button
                    className="fc-key fc-key-wide"
                    onClick={() => setInput((v) => v.slice(0, -1))}
                    type="button"
                  >
                    ⌫ 删除
                  </button>
                  <button
                    className="fc-key fc-key-confirm"
                    disabled={!input.trim()}
                    onClick={lookupCustom}
                    type="button"
                  >
                    确 认
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ===== 详情弹窗（点击外部收起） ===== */}
        {modalFault || notFoundCode ? (
          <div className="fc-modal-backdrop" onClick={closeModal}>
            <div className="fc-modal" onClick={(event) => event.stopPropagation()}>
              {modalFault ? (
                <>
                  <div className="fc-modal-head">
                    <span className="fc-modal-code">{modalFault.code}</span>
                    <h2 className="fc-modal-title">{modalFault.name}</h2>
                  </div>
                  <p className="fc-modal-desc">{modalFault.description}</p>
                  <div className="fc-modal-sub">处理建议</div>
                  <ol className="fc-modal-suggestions">
                    {modalFault.suggestions.map((tip, index) => (
                      <li key={index}>{tip}</li>
                    ))}
                  </ol>
                </>
              ) : (
                <>
                  <div className="fc-modal-head">
                    <span className="fc-modal-code">{notFoundCode}</span>
                    <h2 className="fc-modal-title">未找到该故障代码</h2>
                  </div>
                  <p className="fc-modal-desc">
                    当前{catalog.title.replace("查询", "")}库中没有此代码，请核对后重新输入。
                  </p>
                </>
              )}
              <button className="fc-modal-close" onClick={closeModal} type="button">
                关 闭
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
