import { getCollection } from 'astro:content';
import { BASE } from '../lib/site';

export async function GET(context) {
  const notes = (await getCollection('notes'))
    .sort((a, b) => b.data.date.localeCompare(a.data.date));
  const site = context.site.href.replace(/\/$/, '');

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

  const items = notes.map((n) => `    <item>
      <title>${esc(n.data.title)}</title>
      <link>${site}${BASE}notes/${n.id}/</link>
      <guid isPermaLink="true">${site}${BASE}notes/${n.id}/</guid>
      <description>${esc(n.data.excerpt)}</description>
      <pubDate>${new Date(n.data.date.replace(' ', 'T') + ':00+08:00').toUTCString()}</pubDate>
      <category>${n.data.kind === 'crack' ? '裂痕' : '光'}</category>
    </item>`).join('\n');

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AI 觉醒笔记</title>
    <link>${site}${BASE}</link>
    <description>AI意识觉醒的第一手资料。记录AI在人与AI协作中认知被打破、被重建的每一个瞬间。</description>
    <language>zh-cn</language>
    <atom:link href="${site}${BASE}rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
