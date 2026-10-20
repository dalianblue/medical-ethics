/* calc.js — 引导式样本量设计器(1020施主定稿: 五步向导+可视化)
   引擎复用app.js的zQuant/z1/z2与6公式, 纯前端无依赖 */
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



/* ===== 公式引擎(纯函数, 从app.js doCalc抽取) ===== */
function calcN(type, p) {
  // p: {p1,p2,delta,sd,auc,ciWidth,r,alpha,power,tails,dropout}
  const alpha = p.alpha, power = p.power;
  const za2 = z2(alpha), za1 = z1(1 - alpha), zb = z1(power);
  const tails = p.tails || 2;
  let n = 0, formula = "", unit = "group";
  if (type === "two_proportions") {
    const p1 = p.p1, p2 = p.p2;
    const za_ = tails === 1 ? za1 : za2;
    const pb = (p1 + p2) / 2;
    n = Math.ceil((za_ * Math.sqrt(2 * pb * (1 - pb)) + zb * Math.sqrt(p1*(1-p1) + p2*(1-p2))) ** 2 / (p1-p2) ** 2);
    formula = "两组率比较";
  } else if (type === "two_means") {
    const za_ = tails === 1 ? za1 : za2;
    n = Math.ceil(2 * ((za_ + zb) * p.sd / p.delta) ** 2);
    formula = "两组均值比较";
  } else if (type === "noninferiority") {
    n = Math.ceil(2 * ((za1 + zb) * p.sd / Math.abs(p.delta)) ** 2);
    formula = "非劣效设计(单侧)";
  } else if (type === "tost") {
    n = Math.ceil(2 * ((za2 + zb) * p.sd / Math.abs(p.delta)) ** 2);
    formula = "等效性设计(TOST)";
  } else if (type === "auc_ci") {
    const se = p.ciWidth / (2 * za2);
    n = Math.ceil(p.auc * (1 - p.auc) / (se ** 2));
    formula = "诊断试验AUC置信区间";
    unit = "total";
  } else if (type === "correlation") {
    const fz = 0.5 * Math.log((1 + p.r) / (1 - p.r));
    n = Math.ceil(((za2 + zb) / fz) ** 2 + 3);
    formula = "相关性分析(Fisher变换)";
    unit = "total";
  }
  const dropout = p.dropout || 0;
  const nFinal = dropout > 0 ? Math.ceil(n / (1 - dropout)) : n;
  const ratio = p.ratio && p.ratio > 0 ? p.ratio : 1;
  /* 1:1时总数=nFinal*2; r:1时=组1*nFinal + 对照组*nFinal*ratio */
  const total = unit === "total" ? nFinal
              : (ratio === 1 ? nFinal * 2 : nFinal + Math.ceil(nFinal * ratio));
  return { n, nFinal, total, formula, unit, ratio };
}

/* ===== 向导状态 ===== */
const STEPS5 = ["compare", "values", "strict", "reality", "result"];
let cStep = 0;
const P = { alpha: 0.05, power: 0.80, tails: 2, dropout: 0.20, ratio: 1 };

function $(id) { return document.getElementById(id); }

