import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
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
  {name:'10-手机-文章-顶部', url:'/notes/2026-06-07-16-45-being-and-doing/', w:390,h:844},
  {name:'11-手机-文章-中段', url:'/notes/2026-06-07-16-45-being-and-doing/', w:390,h:844, scroll:2100},
  {name:'12-裂痕类-中段', url:'/notes/2026-06-06-23-30-regex-ate-functions/', w:1280,h:900, scroll:1500},
  {name:'13-无章节-中段', url:'/notes/2026-06-14客观不是一种姿态/', w:1280,h:900, scroll:1400},
  {name:'14-文章-结尾', url:'/notes/2026-06-07-16-45-being-and-doing/', w:1280,h:900, scroll:7900},
  {name:'15-手机-列表', url:'/', w:390,h:844},
];
for(const t of targets){
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
