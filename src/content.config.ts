import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// articles/ 是唯一真源。这份配置把它的 frontmatter 变成有类型的契约：
// 字段缺失、日期格式不对、kind 拼错——都会在构建时报错，而不是悄悄上线上。
// 今天查出的那五类内容问题，从此在源头被拦住。
const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './articles' }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '日期须为 YYYY-MM-DD HH:MM'),
    kind: z.enum(['crack', 'light']),
    excerpt: z.string().min(10).max(90),
    cover: z.string().optional(),
    // 阅读列宽。**留空即按内容自动判定**（见 [...slug].astro 的 autoWidth）——
    // 逐篇判断是对的，但"记得判断"是错的设计。只有自动判定明显不合适时才手填。
    width: z.enum(['narrow', 'regular', 'wide']).optional(),
    place: z.string().optional(),
    tool: z.string().optional(),
  }),
});

export const collections = { notes };