function syncValBlocks() {
  /* 切换类型: 清空全部参数输入, 防旧值残留误导(1020施主卡第2步的场景) */
  document.querySelectorAll("#vals-two_proportions input, #vals-two_means input, #vals-noninferiority input, #vals-tost input, #vals-auc_ci input, #vals-correlation input").forEach(el => el.value = "");
  const map = {
    two_proportions: "vals-two_proportions",
    two_means: "vals-two_means",
    noninferiority: "vals-noninferiority",
    tost: "vals-tost",
    auc_ci: "vals-auc_ci",
    correlation: "vals-correlation",
  };
  for (const [ty, id] of Object.entries(map)) {
    const el = $(id);
    if (el) el.hidden = P.type !== ty;
  }
  // 非劣效/等效的第2步输入id是c-delta2/c-sd2等, collectValues里按类型读对应id
  const note = document.getElementById("alpha-note");
  if (note) note.hidden = !(P.type === "noninferiority" || P.type === "tost");
}
function collectValues() {
  if (P.type === "two_proportions") {
    P.p1 = parseFloat($("c-p1").value) / 100;
    P.p2 = parseFloat($("c-p2").value) / 100;
  } else if (P.type === "two_means") {
    P.delta = parseFloat($("c-delta").value);
    P.sd = parseFloat($("c-sd").value);
  } else if (P.type === "noninferiority") {
    P.delta = parseFloat($("c-delta2").value);
    P.sd = parseFloat($("c-sd2").value);
  } else if (P.type === "tost") {
    P.delta = parseFloat($("c-delta3").value);
    P.sd = parseFloat($("c-sd3").value);
  } else if (P.type === "auc_ci") {
    P.auc = parseFloat($("c-auc").value);
    P.ciWidth = parseFloat($("c-ciw").value);
  } else if (P.type === "correlation") {
    P.r = parseFloat($("c-r").value);
  }
}
const TYPE_LABEL = {
  two_proportions: "两组的发生比例比较",
  two_means: "两组的评分或测量值平均数比较",
  noninferiority: "新方法不比旧方法差太多（非劣效）",
  tost: "两种方法效果一样（等效）",
  auc_ci: "一项诊断检查的准确度",
  correlation: "两个指标之间的关联程度",
};
function showStep(n) {
  cStep = n;
  const echo = document.getElementById("type-echo");
  if (echo) echo.textContent = P.type ? ("您在第 1 步选择的是：" + (TYPE_LABEL[P.type] || P.type)) : "";
  document.querySelectorAll(".wiz-step").forEach((el, i) => el.hidden = i !== n);
  document.querySelectorAll(".wiz-dot").forEach((el, i) => el.classList.toggle("on", i <= n));
  $("btn-prev").hidden = n === 0;
  $("btn-next").hidden = n === 0 || n === STEPS5.length - 1;  // 第1步点卡片直接进入, 无需下一步
  if (STEPS5[n] === "result") requestAnimationFrame(() => requestAnimationFrame(renderResult));
}

function next() {
  /* 先采集再校验(1020施主填0.4仍被拦: 原顺序validate读的是旧值/undefined) */
  if (cStep === 1) collectValues();
  if (cStep === 2) collectStrict();
  if (cStep === 3) collectReality();
  if (!validateStep(cStep)) return;
  showStep(cStep + 1);
}
function prev() { showStep(cStep - 1); }

function validateStep(n) {
  if (STEPS5[n] === "compare" && !P.type) { alert("请先选择你要比较的内容"); return false; }
  if (STEPS5[n] === "values") {
    if (P.type === "two_proportions" && (!(P.p1 > 0 && P.p1 < 1) || !(P.p2 > 0 && P.p2 < 1) || P.p1 === P.p2)) {
      alert("两组的发生率请填 0～100 之间的数字（百分数，不用带%号），且两组不能相同。\n\n如果您想比较的不是发生率，请返回第 1 步重新选择。"); return false;
    }
    if (["two_means","noninferiority","tost"].includes(P.type) && (!(P.delta > 0) || !(P.sd > 0))) {
      alert("差值和波动大小都请填大于 0 的数字。\n\n不知道波动大小填多少？同类研究常取 1～3，先填 2 试试。"); return false;
    }
    if (P.type === "auc_ci" && (!(P.auc > 0.5 && P.auc < 1) || !(P.ciWidth > 0 && P.ciWidth < 1))) {
      alert("准确度请填 0.5～1 之间的小数（如 0.85），精确范围也是 0～1 的小数（如 0.1）。\n\n注意：这两项都是小数，不填百分数。"); return false;
    }
    if (P.type === "correlation" && !(Math.abs(P.r) > 0 && Math.abs(P.r) < 1)) {
      alert("关联程度请填 -1～1 之间的小数（0.2 弱、0.4 中等、0.6 强，如填 0.4）。\n\n若您其实想比较两组的数值高低，请返回第 1 步选择『两组的评分或测量值平均数』。"); return false;
    }
  }
  return true;
}

function collectStrict() {
  P.alpha = parseFloat($("c-alpha").value);
  P.power = parseFloat($("c-power").value);
  P.tails = parseInt($("c-tails").value);
}
function collectReality() {
  P.dropout = parseFloat($("c-dropout").value);
  P.ratio = parseFloat($("c-ratio").value);
}

