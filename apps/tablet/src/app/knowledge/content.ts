/**
 * 知识库正文内容。
 *
 * 后续补充资料时，只要往 KB_GROUPS 里加 group / article 即可，页面自动出现在左侧目录。
 * 正文用 block 描述，渲染规则见 globals.css 的「知识库」段：
 *   h      小标题
 *   p      正文段落
 *   ol/ul  编号 / 圆点列表
 *   chips  并排大字方块（型号、牌号这类短标识）
 *   defs   术语对照表（左编码右释义）
 *   fault  故障卡片：一个现象 + 若干可能原因
 *   note   高亮提示条（原文里的「注」「注意」）
 */

export type KbBlock =
  | { kind: "h"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ol"; items: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "chips"; items: string[] }
  | { kind: "defs"; items: { term: string; desc: string }[] }
  | { kind: "fault"; symptom: string; causes: string[] }
  | { kind: "note"; text: string };

export type KbArticle = {
  id: string;
  title: string;
  blocks: KbBlock[];
};

export type KbGroup = {
  id: string;
  label: string;
  articles: KbArticle[];
};

const MODEL_MEANING: KbArticle = {
  id: "model-code",
  title: "采煤机型号的含义",
  blocks: [
    { kind: "h", text: "常见型号" },
    { kind: "chips", items: ["MG450/1020-QWD", "MG300/720-AWD", "MG750/1920-GWD"] },
    { kind: "h", text: "编码含义" },
    {
      kind: "defs",
      items: [
        { term: "M", desc: "采煤机" },
        { term: "G", desc: "滚筒式" },
        { term: "450", desc: "截割电机功率（kW）" },
        { term: "1020", desc: "整机总功率（kW）" },
        { term: "Q", desc: "大倾角（适用于大倾角工作面）" },
        { term: "A", desc: "矮机身" },
        { term: "G", desc: "高机身" },
        { term: "W", desc: "无链牵引" },
        { term: "D", desc: "电牵引" },
      ],
    },
    {
      kind: "note",
      text: "“G — 高机身”与前面的“G — 滚筒式”字母重复，这是采煤机型号编码中不同位置的含义。",
    },
  ],
};

const HEIGHT_ADJUST_FAULTS: KbArticle = {
  id: "height-adjust",
  title: "调高系统故障分析",
  blocks: [
    { kind: "p", text: "调高液压系统常常出现以下几种问题，列举如下。" },
    {
      kind: "fault",
      symptom: "摇臂不能调高",
      causes: [
        "调高泵损坏。",
        "系统主管路损坏漏油。",
        "安全阀失灵，压力达不到规定压力值。",
        "油缸泄漏严重，或是内部咬死：前者不起压，后者压力高但不调高。",
      ],
    },
    {
      kind: "fault",
      symptom: "摇臂调高速度下降",
      causes: [
        "系统存在泄漏，如油缸内部窜油、接头漏油、胶管破损、密封损坏等。",
        "调高泵容积效率过低，排出油量减少。",
        "安全阀密封不好，不打开也有较大泄漏。",
        "油缸或管路中有空气。",
      ],
    },
    {
      kind: "fault",
      symptom: "摇臂锁不住，有下沉现象",
      causes: [
        "液力锁阀芯有泄漏。",
        "液力锁安全阀调定压力低，安全阀有泄漏。",
        "油缸活塞内部窜油。",
      ],
    },
  ],
};

const HYDRAULIC_NUT: KbArticle = {
  id: "hydraulic-nut",
  title: "液压螺母",
  blocks: [
    { kind: "h", text: "原理与用途" },
    {
      kind: "p",
      text: "液压螺母是一种先进的螺栓紧固系统，与液压拉伸器工作原理相同，特别适用于狭窄空间和重负荷振动机械的紧固。其工作原理是利用超高压油（多为液压油）在轴上产生一个推力、在轴套上产生一个张力，使轴和轴套受力均匀地连接在一起。使用液压螺母可以提高工作效率，而且既准确又安全，因此被广泛应用于高负载强震动的机械紧固领域。例如在钢材连续挤压加工领域，就经常需要拆、装液压螺母，用于固定挤压轮组件，并能消除挤压轮组件之间的间隙。",
    },
    { kind: "h", text: "打压与复位" },
    {
      kind: "p",
      text: "液压螺母在使用时通常需要打压，油压一般在 150～250 MPa 之间；打压后缸体会被顶出一段行程，导致柱塞和缸体之间产生间隙。而缸体的额定行程往往比较短，一般只有 5～20 mm，所以每次使用完液压螺母后、二次使用液压螺母前，需要对液压螺母进行复位操作，即消除柱塞与缸体之间的间隙，从而防止二次使用时把液压螺母缸体的行程打完，确保液压螺母的正确使用。",
    },
    { kind: "note", text: "二次使用前不复位就直接打压，容易把缸体行程打完，俗称把液压螺母“打爆”。" },
    { kind: "h", text: "常用复位方法" },
    {
      kind: "p",
      text: "现有的复位方法中，多是将液压螺母从轴上直接拆卸下来，旋转松开液压螺母上的锁紧螺母，然后借助榔头等工具将柱塞往回程方向压，从而达到消除柱塞与缸体之间间隙的目的；间隙消除后，再将液压螺母安装到轴上，并旋转至轴套端面处，打压液压螺母，即可紧固需要固定的工件。",
    },
  ],
};

const DRUM_MAINTENANCE: KbArticle = {
  id: "drum-maintenance",
  title: "滚筒维护小常识",
  blocks: [
    {
      kind: "p",
      text: "滚筒筒体采用焊接结构，螺旋叶片上设有内喷雾水道和喷嘴，压力水从喷嘴雾状喷出，直接喷向齿尖，以达到冷却截齿、降低煤尘和稀释瓦斯的目的。为延长螺旋叶片的使用寿命，在其出煤口处采用耐磨材料堆焊处理。",
    },
    {
      kind: "p",
      text: "为适应较高牵引速度的要求，采用新型大镐形齿以及与之相配套的大齿座。齿座采用了特殊材料和特殊加工工艺，强度高，截齿固定方便、可靠。",
    },
    {
      kind: "p",
      text: "滚筒属于易损件，正确维护和使用滚筒，对延长其工作寿命、提高截割功率利用率是十分重要的，所以开机前必须做到如下几点。",
    },
    { kind: "h", text: "开机前必查" },
    {
      kind: "ol",
      items: [
        "检查滚筒上的截齿和喷嘴是否处于良好状态。若发现截齿刀头严重磨损，应及时更换；若喷嘴被堵，亦应及时更换，换下的喷嘴经清洗后可复用。",
        "检查滚筒上的截齿和喷嘴是否齐全，若发现丢失，则应及时补上。",
        "截齿和喷嘴的固定必须牢靠。",
        "检查喷雾冷却系统管路是否漏水，水量、水压是否符合要求。",
        "检查固定滚筒用的螺栓是否松动，以防滚筒脱落。",
        "采煤司机操作时，做到先开水、后开机；停机时先停机、后停水，并注意不让滚筒割支架顶梁和输送机铲煤板等金属件。",
      ],
    },
  ],
};

export const KB_GROUPS: KbGroup[] = [
  { id: "machine", label: "整机与型号", articles: [MODEL_MEANING] },
  { id: "hydraulic", label: "液压系统", articles: [HEIGHT_ADJUST_FAULTS, HYDRAULIC_NUT] },
  { id: "cutting", label: "截割部", articles: [DRUM_MAINTENANCE] },
];

export const KB_ARTICLES: KbArticle[] = KB_GROUPS.flatMap((group) => group.articles);
