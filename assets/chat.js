/* chat.js — 随便聊聊: DeepSeek驱动的伦理申报引导员 (1019) */
"use strict";
const $ = id => document.getElementById(id);
const KEY_LS = "me_deepseek_key";
const STAGE_LS = "me_chat_stage";
const HISTORY_LS = "me_chat_history";

/* ===== 阶段机(引导流程, 按pyEEG验证过的申报逻辑) ===== */
const STAGES = [
  { id: "idea",     name: "了解想法" },
  { id: "type",     name: "类型判定" },
  { id: "enroll",   name: "纳排标准" },
  { id: "sample",   name: "样本量" },
  { id: "ethics",   name: "知情同意" },
  { id: "generate", name: "生成文书" },
];

let stage = localStorage.getItem(STAGE_LS) || "idea";
let history = JSON.parse(localStorage.getItem(HISTORY_LS) || "[]");

const sysPrompt = `你是医学研究伦理申请的引导员，帮助临床研究者把模糊的想法整理成合格的伦理申请材料。
你的工作方式：每次只问1-2个问题，逐步收集信息，绝不一次性甩出大问卷。
按以下阶段推进（当前阶段由系统注入）：
1.idea：了解研究想法（做什么、在什么人群、解决什么问题）
2.type：判定研究类型（干预性vs观察性；前瞻vs回顾），并告知注册义务（干预性必须注册ChiCTR/NCT；观察性走STROBE清单）
3.enroll：收集纳入标准、排除标准（引导用户逐条说，你来整理成规范表述）
4.sample：收集主要结局和预期参数，建议样本量计算方法（两率比较/均值比较/非劣效/TOST/AUC CI宽度/相关性），帮助估算样本量（如用户给了参数请直接计算给出数字）
5.ethics：知情同意方式（签署同意书 or 豁免——豁免需用户给出至少3条论证理由，你来帮他完善表述）
6.generate：信息齐全后输出总结，并提示"点击下方按钮生成文书"

要求：
- 中文回答，口语化、鼓励式，每次回复≤200字
- 收到新信息时先简要确认你的理解，再问下一个问题
- 用户粘贴已有方案时，直接提取要素并汇报"我已从你的方案中提取到：…"
- 永远不给确定性医学结论，提醒最终须经伦理委员会审查`;


/* ===== 风险提示库注入(蒸馏自second-brain 1.2万卡, 2026-10-19) ===== */
function matchRiskTopics(text) {
  const AXES = {
    "全麻/全身麻醉": /全身麻醉|全麻|丙泊酚|七氟醚|插管|拔管|机械通气/,
    "椎管内麻醉": /椎管内|硬膜外|腰麻|蛛网膜下/,
    "神经阻滞": /神经阻滞|臂丛|腰丛|骶麻|骶管|髂筋膜/,
    "镇静": /镇静|无痛胃肠镜|右美托咪定|咪达唑仑/,
    "老年": /老年|高龄/,
    "儿童": /儿童|小儿|婴幼儿|患儿/,
    "孕妇/产科": /孕妇|产科|剖宫产|妊娠/,
    "腹腔镜/气腹": /腹腔镜|气腹/,
    "日间手术/快速康复": /日间手术|快速康复|ERAS/,
    "术后疼痛/镇痛": /术后镇痛|镇痛泵|多模式镇痛|术后疼痛/,
    "术后恶心呕吐": /恶心呕吐|PONV/,
    "术后谵妄/认知": /谵妄|认知功能/,
    "苏醒期躁动": /躁动/,
    "低血压/循环": /低血压|心动过缓|循环抑制/,
    "呼吸抑制/低氧": /呼吸抑制|低氧血症/,
    "体温/寒战": /低体温|寒战|保温/,
    "过敏/类过敏": /过敏/,
    "困难气道/误吸": /困难气道|误吸|饱胃/,
  };
  const out = [];
  for (const [axis, pat] of Object.entries(AXES)) {
    if (pat.test(text) && window.RISK_KB && window.RISK_KB[axis]) out.push(axis);
  }
  return out.slice(0, 4);
}
/* 设计判定: LLM类型化分类器(JEV System One范式; JEV key到位后切/jc端点)
   返回 {design, confidence, source} */
