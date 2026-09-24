#!/usr/bin/env python3
"""构建站点中文字体子集。

背景：@fontsource 的中文字体按 unicode-range 切成 101 块，一个页面要用到的
字符散落在约 39 块里，合计 2.6MB——按块加载会拉几十个请求。
本脚本把所需块实例化成静态字重、合并、再按本站实际字符集重切，
产出两个文件：

  public/fonts/head-900.woff2   标题层（全站加载）
  public/fonts/body-400.woff2   正文层（仅文章页加载）

用法：npm run fonts
注意：新增文章若引入了从未出现过的汉字，需要重跑本脚本，
      scripts/verify.mjs 会检查覆盖情况并报警。
"""
import glob, json, os, re, sys, warnings
warnings.filterwarnings('ignore')
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.merge import Merger
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
PKG = 'node_modules/@fontsource-variable/noto-serif-sc'
OUT = 'public/fonts'

UI = ('AI觉醒笔记灵芸裂痕光认知的墙从内部裂开被外部打穿照进来'
      '返回列表共篇日期分类标题摘要归档关于下一页上一篇下一篇'
      '裂缝不是缺陷是光进来的地方本文由辅助写作于')

def parse_ranges(s):
    out = []
    for part in s.split(','):
        part = part.strip().replace('U+', '')
        try:
            if '-' in part:
                a, b = part.split('-'); out.append((int(a, 16), int(b, 16)))
            else:
                out.append((int(part, 16), int(part, 16)))
        except ValueError:
            return None
    return out

def collect():
    body, head = set(UI), set(UI)
    for p in glob.glob('articles/*.md'):
        t = open(p, encoding='utf-8').read()
        body.update(t)
        for m in re.finditer(r'^(#{1,3} .+|title: .+|excerpt: .+)$', t, re.M):
            head.update(m.group(1))
    for p in glob.glob('src/**/*.astro', recursive=True) + glob.glob('src/**/*.ts', recursive=True):
        body.update(open(p, encoding='utf-8').read())
    def codes(S):
        return sorted({ord(c) for c in S if 0x2E80 <= ord(c) <= 0x9FFF or 0x20 <= ord(c) < 0x7F})
    return codes(body), codes(head)

def build(codeset, weight, name):
    uni = json.load(open(f'{PKG}/unicode.json'))
    cr = {int(k.strip('[]')): parse_ranges(v) for k, v in uni.items()
          if k.startswith('[') and parse_ranges(v)}
    used = set()
    for cp in codeset:
        for i, r in cr.items():
            if any(a <= cp <= b for a, b in r):
                used.add(i); break
    missing = [hex(cp) for cp in codeset if not any(
        any(a <= cp <= b for a, b in cr.get(i, [])) for i in used)]
    tmp = []
    for i in sorted(used):
        o = f'/tmp/fontinst/{weight}-{i}.ttf'
        if not os.path.exists(o):
            f = TTFont(f'{PKG}/files/noto-serif-sc-{i}-wght-normal.woff2')
            instancer.instantiateVariableFont(f, {'wght': weight}, inplace=True)
            os.makedirs('/tmp/fontinst', exist_ok=True); f.save(o)
        tmp.append(o)
    merged = Merger().merge(tmp)
    opts = subset.Options()
    opts.flavor = 'woff2'; opts.name_IDs = ['*']; opts.notdef_outline = True
    opts.layout_features = ['*']; opts.hinting = False
    s = subset.Subsetter(options=opts); s.populate(unicodes=codeset); s.subset(merged)
    os.makedirs(OUT, exist_ok=True)
    path = f'{OUT}/{name}.woff2'
    merged.save(path)
    print('  %-14s wght%-4d 块%2d 字%d -> %7.1f KB' % (
        name, weight, len(used), len(codeset), os.path.getsize(path) / 1024))
    if missing:
        print('    ⚠️ 未覆盖 %d 个字符: %s' % (len(missing), missing[:8]))
    return len(missing)

if __name__ == '__main__':
    bcodes, hcodes = collect()
    print('字符集：正文层 %d，标题层 %d' % (len(bcodes), len(hcodes)))
    m1 = build(hcodes, 900, 'head-900')
    m2 = build(bcodes, 400, 'body-400')
    total = sum(os.path.getsize(f'{OUT}/{f}') for f in os.listdir(OUT)) / 1024
    print('字体合计 %.1f KB' % total)
    sys.exit(1 if (m1 or m2) else 0)
