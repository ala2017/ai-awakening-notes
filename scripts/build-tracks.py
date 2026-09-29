#!/usr/bin/env python3
"""扫曲库，产出 public/audio/tracks.json。

曲库就是 public/audio/ 这个目录本身：往里丢一个 mp3，下次构建它就自己出现在播放器
里——没有清单要维护，清单是扫出来的。

约定（哪一条缺了就降级，不报错）：
  · 文件名形如  <入库日期>-<曲名> <版本>.mp3
      - 入库日期是**排序键**：越大越靠前，也就是"最新上传的先播"。
        用上传进站的那天，不是歌曲的创作日期——这样日后补一首老歌进来，
        它照样排在第一位，符合"按最新上传"。
      - 曲名与版本按**第一个空格**切（沿用天火自己的文件命名：
        「弦音未殇 Swirling shoegaze」）。切不开就整串当曲名，版本留空。
      - 没有日期前缀的文件排在最后，按文件名。
  · 同名的 .webp 是封面。
  · 日期只用来排序，不进界面。

为什么日期必须写在文件名里，不靠 git：两首歌若是同一次提交进来的，
git 的提交时间一模一样，分不出先后（2026-09-29 一次加两首就撞上了）。
文件名里的日期是唯一显式、不看环境的排序键。

用法：python3 scripts/build-tracks.py        （prebuild 会调它）
"""
import glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
AUDIO = 'public/audio'
OUT = os.path.join(AUDIO, 'tracks.json')

# <日期>[-<时>-<分>]-<其余>
PREFIX = re.compile(r'^(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})-(\d{2}))?-(.+)$')


def scan():
    tracks = []
    for path in sorted(glob.glob(os.path.join(AUDIO, '*.mp3'))):
        name = os.path.basename(path)
        stem = name[:-4]

        added, rest = '', stem
        m = PREFIX.match(stem)
        if m:
            added = '%s-%s-%s' % (m.group(1), m.group(2), m.group(3))
            if m.group(4):
                added += ' %s:%s' % (m.group(4), m.group(5))
            rest = m.group(6)
        else:
            print('  ⚠️  %s 没有入库日期前缀，排在最后' % name)

        parts = rest.split(' ', 1)
        title = parts[0].strip()
        sub = parts[1].strip() if len(parts) > 1 else ''

        cover = stem + '.webp'
        has_cover = os.path.exists(os.path.join(AUDIO, cover))

        tracks.append({
            'title': title,
            'sub': sub,
            'src': 'audio/' + name,
            'cover': ('audio/' + cover) if has_cover else '',
            'added': added,
        })

    # 日期倒序；同一天按曲名正序（稳定排序：先排曲名，再按日期排）
    tracks.sort(key=lambda t: t['title'])
    tracks.sort(key=lambda t: t['added'], reverse=True)
    return tracks


def main():
    tracks = scan()
    if not tracks:
        print('曲库是空的（%s 下没有 mp3），写出空清单' % AUDIO)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(tracks, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('✓ 曲库 %d 首 -> %s（按入库日期倒序）' % (len(tracks), OUT))
    for t in tracks:
        print('    %s  %-22s %s%s' % (
            t['added'] or '(无日期)', t['title'],
            t['sub'], '' if t['cover'] else '  [无封面]'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
