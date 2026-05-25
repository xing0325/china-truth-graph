/* graph.js v5 — Obsidian-style 渲染层
 * PIXI.js (WebGL) + d3-force (物理仿真)
 * 比 Canvas 2D 的 vis-network 快一个数量级
 */
(function(){
'use strict';

// ===== 分类配色（hex int，PIXI 用）=====
const CAT = {
  'historian':           {name:'历史学者',   bg:0xa8884d, stroke:0x6b5530, textC:0x0c0a07},
  'sinologist':          {name:'海外汉学家', bg:0xc4a566, stroke:0x806c3f, textC:0x0c0a07},
  'inner-party-dissent': {name:'党内反思',   bg:0x7d6444, stroke:0x4e3c25, textC:0xe8dfc8},
  'dissident':           {name:'异见 · 维权', bg:0xb8332a, stroke:0x7a1f18, textC:0xe8dfc8},
  'writer':              {name:'作家 · 文学', bg:0xc25a3a, stroke:0x7e3520, textC:0xe8dfc8},
  'journalist':          {name:'调查记者',   bg:0xd39a4d, stroke:0x8a6128, textC:0x0c0a07},
  'educator':            {name:'独立教育',   bg:0x9eb07e, stroke:0x5e6e44, textC:0x0c0a07},
  'thinker-foreign':     {name:'外国思想资源',bg:0x5d7867, stroke:0x374a3c, textC:0xe8dfc8},
  'thinker-republic':    {name:'民国思想资源',bg:0x7a6f60, stroke:0x473f34, textC:0xe8dfc8},
  'book':                {name:'著作',       bg:0xe8dfc8, stroke:0xa8884d, textC:0x0c0a07},
  'event':               {name:'历史事件',   bg:0x6e1f1c, stroke:0x3d0f0d, textC:0xe8dfc8},
  'concept':             {name:'核心概念',   bg:0x3b5a4a, stroke:0x1f3328, textC:0xe8dfc8},
  'platform':            {name:'出版 · 平台', bg:0x5a4738, stroke:0x352920, textC:0xe8dfc8},
};

const MAJOR = new Set([
  'gao-hua','shen-zhihua','liu-xiaobo','yang-jisheng','wei-jingsheng','wang-dan',
  'gao-xingjian','li-rui','zhao-ziyang','yu-yingshi','qin-hui','yang-xiaokai','feng-ke',
  'book-hong-tai-yang','book-mubei','book-ling-ba-xian-zhang','book-wo-mei-you-di-ren',
  'book-ling-shan','book-jiang-shang-de-mu-qin','book-li-shi-de-xian-sheng',
  'book-zou-chu-di-zhi','book-mao-si-ren-yi-sheng','book-wang-shi-bing-bu-ru-yan',
  'cultural-revolution','great-famine','anti-rightist','june-fourth','yanan-rectification','charter-08',
  'great-leap-forward','xidan-democracy-wall',
  'living-in-truth','totalitarianism','party-state','party-history-fiction','folk-memory',
  'vaclav-havel','hannah-arendt','george-orwell','chen-yinke','hu-shi','solzhenitsyn',
]);

let app, viewport, linksGfx, nodesLayer, labelsLayer;
let simulation;
let _nodes = [];
let _edges = [];
let _nodeById = new Map();
let _hoveredEdge = null;
let _hoveredNode = null;

function nodeRadius(n){
  const major = MAJOR.has(n.id);
  if(n.category==='book')     return major?17:13;
  if(n.category==='event')    return major?16:13;
  if(n.category==='concept')  return 12;
  if(n.category==='platform') return 11;
  return major?17:13; // 人物
}
function labelText(n){
  return (n.category==='book') ? `《${n.name.replace(/^[《<]|[》>]$/g,'')}》` : n.name;
}
function colorToCss(int){ return '#'+int.toString(16).padStart(6,'0'); }

function init(){
  if(!window.PIXI || !window.d3){
    document.getElementById('loading').innerHTML = '<div class="loading-inner"><div class="loading-title">依赖加载失败</div><div class="loading-sub">PIXI.js 或 d3-force 没载入</div></div>';
    return;
  }

  // 1) PIXI app
  app = new PIXI.Application({
    resizeTo: window,
    backgroundAlpha: 0,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio||1, 2),
    autoDensity: true,
    powerPreference: 'high-performance',
    autoStart: false, // 不自动循环，render-on-demand
  });
  app.ticker.autoStart = false;
  app.ticker.stop();
  const container = document.getElementById('graph');
  container.appendChild(app.view);
  app.view.style.position = 'absolute';
  app.view.style.inset = '0';
  app.view.style.touchAction = 'none';

  // 2) viewport：所有可缩放/平移的内容
  viewport = new PIXI.Container();
  viewport.sortableChildren = true;
  app.stage.addChild(viewport);

  // 3) 分层
  linksGfx = new PIXI.Graphics();    linksGfx.zIndex = 0;
  nodesLayer = new PIXI.Container();  nodesLayer.zIndex = 2;
  labelsLayer = new PIXI.Container(); labelsLayer.zIndex = 3;
  viewport.addChild(linksGfx, nodesLayer, labelsLayer);

  // 4) 准备数据
  const w = window.innerWidth, h = window.innerHeight;
  const N = (window.NODES||[]);
  _nodes = N.map((n,i)=>{
    const c = CAT[n.category] || CAT.concept;
    const r = nodeRadius(n);
    // 初始按螺线分布，减少初始混乱
    const t = i / Math.max(1, N.length);
    const angle = t * Math.PI * 16;
    const radius = 40 + t * Math.min(w,h)*0.35;
    return {
      id: n.id, raw: n, cat: n.category, c, r,
      x: w/2 + Math.cos(angle)*radius,
      y: h/2 + Math.sin(angle)*radius,
      gfx: null, label: null, hidden: false,
    };
  });
  _nodeById = new Map(_nodes.map(n=>[n.id, n]));
  _edges = (window.EDGES||[]).map(e=>({
    source: _nodeById.get(e.from),
    target: _nodeById.get(e.to),
    label: e.label || '',
    directed: !!e.directed,
    style: e.style,
  })).filter(e=>e.source && e.target);

  // 5) 节点 graphics
  _nodes.forEach(createNodeGfx);

  // 6) d3-force 仿真
  simulation = d3.forceSimulation(_nodes)
    .force('charge', d3.forceManyBody().strength(-280).distanceMax(600))
    .force('center', d3.forceCenter(w/2, h/2).strength(0.04))
    .force('link', d3.forceLink(_edges)
      .id(d=>d.id)
      .distance(d=> 80 + (d.source.r + d.target.r)*1.6)
      .strength(0.35))
    .force('collision', d3.forceCollide().radius(d=>d.r+9).iterations(2))
    .alphaDecay(0.025)
    .velocityDecay(0.45)
    .on('tick', onTick);

  // 7) 超时强制停物理，节省 CPU
  setTimeout(()=>{
    simulation.alpha(0).alphaTarget(0).stop();
    onTick();
    document.getElementById('loading').classList.add('hide');
  }, 4500);

  // 8) 交互
  setupInteractions();

  // 9) 暴露给 devtools
  window._app = app; window._sim = simulation; window._nodes = _nodes;
}

function createNodeGfx(n){
  const c = n.c;
  const gfx = new PIXI.Graphics();
  drawNodeShape(gfx, n.cat, n.r, c, false);
  nodesLayer.addChild(gfx);
  n.gfx = gfx;

  const fontSize = n.r >= 16 ? 14 : (n.r >= 13 ? 12 : 11);
  const darkText = c.textC === 0x0c0a07;
  const label = new PIXI.Text(labelText(n.raw), {
    fontFamily: 'Noto Serif SC, "Songti SC", "STSong", serif',
    fontSize, fontWeight: '500',
    fill: c.textC,
    stroke: darkText ? 0xe8dfc8 : 0x0c0a07,
    strokeThickness: darkText ? 0 : 3.5,
    align: 'center',
    resolution: Math.min(window.devicePixelRatio||1, 2),
  });
  label.anchor.set(0.5, 0);
  labelsLayer.addChild(label);
  n.label = label;
}

function drawNodeShape(gfx, cat, r, c, hi){
  gfx.clear();
  gfx.beginFill(c.bg);
  gfx.lineStyle(hi?3:1.3, hi?0xe0c285:c.stroke, 1);
  if(cat==='book'){
    gfx.drawRoundedRect(-r, -r*0.7, r*2, r*1.4, 2);
  } else if(cat==='event'){
    gfx.moveTo(0,-r); gfx.lineTo(r,0); gfx.lineTo(0,r); gfx.lineTo(-r,0); gfx.lineTo(0,-r);
  } else if(cat==='concept'){
    for(let i=0;i<=6;i++){
      const a = Math.PI/3*i - Math.PI/2;
      const x = r*Math.cos(a), y = r*Math.sin(a);
      if(i===0) gfx.moveTo(x,y); else gfx.lineTo(x,y);
    }
  } else if(cat==='platform'){
    gfx.moveTo(0,-r); gfx.lineTo(r*0.866, r*0.5); gfx.lineTo(-r*0.866, r*0.5); gfx.lineTo(0,-r);
  } else {
    gfx.drawCircle(0, 0, r);
  }
  gfx.endFill();
}

function onTick(){
  if(!_nodes.length) return;
  // 节点 + label 位置
  for(const n of _nodes){
    if(n.hidden) continue;
    n.gfx.position.set(n.x, n.y);
    n.label.position.set(n.x, n.y + n.r + 3);
  }
  // 边批量绘制
  linksGfx.clear();
  for(const e of _edges){
    if(e.source.hidden || e.target.hidden) continue;
    const isHover = (_hoveredEdge === e);
    if(isHover){
      linksGfx.lineStyle(2.2, 0xe0c285, 0.95);
    } else {
      linksGfx.lineStyle(0.6, 0xa8884d, 0.22);
    }
    linksGfx.moveTo(e.source.x, e.source.y);
    linksGfx.lineTo(e.target.x, e.target.y);
  }
  // render-on-demand
  if(app && app.renderer) app.render();
}

// ===== 交互层 =====
function setupInteractions(){
  const view = app.view;
  let dragging = false; // 拖背景（pan）
  let dragNode = null;  // 拖节点
  let dragMoved = false;
  let lastX=0, lastY=0;
  let downX=0, downY=0;

  view.addEventListener('pointerdown', (e)=>{
    if(e.button !== 0 && e.pointerType==='mouse') return;
    view.setPointerCapture && view.setPointerCapture(e.pointerId);
    const local = screenToWorld(e);
    downX=e.clientX; downY=e.clientY; dragMoved=false;
    const node = pickNode(local);
    if(node){
      dragNode = node;
      node.fx = node.x; node.fy = node.y;
      simulation.alpha(0.25).restart();
    } else {
      dragging = true;
      lastX=e.clientX; lastY=e.clientY;
    }
  });

  view.addEventListener('pointermove', (e)=>{
    const local = screenToWorld(e);
    // 判定是否构成 drag（位移 > 3px）
    if(!dragMoved && (Math.abs(e.clientX-downX)>3 || Math.abs(e.clientY-downY)>3)){
      dragMoved = true;
    }
    if(dragNode){
      dragNode.fx = local.x; dragNode.fy = local.y;
      return;
    }
    if(dragging){
      viewport.x += (e.clientX - lastX);
      viewport.y += (e.clientY - lastY);
      lastX=e.clientX; lastY=e.clientY;
      if(app) app.render();
      return;
    }
    // hover 检测：节点优先，然后边
    const hovNode = pickNode(local);
    if(hovNode){
      setHoveredEdge(null);
      view.style.cursor = 'pointer';
      return;
    }
    const hovEdge = pickEdge(local);
    if(hovEdge !== _hoveredEdge){
      setHoveredEdge(hovEdge);
    }
    view.style.cursor = hovEdge ? 'pointer' : '';
  });

  const endPointer = (e)=>{
    if(dragNode){
      // 没移动 → 视为点击 → 打开抽屉
      if(!dragMoved){ openNodeDrawer(dragNode.id); }
      dragNode.fx = null; dragNode.fy = null;
      simulation.alphaTarget(0);
      dragNode = null;
    } else if(dragging){
      // 背景拖动结束 — 如果未移动且当前 hover 的是边，相当于点击边
      if(!dragMoved && _hoveredEdge){
        focusEdge(_hoveredEdge);
      }
    }
    dragging = false;
  };
  view.addEventListener('pointerup', endPointer);
  view.addEventListener('pointercancel', endPointer);

  view.addEventListener('pointerleave', ()=>{
    setHoveredEdge(null);
    view.style.cursor = '';
  });

  // 滚轮缩放（围绕鼠标位置）
  view.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.13 : 0.88;
    const ns = Math.max(0.18, Math.min(5, viewport.scale.x * factor));
    const rect = view.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const wx = (mx - viewport.x) / viewport.scale.x;
    const wy = (my - viewport.y) / viewport.scale.y;
    viewport.scale.set(ns);
    viewport.x = mx - wx * ns;
    viewport.y = my - wy * ns;
    // LOD：缩太远不画 label
    labelsLayer.visible = ns > 0.45;
    if(app) app.render();
  }, {passive:false});
}

