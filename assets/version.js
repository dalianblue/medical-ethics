/* 版本显示(1020施主提议: 方便对账) */
fetch("version.json?t=" + Date.now()).then(r => r.json()).then(d => {
  const el = document.getElementById("app-version");
  if (el) el.textContent = "v " + d.v + " · 构建 " + d.built;
}).catch(() => {});
