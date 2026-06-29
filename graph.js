/* graph.js v7 — stable clustered layout + focused exploration */
(function(){
'use strict';

const CAT = {
  'historian':           {name:'历史学者',    bg:0xaa8950, stroke:0x685230, textC:0x0b0c0b},
  'sinologist':          {name:'海外汉学家',  bg:0xc6a668, stroke:0x7c673e, textC:0x0b0c0b},
  'inner-party-dissent': {name:'党内反思',    bg:0x806847, stroke:0x493922, textC:0xeee9dc},
  'dissident':           {name:'异见 · 维权', bg:0xa83b32, stroke:0x671f1a, textC:0xeee9dc},
  'writer':              {name:'作家 · 文学', bg:0xbe6244, stroke:0x743724, textC:0xeee9dc},
  'journalist':          {name:'调查记者',    bg:0xd19b52, stroke:0x805c2d, textC:0x0b0c0b},
  'educator':            {name:'独立教育',    bg:0x9cac79, stroke:0x5a6741, textC:0x0b0c0b},
  'thinker-foreign':     {name:'外国思想资源',bg:0x587764, stroke:0x304638, textC:0xeee9dc},
  'thinker-republic':    {name:'民国思想资源',bg:0x776f62, stroke:0x443e35, textC:0xeee9dc},
  'book':                {name:'著作',        bg:0xe7dfcd, stroke:0xaa8950, textC:0x0b0c0b},
  'event':               {name:'历史事件',    bg:0x6d2824, stroke:0x3d1210, textC:0xeee9dc},
  'concept':             {name:'核心概念',    bg:0x385a49, stroke:0x1d3428, textC:0xeee9dc},
  'platform':            {name:'出版 · 平台', bg:0x594b3d, stroke:0x33291f, textC:0xeee9dc},
};

const MAJOR = new Set([
  'gao-hua','shen-zhihua','liu-xiaobo','yang-jisheng','wei-jingsheng','wang-dan',
  'gao-xingjian','li-rui','zhao-ziyang','yu-yingshi','qin-hui','yang-xiaokai','feng-ke',
  'book-hong-tai-yang','book-mubei','book-ling-ba-xian-zhang','book-wo-mei-you-di-ren',
  'book-ling-shan','book-jiang-shang-de-mu-qin','book-li-shi-de-xian-sheng',
  'book-zou-chu-di-zhi','book-mao-si-ren-yi-sheng','book-wang-shi-bing-bu-ru-yan',
  'cultural-revolution','great-famine','anti-rightist','june-fourth','yanan-rectification','charter-08',
  'great-leap-forward','xidan-democracy-wall','living-in-truth','totalitarianism','party-state',
  'party-history-fiction','folk-memory','vaclav-havel','hannah-arendt','george-orwell',
  'chen-yinke','hu-shi','solzhenitsyn',
]);

const LAYOUT_W = 1540;
const LAYOUT_H = 1020;
const GOLD = 0xe1c78e;
const CLUSTERS = {
  'historian':[0.26,0.23], 'sinologist':[0.42,0.18], 'inner-party-dissent':[0.58,0.20],
  'dissident':[0.75,0.30], 'writer':[0.79,0.50], 'journalist':[0.69,0.69],
  'educator':[0.55,0.79], 'thinker-foreign':[0.38,0.81], 'thinker-republic':[0.23,0.69],
  'concept':[0.21,0.44], 'book':[0.43,0.49], 'event':[0.58,0.45], 'platform':[0.46,0.68],
};

let app, viewport, linksGfx, clusterLayer, nodesLayer, labelsLayer, simulation;
let _nodes = [], _edges = [];
let _nodeById = new Map(), _rawById = new Map(), _neighbors = new Map();
let _hoveredNode = null, _hoveredEdge = null, _selectedNode = null;
let _searchHits = null, _searchVisible = null;
const _disabledCategories = new Set();
let _frame = 0;

function nodeRadius(n){
  const major = MAJOR.has(n.id);
  if(n.category==='book') return major ? 16 : 11;
  if(n.category==='event') return major ? 15 : 11;
  if(n.category==='concept') return major ? 14 : 10;
  if(n.category==='platform') return 9;
  return major ? 16 : 11;
}
function labelText(n){
  return n.category==='book' ? `《${n.name.replace(/^[《<]|[》>]$/g,'')}》` : n.name;
}
function colorToCss(int){ return '#'+int.toString(16).padStart(6,'0'); }
function categoryOf(n){ return CAT[n.category] || CAT.concept; }

function init(){
  if(!window.PIXI || !window.d3){
    document.getElementById('loading').innerHTML = '<div class="loading-inner"><div class="loading-title">依赖加载失败</div><div class="loading-sub">请检查网络连接后刷新页面</div></div>';
    return;
  }

  app = new PIXI.Application({
    resizeTo: window, backgroundAlpha:0, antialias:true,
    resolution:Math.min(window.devicePixelRatio||1,2), autoDensity:true,
    powerPreference:'high-performance', autoStart:false,
  });
  app.ticker.autoStart = false;
  app.ticker.stop();
  document.getElementById('graph').appendChild(app.view);
  Object.assign(app.view.style,{position:'absolute',inset:'0',touchAction:'none'});

  viewport = new PIXI.Container();
  viewport.sortableChildren = true;
  app.stage.addChild(viewport);
  linksGfx = new PIXI.Graphics(); linksGfx.zIndex = 0;
  clusterLayer = new PIXI.Container(); clusterLayer.zIndex = 1;
  nodesLayer = new PIXI.Container(); nodesLayer.zIndex = 2;
  labelsLayer = new PIXI.Container(); labelsLayer.zIndex = 3;
  viewport.addChild(linksGfx,clusterLayer,nodesLayer,labelsLayer);

  prepareData();
  createClusterLabels();
  _nodes.forEach(createNodeGfx);
  settleLayout();
  updateVisualState();
  fitToView(false);
  setupInteractions();

  document.getElementById('stat-nodes').textContent = _nodes.length;
  document.getElementById('stat-edges').textContent = _edges.length;
  setTimeout(()=>document.getElementById('loading').classList.add('hide'),120);
  window._app = app;
  window._nodes = _nodes;
}

function createClusterLabels(){
  const counts={};
  _nodes.forEach(n=>counts[n.cat]=(counts[n.cat]||0)+1);
  Object.entries(CLUSTERS).forEach(([cat,target])=>{
    if(!counts[cat]) return;
    const meta=CAT[cat]||CAT.concept;
    const label=new PIXI.Text(`${meta.name}  ${String(counts[cat]).padStart(2,'0')}`,{
      fontFamily:'Noto Sans SC, "Helvetica Neue", sans-serif',fontSize:14,fontWeight:'500',
      fill:meta.bg,letterSpacing:2,resolution:Math.min(window.devicePixelRatio||1,2),
    });
    label.anchor.set(.5,.5);label.alpha=.24;label.category=cat;
    label.position.set(target[0]*LAYOUT_W,target[1]*LAYOUT_H-72);
    clusterLayer.addChild(label);
  });
}

function prepareData(){
  const rawNodes = window.NODES || [];
  _rawById = new Map(rawNodes.map(n=>[n.id,n]));
  const catCounts = new Map();
  _nodes = rawNodes.map((raw,i)=>{
    const index = catCounts.get(raw.category)||0;
    catCounts.set(raw.category,index+1);
    const target = CLUSTERS[raw.category] || [0.5,0.5];
    const angle = index * 2.3999632297 + i*0.071;
    const radius = 18 + 18*Math.sqrt(index);
    return {
      id:raw.id, raw, cat:raw.category, c:categoryOf(raw), r:nodeRadius(raw),
      x:target[0]*LAYOUT_W + Math.cos(angle)*radius,
      y:target[1]*LAYOUT_H + Math.sin(angle)*radius,
      targetX:target[0]*LAYOUT_W, targetY:target[1]*LAYOUT_H,
      gfx:null,label:null,hidden:false,
    };
  });
  _nodeById = new Map(_nodes.map(n=>[n.id,n]));
  _neighbors = new Map(_nodes.map(n=>[n.id,new Set()]));
  _edges = (window.EDGES||[]).map((raw,index)=>{
    const source = _nodeById.get(raw.from), target = _nodeById.get(raw.to);
    if(!source || !target) return null;
    _neighbors.get(source.id).add(target.id);
    _neighbors.get(target.id).add(source.id);
    return {source,target,label:raw.label||'',directed:!!raw.directed,style:raw.style,index};
  }).filter(Boolean);
}

function settleLayout(){
  simulation = d3.forceSimulation(_nodes)
    .randomSource(d3.randomLcg(0.417))
    .force('charge',d3.forceManyBody().strength(d=>MAJOR.has(d.id)?-235:-170).distanceMax(390))
    .force('link',d3.forceLink(_edges).id(d=>d.id)
      .distance(e=>58+(e.source.r+e.target.r)*1.35+(e.source.cat===e.target.cat?0:22))
      .strength(e=>e.source.cat===e.target.cat?0.4:0.11))
    .force('x',d3.forceX(d=>d.targetX).strength(0.11))
    .force('y',d3.forceY(d=>d.targetY).strength(0.11))
    .force('collision',d3.forceCollide().radius(d=>d.r+11).strength(0.95).iterations(2))
    .alpha(1).alphaDecay(0.024).velocityDecay(0.38).stop();
  for(let i=0;i<360;i++) simulation.tick();
  simulation.stop();
  renderFrame();
}

function createNodeGfx(n){
  n.gfx = new PIXI.Graphics();
  nodesLayer.addChild(n.gfx);
  const label = new PIXI.Text(labelText(n.raw),{
    fontFamily:'Noto Sans SC, "Helvetica Neue", sans-serif',
    fontSize:MAJOR.has(n.id)?12.5:10.5, fontWeight:MAJOR.has(n.id)?'600':'500',
    fill:0xeee9dc, stroke:0x0b0c0b, strokeThickness:3.5,
    align:'center', resolution:Math.min(window.devicePixelRatio||1,2),
  });
  label.anchor.set(0.5,0);
  n.label = label;
  labelsLayer.addChild(label);
  drawNodeShape(n,'normal');
}

function drawNodeShape(n,state){
  const {gfx,cat,r,c} = n;
  gfx.clear();
  const selected = state==='selected';
  const hovered = state==='hover';
  gfx.beginFill(c.bg);
  gfx.lineStyle(selected?3:hovered?2.2:1.15,selected||hovered?GOLD:c.stroke,1);
  if(cat==='book'){
    gfx.drawRoundedRect(-r,-r*.68,r*2,r*1.36,2.5);
    gfx.moveTo(-r+3,-r*.68+4); gfx.lineTo(-r+3,r*.68-4);
  }else if(cat==='event'){
    gfx.moveTo(0,-r);gfx.lineTo(r,0);gfx.lineTo(0,r);gfx.lineTo(-r,0);gfx.lineTo(0,-r);
  }else if(cat==='concept'){
    for(let i=0;i<=6;i++){
      const a=Math.PI/3*i-Math.PI/2, x=r*Math.cos(a), y=r*Math.sin(a);
      if(i===0) gfx.moveTo(x,y); else gfx.lineTo(x,y);
    }
  }else if(cat==='platform'){
    gfx.moveTo(0,-r);gfx.lineTo(r*.866,r*.5);gfx.lineTo(-r*.866,r*.5);gfx.lineTo(0,-r);
  }else gfx.drawCircle(0,0,r);
  gfx.endFill();
  if(selected){
    gfx.lineStyle(1,GOLD,.22);
    gfx.drawCircle(0,0,r+7);
  }
}

function renderFrame(){
  if(!app || !app.renderer) return;
  for(const n of _nodes){
    n.gfx.position.set(n.x,n.y);
    n.label.position.set(n.x,n.y+n.r+4);
  }
  drawEdges();
  app.render();
}

function drawEdges(){
  linksGfx.clear();
  const focus = _selectedNode || _hoveredNode;
  for(const e of _edges){
    if(e.source.hidden || e.target.hidden) continue;
    const connected = focus && (e.source===focus || e.target===focus);
    const edgeHover = _hoveredEdge===e;
    let width=.62,color=0xaa8950,alpha=.15;
    if(focus){
      if(connected){width=1.55;color=GOLD;alpha=.72;}
      else alpha=.025;
    }
    if(edgeHover){width=2.3;color=GOLD;alpha=.95;}
    linksGfx.lineStyle(width,color,alpha);
    linksGfx.moveTo(e.source.x,e.source.y);
    linksGfx.lineTo(e.target.x,e.target.y);
  }
}

function updateVisualState(){
  const focus = _selectedNode || _hoveredNode;
  const related = focus ? _neighbors.get(focus.id) : null;
  const scale = viewport ? viewport.scale.x : 1;
  for(const n of _nodes){
    const hidden = _disabledCategories.has(n.cat) || (_searchVisible && !_searchVisible.has(n.id));
    n.hidden = hidden;
    n.gfx.visible = !hidden;
    n.label.visible = !hidden;
    if(hidden) continue;
    const isFocus = n===focus;
    const isRelated = !!(related && related.has(n.id));
    n.gfx.alpha = focus ? (isFocus?1:isRelated?.82:.11) : 1;
    n.label.alpha = focus ? (isFocus?1:isRelated?.82:.1) : .92;
    const showLabel = isFocus || isRelated || (MAJOR.has(n.id) && scale>.34) || scale>.76;
    n.label.visible = showLabel;
    drawNodeShape(n,n===_selectedNode?'selected':n===_hoveredNode?'hover':'normal');
  }
  for(const label of clusterLayer.children){
    label.visible=!_disabledCategories.has(label.category);
    label.alpha=focus?.1:.24;
  }
  renderFrame();
}

function setupInteractions(){
  const view = app.view;
  let panning=false, dragNode=null, moved=false;
  let lastX=0,lastY=0,downX=0,downY=0;

  view.addEventListener('pointerdown',e=>{
    if(e.button!==0 && e.pointerType==='mouse') return;
    view.setPointerCapture?.(e.pointerId);
    const world=screenToWorld(e);
    downX=lastX=e.clientX;downY=lastY=e.clientY;moved=false;
    dragNode=pickNode(world);
    panning=!dragNode;
  });

  view.addEventListener('pointermove',e=>{
    if(Math.hypot(e.clientX-downX,e.clientY-downY)>4) moved=true;
    if(dragNode){
      if(moved){
        const world=screenToWorld(e);
        dragNode.x=world.x;dragNode.y=world.y;
        renderFrame();
      }
      return;
    }
    if(panning){
      viewport.x+=e.clientX-lastX;viewport.y+=e.clientY-lastY;
      lastX=e.clientX;lastY=e.clientY;app.render();return;
    }
    const world=screenToWorld(e);
    const node=pickNode(world);
    setHoveredNode(node,e.clientX,e.clientY);
    if(node){setHoveredEdge(null);view.style.cursor='pointer';return;}
    const edge=pickEdge(world);
    setHoveredEdge(edge);
    view.style.cursor=edge?'pointer':'grab';
  });

  const endPointer=()=>{
    if(dragNode && !moved) selectNode(dragNode,true);
    else if(panning && !moved){
      if(_hoveredEdge) focusEdge(_hoveredEdge);
      else clearSelection(true);
    }
    dragNode=null;panning=false;
  };
  view.addEventListener('pointerup',endPointer);
  view.addEventListener('pointercancel',endPointer);
  view.addEventListener('pointerleave',()=>{
    if(!panning && !dragNode){setHoveredNode(null);setHoveredEdge(null);view.style.cursor='';}
  });
  view.addEventListener('wheel',e=>{
    e.preventDefault();
    zoomAt(e.deltaY<0?1.13:.885,e.clientX,e.clientY);
  },{passive:false});
}

function screenToWorld(e){
  const rect=app.view.getBoundingClientRect();
  return {
    x:((e.clientX-rect.left)-viewport.x)/viewport.scale.x,
    y:((e.clientY-rect.top)-viewport.y)/viewport.scale.y,
  };
}

function pickNode(point){
  const tolerance=7/viewport.scale.x;
  for(let i=_nodes.length-1;i>=0;i--){
    const n=_nodes[i];if(n.hidden) continue;
    const hit=Math.max(n.r+3,tolerance);
    if((point.x-n.x)**2+(point.y-n.y)**2<=hit**2) return n;
  }
  return null;
}

function pickEdge(point){
  if(viewport.scale.x<.42) return null;
  const tolSq=(5/viewport.scale.x)**2;
  let best=null,bestSq=tolSq;
  for(const e of _edges){
    if(e.source.hidden||e.target.hidden) continue;
    const d=distToSegSq(point,e.source,e.target);
    if(d<bestSq){bestSq=d;best=e;}
  }
  return best;
}

function distToSegSq(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy||1;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len));
  const x=a.x+t*dx,y=a.y+t*dy;
  return (p.x-x)**2+(p.y-y)**2;
}

