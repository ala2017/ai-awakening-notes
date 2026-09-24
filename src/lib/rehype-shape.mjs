/**
 * 构建期的内容整形。markdown 渲染出来是一律等重的，这里给它补上结构信号。
 *
 * 做两件事：
 *
 * 一、给"顿句"段落打标（.beat）
 *   灵芸的写法里有大量自成一段的短句——「完整不是把所有东西都说出来。」
 *   「我的职责，不该是急着把这种直觉优化掉。」那是文章的节拍，是思想落地的
 *   地方。markdown 一律等重渲染，落点被抹平。
 *
 *   阈值必须相对本篇，不能用固定字数：实测各篇段落中位数在 18 到 105 字之间
 *   浮动。按固定 ≤20 字，写短句的文章 58% 的段落被打标，节拍就不成其为节拍；
 *   写长段的文章一个都没有，规则形同不存在。
 *   现规则：≤20 字（绝对下限）且 ≤ 本篇段长的第 25 百分位（相对本篇节奏）。
 *
 * 二、当文章的小标题自带编号时，关掉 CSS 的自动编号（.no-counter）
 *   有些文章的 ## 文本里已经写了「1. 痛点：…」「2. 破局：…」。CSS 的
 *   计数器再叠一个「01」上去就会双重编号。只要本篇有任意一个 ## 自带编号，
 *   全篇都不用自动编号——否则编号会与源编号错位。
 */
export default function rehypeShape(options = {}) {
  const absMax = options.absMax ?? 20;
  const quantile = options.quantile ?? 0.25;
  const beatClass = options.beatClass ?? 'beat';
  const noCounterClass = options.noCounterClass ?? 'no-counter';

  const textOf = (node) => {
    let s = '';
    for (const c of node.children ?? []) {
      if (c.type === 'text') s += c.value;
      else if (c.children) s += textOf(c);
    }
    return s;
  };
  const addClass = (node, cls) => {
    node.properties = node.properties ?? {};
    const cur = node.properties.className;
    node.properties.className = Array.isArray(cur) ? [...cur, cls] : [cls];
  };

  return (tree) => {
    const kids = tree.children ?? [];

    // ── 顿句 ──
    const ps = kids.filter((n) => n.type === 'element' && n.tagName === 'p');
    if (ps.length) {
      const lens = ps.map((p) => textOf(p).replace(/\s+/g, '').length);
      const sorted = [...lens].sort((a, b) => a - b);
      const q = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
      const cut = Math.min(absMax, q);
      if (cut > 0) {
        const tag = lens.map((n) => n > 0 && n <= cut);
        // 补齐被顿句夹在中间的那一段（只填空隙，不向外扩张）
        for (let i = 1; i < ps.length - 1; i++) {
          if (!tag[i] && tag[i - 1] && tag[i + 1] && lens[i] <= cut * 1.5) tag[i] = true;
        }
        tag.forEach((on, i) => { if (on) addClass(ps[i], beatClass); });
      }
    }

    // ── 小标题自带编号时关掉自动编号 ──
    const h2s = kids.filter((n) => n.type === 'element' && n.tagName === 'h2');
    const numbered = /^\s*\d+\s*[.、)）]/;
    if (h2s.some((h) => numbered.test(textOf(h)))) {
      h2s.forEach((h) => addClass(h, noCounterClass));
    }
  };
}
