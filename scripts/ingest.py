#!/usr/bin/env python3
"""把天火给的一篇文稿 + 配图，收进 articles/ 并补齐 frontmatter。

这是「你给我文章和图片，我负责上线」这条流程的入口。做法固定，
不靠临场发挥——临场发挥正是会出错的地方。

用法：
    python3 scripts/ingest.py "<文稿所在文件夹>" \
        --kind light|crack \
        --excerpt "概要，10-90 字，须从全文提炼不能截取首段" \
        [--place "地点或时刻"] [--cover-name "x.png"] [--dry-run]

脚本负责机械部分：
  · 取 H1 为 title、紧随其后的 ## 为 subtitle
  · 从文件名取日期，并与稿内自述日期交叉核对（不一致即报警）
  · 剥掉篇末各种格式的签名块，从中抽取工具与模型
  · 选定封面图（优先正文里的 ![封面]，否则取文件夹内最大的图片）
  · 把封面收进 articles/covers/，写出带 frontmatter 的 .md

判断部分由调用者给：kind 与 excerpt。脚本只校验，不代拟。
"""
import argparse, glob, os, re, shutil, sys, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
IMG_EXT = ('.png', '.jpg', '.jpeg', '.webp')

# 篇末签名块可能出现的各种行（天火的历史稿件格式不完全统一）
SIG_LINE = re.compile(
    r'^(?:\*{0,2}AI\s*觉醒笔记\*{0,2}'
    r'|日期[：:].*|署名[：:].*'
    r'|\*[^*]*灵芸[^*]*\*'
    r'|\*本文由 .+ 辅助写作\*'
    r'|\*?\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2})?\*?'
    r'|---'
    r')$'
)