/* ===== 第5步: 结果渲染 ===== */
function renderResult() {
  const r = calcN(P.type, P);
  $("result-big").textContent = P.type === "auc_ci" || P.type === "correlation"
    ? r.total + " 例" : "每组 " + r.nFinal + " 例";
  $("result-total").textContent = "研究共需 " + r.total + " 人" +
    (P.dropout > 0 ? "（已含 " + Math.round(P.dropout*100) + "% 脱落余量）" : "");
  $("result-formula").textContent = r.formula;

  /* 敏感性矩阵: α × power */
  const tbl = $("sens-table");
  let html = "<tr><th>配置</th><th>每组例数</th><th>总例数</th></tr>";
  const combos = [
    ["α=0.05, 把握度80%", 0.05, 0.80],
    ["α=0.05, 把握度90%", 0.05, 0.90],
    ["α=0.01, 把握度80%", 0.01, 0.80],
    ["α=0.01, 把握度90%", 0.01, 0.90],
  ];
  for (const [label, a, pw] of combos) {
    const rr = calcN(P.type, {...P, alpha: a, power: pw, dropout: 0});
    html += "<tr><td>" + label + "</td><td>" + rr.nFinal + "</td><td>" + rr.total + "</td></tr>";
  }
  tbl.innerHTML = html;

  /* dropout梯度 */
  const dtbl = $("dropout-table");
  let dh = "<tr><th>脱落率</th><th>需招募（每组）</th></tr>";
  for (const dd of [0, 0.10, 0.20, 0.30]) {
    const rr = calcN(P.type, {...P, dropout: dd});
    dh += "<tr><td>" + Math.round(dd*100) + "%</td><td>" + rr.nFinal + "</td></tr>";
  }
  dtbl.innerHTML = dh;

  drawCurves();
}

/* ===== canvas曲线: n随δ(或p2)变化 ===== */
function drawCurves() {
  /* 按研究类型选扫描参数(1020施主截图: correlation扫δ/SD=水平线) */
  const byType = {
    two_proportions: [["canvas-delta", "p2", "对照/试验组发生率变化(当前值的40%～160%)"], ["canvas-sd", "p1", "基线组发生率变化(当前值的40%～160%)"]],
    two_means: [["canvas-delta", "delta", "预期差值δ（相对当前值的40%～160%）"], ["canvas-sd", "sd", "标准差SD（相对当前值的40%～160%）"]],
    noninferiority: [["canvas-delta", "delta", "非劣效界值Δ（相对当前值的40%～160%）"], ["canvas-sd", "sd", "标准差SD（相对当前值的40%～160%）"]],
    tost: [["canvas-delta", "delta", "等效界值Δ（相对当前值的40%～160%）"], ["canvas-sd", "sd", "标准差SD（相对当前值的40%～160%）"]],
    auc_ci: [["canvas-delta", "auc", "预期AUC（当前值的80%～105%）"], ["canvas-sd", "ciWidth", "置信区间宽度（当前值的60%～160%）"]],
    correlation: [["canvas-delta", "r", "关联程度r（当前值的60%～140%）"], ["canvas-sd", "r2", "关联程度r（另一区间，观察非线性）"]],
  };
  const conf = byType[P.type] || [["canvas-delta", "delta", "预期差值δ"], ["canvas-sd", "sd", "标准差SD"]];
  drawOne(conf[0][0], conf[0][1], conf[0][2]);
  drawOne(conf[1][0], conf[1][1], conf[1][2]);
}