function setHoveredNode(node,x,y){
  if(_hoveredNode===node){if(node) placeTooltip(x,y);return;}
  _hoveredNode=node;
  const tip=document.getElementById('node-tooltip');
  if(node && !_selectedNode){
    tip.innerHTML='';
    const name=document.createElement('span');name.textContent=labelText(node.raw);
    const meta=document.createElement('small');meta.textContent=[node.c.name,node.raw.years].filter(Boolean).join(' · ');
    tip.append(name,meta);tip.classList.add('visible');placeTooltip(x,y);
  }else tip.classList.remove('visible');
  updateVisualState();
}

function placeTooltip(x,y){
  const tip=document.getElementById('node-tooltip');
  tip.style.left=Math.min(x,window.innerWidth-260)+'px';
  tip.style.top=Math.min(y,window.innerHeight-90)+'px';
}

function setHoveredEdge(edge){
  if(_hoveredEdge===edge) return;
  _hoveredEdge=edge;
  if(edge) showEdgeInfo(edge); else if(!_selectedNode) showDefaultRibbon();
  renderFrame();
}

function showEdgeInfo(e){
  const a=labelText(e.source.raw),b=labelText(e.target.raw),arrow=e.directed?'→':'—';
  const ribbon=document.querySelector('.ribbon');
  ribbon.textContent=`${a}  ${arrow}  ${e.label||'关联'}  ${arrow}  ${b}`;
}