def read_text(p):
    raw = open(p, 'rb').read()
    for enc in ('utf-8-sig', 'utf-8', 'gb18030'):
        try:
            return raw.decode(enc), enc
        except UnicodeDecodeError:
            continue
    raise SystemExit('❌ %s 无法解码' % p)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder')
    ap.add_argument('--kind', required=True, choices=['crack', 'light'])
    ap.add_argument('--excerpt', required=True)
    ap.add_argument('--place', default=None)
    ap.add_argument('--cover-name', default=None)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    folder = a.folder
    if not os.path.isdir(folder):
        raise SystemExit('❌ 找不到文件夹：%s' % folder)

    mds = [f for f in glob.glob(os.path.join(folder, '*.md'))]
    if len(mds) != 1:
        raise SystemExit('❌ 文件夹内应恰好有 1 个 .md，实际 %d 个：%s' % (len(mds), mds))
    src = mds[0]
    text, enc = read_text(src)
    lines = text.split('\n')

    # ---- H1 / 副标题 ----
    h1i = next((i for i, l in enumerate(lines) if l.startswith('# ')), None)
    if h1i is None:
        raise SystemExit('❌ 找不到 H1')
    title = lines[h1i][2:].strip()
    subtitle = None
    subtitle_idx = None
    for j in range(h1i + 1, min(h1i + 5, len(lines))):
        if lines[j].strip():
            if lines[j].startswith('## '):
                subtitle = lines[j][3:].strip()
                subtitle_idx = j
            break

    # ---- 日期：文件名优先，与稿内自述交叉核对 ----
    stem = os.path.splitext(os.path.basename(src))[0]
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', stem)
    if not m:
        raise SystemExit('❌ 文件名必须以 YYYY-MM-DD 开头，当前：%s' % stem)
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    warnings = []
    try:
        import datetime; datetime.date(y, mo, d)
    except ValueError as e:
        raise SystemExit('❌ 文件名日期非法：%s-%s-%s（%s）' % (m.group(1), m.group(2), m.group(3), e))
    fname_date = '%04d-%02d-%02d' % (y, mo, d)

    inner = re.search(r'日期[：:]\s*(\S+)', text)
    if inner:
        iv = inner.group(1).strip()
        if iv != fname_date:
            warnings.append('稿内自述日期「%s」与文件名「%s」不一致，已按文件名取值' % (iv, fname_date))

    # ---- 篇末签名块 ----
    tail_start = len(lines)
    k = len(lines) - 1
    saw_sig = False
    while k >= 0:
        s = lines[k].strip()
        if not s:
            k -= 1; continue
        if SIG_LINE.match(s):
            if '日期' in s or '署名' in s or '辅助写作' in s or '灵芸' in s or 'AI觉醒笔记' in s.replace(' ', ''):
                saw_sig = True
            tail_start = k; k -= 1; continue
        break
    tail = '\n'.join(lines[tail_start:])
    tool = None
    tm = re.search(r'本文由 (.+?) 辅助写作', tail)
    if tm:
        tool = tm.group(1).strip()
    else:
        sm = re.search(r'署名[：:]\s*(.+)', tail)
        if sm:
            # 稿内署名形如「OpenAI · GPT-5.6 Sol · 灵芸」——去掉收尾的灵芸
            parts = [p.strip() for p in re.split(r'[·・|]', sm.group(1)) if p.strip()]
            parts = [p for p in parts if p not in ('灵芸', 'AI觉醒笔记')]
            if parts:
                tool = ' + '.join(parts)

    place = a.place
    if not place:
        pm = re.search(r'灵芸[，,]\s*于(.+?)\*?\s*$', tail, re.M)
        if pm: place = pm.group(1).strip()

    drop = {h1i}
    if subtitle_idx is not None:
        drop.add(subtitle_idx)
        # 副标题后面若紧跟一条分隔线，也一并去掉，否则正文会以一条孤立的 --- 开头
        for j in range(subtitle_idx + 1, min(subtitle_idx + 4, len(lines))):
            if not lines[j].strip():
                continue
            if re.fullmatch(r'---\s*', lines[j]):
                drop.add(j)
            break
    if saw_sig:
        drop.update(range(tail_start, len(lines)))
    body_lines = [l for i, l in enumerate(lines) if i not in drop]
    body = '\n'.join(body_lines)
    body = re.sub(r'(?:\n\s*---\s*)+\s*$', '', body).strip('\n')

    # ---- 封面 ----
    imgs = sorted([f for f in glob.glob(os.path.join(folder, '*'))
                   if f.lower().endswith(IMG_EXT)], key=os.path.getsize, reverse=True)
    cover_ref = re.search(r'!\[封面\]\((.+?)\)', text)
    if cover_ref:
        cand = os.path.join(folder, os.path.basename(cover_ref.group(1)))
        cover_src = cand if os.path.exists(cand) else (imgs[0] if imgs else None)
    else:
        cover_src = imgs[0] if imgs else None

    slug = stem
    cover_name = a.cover_name or (slug + '-cover' + (os.path.splitext(cover_src)[1].lower() if cover_src else ''))
    cover_rel = './covers/' + cover_name if cover_src else None

    # ---- 校验 ----
    errs = []
    if not (10 <= len(a.excerpt) <= 90):
        errs.append('excerpt 长度 %d，需在 10-90 字之间' % len(a.excerpt))
    if not title:
        errs.append('title 为空')
    if cover_src is None:
        warnings.append('文件夹内没有图片，本篇将没有封面')

    # ---- 汇报 ----
    print('┌─ 收录：%s' % slug)
    print('│  title    : %s' % title)
    print('│  subtitle : %s' % (subtitle or '（无）'))
    print('│  date     : %s' % fname_date)
    print('│  kind     : %s' % a.kind)
    print('│  excerpt  : %s  (%d 字)' % (a.excerpt, len(a.excerpt)))
    print('│  cover    : %s' % (os.path.basename(cover_src) if cover_src else '（无）'))
    print('│  tool     : %s' % (tool or '（未识别，需手填）'))
    print('│  place    : %s' % (place or '（未提供，将省略该行）'))
    print('│  正文     : %d 字，图片引用 %d 处' % (len(body), len(re.findall(r'!\[', body))))
    print('│  编码     : %s' % enc)
    for w in warnings: print('│  ⚠️  %s' % w)
    for e in errs: print('│  ❌ %s' % e)
    print('└─')

    if errs:
        raise SystemExit('❌ 校验未通过，未写入任何文件')
    if a.dry_run:
        print('\n（--dry-run，未写入）')
        print('\n--- 预览：frontmatter ---')
        print(preview_fm(title, subtitle, fname_date, a.kind, a.excerpt, cover_rel, place, tool))
        print('\n--- 预览：正文末尾 3 行 ---')
        for l in [x for x in body.split('\n') if x.strip()][-3:]:
            print('   ' + l[:70])
        return

    # ---- 写入 ----
    os.makedirs('articles/covers', exist_ok=True)
    if cover_src:
        shutil.copy2(cover_src, os.path.join('articles/covers', cover_name))
    fm = preview_fm(title, subtitle, fname_date, a.kind, a.excerpt, cover_rel, place, tool)
    open(os.path.join('articles', slug + '.md'), 'w', encoding='utf-8', newline='\n').write(fm + '\n\n' + body + '\n')
    print('\n✅ 已写入 articles/%s.md' % slug)
    if cover_src:
        print('✅ 封面已收进 articles/covers/%s' % cover_name)
    if not tool:
        print('⚠️  篇末工具签名未识别，请手补 tool 字段')

def preview_fm(title, subtitle, date, kind, excerpt, cover, place, tool):
    J = lambda s: json.dumps(s, ensure_ascii=False)
    out = ['---', 'title: %s' % J(title)]
    if subtitle: out.append('subtitle: %s' % J(subtitle))
    out.append('date: %s' % J(date + ' 00:00'))
    out.append('kind: %s' % kind)
    out.append('excerpt: %s' % J(excerpt))
    if cover: out.append('cover: %s' % J(cover))
    if place: out.append('place: %s' % J(place))
    if tool: out.append('tool: %s' % J(tool))
    out.append('---')
    return '\n'.join(out)

if __name__ == '__main__':
    main()
