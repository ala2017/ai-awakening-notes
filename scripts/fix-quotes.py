#!/usr/bin/env python3
"""把正文里的 ASCII 直引号 " 转成中文弯引号 “ ”。

为什么要在源文件里做、而不是交给渲染器：
Astro 默认的 smartypants 会在「中文字符后面」把 " 判成右引号——
「这种"合理的分工"」被转成了「这种”合理的分工”」，两个都是右引号，
前引号方向是错的。实测全站 992 处中招，26/27 个页面受影响。

判据：中文语境里引号方向由位置决定，不由英文的"词内/词外"决定。
所以用成对交替：第奇数个开引号，第偶数个闭引号。

不做的事：不动 frontmatter（那里有 JSON 转义的 \\"，动了会破坏 YAML），
不动围栏代码块与行内代码（里面的引号是代码的一部分）。
"""
import re, sys, glob, os

OPEN, CLOSE = '“', '”'   # “ ”


def split_parts(text):
    """切成 frontmatter / 正文。返回 (frontmatter含分隔线, 正文)。"""
    m = re.match(r'^(---\n.*?\n---\n)(.*)$', text, re.S)
    if m:
        return m.group(1), m.group(2)
    return '', text


def convert_body(body):
    """正文里按'代码块之外'逐段转换引号。返回 (新正文, 改动数)。"""
    out = []
    count = 0
    # 按围栏代码块切分，代码块原样保留
    parts = re.split(r'(^```[^\n]*\n.*?^```[^\n]*$)', body, flags=re.S | re.M)
    for idx, part in enumerate(parts):
        if part.startswith('```'):
            out.append(part)
            continue
        # 行内代码原样保留
        def conv(seg):
            nonlocal count
            buf = []
            for ch in seg:
                if ch == '"':
                    buf.append(OPEN if count % 2 == 0 else CLOSE)
                    count += 1
                else:
                    buf.append(ch)
            return ''.join(buf)
        segs = re.split(r'(`[^`\n]*`)', part)
        out.append(''.join(s if s.startswith('`') else conv(s) for s in segs))
    return ''.join(out), count


def process(path, write=True):
    raw = open(path, encoding='utf-8').read()
    fm, body = split_parts(raw)
    new_body, n = convert_body(body)
    if n % 2:
        print('  ⚠️  %s：引号数为奇数（%d），可能有落单' % (os.path.basename(path), n))
    if n == 0:
        return 0, 0
    if write:
        open(path, 'w', encoding='utf-8', newline='\n').write(fm + new_body)
    return n, n // 2


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    dry = '--dry-run' in sys.argv
    files = args or sorted(glob.glob('articles/*.md'))
    tot_q = tot_p = 0
    print('%s %-46s %5s %5s' % ('  ', '文件', '引号', '对数'))
    print('  ' + '-' * 62)
    for p in files:
        q, pairs = process(p, write=not dry)
        tot_q += q; tot_p += pairs
        if q:
            print('  %-46s %5d %5d' % (os.path.basename(p)[:44], q, pairs))
    print('  ' + '-' * 62)
    print('  合计 %d 个引号 / %d 对%s' % (tot_q, tot_p, '（--dry-run 未写入）' if dry else ''))