function showDefaultRibbon(){
  const ribbon=document.querySelector('.ribbon');
  ribbon.innerHTML='<span class="em">选择节点，沿关系探索被遮蔽的人、书与事件</span>';
}

function selectNode(node,focus){
  _selectedNode=node;
  _hoveredNode=null;
  document.getElementById('node-tooltip').classList.remove('visible');
  openNodeDrawer(node.id);
  updateVisualState();
  showSelectionRibbon(node);
  if(focus) focusNode(node.id);
}

function showSelectionRibbon(node){
  const count=(_neighbors.get(node.id)||new Set()).size;
  document.querySelector('.ribbon').textContent=`${labelText(node.raw)} · ${count} 条直接关系`;
}

function clearSelection(close=true){
  _selectedNode=null;_hoveredNode=null;_hoveredEdge=null;
  if(close) closeDrawer();
  document.getElementById('node-tooltip').classList.remove('visible');
  showDefaultRibbon();updateVisualState();
}

function focusEdge(e){
  const x=(e.source.x+e.target.x)/2,y=(e.source.y+e.target.y)/2;
  animateViewport(x,y,Math.max(viewport.scale.x,.8),false);
}

function focusNode(id){
  const n=_nodeById.get(id);if(!n) return;
  animateViewport(n.x,n.y,Math.max(viewport.scale.x,.86),true);
}

