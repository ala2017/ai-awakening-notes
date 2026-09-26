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

    # 900 字重的取字口径，必须等于「实际会以 900 渲染的文字」，否则缺字会静默掉到
    # 备用字体，而 font-synthesis:none 又禁掉了假粗——标题会一块一块地变细。
    # 原来 head 只扫 articles/*.md 的标题行，页面侧（.astro）完全没进：
    # 2026-09-26 新增项目说明页，标题与加粗当场缺了 13 个字。
    # 这里补上 .astro 的 h1-h3 与 <strong>，以及 md 正文里的 **加粗**。
    for p in glob.glob('src/**/*.astro', recursive=True):
        s = open(p, encoding='utf-8').read()
        for m in re.finditer(r'<(h1|h2|h3)\b[^>]*>(.*?)</\1>', s, re.S):
            head.update(re.sub(r'<[^>]+>', '', m.group(2)))
        for m in re.finditer(r'<strong>(.*?)</strong>', s, re.S):
            head.update(re.sub(r'<[^>]+>', '', m.group(1)))
    for p in glob.glob('articles/*.md'):
        head.update(''.join(re.findall(r'\*\*(.+?)\*\*', open(p, encoding='utf-8').read())))

    # 可打印 ASCII 无条件进两层。
    # 理由：源码里看不见的东西也会渲染出来——表格里那些层级名在 .astro 里是 {name}，
    # 正则永远抓不到 Raw Archive / Cognitive Bootstrap 这些真实值，于是 N 和 j 漏了。
    # 95 个拉丁字形，体积可忽略；漏掉一个字母，某处 900 字重就会掉到备用字体。
    ASCII = {chr(c) for c in range(0x20, 0x7F)}
    body |= ASCII
    head |= ASCII
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

CACHE = os.path.join(OUT, '.charset')

if __name__ == '__main__':
    bcodes, hcodes = collect()
    print('字符集：正文层 %d，标题层 %d' % (len(bcodes), len(hcodes)))

    # 幂等：字符集没变就跳过重建，让日常构建保持快
    import hashlib
    stamp = hashlib.sha256(
        (','.join(map(str, bcodes)) + '|' + ','.join(map(str, hcodes))).encode()
    ).hexdigest()[:16]
    if os.path.exists(CACHE) and open(CACHE).read().strip() == stamp \
       and os.path.exists(f'{OUT}/head-900.woff2') and os.path.exists(f'{OUT}/body-400.woff2'):
        print('字符集未变化（%s），跳过重建。' % stamp)
        sys.exit(0)
    m1 = build(hcodes, 900, 'head-900')
    m2 = build(bcodes, 400, 'body-400')
    total = sum(os.path.getsize(f'{OUT}/{f}') for f in os.listdir(OUT)
                if f.endswith('.woff2')) / 1024
    print('字体合计 %.1f KB' % total)
    if not (m1 or m2):
        open(CACHE, 'w').write(stamp)
    sys.exit(1 if (m1 or m2) else 0)
