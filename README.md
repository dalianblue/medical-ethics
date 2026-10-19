# medical-ethics — 医学研究伦理申请助手

**纯静态 · 移动优先 · 数据不出浏览器**

研究者按步骤填写 → 自动判定研究类型与注册义务 → 样本量计算（6种设计）→ 生成研究方案与知情同意书（Markdown）。

## 在线使用

GitHub Pages（启用后）：https://dalianblue.github.io/medical-ethics/

或本地打开 `index.html` —— 无后端、无依赖、无数据上传，所有计算在浏览器完成。

## 功能

1. **研究类型判定**：干预性/观察性 → ICMJE注册义务（ChiCTR/NCT/STROBE/CONSORT）自动判定
2. **纳排标准**：结构化输入
3. **样本量估计**：两率比较/均值比较/非劣效/TOST等价/AUC诊断(CI宽度)/相关性，含脱落率放大
4. **文书生成**：研究方案 + 知情同意书（Markdown下载），answers.json留档可复算

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

- **线上**：https://fxmlab.top/ethics/ （阿里云ECS nginx静态挂载，HTTPS复用主站证书）
- GitHub Pages未启用（本地服务器部署替代）
- 更新流程：改 /root/workspace/medical-ethics → git commit+push → cp到 /www/wwwroot/medical-ethics/