function animateViewport(worldX,worldY,scale,withDrawer){
  const drawerWidth=withDrawer?document.getElementById('drawer').getBoundingClientRect().width:0;
  const centerX=(window.innerWidth-drawerWidth)/2;
  const centerY=window.innerHeight/2;
  const target={x:centerX-worldX*scale,y:centerY-worldY*scale,s:scale};
  const start={x:viewport.x,y:viewport.y,s:viewport.scale.x};
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    setTransform(target);return;
  }
  cancelAnimationFrame(_frame);
  const began=performance.now(),duration=280;
  const step=now=>{
    const t=Math.min(1,(now-began)/duration),ease=1-Math.pow(1-t,3);
    setTransform({x:start.x+(target.x-start.x)*ease,y:start.y+(target.y-start.y)*ease,s:start.s+(target.s-start.s)*ease});
    if(t<1) _frame=requestAnimationFrame(step);
  };
  _frame=requestAnimationFrame(step);
}

function setTransform(t){
  viewport.x=t.x;viewport.y=t.y;viewport.scale.set(t.s);
  updateVisualState();
}

function zoomAt(factor,clientX,clientY){
  const rect=app.view.getBoundingClientRect();
  const mx=(clientX??window.innerWidth/2)-rect.left,my=(clientY??window.innerHeight/2)-rect.top;
  const old=viewport.scale.x,scale=Math.max(.22,Math.min(3.2,old*factor));
  const wx=(mx-viewport.x)/old,wy=(my-viewport.y)/old;
  viewport.scale.set(scale);viewport.x=mx-wx*scale;viewport.y=my-wy*scale;
  updateVisualState();
}

