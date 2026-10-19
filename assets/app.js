/* medical-ethics app.js — 表单逻辑/样本量计算(JS版)/文书生成 (1019) */
"use strict";

/* ===== 步骤导航 ===== */
const STEPS = [1, 2, 3, 4];
let cur = 1;

function show(n) {
  cur = n;
  document.querySelectorAll("main .card").forEach(c => c.classList.remove("on"));
  document.getElementById("s" + n).classList.add("on");
  document.querySelectorAll(".step").forEach(s =>
    s.classList.toggle("on", +s.dataset.s === n));
  document.getElementById("btn-prev").disabled = n === 1;
  document.getElementById("btn-next").textContent = n === 4 ? "生成 →" : "下一步 →";
  if (n === 4) updateVerdict();   // 进文书页前刷新类型判定
  window.scrollTo({ top: 0 });
}
document.getElementById("btn-prev").onclick = () => cur > 1 && show(cur - 1);
document.getElementById("btn-next").onclick = () => {
  if (cur === 3 && !lastCalc) { doCalc(); }   // 进第4步前先算一次样本量
  if (cur < 4) show(cur + 1);
};

/* ===== 类型判定 ===== */
const $ = id => document.getElementById(id);

function readType() {
  const inter = document.querySelector('input[name=interventional]:checked').value === "yes";
  const timing = document.querySelector('input[name=timing]:checked').value;
  return { inter, timing };
}

function updateVerdict() {
  const { inter, timing } = readType();
  const v = document.getElementById("type-verdict");
  const tcn = { prospective: "前瞻性", retrospective: "回顾性", hybrid: "混合（前瞻采集+回顾分析）" }[timing];
  let html = `判定：<b>${inter ? "干预性研究" : "观察性研究"}</b>（${tcn}）。<br>`;
  if (inter) {
    html += `注册义务：<b>必须注册</b>（ICMJE要求）。国内→ChiCTR；国际/投顶刊→ClinicalTrials.gov。`
         +  `发表清单：CONSORT。`;
    document.getElementById("q-int-detail").style.display = "block";
  } else {
    html += `注册义务：观察性研究<b>无强制注册义务</b>（ICMJE注册要求仅覆盖前瞻性干预研究），发表清单：STROBE。`
         +  `注：若属"前瞻采集数据"的观察设计，部分机构仍鼓励注册（记录于伦理材料说明即可）。`;
    document.getElementById("q-int-detail").style.display = "none";
  }
  v.innerHTML = html;
  v.classList.add("show");
}
document.querySelectorAll('input[name=interventional],input[name=timing]').forEach(
  el => el.addEventListener("change", updateVerdict));

/* ===== 样本量计算 (JS版, 与sample_size.py公式一致) ===== */
function zQuant(p) {           /* 正态分位数(有理逼近, Acklam算法简化) */
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const plow = 0.02425, phigh = 1 - plow;
  let q, r;
  if (p < plow) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+d[4]); }
  if (p > phigh) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+d[4]); }
  q = p - 0.5; r = q * q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
         (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}
const z1 = p => zQuant(p);                          // 单侧分位
const z2 = alpha => zQuant(1 - alpha / 2);          // 双侧

/* 各设计类型的参数显隐 */
function syncFields() {
  const t = $("calc-type").value;
  const show = { p1: 0, p2: 0, delta: 0, sd: 0, auc: 0, ciw: 0, r: 0 };
  if (t === "two_proportions") { show.p1 = 1; show.p2 = 1; }
  if (t === "two_means")       { show.delta = 1; show.sd = 1; }
  if (t === "noninferiority")  { show.delta = 1; show.sd = 1; }
  if (t === "tost")            { show.delta = 1; show.sd = 1; }
  if (t === "auc_ci")          { show.auc = 1; show.ciw = 1; }
  if (t === "correlation")     { show.r = 1; }
  for (const k in show) $("style_" + k);
  document.querySelectorAll(".grid2 label, .grid3 label").forEach(() => {});
  [["p1", show.p1], ["p2", show.p2], ["delta", show.delta], ["sd", show.sd],
   ["auc", show.auc], ["ci-width", show.ciw], ["r", show.r]].forEach(([id, on]) => {
    const lb = $(id).closest("label");
    lb.style.display = on ? "block" : "none";
  });
}
$("calc-type").addEventListener("change", syncFields);
syncFields();

let lastCalc = null;

