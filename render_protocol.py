#!/usr/bin/env python3
"""render_protocol.py — 伦理申请skill Phase 3: 方案/知情同意书渲染器
从 answers.json(单一数据源)渲染:
  - 08_科研方案.md (浙大一院IIT模板章节树, 参照pyEEG-ethics-amendment/08号文件)
  - 04_知情同意书.md (含豁免论证分支)
用法: python3 render_protocol.py answers.json outdir/
"""
import json, sys, math
from pathlib import Path


def sec_bg(a):
    return f"""## 一、研究背景

{a['background']}"""


def sec_purpose(a):
    lines = ['## 二、研究目的']
    for i, p in enumerate(a.get('purposes', []), 1):
        lines.append(f'（{i}）{p}')
    return '\n'.join(lines)


def sec_design(a):
    dtype = a['study_type']       # interventional / observational
    dtime = a['data_timing']      # prospective / retrospective / hybrid
    t_cn = {'interventional': '干预性研究', 'observational': '观察性研究'}[dtype]
    tm_cn = {'prospective': '前瞻性', 'retrospective': '回顾性', 'hybrid': '前瞻采集+回顾分析'}[dtime]
    out = [f"""### 3.1 研究方法

**研究类型**：{t_cn}（{tm_cn}）。

**注册与清单义务**：{a.get('registration_note', '按ICMJE规则判定。')}"""]
    return '\n'.join(out)


def sec_enroll(a):
    inc = '\n'.join(f'- {x}' for x in a.get('inclusion', []))
    exc = '\n'.join(f'- {x}' for x in a.get('exclusion', []))
    return f"""### 3.2 研究对象

**纳入标准**：
{inc}

**排除标准**：
{exc}"""


def sec_sample(a):
    s = a.get('sample_size', {})
    if not s:
        return '### 3.3 样本量\n\n（待定）'
    drop = s.get('dropout', 0)
    drop_txt = (f"；考虑{drop*100:.0f}%脱落率后，最终每组{s['n_per_group_final']}例"
                if drop else '')
    return f"""### 3.3 样本量

采用**{s['name_cn']}**方法估算样本量。

参数：{json.dumps(s['params'], ensure_ascii=False)}

计算结果：每组需 **{s['n_per_group_raw']}** 例{drop_txt.replace('{n}', str(s['n_per_group_final']))}，总计 **{s['total_n']}** 例。

样本量计算书（含公式与参数，可复算）见附件`sample_size_cal.json`。最终样本量确定由研究者与统计师共同负责。"""


def sec_consent(a):
    if a.get('consent_mode') == 'waiver':
        return f"""## 四、知情同意豁免

本研究申请**豁免知情同意**，论证如下：

{a.get('waiver_justification', '')}"""
    return f"""## 四、知情同意

{a.get('consent_process', '研究开始前由研究者向受试者充分说明研究目的、流程、风险与获益，签署知情同意书后入组。')}"""


def render_protocol(a):
    parts = [
        f'# "{a["title"]}"项目研究方案',
        f'\n**方案版本号：{a.get("version", "1.0")}，{a.get("date", "")}**\n',
        sec_bg(a), sec_purpose(a), sec_design(a), sec_enroll(a),
        sec_sample(a), sec_consent(a),
    ]
    return '\n\n'.join(parts)


def main():
    answers = json.load(open(sys.argv[1]))
    outdir = Path(sys.argv[2])
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / '08_科研方案.md').write_text(render_protocol(answers), encoding='utf-8')
    print(f'已渲染: {outdir}/08_科研方案.md')


if __name__ == '__main__':
    main()