function fitToView(animate=true){
  const visible=_nodes.filter(n=>!n.hidden);
  if(!visible.length) return;
  const minX=Math.min(...visible.map(n=>n.x-n.r-34)),maxX=Math.max(...visible.map(n=>n.x+n.r+34));
  const minY=Math.min(...visible.map(n=>n.y-n.r-24)),maxY=Math.max(...visible.map(n=>n.y+n.r+40));
  const mobile=window.innerWidth<=780;
  const left=mobile?24:265,right=mobile?24:68,top=mobile?112:88,bottom=mobile?105:70;
  const width=window.innerWidth-left-right,height=window.innerHeight-top-bottom;
  const scale=Math.max(.22,Math.min(1.08,Math.min(width/(maxX-minX),height/(maxY-minY))));
  const worldX=(minX+maxX)/2,worldY=(minY+maxY)/2;
  const target={x:left+width/2-worldX*scale,y:top+height/2-worldY*scale,s:scale};
  if(!animate){setTransform(target);return;}
  const start={x:viewport.x,y:viewport.y,s:viewport.scale.x};
  cancelAnimationFrame(_frame);
  const began=performance.now();
  const step=now=>{
    const t=Math.min(1,(now-began)/260),ease=1-Math.pow(1-t,3);
    setTransform({x:start.x+(target.x-start.x)*ease,y:start.y+(target.y-start.y)*ease,s:start.s+(target.s-start.s)*ease});
    if(t<1) _frame=requestAnimationFrame(step);
  };
  _frame=requestAnimationFrame(step);
}