function doCalc() {
  const t = $("calc-type").value;
  const alpha = parseFloat($("alpha").value) || 0.05;
  const power = parseFloat($("power").value) || 0.80;
  const dropout = parseFloat($("dropout").value) || 0;
  const num = id => parseFloat($(id).value);
  const za = t === "noninferiority" ? z1(1 - alpha) : z2(alpha);
  const zb = z1(power);
  let n, formula = "";

  if (t === "two_proportions") {
    const p1 = num("p1"), p2 = num("p2");
    const tails = parseInt($("tails").value);
    const za_ = tails === 1 ? z1(1 - alpha) : z2(alpha);
    const pb = (p1 + p2) / 2;
    n = Math.ceil((za_ * Math.sqrt(2 * pb * (1 - pb)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (p1 - p2) ** 2);
    formula = `n = [Zα√(2p̄(1-p̄)) + Zβ√(p₁(1-p₁)+p₂(1-p₂))]² / (p₁-p₂)²`;
  } else if (t === "two_means") {
    const d = num("delta"), sd = num("sd");
    const tails = parseInt($("tails").value);
    const za_ = tails === 1 ? z1(1 - alpha) : z2(alpha);
    n = Math.ceil(2 * ((za_ + zb) * sd / d) ** 2);
    formula = `n = 2[(Zα+Zβ)·SD/δ]²`;
  } else if (t === "noninferiority") {
    const d = num("delta"), sd = num("sd");
    n = Math.ceil(2 * ((z1(1 - alpha) + zb) * sd / Math.abs(d)) ** 2);
    formula = `n = 2[(Z(1-α)+Zβ)·SD/Δ_NI]²  (单侧α=${alpha})`;
  } else if (t === "tost") {
    const d = num("delta"), sd = num("sd");
    n = Math.ceil(2 * ((z2(alpha) + zb) * sd / Math.abs(d)) ** 2);
    formula = `n = 2[(Z(1-α/2)+Zβ)·SD/Δ_eq]²  (TOST双单侧)`;
  } else if (t === "auc_ci") {
    const auc = num("auc"), w = num("ci-width");
    const se = w / (2 * z2(alpha));
    n = Math.ceil(auc * (1 - auc) / (se ** 2));
    formula = `n = AUC(1-AUC)/SE², SE=CI宽/(2·Zα/2)`;
  } else if (t === "correlation") {
    const r = num("r");
    const fz = 0.5 * Math.log((1 + r) / (1 - r));
    n = Math.ceil(((z2(alpha) + zb) / fz) ** 2 + 3);
    formula = `n = [(Zα/2+Zβ)/Fisher(r)]² + 3`;
  }

  const nFinal = dropout > 0 ? Math.ceil(n / (1 - dropout)) : n;
  lastCalc = {
    calculator: t, params: { alpha, power, dropout },
    n_per_group_raw: n, n_per_group_final: nFinal,
    total_n: ["auc_ci", "correlation"].includes(t) ? nFinal : nFinal * 2,
  };

  const box = $("calc-result");
  box.hidden = false;
  box.innerHTML =
    `<b>${nFinal}</b> 例${["auc_ci", "correlation"].includes(t) ? "" : "（每组 " + nFinal + "）"}` +
    (dropout > 0 ? `（已含 ${Math.round(dropout * 100)}% 脱落放大）` : "") +
    `<div class="formula">${formula}<br>原始样本量 ${n} → 脱落放大后 ${nFinal}</div>` +
    `<div class="formula">⚠ 计算结果供设计参考，最终样本量辩护归统计师。</div>`;
}
$("btn-calc").onclick = doCalc;

/* ===== 文书生成 ===== */
function collect() {
  const { inter, timing } = readType();
  const lines = id => ($(id).value || "").split("\n").map(s => s.trim()).filter(Boolean);
  const t = $("calc-type").value;
  const tcn = { two_proportions: "两样本率比较", two_means: "两样本均值比较",
                noninferiority: "非劣效试验", tost: "TOST等价检验",
                auc_ci: "AUC诊断研究CI宽度法", correlation: "相关性分析" }[t];
  const timingCn = { prospective: "前瞻性", retrospective: "回顾性", hybrid: "混合" }[timing];
  return {
    title: $("title").value.trim() || "（未填题目）",
    version: "1.0",
    date: new Date().toISOString().slice(0, 10),
    study_type: inter ? "interventional" : "observational",
    data_timing: timing,
    registration_note: inter
      ? "干预性研究，已按ICMJE要求在注册库注册（注册号见伦理材料）。发表清单：CONSORT。"
      : "观察性研究，按BJA/ICMJE规则无强制注册义务，发表要求为STROBE清单逐条对照。",
    background: $("background").value.trim(),
    purposes: lines("purposes"),
    inclusion: lines("inclusion"),
    exclusion: lines("exclusion"),
    randomization: $("randomization").value || "",
    blinding: $("blinding").value || "",
    sample_size: lastCalc ? {
      calculator: t, name_cn: tcn,
      params: { alpha: parseFloat($("alpha").value), power: parseFloat($("power").value),
                tails: parseInt($("tails").value), dropout: parseFloat($("dropout").value) },
      n_per_group_raw: lastCalc.n_per_group_raw,
      n_per_group_final: lastCalc.n_per_group_final,
      total_n: lastCalc.total_n,
    } : null,
    consent_mode: document.querySelector('input[name=consent]:checked').value,
    waiver_justification: $("waiver").value.trim(),
  };
}

function renderProtocol(a) {
  const linesOf = id => a[id.replace("-","")] || [];
  let s = `# "${a.title}"项目研究方案\n\n**方案版本号：${a.version}，${a.date}**\n\n`;
  s += `## 一、研究背景\n\n${a.background}\n\n`;
  s += `## 二、研究目的\n`;
  a.purposes.forEach((p, i) => s += `（${i + 1}）${p}\n`);
  const tcn = { interventional: "干预性研究", observational: "观察性研究" }[a.study_type];
  const tm = { prospective: "前瞻性", retrospective: "回顾性", hybrid: "前瞻采集+回顾分析" }[a.data_timing];
  s += `\n### 3.1 研究方法\n\n**研究类型**：${tcn}（${tm}）。\n\n**注册与清单义务**：${a.registration_note}\n\n`;
  s += `### 3.2 研究对象\n\n**纳入标准**：\n${a.inclusion.map(x => "- " + x).join("\n")}\n\n**排除标准**：\n${a.exclusion.map(x => "- " + x).join("\n")}\n`;
  if (a.randomization) s += `\n**随机方法**：${a.randomization}\n`;
  if (a.blinding) s += `**盲法**：${a.blinding}\n`;
  if (a.sample_size) {
    const ss = a.sample_size;
    s += `\n### 3.3 样本量\n\n采用**${ss.name_cn}**方法估算样本量。\n\n` +
         `计算结果：每组 **${ss.n_per_group_raw}** 例${ss.params.dropout ? `；考虑${Math.round(ss.params.dropout * 100)}%脱落率后，最终每组${ss.n_per_group_final}例` : ""}，总计 **${ss.total_n}** 例。\n\n` +
         `样本量计算书可由本工具复算（附answers.json）。最终样本量确定由研究者与统计师共同负责。\n`;
  }
  if (a.consent_mode === "waiver") {
    s += `\n## 四、知情同意豁免\n\n本研究申请**豁免知情同意**，论证如下：\n\n${a.waiver_justification}\n`;
  } else {
    s += `\n## 四、知情同意\n\n研究开始前由研究者向受试者充分说明研究目的、流程、风险与获益，签署知情同意书后入组。\n`;
  }
  s += `\n---\n*本方案由医学研究伦理申请助手生成（${a.date}），须经研究者和统计师审核、并经伦理委员会审查批准后实施。*\n`;
  return s;
}

function renderConsent(a) {
  let s = `# 知情同意书\n\n**研究题目**：${a.title}\n\n`;
  s += `## 一、为什么做这项研究\n\n${a.background}\n\n`;
  s += `## 二、如果您参加，需要做什么\n\n`;
  a.inclusion.forEach(x => s += `- 符合条件：${x}\n`);
  s += `\n您将被邀请接受${a.data_timing === "prospective" ? "前瞻性的" : ""}数据采集与随访观察，具体流程由研究医生向您详细说明。\n\n`;
  s += `## 三、风险与不适\n\n研究涉及的 操作/数据采集 可能带来轻微不便；所有数据将去标识化处理，您的隐私将受到保护。\n\n`;
  s += `## 四、自愿参加与退出\n\n参加完全自愿。您可以随时退出研究，不会影响您的正常医疗。如退出，已采集的数据在去标识化后仍可能被用于分析。\n\n`;
  s += `## 五、隐私保护\n\n您的个人信息将加密存储、去标识化分析，仅研究团队可访问，不对外披露可识别身份的信息。\n\n`;
  s += `## 六、联系人\n\n如有问题，请联系研究医生：________（电话：________）。\n\n`;
  s += `## 七、同意声明\n\n我已阅读并理解本知情同意书，研究者已回答我的全部疑问。我自愿同意参加本研究。\n\n\n`;
  s += `受试者签名：____________　日期：________\n\n研究者签名：____________　日期：________\n`;
  return s;
}

function download(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

$("btn-gen").onclick = () => {
  const a = collect();
  if (!lastCalc) doCalc();
  a.sample_size = lastCalc ? { calculator: lastCalc.calculator, name_cn: $("calc-type").selectedOptions[0].textContent,
    params: { alpha: parseFloat($("alpha").value), power: parseFloat($("power").value),
              dropout: parseFloat($("dropout").value) },
    n_per_group_raw: lastCalc.n_per_group_raw, n_per_group_final: lastCalc.n_per_group_final,
    total_n: lastCalc.total_n } : null;
  const answersJson = JSON.stringify(a, null, 1);
  download("研究方案.md", renderProtocol(a), "text/markdown");
  setTimeout(() => download("知情同意书.md", renderConsent(a), "text/markdown"), 300);
  setTimeout(() => download("answers.json", answersJson, "application/json"), 600);
  const box = $("gen-result");
  box.hidden = false;
  box.scrollIntoView({ behavior: "smooth" });
};