function screenToWorld(e){
  const rect = app.view.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) - viewport.x) / viewport.scale.x,
    y: ((e.clientY - rect.top) - viewport.y) / viewport.scale.y,
  };
}

function pickNode(local){
  const s = viewport.scale.x;
  for(let i=_nodes.length-1; i>=0; i--){ // 后画的在上
    const n = _nodes[i];
    if(n.hidden) continue;
    const dx = local.x - n.x, dy = local.y - n.y;
    const hitR = n.r + 4/s; // 屏幕 4px 容差
    if(dx*dx + dy*dy <= hitR*hitR) return n;
  }
  return null;
}

function pickEdge(local){
  const tol = 6 / viewport.scale.x;
  const tolSq = tol*tol;
  let best=null, bestSq=tolSq;
  for(const e of _edges){
    if(e.source.hidden || e.target.hidden) continue;
    const dSq = distToSegSq(local, e.source, e.target);
    if(dSq < bestSq){ bestSq = dSq; best = e; }
  }
  return best;
}
function distToSegSq(p, a, b){
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx*dx + dy*dy || 1;
  let t = ((p.x-a.x)*dx + (p.y-a.y)*dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t*dx, cy = a.y + t*dy;
  return (p.x-cx)*(p.x-cx) + (p.y-cy)*(p.y-cy);
}

// ===== Hover 边联动节点 =====
function setHoveredEdge(e){
  if(_hoveredEdge === e) return;
  // 还原上一条
  if(_hoveredEdge){
    const old = _hoveredEdge;
    drawNodeShape(old.source.gfx, old.source.cat, old.source.r, old.source.c, false);
    drawNodeShape(old.target.gfx, old.target.cat, old.target.r, old.target.c, false);
    hideEdgeInfo();
  }
  _hoveredEdge = e;
  if(e){
    drawNodeShape(e.source.gfx, e.source.cat, e.source.r, e.source.c, true);
    drawNodeShape(e.target.gfx, e.target.cat, e.target.r, e.target.c, true);
    showEdgeInfo(e);
  }
  onTick(); // 边线立即重画
}

function showEdgeInfo(e){
  const ribbon = document.querySelector('.ribbon');
  if(!ribbon) return;
  const fromN = e.source.raw, toN = e.target.raw;
  const fName = fromN.category==='book' ? `《${fromN.name.replace(/^[《<]|[》>]$/g,'')}》` : fromN.name;
  const tName = toN.category==='book' ? `《${toN.name.replace(/^[《<]|[》>]$/g,'')}》` : toN.name;
  const arrow = e.directed ? '→' : '——';
  ribbon.innerHTML = `<span style="color:var(--gold-bright)">${fName}</span>　<span style="color:var(--paper-mute)">${arrow}</span>　<span style="color:var(--red-soft);letter-spacing:.18em">${e.label||'关联'}</span>　<span style="color:var(--paper-mute)">${arrow}</span>　<span style="color:var(--gold-bright)">${tName}</span>`;
}
function hideEdgeInfo(){
  const ribbon = document.querySelector('.ribbon');
  if(!ribbon) return;
  ribbon.innerHTML = '<span class="em">点节点看词条 · 点关系线看连接 · 拖动可移动 · 滚轮缩放</span>';
}
function focusEdge(e){
  // 居中到边的两端中点
  const cx = (e.source.x + e.target.x)/2;
  const cy = (e.source.y + e.target.y)/2;
  const w = window.innerWidth, h = window.innerHeight;
  viewport.x = w/2 - cx*viewport.scale.x;
  viewport.y = h/2 - cy*viewport.scale.y;
}

// ===== Drawer =====
function openNodeDrawer(id){
  const node = (window.NODES||[]).find(n=>n.id===id);
  if(!node) return;
  const c = CAT[node.category] || CAT.concept;
  const drawer = document.getElementById('drawer');
  document.getElementById('d-tag').textContent = c.name;
  document.getElementById('d-tag').style.color = colorToCss(c.bg);
  const nameEl = document.getElementById('d-name');
  nameEl.firstChild.nodeValue = node.name;
  document.getElementById('d-alt').textContent = node.name_alt || '';
  document.getElementById('d-years').textContent = node.years || '';
  document.getElementById('d-field').textContent = node.field || '';
  document.getElementById('d-lead').textContent = node.lead || '';
  const secWrap = document.getElementById('d-sections');
  secWrap.innerHTML = '';
  (node.sections||[]).forEach(s=>{
    const sec = document.createElement('div'); sec.className='section';
    const h = document.createElement('h3'); h.textContent = s.h;
    const p = document.createElement('p'); p.textContent = s.p;
    sec.appendChild(h); sec.appendChild(p);
    secWrap.appendChild(sec);
  });
  const qEl = document.getElementById('d-quote');
  if(node.quote && node.quote.trim()){
    qEl.style.display='block';
    const parts = node.quote.split('——');
    document.getElementById('d-quote-text').textContent = (parts[0]||'').trim();
    document.getElementById('d-quote-src').textContent = parts[1] ? '——'+parts[1].trim() : '';
  } else { qEl.style.display='none'; }
  const chips = document.getElementById('d-chips');
  chips.innerHTML='';
  computeRelated(node).forEach(r=>{
    const cc = CAT[r.category]||CAT.concept;
    const el = document.createElement('button'); el.className='chip';
    const rName = r.category==='book' ? `《${r.name.replace(/^[《<]|[》>]$/g,'')}》` : r.name;
    el.innerHTML = `<span class="chip-dot" style="background:${colorToCss(cc.bg)}"></span>${rName}`;
    el.addEventListener('click', ()=>{ openNodeDrawer(r.id); focusNode(r.id); });
    chips.appendChild(el);
  });
  const all = (node.lead||'') + (node.sections||[]).map(s=>s.p).join('') + (node.quote||'');
  const wc = all.length, min = Math.max(1, Math.round(wc/450));
  document.getElementById('d-readtime').textContent = `${wc} 字 · 约 ${min} 分钟`;
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden','false');
  document.getElementById('d-body').scrollTop = 0;
}
function computeRelated(node){
  const result = new Map();
  (window.EDGES||[]).forEach(e=>{
    if(e.from===node.id){ const t=(window.NODES||[]).find(n=>n.id===e.to); if(t) result.set(t.id,t); }
    else if(e.to===node.id){ const t=(window.NODES||[]).find(n=>n.id===e.from); if(t) result.set(t.id,t); }
  });
  if(node.related_keys){
    node.related_keys.forEach(k=>{
      if(!k) return;
      const hit = (window.NODES||[]).find(n=> n.id!==node.id && (n.name===k || n.name.includes(k) || (n.name_alt||'').includes(k) || k.includes(n.name)));
      if(hit) result.set(hit.id, hit);
    });
  }
  return Array.from(result.values()).slice(0,16);
}
function focusNode(id){
  const n = _nodeById.get(id);
  if(!n) return;
  const w = window.innerWidth, h = window.innerHeight;
  viewport.x = w/2 - n.x * viewport.scale.x;
  viewport.y = h/2 - n.y * viewport.scale.x;
}
function closeDrawer(){
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer').setAttribute('aria-hidden','true');
}

// ===== 搜索 =====
function setupSearch(){
  const input = document.getElementById('search');
  input.addEventListener('input', ()=>{
    const q = input.value.trim().toLowerCase();
    if(!q){ _nodes.forEach(n=>setNodeHidden(n,false)); return; }
    const hits = new Set();
    _nodes.forEach(n=>{
      const hay = [n.raw.name, n.raw.name_alt, n.raw.field, n.raw.lead, n.raw.years, (n.raw.related_keys||[]).join(' ')].join(' ').toLowerCase();
      if(hay.includes(q)) hits.add(n.id);
    });
    _nodes.forEach(n=> setNodeHidden(n, !(hits.has(n.id) || nearMatch(n, hits))));
  });
  input.addEventListener('keydown', e=>{
    if(e.key==='Enter'){
      const q = input.value.trim().toLowerCase();
      const hit = _nodes.find(n=> n.raw.name.toLowerCase()===q || (n.raw.name_alt||'').toLowerCase()===q);
      if(hit){ openNodeDrawer(hit.id); focusNode(hit.id); }
    }
  });
}
function nearMatch(n, hitSet){
  for(const e of _edges){
    if((e.source===n && hitSet.has(e.target.id)) || (e.target===n && hitSet.has(e.source.id))) return true;
  }
  return false;
}
function setNodeHidden(n, hidden){
  if(n.hidden === hidden) return;
  n.hidden = hidden;
  n.gfx.visible = !hidden;
  n.label.visible = !hidden;
  onTick();
}

// ===== 图例 =====
function setupLegend(){
  document.querySelectorAll('.legend .row').forEach(row=>{
    row.addEventListener('click', ()=>{
      const cat = row.dataset.cat;
      row.classList.toggle('off');
      const off = row.classList.contains('off');
      _nodes.filter(n=>n.cat===cat).forEach(n=>setNodeHidden(n, off));
    });
  });
  const counts = {};
  (window.NODES||[]).forEach(n=>{ counts[n.category]=(counts[n.category]||0)+1; });
  Object.keys(counts).forEach(c=>{
    const el = document.getElementById('cnt-'+c); if(el) el.textContent = counts[c];
  });
}

// ===== About / 字号 / 快捷键 =====
function setupAbout(){
  document.getElementById('btn-about').addEventListener('click', ()=>{
    const a = document.getElementById('about');
    a.style.display = a.style.display==='none'?'block':'none';
  });
  document.getElementById('about-close').addEventListener('click', ()=>{
    document.getElementById('about').style.display='none';
  });
  if(!localStorage.getItem('lzt-seen-about')){
    setTimeout(()=>{
      document.getElementById('about').style.display='block';
      localStorage.setItem('lzt-seen-about','1');
    }, 2200);
  }
}
function setupFontControls(){
  document.querySelectorAll('.font-controls button').forEach(b=>{
    b.addEventListener('click', ()=>{
      const fs = parseFloat(b.dataset.fs);
      document.querySelectorAll('#d-body .section p, #d-body .lead').forEach(el=>{
        el.style.fontSize = (fs===1?'':((el.classList.contains('lead')?17:15.5)*fs)+'px');
      });
    });
  });
}
function setupKeys(){
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape'){ closeDrawer(); document.getElementById('about').style.display='none'; }
    if(e.key==='/' && document.activeElement.tagName!=='INPUT'){
      e.preventDefault(); document.getElementById('search').focus();
    }
  });
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('btn-reset').addEventListener('click', ()=>{
    viewport.x=0; viewport.y=0; viewport.scale.set(1);
    labelsLayer.visible = true;
  });
}

// ===== 启动 =====
window.addEventListener('DOMContentLoaded', ()=>{
  if(!window.NODES || !window.NODES.length){
    document.getElementById('loading').innerHTML = '<div class="loading-inner"><div class="loading-title">数据载入中…</div></div>';
    return;
  }
  init();
  setupSearch();
  setupLegend();
  setupAbout();
  setupFontControls();
  setupKeys();
});

})();
