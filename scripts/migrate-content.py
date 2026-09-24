#!/usr/bin/env python3
"""把 articles/*.md 迁移为 Astro 内容集合格式。

做四件事：
  1. 抽出 H1 → frontmatter.title（H1 从正文移除，避免详情页重复渲染）
  2. 抽出紧随其后的 ## 行 → frontmatter.subtitle（仅当它是正文首行）
  3. 抽出 ![封面](x) → frontmatter.cover（改为由布局用 <Image> 渲染，以生成 srcset）
  4. 抽出篇末署名块 → frontmatter.place / tool（日期已在 date）

元数据来源优先级：正文署名 > 现有索引（仅作日期兜底）。kind 与 excerpt 由外部注入。
"""
import re, json, os, sys, glob

DRY = '--dry-run' in sys.argv
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

meta = json.load(open('/tmp/meta-final.json', encoding='utf-8'))
EXC = json.load(open('/tmp/excerpts.json', encoding='utf-8'))

def yaml_str(s):
    return json.dumps(s, ensure_ascii=False)

def parse(path, slug):
    raw = open(path, encoding='utf-8-sig').read()
    lines = raw.split('\n')
    m = meta[slug]

    # --- H1 ---
    h1i = next((i for i, l in enumerate(lines) if l.startswith('# ')), None)
    title = m['title']
    del_from, del_to = h1i, h1i

    # --- 副标题：H1 之后第一个非空行若是 ## ---
    sub = None
    for j in range(h1i + 1, min(h1i + 5, len(lines))):
        if lines[j].strip():
            if lines[j].startswith('## '):
                sub = lines[j][3:].strip()
                del_to = max(del_to, j)
            break

    # --- 封面 ---
    cover = m.get('cover')
    for i, l in enumerate(lines):
        if re.match(r'^!\[封面\]\(.+\)\s*$', l):
            del_to = max(del_to, i)
            break

    # --- 篇末署名块：从末尾往上找连续的斜体行 ---
    tail_start = len(lines)
    k = len(lines) - 1
    while k >= 0:
        s = lines[k].strip()
        if not s:
            k -= 1; continue
        if re.fullmatch(r'\*[^*]+\*', s) or re.fullmatch(r'20\d\d-\d\d-\d\d( \d\d:\d\d)?', s) \
           or re.fullmatch(r'灵芸[，,].*', s):
            tail_start = k; k -= 1; continue
        break
    tail = lines[tail_start:]
    tailtext = '\n'.join(tail)
    place = tool = None
    pm = re.search(r'灵芸[，,]\s*于(.+?)\*?\s*$', tailtext, re.M)
    if pm: place = pm.group(1)
    tm = re.search(r'本文由 (.+?) 辅助写作', tailtext)
    if tm: tool = tm.group(1)
    # 仅当块内确有署名或工具签名时才切除，避免误删正文
    strip_tail = bool(pm or tm)

    body = lines[:min(del_from, del_to)] + lines[del_to + 1: (tail_start if strip_tail else len(lines))]
    body = '\n'.join(body).strip('\n')
    # 修剪署名块切除后残留的分隔线与空白
    body = re.sub(r'(?:\n\s*---\s*)+\s*$', '', body).strip('\n')

    return dict(title=title, subtitle=sub, cover=cover, place=place, tool=tool,
                date=m['date'], kind=m['kind'], excerpt=EXC[slug], body=body,
                stripped_tail=strip_tail)

if DRY:
    print("%-46s %-7s %-5s %-6s %s" % ("文件","副标题","封面","切署名","body末尾"))
    print("-"*150)
    for p in sorted(glob.glob('articles/*.md')):
        slug = os.path.basename(p)[:-3]
        r = parse(p, slug)
        last = [l for l in r['body'].split('\n') if l.strip()][-1]
        print("%-46s %-7s %-5s %-6s %s" % (slug[:45], '有' if r['subtitle'] else '—',
              '有' if r['cover'] else '—', '是' if r['stripped_tail'] else '否', last[:56]))
    sys.exit(0)

# --- 正式写入 ---
count = 0
for p in sorted(glob.glob('articles/*.md')):
    slug = os.path.basename(p)[:-3]
    r = parse(p, slug)
    fm = ['---', 'title: %s' % yaml_str(r['title'])]
    if r['subtitle']: fm.append('subtitle: %s' % yaml_str(r['subtitle']))
    fm.append('date: %s' % yaml_str(r['date']))
    fm.append('kind: %s' % r['kind'])
    fm.append('excerpt: %s' % yaml_str(r['excerpt']))
    if r['cover']: fm.append('cover: %s' % yaml_str(r['cover']))
    if r['place']: fm.append('place: %s' % yaml_str(r['place']))
    if r['tool']: fm.append('tool: %s' % yaml_str(r['tool']))
    fm.append('---')
    out = '\n'.join(fm) + '\n\n' + r['body'] + '\n'
    open(p, 'w', encoding='utf-8', newline='\n').write(out)
    count += 1
print("已写入 %d 篇" % count)