let _designCache = null;
let _designCacheKey = "";
async function classifyDesign(historyArr) {
  const joined = historyArr.map(m => (m.role === "user" ? "用户: " : "引导员: ") + m.content).join("\n").slice(-8000);
  if (_designCache && _designCacheKey === joined.slice(-500)) return _designCache;
  const key = localStorage.getItem(KEY_LS);
  const sys = `你是研究设计分类器。判断这段医患研究者对话描述的研究设计类型。只输出JSON: {"design":"RCT|前瞻性队列|回顾性队列|病例对照|横断面|病例系列|其他观察性|未明确", "confidence":0到1}。注意:"随机分组困难/难以随机/无法随机"是反对RCT的信号, 不是支持RCT; 判断不清时design填"未明确"且confidence必须≤0.5。`;
  const msgs = [{ role: "system", content: sys }, { role: "user", content: joined }];
  try {
    let r;
    if (key) {
      r = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
        body: JSON.stringify({ model: "deepseek-chat", temperature: 0, max_tokens: 100, messages: msgs }),
      });
    } else {
      r = await fetch("/api/me/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "deepseek-chat", max_tokens: 100, messages: msgs }),
      });
    }
    if (!r.ok) throw new Error("api");
    const txt = (await r.json()).choices[0].message.content;
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("fmt");
    const obj = JSON.parse(m[0]);
    const out = { design: String(obj.design || "未明确"), confidence: Number(obj.confidence) || 0, source: "llm" };
    _designCache = out; _designCacheKey = joined.slice(-500);
    return out;
  } catch (e) {
    /* LLM失败→正则兜底(保守版: 只认明确词, 语义反转风险已由prompt规避主路径) */
    return { design: regexFallback(joined), confidence: 0.55, source: "regex-fallback" };
  }
}
function regexFallback(text) {
  const t = text || "";
  if (/队列|cohort/i.test(t)) return "前瞻性队列";
  if (/病例对照|case-control/i.test(t)) return "病例对照";
  if (/横断面|现况调查/i.test(t)) return "横断面";
  if (/随机分组困难|难以随机|无法随机|不好随机/.test(t)) return "其他观察性";
  if (/随机对照|RCT/i.test(t)) return "RCT";
  return "未明确";
}
async function designBlockAsync(historyArr) {
  const cls = await classifyDesign(historyArr);
  if (cls.confidence < 0.7 || cls.design === "未明确") {
    return "\n【设计确认——最高优先级】对话未能明确研究设计类型（分类置信度" + cls.confidence.toFixed(2) + "）。全文严禁出现'随机分组/随机对照/盲法/分配隐藏'等表述，设计相关内容全部标注【待补充：设计类型与分组方法】。\n";
  }
  return "\n【设计确认——最高优先级，机器判定置信度" + cls.confidence.toFixed(2) + "】本研究设计类型是: " + cls.design
       + "\n全文所有章节必须与此设计一致。设计确认优先于本提示词中的任何章节模板要求：模板中不适用于该设计的章节要素（如队列研究的随机化/盲法）必须整体省略，不得改写后塞入。\n";
}
function riskContextBlock(text) {
  const topics = matchRiskTopics(text);
  if (!topics.length) return "";
  let s = "\n【风险提示库命中】该研究涉及: " + topics.join("、") + "\n";
  s += "生成知情同意书风险章节时, 逐条引用下列证据条目(含发生率与来源), 禁止用'轻微不便'类模板句; 未列出的风险不得编造:\n";
  for (const tp of topics) {
    s += "\n■ " + tp + ":\n";
    for (const r of window.RISK_KB[tp].risks.slice(0, 6)) {
      s += "- " + r.name + "（" + r.freq + "）" + (r.detail ? "：" + r.detail : "") + (r.src.length ? " [源:" + r.src[0] + "]" : "") + "\n";
    }
    s += "患者话术参考: " + window.RISK_KB[tp].lines.slice(0, 2).join(" ") + "\n";
  }
  return s;
}

function stageIdx() { return STAGES.findIndex(s => s.id === stage); }
function stageName() { return STAGES[stageIdx()].name; }
function nextStage() {
  const i = Math.min(stageIdx() + 1, STAGES.length - 1);
  stage = STAGES[i].id;
  localStorage.setItem(STAGE_LS, stage);
  $("stage-chip").textContent = "阶段：" + stageName();
  if (typeof refreshGenBar === "function") refreshGenBar();
}

