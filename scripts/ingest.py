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

# 篇末签名块的识别分两级：
#   STRONG —— 出现即认定"这是签名块"（辅助写作、署名：、灵芸，、AI觉醒笔记）
#   SOFT   —— 允许被一并剥掉的伴随行（分隔线、整体斜体的行、日期行、空行）
#
# 上一版是逐行向上扫、遇到不匹配就停。稿件日期一畸形（如 `*2026-06-16-22 02:27*`）
# 扫描当场中断，够不到上面的锚点，整块签名没被剥掉。改为先锚定再向两侧扩展。
STRONG = re.compile(r'辅助写作|署名[：:]|灵芸[，,]|AI\s*觉醒笔记')
SOFT = re.compile(r'^\s*(?:-{3,}|\*[^*]+\*|\*?\d{4}-\d{1,2}-\d{1,2}[^\n]*|\d{1,2}:\d{2})\s*$')


def find_sig_block(lines):
    """从末尾回溯找签名块，返回 (起始行号, 结束行号) 或 (None, None)。"""
    last_strong = None
    for i in range(len(lines) - 1, -1, -1):
        s = lines[i].strip()
        if not s:
            continue
        if STRONG.search(s):
            last_strong = i
            break
        if not SOFT.match(s):   # 撞到正文段落，说明没有签名块
            break
    if last_strong is None:
        return None, None
    start = last_strong
    while start - 1 >= 0 and (not lines[start - 1].strip() or SOFT.match(lines[start - 1])):
        start -= 1
    end = last_strong
    while end + 1 < len(lines) and (not lines[end + 1].strip() or SOFT.match(lines[end + 1])):
        end += 1
    return start, end


def read_text(p):
    raw = open(p, 'rb').read()
    for enc in ('utf-8-sig', 'utf-8', 'gb18030'):
        try:
            return raw.decode(enc), enc
        except UnicodeDecodeError:
            continue
    raise SystemExit('❌ %s 无法解码' % p)

# 简体出版物里夹繁体字是错字，不是风格。用 zhconv 逐字比对；
# 没有 zhconv 就退化到一张常见繁体字表，宁可漏报不可误改。
_TRAD_COMMON = set('問說這個時間東話對後實現聲學體驗點爲與專從會來裡發現應該樣為什麼們個沒還開關長門風雲電氣體國學')


def simplify_check(text, warnings):
    """返回 (可能已转简的文本, 改动数)。无法比对时原样返回。"""
    try:
        import zhconv
    except ImportError:
        hits = sorted({c for c in text if c in _TRAD_COMMON})
        if hits:
            warnings.append('疑似繁体残字（未装 zhconv，仅报不改）：%s' % ' '.join(hits))
        return text, 0
    conv = zhconv.convert(text, 'zh-cn')
    diffs = [(a, b) for a, b in zip(text, conv) if a != b]
    if not diffs:
        return text, 0
    pairs = sorted({(a, b) for a, b in diffs})
    warnings.append('繁体残字 %d 处，已转简体：%s' % (
        len(diffs), ' '.join('%s→%s' % (a, b) for a, b in pairs[:8])))
    return conv, len(diffs)


