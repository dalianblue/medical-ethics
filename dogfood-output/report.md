# Dogfood QA Report — medical-ethics (fxmlab.top/me/)

**Target:** https://fxmlab.top/me/（index / chat / calc 三页）
**Date:** 2026-10-20 19:40–20:20 CST
**Scope:** 移动端视口(375×667, 微信webview模拟)全流程探索性 QA + impeccable 静态反模式扫描 + 部署通道对账
**Tester:** Hermes Agent (automated exploratory QA, dogfood v1.0 + impeccable v4.7.0)

---

## Executive Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 1 |
| 🟠 High | 1 |
| 🟡 Medium | 3 |
| 🔵 Low | 2 |
| **Total** | **7** |

**Overall Assessment:** 核心链路健康（统计引擎数值全对、聊天引导正常、代理通道 200、双卡入口/设置弹窗/防遮盖历史修复全部在位），但 calc 第5步 canvas 红点代码引用未定义变量使两张曲线图一条残缺一条全白 + 控制台必报错，属用户可见的 Critical；另有 2 处"修复声称落地但实际没落地"的部署纪律问题需要归位。

### 修复声称与实态核对（1020代码审查 commit 3eb4fbe 六项声明逐条验）

| 声明 | 实态 |
|---|---|
| ① send防重入(_sending标志) | ❌ **未落地**——入口无守卫，变量未声明，strict模式下必抛 ReferenceError（Issue #2） |
| ② renderMd href白名单 | ✅ 在位（渲染AI回复含链接无注入路径） |
| ③ blob URL revoke | ✅ 未复测下载流（代码在位） |
| ④ proxy payload 60KB上限 | ✅ 未复测（服务端在位） |
| ⑤ 分类按需触发 | ✅ 未复测（服务端在位） |
| ⑥ deploy.sh | ✅ 存在且本次6文件核对全 SYNCED（但见 Issue #3 版本号通道） |

---

## Issues

### Issue #1: calc 第5步曲线图绘制崩溃——红点缺失、第二张图全白、控制台报错

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Category** | Functional |
| **URL** | https://fxmlab.top/me/calc.html 第5步 |

**Description:**
`assets/calc-engine.js` 第346行 `ctx.arc(cx, cy, 7, 0, 7)` 引用了从未定义的 `cx`/`cy`（fdd3d84 红点修复重构时遗留），strict-mode 下抛 `Uncaught ReferenceError: cx is not defined @346`。`drawCurves()` 先画 canvas-delta：坐标轴+曲线已绘出后在此行崩溃，**红点、"当前: N例"标注、轴标文字全部丢失**；异常向上传播导致 **canvas-sd 完全空白（0 像素）**。任何真实用户走到第5步都会触发，控制台必报错。

**Steps to Reproduce:**
1. 打开 /me/calc.html → 第1步选"两组的评分或测量值平均数"
2. 第2步填 差值1.25 / SD2.5 → 第3、4步默认 → 进入第5步
3. 控制台出现 `Uncaught ReferenceError: cx is not defined @346`

**Expected Behavior:** 两张曲线完整渲染（红点在曲线上+当前值标注），控制台零报错。

**Actual Behavior:** 第一张图缺红点/标注/轴标，第二张全白；像素级取证 canvas-delta painted=3804、canvas-sd painted=0。

**Screenshot:** MEDIA:/root/workspace/medical-ethics/dogfood-output/screenshots/calc-step5-charts-broken.png

**Console Errors:**
```
Uncaught ReferenceError: cx is not defined @ calc-engine.js?v=12:346
```

**修法（一行）:** 346行前补 `const cx = px(curF), cy = py(curN);`（curF=0.5 已有，curN 插值已有）

---

### Issue #2: chat 每发一条消息必抛未捕获 Promise 拒绝——"_sending 防重入"声称已修但从未落地

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Category** | Console / Functional |
| **URL** | https://fxmlab.top/me/chat.html |

**Description:**
commit 3eb4fbe 声称"①send防重入(_sending标志+按钮disabled, 防连点并发乱序)"，但线上 chat.js v31：`send()` 入口无 `if (_sending) return` 守卫，`_sending` 全文件仅 finally 里一次赋值（309行）且**从未用 let/var 声明**。`"use strict"` 模式下给未声明变量赋值 → 每条消息必抛 `ReferenceError: _sending is not defined`（未捕获 Promise 拒绝，线上已复现实证）。当前防双击实际依赖"发送后立即清空输入框"的副作用（双击实测仅1次API调用），防重入形同虚设；若 AI 回复后输入框被自动回填等场景出现，连点并发防线不存在。