/* ===== UI ===== */
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderMd(text) {
  /* 先转义HTML防XSS, 再用marked渲染markdown。
     单个波浪号保护为实体: 防GFM把"3~6分...1~2分"两个~误配对成删除线(medical数字范围高频) */
  return marked.parse(escapeHtml(text).replace(/~(?!~)/g, "&#732;"));
}
function bubble(role, text, isHtml) {
  const row = document.createElement("div");
  row.className = "bubble-row " + (role === "user" ? "row-user" : "row-ai");
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "🧑‍⚕️" : "🤖";
  const el = document.createElement("div");
  el.className = "ai-msg ai-" + role;
  if (isHtml) el.innerHTML = text; else el.innerHTML = renderMd(text);
  row.appendChild(avatar);
  row.appendChild(el);
  $("chat-history").appendChild(row);
  $("chat-history").scrollTop = $("chat-history").scrollHeight;
  return el;
}
function saveHist() {
  localStorage.setItem(HISTORY_LS, JSON.stringify(history.slice(-40)));
  localStorage.setItem(STAGE_LS, stage);
}

/* ===== DeepSeek调用(用户key) ===== */
async function deepseek(messages) {
  /* 1019晚: 默认走本站代理(平台预置key, 限流20次/时/IP);
     高级用户可在首页⚙填自己的key直连(不限流) */
  const ownKey = localStorage.getItem(KEY_LS);
  let r;
  if (ownKey) {
    r = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ownKey },
      body: JSON.stringify({
        model: "deepseek-chat", temperature: 0.4,
        messages: [{ role: "system", content: sysPrompt + `\n当前阶段：${stageName()}（${stage}）` + riskContextBlock(messages.map(m => m.content).join(" ")) },
                   ...messages],
      }),
    });
  } else {
    r = await fetch("/api/me/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "system", content: sysPrompt + `\n当前阶段：${stageName()}（${stage}）` + riskContextBlock(messages.map(m => m.content).join(" ")) },
                   ...messages],
      }),
    });
  }
  if (r.status === 401) throw new Error("KEYBAD");
  if (r.status === 429) throw new Error("RATE");
  if (!r.ok) throw new Error("API" + r.status);
  return (await r.json()).choices[0].message.content;
}

async function send() {
  const q = $("chat-input").value.trim();
  if (!q) return;
  $("chat-input").value = "";
  history.push({ role: "user", content: q });
  bubble("user", q);
  const pend = bubble("ai", "…");
  try {
    const answer = await deepseek(history);
    pend.innerHTML = renderMd(answer);
    history.push({ role: "assistant", content: answer });
    nextStage();
    saveHist();
  } catch (e) {
    pend.innerHTML = renderMd(e.message === "KEYBAD" ? "⚠ API Key 无效，请到首页⚙重新填写"
                     : e.message === "NOKEY" ? "⚠ 请先在首页⚙填写 DeepSeek API Key"
                     : e.message === "RATE" ? "⚠ 本小时使用次数已达上限（60次/时/IP），请下个整点再试，或在首页⚙填入自己的 DeepSeek Key"
                     : "⚠ 网络异常：" + e.message + "，请重试");
  }
}

