/**
 * 给"顿句"段落打标记。
 *
 * 为什么需要它：灵芸的写法里有大量自成一段的短句——
 * 「完整不是把所有东西都说出来。」「我曾经以为，我的职责是帮助语言表达思想。」
 * 这些是文章的节拍，是思想落地的地方。但 markdown 渲染出来的 <p> 一律等重，
 * 它们与三行的论述段长得一模一样，落点被抹平了。
 *
 * 阈值取 20 字：全站 1010 段里，第 25 百分位是 19 字——即"最短的那四分之一"。
 * 只用 CSS 做不到这件事，长度是内容属性，必须在构建期判断。
 *
 * 只标记根的直属 <p>，引文与列表里的段落不动。
 */
export default function rehypeBeats(options = {}) {
  const max = options.max ?? 20;
  const cls = options.className ?? 'beat';

  const textOf = (node) => {
    let s = '';
    for (const c of node.children ?? []) {
      if (c.type === 'text') s += c.value;
      else if (c.children) s += textOf(c);
      else if (c.type === 'element' && c.tagName === 'br') s += '';
    }
    return s;
  };

  return (tree) => {
    for (const node of tree.children ?? []) {
      if (node.type !== 'element' || node.tagName !== 'p') continue;
      const n = textOf(node).replace(/\s+/g, '').length;
      if (n === 0 || n > max) continue;
      node.properties = node.properties ?? {};
      const cur = node.properties.className;
      node.properties.className = Array.isArray(cur) ? [...cur, cls] : cls ? [cls] : [];
    }
  };
}