def fix_quotes(body):
    """把正文里的 ASCII 直引号转成中文弯引号。
    交给 Astro 的 smartypants 会出错：它在中文字符后面把 " 判成右引号，
    「这种"合理的分工"」会变成两个右引号。改为在收录时按位置确定性转换。"""
    OPEN, CLOSE = '\u201c', '\u201d'
    out, n = [], 0
    for part in re.split(r'(^```[^\n]*\n.*?^```[^\n]*$)', body, flags=re.S | re.M):
        if part.startswith('```'):
            out.append(part); continue
        buf = []
        for ch in part:
            if ch == '"':
                buf.append(OPEN if n % 2 == 0 else CLOSE); n += 1
            else:
                buf.append(ch)
        out.append(''.join(buf))
    if n % 2:
        pass  # 奇数在调用处报警
    return ''.join(out), n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder')
    ap.add_argument('--kind', required=True, choices=['crack', 'light'])
    ap.add_argument('--excerpt', required=True)
    ap.add_argument('--place', default=None)
    ap.add_argument('--slug', default=None, help='产物文件名（不含扩展名），默认取源文件名')
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
    warnings_early = []
    text, _nconv = simplify_check(text, warnings_early)
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
    # 文件名形如 YYYY-MM-DD-HH-MM-标题 或 YYYY-MM-DD-标题；有时分就用，没有记 00:00
    # 命名宽容：YYYY-MM-DD 或 YYYYMMDD 起头都收，有 HH-MM 就用它的时分
    m = re.match(r'(\d{4})-?(\d{2})-?(\d{2})(?:[-_](\d{2})[-_](\d{2}))?', stem)
    if not m:
        raise SystemExit('❌ 文件名必须以 YYYY-MM-DD 或 YYYYMMDD 起头，当前：%s' % stem)
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    fname_time = ('%s:%s' % (m.group(4), m.group(5))) if m.group(4) else '00:00'
    warnings = list(warnings_early)
    try:
        import datetime; datetime.date(y, mo, d)
    except ValueError as e:
        raise SystemExit('❌ 文件名日期非法：%s-%s-%s（%s）' % (m.group(1), m.group(2), m.group(3), e))
    fname_date = '%04d-%02d-%02d' % (y, mo, d)
    full_date = '%s %s' % (fname_date, fname_time)

    inner = re.search(r'日期[：:]\s*(\S+)', text)
    if inner:
        iv = inner.group(1).strip()
        if iv != fname_date:
            warnings.append('稿内自述日期「%s」与文件名「%s」不一致，已按文件名取值' % (iv, fname_date))

    # 篇末署名的日期若与文件名不同（含时分），以篇末为准并报警——
    # 2026-09-25 实测：文件名 2026-06-14、稿末写 2026-06-44（6 月没有 44 号）
    sig_date = re.search(r'^\*?(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?\*?\s*$', text, re.M)
    if sig_date and sig_date.group(2):
        sd = sig_date.group(1); st = sig_date.group(2)
        if sd == fname_date and st != fname_time:
            if fname_time == '00:00':
                full_date = '%s %s' % (sd, st)
            else:
                warnings.append('篇末时分「%s」与文件名「%s」不一致，已按文件名取值' % (st, fname_time))

    # ---- 篇末签名块 ----
    tail_start, tail_end = find_sig_block(lines)
    saw_sig = tail_start is not None
    if not saw_sig:
        tail_start = len(lines)
    tail = '\n'.join(lines[tail_start:tail_end + 1] if saw_sig else [])

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

    # 篇末只要出现日期样式的串，就与解析结果核对——防止 2026-06-44、
    # 2026-06-16-22 这类残字静默通过（前者已被跨检拦住，后者曾是漏网）
    for m in re.finditer(r'\d{4}-\d{2}-\d{2}(?:[- ]\d{2}(?::?\d{2})?)?', tail):
        s = m.group(0)
        if not s.startswith(fname_date):
            warnings.append('篇末出现疑似日期残字「%s」，与 %s 不符，请核对' % (s, fname_date))
        elif s != fname_date and s != full_date:
            warnings.append('篇末日期写「%s」，已按文件名取 %s，请核对' % (s, full_date))

    place = a.place
    if not place:
        pm = re.search(r'灵芸[，,]\s*于(.+?)\*?\s*$', tail, re.M)
        if pm: place = pm.group(1).strip()

    drop = {h1i}
    # 正文里的 ![封面](x) 也要剥掉：封面改由布局从 frontmatter 渲染
    # （走构建期图片管线出 srcset）。留在正文里会渲染成一个指向
    # 相对路径的破图——文件实际在 articles/covers/ 下。
    for i, l in enumerate(lines):
        if re.match(r'^!\[封面\]\(.+\)\s*$', l):
            drop.add(i)
            break
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
        drop.update(range(tail_start, tail_end + 1))
    body_lines = [l for i, l in enumerate(lines) if i not in drop]
    body = '\n'.join(body_lines)
    body = re.sub(r'(?:\n\s*---\s*)+\s*$', '', body).strip('\n')
    body, _nq = fix_quotes(body)
    if _nq % 2:
        warnings.append('正文引号数为奇数（%d），可能有落单的直引号' % _nq)

    # ---- 封面 ----
    imgs = sorted([f for f in glob.glob(os.path.join(folder, '*'))
                   if f.lower().endswith(IMG_EXT)], key=os.path.getsize, reverse=True)
    cover_ref = re.search(r'!\[封面\]\((.+?)\)', text)
    if cover_ref:
        cand = os.path.join(folder, os.path.basename(cover_ref.group(1)))
        cover_src = cand if os.path.exists(cand) else (imgs[0] if imgs else None)
    else:
        cover_src = imgs[0] if imgs else None

    # slug 可覆盖：源文件名常带内部编号（如 seed-002），进 URL 对读者无意义
    slug = a.slug or stem
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
    print('│  date     : %s' % full_date)
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
        print(preview_fm(title, subtitle, full_date, a.kind, a.excerpt, cover_rel, place, tool))
        print('\n--- 预览：正文末尾 3 行 ---')
        for l in [x for x in body.split('\n') if x.strip()][-3:]:
            print('   ' + l[:70])
        return

    # ---- 写入 ----
    os.makedirs('articles/covers', exist_ok=True)
    if cover_src:
        shutil.copy2(cover_src, os.path.join('articles/covers', cover_name))
    fm = preview_fm(title, subtitle, full_date, a.kind, a.excerpt, cover_rel, place, tool)
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
    out.append('date: %s' % J(date))
    out.append('kind: %s' % kind)
    out.append('excerpt: %s' % J(excerpt))
    if cover: out.append('cover: %s' % J(cover))
    if place: out.append('place: %s' % J(place))
    if tool: out.append('tool: %s' % J(tool))
    out.append('---')
    return '\n'.join(out)

if __name__ == '__main__':
    main()