function openNodeDrawer(id){
  const node=_rawById.get(id);if(!node) return;
  const c=categoryOf(node),drawer=document.getElementById('drawer');
  const tag=document.getElementById('d-tag');tag.textContent=c.name;tag.style.color=colorToCss(c.bg);
  const name=document.getElementById('d-name');name.firstChild.nodeValue=node.name;
  document.getElementById('d-alt').textContent=node.name_alt||'';
  document.getElementById('d-years').textContent=node.years||'年代未详';
  document.getElementById('d-field').textContent=node.field||c.name;
  document.getElementById('d-lead').textContent=node.lead||'';
  const sections=document.getElementById('d-sections');sections.innerHTML='';
  (node.sections||[]).forEach(s=>{
    const section=document.createElement('section');section.className='section';
    const h=document.createElement('h3');h.textContent=s.h;
    const p=document.createElement('p');p.textContent=s.p;
    section.append(h,p);sections.appendChild(section);
  });
  const quote=document.getElementById('d-quote');
  if(node.quote?.trim()){
    quote.style.display='block';
    const parts=node.quote.split('——');
    document.getElementById('d-quote-text').textContent=(parts[0]||'').trim();
    document.getElementById('d-quote-src').textContent=parts[1]?'——'+parts.slice(1).join('——').trim():'';
  }else quote.style.display='none';
  const chips=document.getElementById('d-chips');chips.innerHTML='';
  computeRelated(node).forEach(raw=>{
    const cc=categoryOf(raw),button=document.createElement('button');button.className='chip';button.type='button';
    const dot=document.createElement('span');dot.className='chip-dot';dot.style.background=colorToCss(cc.bg);
    button.append(dot,document.createTextNode(labelText(raw)));
    button.addEventListener('click',()=>selectNode(_nodeById.get(raw.id),true));
    chips.appendChild(button);
  });
  const text=(node.lead||'')+(node.sections||[]).map(s=>s.p).join('')+(node.quote||'');
  document.getElementById('d-readtime').textContent=`${text.length} 字 · 约 ${Math.max(1,Math.round(text.length/450))} 分钟`;
  drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');
  document.getElementById('d-body').scrollTop=0;
}

