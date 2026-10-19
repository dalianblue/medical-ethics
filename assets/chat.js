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
                     : e.message === "RATE" ? "⚠ 当前使用人数较多，请稍后再试，或在首页⚙填入自己的 DeepSeek Key"
                     : "⚠ 网络异常：" + e.message + "，请重试");
  }
}
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
  bubble("ai", `（继续上次的对话，当前阶段：${stageName()}。重新开始请清除浏览器数据或点首页⚙重置。）`);
}
