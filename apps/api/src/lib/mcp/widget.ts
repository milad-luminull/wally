/** Static, dependency-free MCP Apps view. Note content is only assigned with textContent. */
export function cardWidgetHtml(webOrigin: string): string {
  const safeOrigin = JSON.stringify(new URL(webOrigin).origin).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wally cards</title><style>
:root{color-scheme:light dark;--bg:#f6f6f5;--card:#fff;--text:#111;--muted:#646464;--line:#dededb;--chip:#eeeeeb;--green:#125631;font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#101112;--card:#191a1b;--text:#f4f4f7;--muted:#aaa;--line:#3c3d3e;--chip:#272829;--green:#80edaa}}
:root[data-theme=light]{color-scheme:light}
:root[data-theme=dark]{color-scheme:dark;--bg:#101112;--card:#191a1b;--text:#f4f4f7;--muted:#aaa;--line:#3c3d3e;--chip:#272829;--green:#80edaa}
*{box-sizing:border-box}body{margin:0;color:var(--text);background:transparent}main{padding:20px;background:var(--bg);border:1px solid var(--line);border-radius:16px;overflow:hidden}
header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}.brand{font-size:18px;font-weight:750;letter-spacing:-1px}.eyebrow{color:var(--muted);font-size:12px;margin:2px 0 0}h1{font-size:15px;font-weight:550;margin:0;overflow-wrap:anywhere}.count{color:var(--muted);font-size:12px;margin-top:3px}
#cards{display:grid;gap:12px}#cards:not(.single){max-height:560px;overflow:auto}article{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;min-width:0;display:flex;flex-direction:column;align-items:stretch;border-top:3px solid var(--note,var(--line))}h2{font-size:18px;line-height:1.35;letter-spacing:-.3px;margin:0 0 10px;overflow-wrap:anywhere}.single h2{font-size:24px}.description{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 16px;color:var(--muted);max-height:180px;overflow:auto}.badges,.tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.badge,.tag{border-radius:5px;padding:3px 8px;font-size:12px;background:var(--chip)}.done{color:var(--green)}.meta{display:flex;gap:6px 18px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin:0 0 12px}.meta span{overflow-wrap:anywhere}.tag{background:transparent;border:1px solid var(--line);color:var(--muted)}footer{margin-top:auto;display:flex;gap:12px;align-items:flex-start;justify-content:space-between;padding-top:12px;border-top:1px solid var(--line)}a{color:var(--text);font-weight:550;text-underline-offset:3px;text-decoration-thickness:1px;font-size:12px}a:hover{text-decoration-thickness:2px}a:focus-visible,summary:focus-visible{outline:2px solid #708eaa;outline-offset:4px;border-radius:2px}summary{cursor:pointer;font-size:12px;color:var(--muted)}details{min-width:0;max-width:70%}details p{margin:6px 0;font-size:11px;overflow-wrap:anywhere;color:var(--muted)}#message,#pagination{color:var(--muted);font-size:13px}#message{padding:24px 0;margin:0}#pagination{margin:14px 0 0}#error{color:var(--muted);font-size:12px;margin-top:12px}[hidden]{display:none!important}
@media(min-width:620px){#cards:not(.single):not(.compact){grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:380px){main{padding:14px}article{padding:14px}header{gap:10px}.single h2{font-size:21px}}
#cards.compact{grid-template-columns:1fr;gap:6px}.compact article{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 12px;padding:12px 14px;border-top-width:1px;border-left:3px solid var(--note,var(--line))}.compact h2{grid-column:1;grid-row:1;font-size:15px;margin:0}.compact .badges{grid-column:2;grid-row:1;margin:0;justify-content:flex-end}.compact .meta{grid-column:1;grid-row:2;margin:0}.compact article>.description,.compact article>.tags{display:none}.compact footer{grid-column:2;grid-row:2;border:0;padding:0;align-items:center}.compact details{max-width:none}.compact footer:has(details[open]){grid-column:1/-1;grid-row:3;align-items:flex-start;border-top:1px solid var(--line);padding-top:8px}.compact footer:has(details[open]) details{flex:1}.compact details .description{font-size:13px}
@media(max-width:480px){.compact h2{grid-column:1/-1}.compact .badges{grid-column:1/-1;grid-row:2;justify-content:flex-start}.compact .meta{grid-column:1;grid-row:3}.compact footer{grid-column:2;grid-row:3}.compact footer:has(details[open]){grid-column:1/-1;grid-row:4;justify-content:space-between}}
</style></head><body><main aria-label="Wally cards"><header><div><div class="brand">wally<span aria-hidden="true">.</span></div><p class="eyebrow">A little space for what matters</p></div><div><h1 id="board">Your cards</h1><div id="count" class="count"></div></div></header>
<p id="message" role="status">Loading your cards…</p><section id="cards" aria-label="Cards" tabindex="0"></section><p id="pagination" hidden></p><p id="error" role="status" hidden></p></main>
<script>
(() => {
  const allowedOrigin = ${safeOrigin};
  const root = document.getElementById('cards');
  const status = document.getElementById('message');
  const pending = new Map(); let nextId = 1; let ready = false; let observer;
  const notify = (method, params) => parent.postMessage({jsonrpc:'2.0',method,params}, '*');
  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Host unavailable')); }, 10000);
      pending.set(id, {resolve,reject,timer});
      parent.postMessage({jsonrpc:'2.0',id,method,params}, '*');
    });
  }
  function el(tag, text, cls) { const node=document.createElement(tag); if(text!==undefined) node.textContent=text; if(cls)node.className=cls; return node; }
  function safeUrl(value) { try { const url=new URL(value); return url.origin===allowedOrigin && url.pathname.startsWith('/boards/') && !url.username && !url.password ? url.href : null; } catch { return null; } }
  function link(label, value) {
    const url=safeUrl(value); if(!url)return el('span',label);
    const a=el('a',label); a.href=url; a.target='_blank'; a.rel='noopener noreferrer';
    a.addEventListener('click',event=>{ if(!ready)return; event.preventDefault(); request('ui/open-link',{url}).catch(()=>{const error=document.getElementById('error');error.textContent='Could not open Wally. Use the link’s context menu to open it in your browser.';error.hidden=false;}); }); return a;
  }
  const priorities={HIGH:'High',MEDIUM:'Medium',LOW:'Low'};
  const horizons={TODAY:'Today',THIS_WEEK:'This week',LATER:'Later'};
  const colours={CHALK:'#d9d9d9',STONE:'#d4cbbd',OAT:'#e5c966',CLAY:'#dba98c',MIST:'#aab9ca',SAGE:'#aec39e',HEATHER:'#c2b1df',ICE:'#a8cbd4',SKY:'#a3cce4',MINT:'#a7cfb7',SEA_GREEN:'#97c5ba',OLIVE:'#c1c795',ROSE:'#ddaebb',MALLOW:'#c8a8cf'};
  function render(result) {
    root.replaceChildren(); document.getElementById('pagination').hidden=true;
    document.getElementById('board').textContent='Your cards';document.getElementById('count').textContent='';document.getElementById('error').hidden=true;
    if(result?.isError){status.textContent='Cards could not be loaded. Check your Wally connection and try again.';status.hidden=false;return;}
    const data=result?.structuredContent;
    if(!data || !['card','list'].includes(data.view) || !Array.isArray(data.cards) || !data.board || typeof data.board.name!=='string'){status.textContent='Card data is unavailable. You can still read the result in the conversation.';status.hidden=false;return;}
    const compact=data.view==='list'&&data.cards.length>=5;
    root.className=data.view==='card'?'single':compact?'compact':'';
    document.getElementById('board').textContent=data.board.name;
    document.getElementById('count').textContent=data.view==='card'?'Card details':data.cards.length+' of '+data.total+' cards';
    status.hidden=data.cards.length>0;status.textContent='No cards match this view.';
    for(const note of data.cards){
      if(!note || typeof note.title!=='string')continue;
      const card=el('article');card.style.setProperty('--note',colours[note.colour]||colours.CHALK);
      card.append(el('h2',note.title.trim()||'Untitled card'));
      const badges=el('div',undefined,'badges');badges.append(el('span',note.status==='DONE'?'Completed':'Open','badge '+(note.status==='DONE'?'done':'')),el('span',(priorities[note.priority]||note.priority)+' priority','badge'));card.append(badges);
      if(note.description)card.append(el('p',note.description,'description'));
      const meta=el('div',undefined,'meta');meta.append(el('span',horizons[note.horizon]||note.horizon));
      if(note.dueDate)meta.append(el('span','Due '+note.dueDate));
      if(note.assignee)meta.append(el('span',note.assignee));
      if(note.subtaskSummary?.total)meta.append(el('span',note.subtaskSummary.done+'/'+note.subtaskSummary.total+' subtasks'));
      card.append(meta);
      if(note.tags?.length){const tags=el('div',undefined,'tags');for(const tag of note.tags)tags.append(el('span',tag,'tag'));card.append(tags);}
      const footer=el('footer');const details=el('details');details.append(el('summary','Details'),el('p','Card ID: '+note.id),el('p','Revision: '+note.revision));if(compact){if(note.description)details.append(el('p',note.description,'description'));if(note.tags?.length)details.append(el('p',note.tags.join(' · ')));}
      footer.append(details,link('Open in Wally ↗',note.url));card.append(footer);root.append(card);
    }
    if(data.nextCursor){const p=document.getElementById('pagination');p.replaceChildren(el('span','More cards available. Ask for the next page, or '),link('open the board',data.board.url),el('span','.'));p.hidden=false;}
  }
  function theme(context){if(['dark','light'].includes(context?.theme))document.documentElement.dataset.theme=context.theme;}
  window.addEventListener('message',event=>{
    if(event.source!==parent)return;const msg=event.data;if(!msg||msg.jsonrpc!=='2.0')return;
    if(msg.method==='ui/resource-teardown'){ready=false;observer?.disconnect();for(const item of pending.values())clearTimeout(item.timer);pending.clear();parent.postMessage({jsonrpc:'2.0',id:msg.id,result:{}},'*');return;}
    if(!msg.method && pending.has(msg.id)){const item=pending.get(msg.id);pending.delete(msg.id);clearTimeout(item.timer);msg.error?item.reject(msg.error):item.resolve(msg.result);return;}
    if(msg.method==='ui/notifications/tool-result')render(msg.params);
    if(msg.method==='ui/notifications/host-context-changed')theme(msg.params);
    if(msg.method==='ui/notifications/tool-cancelled')render({isError:true});
  });
  function size(){if(ready)notify('ui/notifications/size-changed',{height:Math.ceil(document.querySelector('main').getBoundingClientRect().height),width:document.documentElement.clientWidth});}
  if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(size);observer.observe(document.body);}
  request('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'Wally cards',version:'1.0.0'},appCapabilities:{availableDisplayModes:['inline']}}).then(result=>{
    theme(result.hostContext);ready=true;notify('ui/notifications/initialized',{});size();
  }).catch(()=>{if(!root.children.length){status.textContent='The card view could not connect. The result is still available in the conversation.';status.hidden=false;}});
})();
</script></body></html>`;
}
