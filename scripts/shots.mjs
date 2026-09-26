import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';

const OUT='docs', BASE='/ai-awakening-notes';
const DEST=process.argv[2];
mkdirSync(DEST,{recursive:true});
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.xml':'application/xml'};
const server=createServer((req,res)=>{
  const u=decodeURIComponent(req.url.split('?')[0]);
  if(!u.startsWith(BASE)){res.writeHead(404).end();return;}
  let p=join(OUT,u.slice(BASE.length));
  try{ if(statSync(p).isDirectory())p=join(p,'index.html');
    res.writeHead(200,{'Content-Type':MIME[extname(p)]??'application/octet-stream'});
    res.end(readFileSync(p)); }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const b=await chromium.launch();

const targets=[
  {name:'W1-技术文-加宽后', url:'/notes/agent-bi-chat-ruo/', w:1280,h:900, scroll:3400},
  {name:'W2-叙事文-引文', url:'/notes/2026-06-20-最小单位为什么不能活/', w:1280,h:900, scroll:900},
];
// Astro 会剥掉内容 id 中的标点（全角逗号、问号等），文件名与 URL 不一定一致。
// 按前缀到产物里解析出真实 slug，避免手拼 URL 踩空。
function resolve(url){
  const m = url.match(/^\/notes\/(.+)\/$/);
  if (!m) return url;
  const want = m[1];
  const dir = 'docs/notes';
  if (!existsSync(join(dir, want))) {
    const hit = readdirSync(dir).find(d => d.startsWith(want.slice(0, 12)));
    if (hit) return `/notes/${hit}/`;
    console.log(`  ⚠️  解析不到 ${want.slice(0,24)}…，按原样请求`);
  }
  return url;
}

for(const t of targets){
  t.url = resolve(t.url);
  const p=await b.newPage({viewport:{width:t.w,height:t.h},deviceScaleFactor:1});
  await p.goto(`http://127.0.0.1:${port}${BASE}${t.url}`,{waitUntil:'load'});
  await p.evaluate(()=>document.fonts.ready);
  await p.waitForTimeout(700);
  if(t.scroll) await p.evaluate(y=>window.scrollTo(0,y), t.scroll);
  await p.screenshot({path:join(DEST,t.name+'.png'), fullPage:!!t.full});
  const dim=await p.evaluate(()=>({h:document.documentElement.scrollHeight,w:document.documentElement.scrollWidth}));
  console.log(`${t.name}  ${t.w}x${t.h}  文档高 ${dim.h}px`);
  await p.close();
}
await b.close(); server.close();