**Steps to Reproduce:**
1. 打开 /me/chat.html，发送任意消息
2. DevTools Console 出现 `Uncaught (in promise) ReferenceError: _sending is not defined`

**Expected Behavior:** 防重入标志真实生效（声明+入口守卫+finally复位），控制台零报错。

**Actual Behavior:** 每条消息抛错；守卫缺失。

**Screenshot:** MEDIA:/root/workspace/medical-ethics/dogfood-output/screenshots/chat-sending-error.png

**Console Errors:**
```
PROMISE: ReferenceError: _sending is not defined
```

**修法（三处小改）:** ①`let _sending = false;` 声明 ②`send()` 入口 `if (_sending) return; _sending = true;` ③finally 已有复位。声明后 309 行赋值即合法。

---

### Issue #3: version.json 对账真源滞后——bug修复手动cp绕过deploy.sh，用户页脚报错版本号

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Category** | UX / 运维纪律 |
| **URL** | 全站页脚 + https://fxmlab.top/me/version.json |

**Description:**
18:56 的重大统计修复（7ee27ce）以手动 cp 方式同步上线，绕过了 deploy.sh——结果：线上 `version.json` 仍是 `{"v":"f789005","built":"10-20 18:24"}`，三个页面页脚显示 `v f789005 · 构建 10-20 18:24`，而实际内容已是 7ee27ce（18:56，engine v12）。违反项目纪律#3"version.json 为对账真源"：用户按页脚报版本号会对照到错误 commit，对账被骗。文件内容本身 6/6 全同步（修复有效），纯属版本戳通道失守。

**Steps to Reproduce:**
1. 打开任一页面看页脚版本 `v f789005 · 10-20 18:24`
2. `git log` 对照：该 hash 无 zQuant 修复；实际线上 calc-engine.js 已含修复（v12）

**Expected Behavior:** 内容同步时 version.json 原子更新；页脚版本与实际内容一致。

**Actual Behavior:** 内容新、版本戳旧，相差一个重大修复 commit。

**修法:** 跑一次 deploy.sh（或手动 bump version.json 为 7ee27ce + 正确时间戳），并把"hotfix 也必须走 deploy.sh"写进纪律。

---

### Issue #4: mesh_zh2en.js 在 chat.html 重复加载两次

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Category** | Functional(冗余) / Content |
| **URL** | https://fxmlab.top/me/chat.html (34-35行) |

**Description:**
连续两个 `<script src="assets/mesh_zh2en.js"></script>`。该文件是 `window.MESH_ZH2EN = {...}` 纯赋值（幂等），当前无功能损害，但：重复下载执行、无版本号 `?v=`（其余资产都有 bust 机制，此文件改版后微信webview可能吃旧缓存——正是引用失步事故的同类隐患）、掩盖了"复制粘贴加脚本"的维护痕迹。

**修法:** 删一行；若保留，补 `?v=N`。

---

### Issue #5: chat.html 无"新对话"二次确认的无头/自动化兼容问题 + 交互不可取消性

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Category** | UX |
| **URL** | https://fxmlab.top/me/chat.html (chat.js 545行) |

**Description:**
`btn-newchat` 用原生 `confirm()`。移动端表现正常，但原生弹窗（a）样式与应用割裂（b）在某些内嵌 webview 中被静默拒绝导致按钮"点了没反应"（本次无头测试中即卡死 CDP 会话）。建议换应用内自绘确认条。属低危打磨项。

---

### Issue #6: 页面全域 — 移动端正文低于 12px 的文本多处（impeccable: tiny-text）

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Category** | Accessibility |
| **URL** | chat.html(11px/10.5px), index.html(11.5px), expert.html(11.5px) |

**Description:**
impeccable 检测器报 4 处 tiny-text（正文 <12px，建议 ≥14px）。多为辅助说明文字，移动端可读性受损。该发现属设计取向，由施主拍板是否调（调字号会动 style.css，需连带 deploy.sh bump）。

---

### Issue #7: impeccable 顾问级发现（不计入失败的改进项）

| Field | Value |
|-------|-------|
| **Severity** | Low (advisory) |
| **Category** | Visual / Accessibility |