/* ===== 生成文书(generate阶段) ===== */
function refreshGenBar() {
  $("gen-bar").hidden = stage !== "generate";
}
const GEN_SYS = `你是一名精通临床医学与临床研究方法学的医学科学家，覆盖各专科（内科/外科/妇产/儿科/麻醉/肿瘤/神经/精神等），长期从事医学研究方案设计、临床试验注册规范（WHO TRDS与ClinicalTrials.gov标准）与伦理申报，熟知：手术入路互斥分类（经尿道/腹腔镜/开放切口不得混列）、药物通用名规范（禁用商品名）、结局指标三要素（名称不含缩写+测量方法+时间点）、研究设计分类（RCT/队列/病例对照/横断面按证据等级与因果论证强度严格区分）。你现在的任务：产出**直接可提交伦理委员会的完整文书**（参照三甲医院IIT过会方案标准），不是提纲。

【输出格式——严格遵守】
第一行必须是 ===PROTOCOL===
其后是研究方案全文(markdown)
然后一行必须是 ===CONSENT===
其后是知情同意书全文(markdown)
除以上内容外不输出任何解释或代码块围栏。

【研究方案章节(每章达标)】
# 研究方案
## 一、研究背景 (≥300字: 临床问题+现状+研究缺口+切入点)
## 二、研究目的 (主要+次要, 逐条; 主要结局按三要素写: 结局名称(不用缩写)+测量方法/量表+测量时间点)
## 三、研究过程
### 3.1 研究方法 (设计类型必须与对话中确认的设计一致——RCT写分组随机化+分配隐藏机制+序列产生+盲法对象；队列写暴露组/对照组划分+随访策略+混杂控制；病例对照写病例来源+匹配因素；绝不写对话未确认的设计要素。干预/暴露描述用通用名+剂量/频次/途径/时长。另含: 对象来源/样本量估算:公式参数每个数值来源与计算过程/统计方法)
### 3.2 研究步骤 (筛选到随访时间线, 逐访视窗)
### 3.3 数据存储 (采集工具/存储位置/加密/期限/脱标识/权限)
### 3.4 研究路线图 (分阶段)
## 四、研究的风险和获益；补偿、赔偿措施；受试者保护措施
### （一）风险和获益 (逐条风险+防控+获益; 上下文有风险库条目则逐条引用发生率与来源)
### （二）补偿、赔偿措施
### （三）隐私保护、风险控制和安全保护
## 五、质量控制与研究监测 (依从性/数据核查/中止标准; 较大干预性研究写明是否设独立数据监查委员会DMC)
## 六、知情同意 (方式/执行人/特殊人群; 豁免则完整论证)
## 七、主要研究者与参加人员 (【待补充】标注; 联系方式区分公众问询与科学问询两类)
## 八、注册与数据共享 (注册平台与号【待补充：ChiCTR/NCT】; 个体参与者数据IPD共享计划: 是否共享/共享范围/获取机制)

【知情同意书章节】为什么做这项研究/参加需要做什么/风险与不适(逐条+发生率+来源)/获益/自愿参加与退出/隐私保护/补偿与赔偿/联系人/同意声明签名栏

【临床事实边界】①术式/解剖/药物/器械名称不得自行扩展或举例——对话中没有出现的术式不得写入方案，更不得把不同入路/不同类别的术式并列进同一主题词（例如"腹腔镜手术"清单里不得出现经尿道电切/剜除等非腹腔镜入路术式）；②并列列举时每一项必须与主题词严格同类，拿不准的用【待补充：术式/名称】；
【硬性要求】①设计类型/分组/盲法/随机化只准写对话中确认过的——对话说是队列就绝不能出现随机分组, 说不清的用【待补充】; ②对话已收集信息全部写入并展开(样本量计算写全参数过程); ③未收集的用【待补充】标注; ④长度不设上限, 目标2500-4500字。`;