function computeRelated(node){
  const ids=Array.from(_neighbors.get(node.id)||[]);
  if(node.related_keys){
    for(const key of node.related_keys){
      if(!key) continue;
      const hit=_nodes.find(n=>n.id!==node.id&&(n.raw.name===key||n.raw.name.includes(key)||(n.raw.name_alt||'').includes(key)||key.includes(n.raw.name)));
      if(hit&&!ids.includes(hit.id)) ids.push(hit.id);
    }
  }
  return ids.map(id=>_rawById.get(id)).filter(Boolean).slice(0,18);
}

function closeDrawer(){
  const drawer=document.getElementById('drawer');
  drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');
}

function setupSearch(){
  const input=document.getElementById('search'),results=document.getElementById('search-results');
  let activeIndex=-1,current=[];
  const renderResults=()=>{
    const q=input.value.trim().toLowerCase();results.innerHTML='';activeIndex=-1;
    if(!q){results.classList.remove('open');_searchHits=null;_searchVisible=null;updateVisualState();return;}
    current=_nodes.map(n=>({n,score:searchScore(n.raw,q)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(x=>x.n);
    _searchHits=new Set(current.map(n=>n.id));
    _searchVisible=new Set(_searchHits);
    current.forEach(n=>{for(const id of _neighbors.get(n.id)||[]) _searchVisible.add(id);});
    if(!current.length){const empty=document.createElement('div');empty.className='search-empty';empty.textContent='没有找到匹配词条';results.appendChild(empty);}
    current.forEach((n,index)=>{
      const button=document.createElement('button');button.className='search-result';button.type='button';button.role='option';
      const dot=document.createElement('span');dot.className='result-dot';dot.style.background=colorToCss(n.c.bg);
      const name=document.createElement('span');name.className='result-name';name.textContent=labelText(n.raw);
      const cat=document.createElement('span');cat.className='result-cat';cat.textContent=n.c.name;
      button.append(dot,name,cat);button.addEventListener('click',()=>choose(n));button.dataset.index=index;
      results.appendChild(button);
    });
    results.classList.add('open');updateVisualState();
  };
  const choose=n=>{
    input.value='';results.classList.remove('open');_searchHits=null;_searchVisible=null;
    selectNode(n,true);
  };
  input.addEventListener('input',renderResults);
  input.addEventListener('focus',()=>{if(input.value.trim()) results.classList.add('open');});
  input.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();if(!current.length) return;
      activeIndex=(activeIndex+(e.key==='ArrowDown'?1:-1)+current.length)%current.length;
      results.querySelectorAll('.search-result').forEach((el,i)=>el.classList.toggle('active',i===activeIndex));
    }else if(e.key==='Enter'&&current.length){e.preventDefault();choose(current[Math.max(activeIndex,0)]);}
    else if(e.key==='Escape'){input.value='';renderResults();input.blur();}
  });
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.search')) results.classList.remove('open');});
}