**Description:**
- **low-contrast**：`#6b7885 on #f4f6f8`（4.2:1 < 4.5:1）在 index/chat/calc/expert 四页多处出现——次级文字色对比度差一线，全局换 `#5d6a77` 一类的深一档灰即可批量达标（WCAG AA）。
- **side-tab**：style.css 两处 `border-left: 3px solid var(--accent)` 左粗色条卡片——AI 生成 UI 的标志性样式（该站风格内敛，可保留亦可微调为 2px 或去色）。
- **em-dash 密度**：calc.html 文案 19 处 em-dash（密度触发 AI 文风阈值）——中文语境下"—"使用合理，仅记录不改。
- **expert.html 已退役仍可访问**（200）：入口已撤，文件留在 webroot 供回滚属施主既定决策，非问题；但它带着 3 处 low-contrast 在线上，若永久退役建议 404 化（拍板项）。

---

## Issues Summary Table

| # | Title | Severity | Category | URL |
|---|-------|----------|----------|-----|
| 1 | calc第5步canvas崩溃(cx undefined): 红点缺失+第二图全白+控制台报错 | 🔴 Critical | Functional | /me/calc.html#step5 |
| 2 | chat每条消息必抛 _sending ReferenceError(防重入未落地) | 🟠 High | Console | /me/chat.html |
| 3 | version.json滞后(修复绕过deploy.sh, 页脚版本对不上实际内容) | 🟡 Medium | UX/运维 | 全站页脚 |
| 4 | mesh_zh2en.js重复加载且无版本号bust | 🟡 Medium | Functional | /me/chat.html:34-35 |
| 5 | 新对话用原生confirm, webview兼容性差 | 🔵 Low | UX | /me/chat.html |
| 6 | tiny-text: 正文<12px多处 | 🔵 Low | Accessibility | 多页 |
| 7 | impeccable顾问项: low-contrast 4.2:1/side-tab/em-dash | 🔵 Low | Visual | 多页 |

## Testing Coverage

### Pages Tested
- /me/index.html（入口、齿轮设置弹窗、版本页脚）
- /me/chat.html（对话全流程、双击竞态、fixed输入栏遮盖、新对话确认）
- /me/calc.html（五步向导全流程、zQuant锚点、敏感性矩阵、canvas曲线）
- 静态扫描：/www/wwwroot/medical-ethics-web/ 全量（impeccable detect, 9文件）

### Features Tested
- ✅ 统计引擎正确性：zQuant(0.975/0.99/0.999/0.9999995) 全部精确（1.9600/2.3263/3.0902/4.8916），线上已是 v12 修复版；端到端 d=0.5/α=0.05双侧/80% → **63例/组**（教科书锚点全对）；脱落梯度 63/70/79/90 合理
- ✅ 聊天引导流：用户气泡→AI引导回复→阶段徽章（了解想法）正常，代理 /api/me/ 200 (2.3s)
- ✅ 微信适配史坑：fixed输入栏不遮盖（padding-bottom 120px 在位）、设置弹窗移动端完整可点
- ✅ 部署通道：6 个核心文件本地↔线上 md5 全部 SYNCED
- ✅ HTTP→HTTPS 301、未知路径 404

### Not Tested / Out of Scope
- 生成文书全流程（需走满6阶段对话到 READY，耗 API 额度，且生成质量属专项审查范围）
- Markdown 下载/复制降级流（MicroMessenger UA 分支）
- rate limit 60次/时/IP 边界
- 真机微信 webview（本次为 CDP 模拟视口；豆腐块字体为本服务器无 CJK 字体的测试环境限制，非页面问题）

### Blockers
- 无（新对话原生 confirm 卡死过一个浏览器会话，已换 tab 恢复并绕过）

---

## Notes

1. **两个代码 bug 同根**：都是"修复/重构声称完成但引用了不存在的符号"（cx/cy、_sending）。建议把"改完必在真浏览器走一遍触发路径+看控制台"固化进 webapp-iterate-deploy 纪律——deploy.sh 验证的是部署通道，不验证运行时。
2. **统计引擎本身经历今天 7ee27ce 修复后状态良好**，8 锚点+端到端全对；α=0.01 路径（原 NaN 重灾区）经敏感性矩阵自动重算 4 组配置无异常。
3. #1/#2 修复都极小（一行+三行），修完跑 deploy.sh 即可一并解决 #3 的版本戳问题。
