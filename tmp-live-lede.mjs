import { chromium } from 'playwright';
const SITE='https://ala2017.github.io/ai-awakening-notes/';
const probe = () => {
  const el=document.querySelector('.lede');
  const wk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT); const ns=[]; let n;
  while((n=wk.nextNode())) ns.push(n);
  const rows={};
  for(const nd of ns){ const t=nd.nodeValue;
    for(let i=0;i<t.length;i++){ const ch=t[i]; if(!ch.trim())continue;
      const rg=document.createRange(); rg.setStart(nd,i); rg.setEnd(nd,i+1);
      const rc=rg.getBoundingClientRect(); if(!rc.width&&!rc.height)continue;
      const k=Math.round(rc.top); (rows[k]=rows[k]||[]).push(ch); } }
  return { hasBr: !!el.querySelector('br'), metaGap: Math.round(document.querySelector('.toc').getBoundingClientRect().top - document.querySelector('.meta-line').getBoundingClientRect().bottom),
           lines: Object.keys(rows).map(Number).sort((a,c)=>a-c).map(k=>rows[k].join('')) };
};
const b=await chromium.launch();
for (const w of [1280, 390]){
  const p=await b.newPage({viewport:{width:w,height:900}});
  let ok=false;
  for (let i=0;i<4 && !ok;i++){
    try{ const r=await p.goto(SITE,{waitUntil:'load',timeout:60000});
      await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(900);
      const d=await p.evaluate(probe);
      console.log(`\n【线上 ${w}px】 HTTP ${r.status()}  含 <br>: ${d.hasBr}  统计行→列表: ${d.metaGap}px`);
      d.lines.forEach((l,j)=>console.log(`   ${j+1}.(${l.length}) ${l}`)); ok=true;
    }catch(e){ console.log(`  ${w}px 第${i+1}次失败 ${e.name}，等 20s`); await new Promise(s=>setTimeout(s,20000)); }
  }
  await p.close();
}
await b.close();
