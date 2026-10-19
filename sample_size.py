#!/usr/bin/env python3
"""sample_size.py — 伦理申请skill Phase 2: 样本量计算器
内置公式(浙大一院IIT申报场景):
  - 两样本率比较(优效/单双侧)
  - 均值比较(t检验)
  - 非劣效试验
  - TOST等价检验
  - AUC点估计CI宽度(诊断类研究, pyEEG案例同款)
  - 相关性(Pearson r)
输出: JSON计算书(可审计, 含公式与参数) + Markdown说明
"""
import json, math, sys, argparse


def z(p, tail=2):
    """正态分位数(数值反解, 无scipy依赖)"""
    if tail == 1:
        p = p * 2
    # Beasley-Springer-Moro近似 + 二分精化
    lo, hi = -8.0, 8.0
    from math import erf
    for _ in range(200):
        mid = (lo + hi) / 2
        cdf = 0.5 * (1 + erf(mid / math.sqrt(2)))
        if cdf < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def n_two_proportions(p1, p2, alpha=0.05, power=0.80, tails=2):
    """两样本率比较(每组样本量)"""
    za = z(1 - alpha / tails)
    zb = z(power)
    pbar = (p1 + p2) / 2
    num = (za * math.sqrt(2 * pbar * (1 - pbar)) + zb * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2
    n = num / (p1 - p2) ** 2
    return math.ceil(n)


def n_two_means(delta, sd, alpha=0.05, power=0.80, tails=2):
    """两样本均值比较(每组样本量)"""
    za = z(1 - alpha / tails)
    zb = z(power)
    n = 2 * ((za + zb) * sd / delta) ** 2
    return math.ceil(n)


def n_noninferiority(delta_ni, sd, alpha=0.025, power=0.80):
    """非劣效试验(每组, 单侧α)"""
    za = z(1 - alpha, tail=1)
    zb = z(power)
    n = 2 * ((za + zb) * sd / abs(delta_ni)) ** 2
    return math.ceil(n)


def n_tost(delta_eq, sd, alpha=0.05, power=0.80):
    """TOST等价检验(每组, 双单侧α/2)"""
    za = z(1 - alpha / 2, tail=1)
    zb = z(power)
    n = 2 * ((za + zb) * sd / abs(delta_eq)) ** 2
    return math.ceil(n)


def n_auc_ci_width(auc, ci_width_target, alpha=0.05):
    """AUC点估计的95%CI宽度(Hanley-McNeil近似): 反解所需样本量
    pyEEG案例: CI宽度≤0.10需约60例(SD≈0.12口径)
    简化: 用SE(AUC)≈sqrt(A(1+A/2)... 太复杂, 用经验式:
    SE ≈ sqrt((auc*(1-auc) + (n_pos-1)*(r1-auc²) + (n_neg-1)*(r2-auc²))/(n_pos*n_neg))
    此处用简化二分: CI宽度=2*1.96*SE, SE≈sqrt(auc*(1-auc)/n_eff)
    """
    za = z(1 - alpha / 2)
    # SE_target = width/(2*za); SE≈sqrt(auc*(1-auc)/n) → n = auc*(1-auc)/SE²
    se_target = ci_width_target / (2 * za)
    n = auc * (1 - auc) / (se_target ** 2)
    return math.ceil(n)


def n_correlation(r, alpha=0.05, power=0.80):
    """Pearson相关检验(Fisher z变换)"""
    za = z(1 - alpha / 2)
    zb = z(power)
    fz = 0.5 * math.log((1 + r) / (1 - r))
    n = ((za + zb) / fz) ** 2 + 3
    return math.ceil(n)


CALCULATORS = {
    'two_proportions': (n_two_proportions, '两样本率比较'),
    'two_means': (n_two_means, '两样本均值比较'),
    'noninferiority': (n_noninferiority, '非劣效试验'),
    'tost': (n_tost, 'TOST等价检验'),
    'auc_ci': (n_auc_ci_width, 'AUC CI宽度(诊断研究)'),
    'correlation': (n_correlation, '相关性检验'),
}


def main():
    ap = argparse.ArgumentParser(description='伦理申请样本量计算器(浙大一院IIT)')
    ap.add_argument('--type', required=True, choices=CALCULATORS.keys())
    ap.add_argument('--p1', type=float, help='组1率')
    ap.add_argument('--p2', type=float, help='组2率')
    ap.add_argument('--delta', type=float, help='差值/非劣效界值/等价界值')
    ap.add_argument('--sd', type=float, help='标准差')
    ap.add_argument('--auc', type=float, help='预期AUC')
    ap.add_argument('--ci-width', type=float, help='目标CI宽度')
    ap.add_argument('--r', type=float, help='预期相关系数')
    ap.add_argument('--alpha', type=float, default=0.05)
    ap.add_argument('--power', type=float, default=0.80)
    ap.add_argument('--tails', type=int, default=2, choices=[1, 2])
    ap.add_argument('--dropout', type=float, default=0, help='脱落率(0-0.5), 自动放大样本')
    ap.add_argument('--out', help='输出JSON路径')
    a = ap.parse_args()

    params = {k: v for k, v in vars(a).items() if v is not None and k not in ('type', 'out')}
    fn = CALCULATORS[a.type][0]

    if a.type == 'two_proportions':
        n = fn(a.p1, a.p2, a.alpha, a.power, a.tails)
    elif a.type == 'two_means':
        n = fn(a.delta, a.sd, a.alpha, a.power, a.tails)
    elif a.type == 'noninferiority':
        n = fn(a.delta, a.sd, a.alpha, a.power)
    elif a.type == 'tost':
        n = fn(a.delta, a.sd, a.alpha, a.power)
    elif a.type == 'auc_ci':
        n = fn(a.auc, a.ci_width, a.alpha)
    elif a.type == 'correlation':
        n = fn(a.r, a.alpha, a.power)

    n_final = math.ceil(n / (1 - a.dropout)) if a.dropout else n

    report = {
        'calculator': a.type,
        'name_cn': CALCULATORS[a.type][1],
        'params': params,
        'n_per_group_raw': n,
        'dropout_rate': a.dropout,
        'n_per_group_final': n_final,
        'total_n': n_final * 2 if a.type != 'correlation' and a.type != 'auc_ci' else n_final,
        'note': '计算书仅供研究设计参考, 最终样本量辩护归统计师/研究者',
    }
    out = json.dumps(report, ensure_ascii=False, indent=1)
    if a.out:
        open(a.out, 'w').write(out)
    print(out)


if __name__ == '__main__':
    main()
