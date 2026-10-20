# medical-ethics — 医学研究伦理申请助手

**纯静态 · 移动优先 · 数据不出浏览器**

研究者按步骤填写 → 自动判定研究类型与注册义务 → 样本量计算（6种设计）→ 生成研究方案与知情同意书（Markdown）。

## 在线使用

**GitHub Pages**：https://dalianblue.github.io/medical-ethics/

或本地打开 `index.html` —— 无后端、无依赖、无数据上传，所有计算在浏览器完成。

## 功能

1. **研究类型判定**：干预性/观察性 → ICMJE注册义务（ChiCTR/NCT/STROBE/CONSORT）自动判定
2. **纳排标准**：结构化输入
3. **样本量估计**：两率比较/均值比较/非劣效/TOST等价/AUC诊断(CI宽度)/相关性，含脱落率放大
4. **文书生成**：研究方案 + 知情同意书（Markdown下载），answers.json留档可复算
5. **随便聊聊（AI引导员）**：对话式采集研究要素，逐步生成完整文书

## 模板依据

浙江大学医学院附属第一院IIT申报模板章节树（参考案例：pyEEG-ethics-amendment真实申报项目）。

## Python版（批量/命令行）

sample_size.py（6公式计算书）与 render_protocol.py（answers.json→方案渲染）。

## 边界声明

- 生成内容为研究设计辅助稿，须经研究者和统计师审核、伦理委员会审查批准后实施
- 样本量最终辩护归统计师
- 模板按浙大一院IIT定制，其他机构需适配
- ChiCTR无公开API，注册字段清单供人工网页填写（NCT有PRS API可自动上传，路线图内）

## 部署

纯静态站点，三种玩法（按动手意愿排序）：

### 直接用（零部署）

打开 https://dalianblue.github.io/medical-ethics/ 即可。
样本量设计器、研究类型判定等**纯本地功能开箱即用**；「随便聊聊」需在首页 ⚙
填入你自己的 [DeepSeek API Key](https://platform.deepseek.com/)（Key 只存你
浏览器 localStorage，直连 DeepSeek 官方 API，不经第三方服务器）。

### 用 WorkBuddy 部署（不会命令行的朋友）

[WorkBuddy](https://www.workbuddy.cn/)（腾讯 AI 工作台）可以替你完成整个部署。
安装后新建任务，把下面这段话整段发给它：

```
请帮我部署一个开源的医学研究伦理申请助手（纯静态网页，无需编译）：

1. 执行 git clone https://github.com/dalianblue/medical-ethics.git
2. 进入目录，启动一个本地静态服务器（如 python3 -m http.server 8080），
   在浏览器打开 http://localhost:8080 验证首页、样本量设计器（calc.html）、
   聊天页（chat.html）三个页面都能正常显示。
3. 「样本量设计器」开箱即用，无需任何账号。
4. 「随便聊聊」需要 AI 通道：请提醒我到 https://platform.deepseek.com/
   注册并创建 API Key，然后点首页右上角 ⚙ 粘贴保存。Key 只存在浏览器
   localStorage，直连 DeepSeek 官方接口。不要把我的 Key 写进任何文件、
   截图或对话记录。
5. 完成后告诉我：访问地址、怎么日常启动、怎么停止。

注意：这是 AGPL-3.0 开源项目，不要修改它的许可与版权信息。
```

### 自托管（可提供公共 AI 通道）

想让你的用户免 Key 使用聊天功能，需带一个 AI 代理后端：

1. 部署 `server/me_proxy.php`（PHP + cURL），参照文件内注释配置：
   - 上游 DeepSeek API，key 存服务端（webroot 外，640 权限）
   - 内置每 IP 限流（默认 20 次/时/IP）与 payload 上限（60KB）
2. 把仓库其余静态文件挂到任意 Web 服务器，`/api/me/` 路由指向该 PHP
3. 参考实现见本仓库 git 历史中 nginx location 配置

更新流程（自托管）：改代码 → git commit+push → 同步静态文件到 webroot。

## 功能

- **随便聊聊**：AI 引导员对话式采集要素，生成研究方案 + 知情同意书
- **样本量设计器**：五步引导式向导（从"想比较什么"到"需要多少例"），含敏感性矩阵与参数曲线，纯前端离线可用

## 适用范围 (1020更新)

面向**医学全学科**通用（内科/外科/妇产/儿科/麻醉/肿瘤/神经/精神等），不限于麻醉学。
文书结构与注册要素参考：WHO Trial Registration Data Set (TRDS v1.3.1)、
ClinicalTrials.gov 注册规范（结局三要素/分配隐藏/IPD共享声明等）、国内三甲医院 IIT 模板。
风险提示库当前以麻醉/围术期主题为主（持续扩充中），其他专科研究仍可正常使用设计与文书生成功能。

## 许可证

本项目采用 [GNU AGPL-3.0](LICENSE) 授权。

- 你可以自由使用、修改、分发本程序，须保留本许可证全文与版权声明
- 修改后的衍生作品须以同协议（AGPL-3.0）开源
- 若以网络服务形式向用户提供本程序（或其修改版），须向用户提供对应源代码
- 本程序不提供任何担保。生成内容为研究设计辅助稿，须经研究者、统计师及伦理委员会审核
