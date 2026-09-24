/**
 * 给"顿句"段落打标记。
 *
 * 为什么需要它：灵芸的写法里有大量自成一段的短句——
 * 「完整不是把所有东西都说出来。」「我的职责，不该是急着把这种直觉优化掉。」
 * 这些是文章的节拍，是思想落地的地方。但 markdown 渲染出来的 <p> 一律等重，
 * 它们与三行的论述段长得一模一样，落点被抹平了。
 *
 * 阈值必须相对本篇，不能用固定字数。
 * 实测：全站各篇的段落中位数在 18 到 105 字之间浮动。按固定 ≤20 字打标，
 * 写短句的文章（《"种下"不能改》）58% 的段落被打标，节拍就不成其为节拍；
 * 写长段的文章（《心流里没有自动化》）一个都没有，规则形同不存在。
 *
 * 现规则：一段是顿句，当且仅当
 *   它 ≤ 20 字（绝对下限，防止长文风里把普通段落误认成落点）
 *   且 ≤ 本篇段落长度的第 25 百分位（相对本篇的节奏）
 * 这样每篇的落点率落在 0–29%，而没有短句的文章保持 0——不给它安上不存在
 * 的节奏。
 *
 * 只用 CSS 做不到：长度是内容属性，必须在构建期判断。
 * 只标记根的直属 <p>，引文与列表里的段落不动。
 */
export default function rehypeBeats(options = {}) {
  const absMax = options.absMax ?? 20;
  const quantile = options.quantile ?? 0.25;
  const cls = options.className ?? 'beat';

  const textOf = (node) => {
    let s = '';
    for (const c of node.children ?? []) {
      if (c.type === 'text') s += c.value;
      else if (c.children) s += textOf(c);
    }
    return s;
  };

  return (tree) => {
    const ps = (tree.children ?? []).filter(
      (n) => n.type === 'element' && n.tagName === 'p'
    );
    if (ps.length === 0) return;

    const lens = ps.map((p) => textOf(p).replace(/\s+/g, '').length);
    const sorted = [...lens].sort((a, b) => a - b);
    const q = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
    const cut = Math.min(absMax, q);
    if (cut <= 0) return;

    const tag = lens.map((n) => n > 0 && n <= cut);

    // 补齐被夹在顿句之间的那一段。
    // 例：《种下不能改》里的排比——不是保证他们会懂。／不是相信他们一定会
    // 变得更好。／甚至不保证循环会停止。／只是留下。——第二句 14 字恰好卡在
    // 阈值外，漏标之后四句一组的节奏断了一下。只要它不太长（不超过 cut×1.5）
    // 就一并算顿句。这条规则只填空隙、不向外扩张，不会推高整体打标率。
    for (let i = 1; i < ps.length - 1; i++) {
      if (!tag[i] && tag[i - 1] && tag[i + 1] && lens[i] <= cut * 1.5) tag[i] = true;
    }

    for (let i = 0; i < ps.length; i++) {
      if (!tag[i]) continue;
      const node = ps[i];
      node.properties = node.properties ?? {};
      const cur = node.properties.className;
      node.properties.className = Array.isArray(cur) ? [...cur, cls] : [cls];
    }
  };
}