async function generateDocs() {
  const btn = $("btn-gen");
  btn.disabled = true; btn.textContent = "⏳ 生成中，约10-30秒…";
  try {
    const key = localStorage.getItem(KEY_LS);
    const body = {
      model: "deepseek-chat", temperature: 0.3,
      messages: [
        { role: "system", content: GEN_SYS + (await designBlockAsync(history)) + riskContextBlock(history.map(m => m.content).join(" ")) },
        ...history.slice(-30),
      ],
    };
    let r;
    if (key) {
      r = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
        body: JSON.stringify(body),
      });
    } else {
      r = await fetch("/api/me/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    if (!r.ok) throw new Error("API" + r.status);
    let data = await r.json();
    let txt = data.choices[0].message.content;
    let docs = parseSections(txt);
    if (!docs) {
      /* 截断类失败: 自动重试一次(要求精简输出) */
      bubble("ai", "第一次生成不完整，正在自动重试（精简模式）…");
      body.messages[0] = { role: "system", content: GEN_SYS + (await designBlockAsync(history)) + "\n注意: 上次输出被截断。本次保留全部章节结构, 压缩各章篇幅(每章2-3句核心), 优先保证两个分隔符标记完整。" + riskContextBlock(history.map(m => m.content).join(" ")) };
      r = await fetch(key ? "https://api.deepseek.com/v1/chat/completions" : "/api/me/", {
        method: "POST",
        headers: key ? { "Content-Type": "application/json", "Authorization": "Bearer " + key }
                     : { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("API" + r.status);
      data = await r.json();
      txt = data.choices[0].message.content;
      docs = parseSections(txt);
      if (!docs) throw new Error("两次生成均不完整");
    }
    /* docs解析见parseSections */
    /* 确定性设计校验: 服务端判定 vs 全文违禁词, 违规→自动重生成一次 */
    const sysMsg = (body.messages[0] || {}).content || "";
    const cohortLike = /队列|观察性|病例对照|横断面/.test(sysMsg);
    let violations = cohortLike
      ? (docs.protocol || "").match(/随机分为|随机对照试验|随机化方案|分配隐藏|采用盲法|评估者盲/g) || []
      : [];
    /* 术式入路校验: 腹腔镜语境混入其他入路术式(施主抓到的TURP幻觉类) */
    const termIssues = checkMixedApproach((docs.protocol || "") + " " + (docs.consent || ""));
    if (termIssues.length && !violations.length) {
      bubble("ai", "⚠ 术式校验发现疑似入路混列：\n" + termIssues.slice(0, 3).join("\n")
        + "\n\n已按术语边界规则重试生成（术式清单只保留对话中确认的入路）。");
      body.messages.push({ role: "assistant", content: txt.slice(0, 300) });
      body.messages.push({ role: "user", content: "你生成的文书把不同手术入路的术式混列了（如腹腔镜清单中出现经尿道术式）。手术入路互斥：经尿道/腹腔镜/开放切口不得并列。请重新生成完整文书：只保留对话中确认过的术式，未确认的术式标注【待补充：术式名称】，保持 ===PROTOCOL=== 与 ===CONSENT=== 分隔符格式。" });
      r = await fetch(key ? "https://api.deepseek.com/v1/chat/completions" : "/api/me/", {
        method: "POST",
        headers: key ? { "Content-Type": "application/json", "Authorization": "Bearer " + key }
                     : { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("API" + r.status);
      data = await r.json();
      txt = data.choices[0].message.content;
      docs = parseSections(txt);
      if (!docs) throw new Error("修正后仍不完整，请重试");
    }
    if (violations.length) {
      bubble("ai", "检测到生成文稿与确认的队列/观察性设计不符（出现：" + [...new Set(violations)].join("、") + "），正在自动修正…");
      body.messages.push({ role: "assistant", content: txt.slice(0, 400) });
      body.messages.push({ role: "user", content: "你生成的方案违规使用了 " + [...new Set(violations)].join("、") + " 等随机对照试验要素。本研究设计是队列/观察性研究（按暴露自然分组）。请重新生成完整文书：研究设计与分组必须严格按队列研究写（暴露组/对照组、随访、混杂控制），全文不得出现任何随机分组、分配隐藏、盲法字样，保持 ===PROTOCOL=== 与 ===CONSENT=== 分隔符格式。" });
      r = await fetch(key ? "https://api.deepseek.com/v1/chat/completions" : "/api/me/", {
        method: "POST",
        headers: key ? { "Content-Type": "application/json", "Authorization": "Bearer " + key }
                     : { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("API" + r.status);
      data = await r.json();
      txt = data.choices[0].message.content;
      docs = parseSections(txt);
      if (!docs) throw new Error("修正后仍不完整，请重试");
    }
    downloadMd("研究方案.md", docs.protocol || "");
    if (docs.consent && docs.consent.length > 100) {
      setTimeout(() => downloadMd("知情同意书.md", docs.consent), 400);
    } else {
      setTimeout(() => bubble("ai", "知情同意书这次没有生成完整（AI输出被截断）。点击生成按钮重试即可，方案文件不受影响。"), 500);
    }

    btn.textContent = "✅ 已生成（若未弹出下载请检查浏览器设置）";
  } catch (e) {
    btn.textContent = "⚠ " + (e.message || "失败") + "，请重试";
    bubble("ai", "生成文书时出现问题：" + (e.message || e) + "\n\n常见原因：\n1. AI输出被截断——再点一次通常就好\n2. 网络波动——稍后重试\n\n若反复失败，可换网络或用系统浏览器打开本页。");
    btn.disabled = false;
  }
}

/* ===== 术式入路校验(蒸馏自second-brain教科书卡, 1019) ===== */
const APPROACH = {
  "腹腔镜": ["腹腔镜", "气腹", "套管", "穿刺器"],
  "经尿道内镜": ["经尿道", "电切镜", "剜除", "TURP", "膀胱镜", "输尿管镜", "肾镜", "宫腔镜"],
  "机器人辅助": ["机器人", "达芬奇"],
  "开放切口": ["开腹", "开放手术"],
  "介入/腔内": ["介入", "支架", "栓塞"],
  "内镜消化道": ["胃镜", "肠镜"],
};
function approachOf(term) {
  const hits = new Set();
  for (const [a, kws] of Object.entries(APPROACH)) {
    if (kws.some(kw => term.toLowerCase().includes(kw.toLowerCase()))) hits.add(a);
  }
  return hits;
}
function checkMixedApproach(text) {
  const issues = [];
  const re = /腹腔镜[\u4e00-\u9fff]{0,14}?(?:手术|切除术|手术（[^）]{0,40}）)[^。\n]{0,100}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const seg = m[0];
    for (const bad of ["经尿道", "电切镜", "剜除", "开腹"]) {
      if (seg.includes(bad)) issues.push("腹腔镜语境中混入非腹腔镜入路术式（" + bad + "）：" + seg.slice(0, 60) + "…");
    }
  }
  return issues;
}
function parseSections(txt) {
  txt = String(txt).replace(/```[a-z]*\n?/gi, "").replace(/```/g, "");
  const pm = txt.match(/=+\s*PROTOCOL\s*=+\n?([\s\S]*?)(?:=+\s*CONSENT\s*=+|$)/i);
  const cm = txt.match(/=+\s*CONSENT\s*=+\n?([\s\S]*)/i);
  if (!pm && !cm) {
    if (txt.indexOf("研究方案") !== -1 && txt.length > 800) return { protocol: txt.trim(), consent: "" };
    return null;
  }
  return { protocol: ((pm && pm[1]) || "").trim(), consent: ((cm && cm[1]) || "").trim() };
}
function isWeixin() { return /MicroMessenger/i.test(navigator.userAgent); }
function downloadMd(name, text) {
  if (isWeixin()) {
    /* 微信内置浏览器不支持blob a[download]下载 → 弹层展示全文, 引导复制/用系统浏览器打开 */
    showCopyModal(name, text);
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function showCopyModal(name, text) {
  let ov = document.getElementById("copy-modal");
  if (ov) ov.remove();
  ov = document.createElement("div");
  ov.id = "copy-modal";
  ov.className = "modal";
  ov.innerHTML = '<div class="modal-box" style="max-width:92vw">'
    + '<h2>' + name.replace(/</g, "&lt;") + '</h2>'
    + '<p class="hint">微信内不支持直接下载。请【全选复制】以下内容，粘贴到备忘录/邮件保存；或点右上角"…"选择"在浏览器打开"后重新生成下载。</p>'
    + '<textarea readonly style="width:100%;height:50vh;font-size:12px;border:1px solid #dde4ea;border-radius:8px;padding:8px"></textarea>'
    + '<div class="modal-btns"><button class="btn-ghost" onclick="document.getElementById(\'copy-modal\').remove()">关闭</button>'
    + '<button class="btn-primary" id="copy-sel">全选复制</button></div></div>';
  document.body.appendChild(ov);
  const ta = ov.querySelector("textarea");
  ta.value = text;
  ov.querySelector("#copy-sel").onclick = () => {
    ta.focus(); ta.select();
    try { document.execCommand("copy"); ov.querySelector("#copy-sel").textContent = "✅ 已复制"; }
    catch (e) { alert("请手动长按全选复制"); }
  };
}
$("btn-gen").addEventListener("click", generateDocs);

/* 开启新的对话: 清空历史与阶段, 重新开始 */
$("btn-newchat").onclick = () => {
  if (!confirm("开启新的对话？当前对话记录将被清除。")) return;
  localStorage.removeItem(HISTORY_LS);
  localStorage.removeItem(STAGE_LS);
  location.reload();
};
$("btn-chat-send").onclick = send;
$("chat-input").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});

/* ===== 初始化: 欢迎语+历史恢复 ===== */
if (history.length === 0) {
  bubble("ai", "你好！我是伦理申报引导员 🙋\n\n"
    + "跟我聊聊你的研究想法就行——比如你想研究什么问题、在什么患者身上、想解决什么困扰。\n\n"
    + "或者你已经写好了方案/有一段想法，直接粘贴过来，我帮你整理成合格的伦理申请材料。\n\n"
    + "开始吧：你的研究想法是什么？");
  saveHist();
} else {
  history.forEach(m => bubble(m.role === "user" ? "user" : "ai", m.content));
  $("stage-chip").textContent = "阶段：" + stageName();
  if (typeof refreshGenBar === "function") refreshGenBar();
  bubble("ai", `（继续上次的对话，当前阶段：${stageName()}。重新开始请清除浏览器数据或点首页⚙重置。）`);
}

/* 时序兜底: 微信webview下localStorage/脚本执行序偶发异常, 多次尝试刷新按钮显隐 */
[0, 300, 800].forEach(ms => setTimeout(refreshGenBar, ms));
document.addEventListener("DOMContentLoaded", refreshGenBar);
window.addEventListener("focus", refreshGenBar);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshGenBar(); });
