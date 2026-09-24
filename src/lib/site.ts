// 站点路径工具。
//
// Astro 7 的 import.meta.env.BASE_URL 不带尾部斜杠（"/ai-awakening-notes"），
// 直接拼接会得到 "/ai-awakening-notesnotes/..." 这种断链。
// 所有内部链接一律走 url()，不要手写 `${base}...`。
const RAW = import.meta.env.BASE_URL;
export const BASE = RAW.endsWith('/') ? RAW : RAW + '/';

/** 拼接站内路径。url() 得到站点根，url('notes/x/') 得到文章页。 */
export const url = (p = '') => BASE + String(p).replace(/^\//, '');