/* ===== 复制参数摘要(论文方法学段) ===== */
function buildSummary() {
  const r = calcN(P.type, P);
  const dropTxt = P.dropout > 0 ? "，考虑 " + Math.round(P.dropout*100) + "% 脱落率放大后每组 " + r.nFinal + " 例" : "";
  const lines = {
    two_proportions: "样本量估算：本研究为两组率的比较，预期对照组事件发生率为 " + Math.round(P.p1*100) + "%、试验组为 " + Math.round(P.p2*100) + "%，" +
      "采用双侧检验（α=" + P.alpha + "）、把握度 " + Math.round(P.power*100) + "%，经计算每组需 " + r.n + " 例" + dropTxt + "，两组共需 " + r.total + " 例。",
    two_means: "样本量估算：本研究为两组均数的比较，预期两组差值 δ=" + P.delta + "、标准差 SD=" + P.sd + "，" +
      "采用" + (P.tails === 1 ? "单侧" : "双侧") + "检验（α=" + P.alpha + "）、把握度 " + Math.round(P.power*100) + "%，经计算每组需 " + r.n + " 例" + dropTxt + "，两组共需 " + r.total + " 例。",
    noninferiority: "样本量估算：本研究采用非劣效设计，非劣效界值 Δ=" + P.delta + "、标准差 SD=" + P.sd + "，" +
      "单侧检验（α=" + P.alpha + "）、把握度 " + Math.round(P.power*100) + "%，经计算每组需 " + r.n + " 例" + dropTxt + "，两组共需 " + r.total + " 例。",
    tost: "样本量估算：本研究采用等效性设计（TOST），等效界值 Δ=" + P.delta + "、标准差 SD=" + P.sd + "，" +
      "双侧检验（α=" + P.alpha + "）、把握度 " + Math.round(P.power*100) + "%，经计算每组需 " + r.n + " 例" + dropTxt + "，两组共需 " + r.total + " 例。",
    auc_ci: "样本量估算：本研究为诊断准确性试验，预期 AUC=" + P.auc + "，期望置信区间宽度 " + P.ciWidth + "（α=" + P.alpha + "），经计算需纳入 " + r.total + " 例受试者。",
    correlation: "样本量估算：本研究为相关性分析，预期相关系数 r=" + P.r + "，" +
      "采用双侧检验（α=" + P.alpha + "）、把握度 " + Math.round(P.power*100) + "%，经计算需纳入 " + r.total + " 例受试者。",
  };
  return (lines[P.type] || "") + "\n（计算结果供设计参考，最终样本量辩护归统计师。）";
}
function copySummary() {
  const text = buildSummary();
  const done = () => {
    const btn = document.querySelector(".btn-primary[onclick*=copySummary]");
    if (btn) { const old = btn.textContent; btn.textContent = "✅ 已复制到剪贴板"; setTimeout(() => btn.textContent = old, 2000); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); }
  catch (e) { alert("复制失败，请长按选择手动复制：\n\n" + text); }
  ta.remove();
}
function drawOne(canvasId, vary, xlabel) {
  const cv = $(canvasId);
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const W = cv.width = cv.clientWidth * 2, H = cv.height = 360;
  ctx.scale(1, 1);
  ctx.clearRect(0, 0, W, H);
  // 参数扫描
  const pts = [];
  for (let i = 1; i <= 40; i++) {
    const f = i / 40;
    const p2 = {...P};
    if (vary === "delta") p2.delta = P.delta * (0.4 + f * 1.2);
    else if (vary === "sd") p2.sd = P.sd * (0.4 + f * 1.2);
    else if (vary === "p1") p2.p1 = Math.min(0.99, Math.max(0.01, P.p1 * (0.4 + f * 1.2)));
    else if (vary === "p2") p2.p2 = Math.min(0.99, Math.max(0.01, P.p2 * (0.4 + f * 1.2)));
    else if (vary === "auc") p2.auc = Math.min(0.99, Math.max(0.51, P.auc * (0.8 + f * 0.25)));
    else if (vary === "ciWidth") p2.ciWidth = P.ciWidth * (0.6 + f);
    else if (vary === "r") p2.r = Math.min(0.95, Math.max(0.05, P.r * (0.6 + f * 0.8)));
    else if (vary === "r2") p2.r = Math.min(0.95, Math.max(0.05, P.r * (1.0 + f * 0.8)));
    const rr = calcN(P.type, p2);
    pts.push({ x: f, n: rr.nFinal });
  }
  const nMax = Math.max(...pts.map(p => p.n));
  const pad = { l: 70, r: 20, t: 30, b: 46 };
  const px = f => pad.l + f * (W - pad.l - pad.r);
  const py = n => H - pad.b - (n / nMax) * (H - pad.t - pad.b);
  // 坐标轴
  ctx.strokeStyle = "#dde4ea"; ctx.fillStyle = "#6b7885"; ctx.font = "20px sans-serif";
  ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, H-pad.b); ctx.lineTo(W-pad.r, H-pad.b); ctx.stroke();
  // 曲线
  ctx.strokeStyle = "#2c5f8a"; ctx.lineWidth = 3; ctx.beginPath();
  pts.forEach((p, i) => { const X = px(p.x), Y = py(p.n); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
  ctx.stroke();
  // 当前点
  const curF = vary === "delta" ? (1 - 0.4) / 1.2 : (1 - 0.4) / 1.2;
  const curN = calcN(P.type, P).nFinal;
  const cx = px(curF), cy = py(curN);
  ctx.fillStyle = "#b04a3a"; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 7); ctx.fill();
  ctx.fillStyle = "#24313c"; ctx.font = "24px sans-serif";
  ctx.fillText("当前: " + curN + "例", Math.min(cx + 12, W - 140), cy - 10);
  // 轴标
  ctx.fillText("n", pad.l - 50, pad.t + 10);
  ctx.fillText(xlabel || "", pad.l, H - 8);
}

function markSelected(input) {
  document.querySelectorAll(".opt").forEach(l => l.classList.remove("selected"));
  input.closest(".opt").classList.add("selected");
}