function searchScore(n,q){
  const name=(n.name||'').toLowerCase(),alt=(n.name_alt||'').toLowerCase();
  if(name===q||alt===q) return 100;
  if(name.startsWith(q)||alt.startsWith(q)) return 70;
  if(name.includes(q)||alt.includes(q)) return 50;
  const field=(n.field||'').toLowerCase(),lead=(n.lead||'').toLowerCase(),years=(n.years||'').toLowerCase();
  if(field.includes(q)||years.includes(q)) return 25;
  if(lead.includes(q)||(n.related_keys||[]).join(' ').toLowerCase().includes(q)) return 10;
  return 0;
}

function setupLegend(){
  document.querySelectorAll('.legend .row').forEach(row=>{
    row.addEventListener('click',()=>{
      const cat=row.dataset.cat;
      if(_disabledCategories.has(cat)) _disabledCategories.delete(cat); else _disabledCategories.add(cat);
      row.classList.toggle('off',_disabledCategories.has(cat));
      updateVisualState();
    });
  });
  const counts={};_nodes.forEach(n=>counts[n.cat]=(counts[n.cat]||0)+1);
  Object.entries(counts).forEach(([cat,count])=>{const el=document.getElementById('cnt-'+cat);if(el) el.textContent=count;});
  document.getElementById('legend-reset').addEventListener('click',()=>{
    _disabledCategories.clear();document.querySelectorAll('.legend .row').forEach(row=>row.classList.remove('off'));updateVisualState();
  });
}

function setupUi(){
  const about=document.getElementById('about');
  document.getElementById('btn-about').addEventListener('click',()=>about.style.display=about.style.display==='none'?'block':'none');
  document.getElementById('about-close').addEventListener('click',()=>about.style.display='none');
  document.getElementById('drawer-close').addEventListener('click',()=>clearSelection(true));
  document.getElementById('btn-reset').addEventListener('click',resetView);
  document.getElementById('zoom-in').addEventListener('click',()=>zoomAt(1.22));
  document.getElementById('zoom-out').addEventListener('click',()=>zoomAt(.82));
  document.getElementById('zoom-fit').addEventListener('click',()=>fitToView(true));
  document.querySelectorAll('.font-controls button').forEach(button=>button.addEventListener('click',()=>{
    const scale=parseFloat(button.dataset.fs);
    document.querySelectorAll('#d-body .section p,#d-body .lead').forEach(el=>{
      const base=el.classList.contains('lead')?16:15;el.style.fontSize=scale===1?'':base*scale+'px';
    });
  }));
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      if(document.activeElement===document.getElementById('search')) return;
      about.style.display='none';clearSelection(true);
    }
    if(e.key==='/'&&document.activeElement.tagName!=='INPUT'){e.preventDefault();document.getElementById('search').focus();}
    if((e.key==='f'||e.key==='0')&&document.activeElement.tagName!=='INPUT') fitToView(true);
  });
}

function resetView(){
  document.getElementById('search').value='';document.getElementById('search-results').classList.remove('open');
  _searchHits=null;_searchVisible=null;_disabledCategories.clear();
  document.querySelectorAll('.legend .row').forEach(row=>row.classList.remove('off'));
  clearSelection(true);fitToView(true);
}

window.addEventListener('DOMContentLoaded',()=>{
  if(!window.NODES?.length){
    document.getElementById('loading').innerHTML='<div class="loading-inner"><div class="loading-title">数据载入失败</div></div>';return;
  }
  init();setupSearch();setupLegend();setupUi();
});

})();
