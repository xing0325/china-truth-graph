/* graph.js — 活在真实中 · 知识图谱主逻辑
 * 依赖：window.NODES, window.EDGES (data.js)
 *      window.vis (vis-network UMD)
 */
(function(){
'use strict';

// ===== 分类配色 =====
const CAT = {
  'historian':           {name:'历史学者',   color:'#a8884d', stroke:'#6b5530', textC:'#0c0a07'},
  'sinologist':          {name:'海外汉学家', color:'#c4a566', stroke:'#806c3f', textC:'#0c0a07'},
  'inner-party-dissent': {name:'党内反思',   color:'#7d6444', stroke:'#4e3c25', textC:'#e8dfc8'},
  'dissident':           {name:'异见 · 维权', color:'#b8332a', stroke:'#7a1f18', textC:'#e8dfc8'},
  'writer':              {name:'作家 · 文学', color:'#c25a3a', stroke:'#7e3520', textC:'#e8dfc8'},
  'journalist':          {name:'调查记者',   color:'#d39a4d', stroke:'#8a6128', textC:'#0c0a07'},
  'educator':            {name:'独立教育',   color:'#9eb07e', stroke:'#5e6e44', textC:'#0c0a07'},
  'thinker-foreign':     {name:'外国思想资源',color:'#5d7867', stroke:'#374a3c', textC:'#e8dfc8'},
  'thinker-republic':    {name:'民国思想资源',color:'#7a6f60', stroke:'#473f34', textC:'#e8dfc8'},
  'book':                {name:'著作',       color:'#e8dfc8', stroke:'#a8884d', textC:'#0c0a07'},
  'event':               {name:'历史事件',   color:'#6e1f1c', stroke:'#3d0f0d', textC:'#e8dfc8'},
  'concept':             {name:'核心概念',   color:'#3b5a4a', stroke:'#1f3328', textC:'#e8dfc8'},
  'platform':            {name:'出版 · 平台', color:'#5a4738', stroke:'#352920', textC:'#e8dfc8'},
};

// 节点大小映射
const SIZE = {
  // 人物：根据"中心度"
  person_major: 30,    // 高华、刘晓波、毛泽东等关键人
  person_normal: 22,
  person_minor: 17,
  book_major: 26,
  book_normal: 20,
  event_major: 24,
  event_minor: 18,
  concept: 18,
  platform: 16,
};

// 高重要性 id 集合（影响节点大小）
const MAJOR = new Set([
  'gao-hua','shen-zhihua','liu-xiaobo','yang-xianhui','yang-jisheng','wei-jingsheng',
  'gao-xingjian','li-rui','zhao-ziyang','yu-yingshi','qin-hui','yang-xiaokai',
  'red-sun','tombstone','charter-08','my-no-enemy','soul-mountain','private-life-mao',
  'lingshan','jiang-shang-de-muqin','xiangguan-hechu','historical-trumpets','zou-chu-dizhi',
  'cultural-revolution','great-leap-famine','anti-rightist','tiananmen-1989','yanan-rectification',
  'living-in-truth','totalitarianism','party-state','havel','arendt','orwell',
]);

function nodeSize(n){
  if(n.size_override) return n.size_override;
  if(n.category==='book') return MAJOR.has(n.id)?SIZE.book_major:SIZE.book_normal;
  if(n.category==='event') return MAJOR.has(n.id)?SIZE.event_major:SIZE.event_minor;
  if(n.category==='concept') return SIZE.concept;
  if(n.category==='platform') return SIZE.platform;
  // 人物
  if(MAJOR.has(n.id)) return SIZE.person_major;
  return SIZE.person_normal;
}

function nodeShape(cat){
  if(cat==='book') return 'box';
  if(cat==='event') return 'diamond';
  if(cat==='concept') return 'hexagon';
  if(cat==='platform') return 'triangle';
  return 'dot';
}

function nodeFontSize(n){
  const s = nodeSize(n);
  if(s>=28) return 17;
  if(s>=22) return 14;
  if(s>=18) return 13;
  return 12;
}
// label 离节点更近：dot 形状用小 vadjust，其他形状（box/diamond）label 在内部用 0
function nodeVadjust(n, sz){
  if(n.category==='book' || n.category==='event' || n.category==='concept' || n.category==='platform') return 0;
  // dot 节点：默认 vis 会自动放在节点下方，给一点空隙就好（之前是 sz+8 太远）
  return Math.round(sz * 0.55);
}

// ===== 构造 vis 节点/边 =====
function buildVisData(){
  const N = (window.NODES||[]).map(n=>{
    const c = CAT[n.category] || CAT['concept'];
    const sz = nodeSize(n);
    const label = (n.category==='book') ? `《${stripBookBrackets(n.name)}》` : n.name;
    return {
      id: n.id,
      label,
      title: n.lead ? stripHtml(n.lead).slice(0,140)+'…' : n.name,
      shape: nodeShape(n.category),
      size: sz,
      color: { background: c.color, border: c.stroke, highlight:{background:lighten(c.color,15), border:c.stroke}, hover:{background:lighten(c.color,10), border:c.stroke} },
      font: {
        color: c.textC, size: nodeFontSize(n),
        face: 'Noto Serif SC, Songti SC, serif',
        strokeWidth: c.textC==='#0c0a07' ? 0 : 3,
        strokeColor: c.textC==='#0c0a07' ? '#0c0a07' : 'rgba(12,10,7,.6)',
        vadjust: nodeVadjust(n, sz),
      },
      borderWidth: 1.2,
      borderWidthSelected: 3,
      _raw: n,
      _cat: n.category,
    };
  });
  const E = (window.EDGES||[]).map((e,i)=>({
    id: 'e'+i,
    from: e.from, to: e.to,
    // 不在画布上画边标签（性能 + 视觉清洁），原始关系词存到 title 供 hover/click 取
    label: undefined,
    title: e.label || '',
    color: { color: 'rgba(168,136,77,.22)', highlight:'#e0c285', hover:'#c4a566', inherit:false },
    width: e.weight || 0.6,
    selectionWidth: 1.4,
    hoverWidth: 0.8,
    smooth: false, // 直线，省 CPU（Obsidian 同款）
    arrows: e.directed ? { to: { enabled:true, scaleFactor:0.35, type:'arrow' } } : undefined,
    dashes: e.style==='dash' ? [4,4] : false,
    _label: e.label || '关联', // 自定义字段，点击边时取来显示
  }));
  return { nodes:new vis.DataSet(N), edges:new vis.DataSet(E) };
}

function stripBookBrackets(s){return s.replace(/^[《<]|[》>]$/g,'')}
function stripHtml(s){const d=document.createElement('div');d.textContent=s;return d.textContent}
function lighten(hex,pct){
  const h = hex.replace('#','');
  const r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16), b=parseInt(h.slice(4,6),16);
  const lr=Math.min(255,Math.round(r+(255-r)*pct/100));
  const lg=Math.min(255,Math.round(g+(255-g)*pct/100));
  const lb=Math.min(255,Math.round(b+(255-b)*pct/100));
  return '#'+[lr,lg,lb].map(x=>x.toString(16).padStart(2,'0')).join('');
}

// ===== 初始化网络 =====
let network, dataset;
function initNetwork(){
  dataset = buildVisData();
  const container = document.getElementById('graph');
  const options = {
    autoResize:true,
    nodes: {
      borderWidth: 1.2,
      shadow: false, // 关阴影：大性能改善
      scaling: { label: { enabled:false } },
      chosen: true, // 选中态加粗（vis 内置）
    },
    layout: { randomSeed: 42, improvedLayout:false },
    edges: {
      smooth: false, // 直线，省 CPU
      hoverWidth: 0.6,
      selectionWidth: 1.2,
      chosen: true,
    },
    physics: {
      enabled: true,
      solver: 'forceAtlas2Based',
      forceAtlas2Based: {
        gravitationalConstant: -80,
        centralGravity: 0.012,
        springLength: 110,
        springConstant: 0.04,
        damping: 0.7,
        avoidOverlap: 0.5,
      },
      stabilization: { enabled:true, iterations: 120, updateInterval:60, fit:true },
      timestep: 0.5,
      maxVelocity: 28,
      adaptiveTimestep: true,
    },
    interaction: {
      hover: true,
      tooltipDelay: 220,
      hideEdgesOnDrag: true,
      hideEdgesOnZoom: true, // 缩放时隐藏边，再放手时再画 — 不卡的关键
      navigationButtons:false,
      keyboard: false,
      multiselect:false,
      zoomView:true,
      selectConnectedEdges: true, // 选中节点时同时高亮相连的边
    },
  };
  network = new vis.Network(container, dataset, options);
  window._net = network; // 暴露给 devtools / preview_eval 控制物理

  // 稳定后关闭物理
  network.once('stabilizationIterationsDone', ()=>{
    document.getElementById('loading').classList.add('hide');
    setTimeout(()=>{ network.setOptions({physics:{enabled:false}}); }, 1500);
  });
  // 后备：3 秒后强制关物理（防止永不稳定）
  setTimeout(()=>{
    if(network){ network.setOptions({physics:{enabled:false}}); document.getElementById('loading').classList.add('hide'); }
  }, 5000);

  network.on('click', params=>{
    if(params.nodes && params.nodes.length){
      openNode(params.nodes[0]);
    } else if(params.edges && params.edges.length){
      // 点击边：高亮两端节点 + 显示关系信息
      const eid = params.edges[0];
      const e = dataset.edges.get(eid);
      if(e){
        // 同时选中边和两端节点，让 vis 的高亮机制自动跑
        network.setSelection({nodes:[e.from, e.to], edges:[eid]}, {highlightEdges:true});
        showEdgeInfo(e);
        // 居中到这两个节点
        try { network.fit({nodes:[e.from, e.to], animation:{duration:500, easingFunction:'easeInOutQuad'}}); } catch(_){}
      }
    } else {
      // 点击空白：清除边信息条
      hideEdgeInfo();
    }
  });
  // hover 边时：高亮边自身 + 两端节点，并显示关系信息
  let _hoveredEdge = null;
  network.on('hoverEdge', params=>{
    const e = dataset.edges.get(params.edge);
    if(!e) return;
    if(_hoveredEdge === params.edge) return; // 同一条边，跳过
    // 先清理上一条
    if(_hoveredEdge) clearEdgeHover(_hoveredEdge);
    _hoveredEdge = params.edge;
    // 边变粗变亮
    dataset.edges.update({
      id: params.edge,
      color: { color:'#e0c285', highlight:'#e0c285', hover:'#e0c285', inherit:false },
      width: 2.4,
    });
    // 两端节点边框金色加粗
    const fromNode = dataset.nodes.get(e.from);
    const toNode = dataset.nodes.get(e.to);
    if(fromNode){
      dataset.nodes.update({
        id: e.from,
        borderWidth: 3.5,
        color: { ...fromNode.color, border:'#e0c285' },
      });
    }
    if(toNode){
      dataset.nodes.update({
        id: e.to,
        borderWidth: 3.5,
        color: { ...toNode.color, border:'#e0c285' },
      });
    }
    showEdgeInfo(e, false);
    document.body.style.cursor = 'pointer';
  });
  network.on('blurEdge', params=>{
    if(_hoveredEdge) clearEdgeHover(_hoveredEdge);
    _hoveredEdge = null;
    hideEdgeInfo(true);
    document.body.style.cursor = 'default';
  });

  function clearEdgeHover(edgeId){
    const e = dataset.edges.get(edgeId);
    if(!e) return;
    // 恢复边
    dataset.edges.update({
      id: edgeId,
      color: { color: 'rgba(168,136,77,.22)', highlight:'#e0c285', hover:'#c4a566', inherit:false },
      width: 0.6,
    });
    // 恢复两端节点
    [e.from, e.to].forEach(nid=>{
      const node = dataset.nodes.get(nid);
      if(!node) return;
      const rawN = (window.NODES||[]).find(x=>x.id===nid);
      if(!rawN) return;
      const c = CAT[rawN.category] || CAT['concept'];
      dataset.nodes.update({
        id: nid,
        borderWidth: 1.2,
        color: { background: c.color, border: c.stroke, highlight:{background:lighten(c.color,15), border:c.stroke}, hover:{background:lighten(c.color,10), border:c.stroke} },
      });
    });
  }
  network.on('doubleClick', params=>{
    if(params.nodes && params.nodes.length){
      network.focus(params.nodes[0], { scale:1.4, animation:{duration:600, easingFunction:'easeInOutQuad'} });
    }
  });
  network.on('hoverNode', ()=>{ document.body.style.cursor='pointer'; });
  network.on('blurNode', ()=>{ document.body.style.cursor='default'; });

  updateLegendCounts();
}

// ===== 抽屉：渲染节点详情 =====
function openNode(id){
  const node = (window.NODES||[]).find(n=>n.id===id);
  if(!node) return;
  const c = CAT[node.category] || CAT['concept'];
  const drawer = document.getElementById('drawer');

  document.getElementById('d-tag').textContent = c.name;
  document.getElementById('d-tag').style.color = c.color;

  const nameEl = document.getElementById('d-name');
  const altEl = document.getElementById('d-alt');
  nameEl.firstChild.nodeValue = node.name;
  altEl.textContent = node.name_alt || '';

  document.getElementById('d-years').textContent = node.years || '';
  document.getElementById('d-field').textContent = node.field || '';

  document.getElementById('d-lead').textContent = node.lead || '';

  // sections
  const secWrap = document.getElementById('d-sections');
  secWrap.innerHTML = '';
  (node.sections||[]).forEach(s=>{
    const sec = document.createElement('div');
    sec.className = 'section';
    const h = document.createElement('h3'); h.textContent = s.h;
    const p = document.createElement('p'); p.textContent = s.p;
    sec.appendChild(h); sec.appendChild(p);
    secWrap.appendChild(sec);
  });

  // quote
  const qEl = document.getElementById('d-quote');
  if(node.quote && node.quote.trim()){
    qEl.style.display='block';
    const parts = node.quote.split('——');
    document.getElementById('d-quote-text').textContent = (parts[0]||'').trim();
    document.getElementById('d-quote-src').textContent = parts[1] ? '——'+parts[1].trim() : '';
  } else {
    qEl.style.display='none';
  }

  // related chips
  const chips = document.getElementById('d-chips');
  chips.innerHTML='';
  const related = computeRelated(node);
  related.forEach(r=>{
    const cc = CAT[r.category]||CAT['concept'];
    const el = document.createElement('button');
    el.className = 'chip';
    el.innerHTML = `<span class="chip-dot" style="background:${cc.color}"></span>${r.category==='book'?`《${stripBookBrackets(r.name)}》`:r.name}`;
    el.addEventListener('click', ()=>{ openNode(r.id); network.selectNodes([r.id]); network.focus(r.id,{scale:1.1,animation:{duration:500}}); });
    chips.appendChild(el);
  });

  // reading time
  const allText = (node.lead||'') + (node.sections||[]).map(s=>s.p).join('') + (node.quote||'');
  const wc = allText.length;
  const min = Math.max(1, Math.round(wc/450));
  document.getElementById('d-readtime').textContent = `${wc} 字 · 约 ${min} 分钟`;

  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden','false');
  document.getElementById('d-body').scrollTop = 0;
}

// ===== 边关系信息条 =====
let _edgeInfoTimer = null;
function showEdgeInfo(e, isHover){
  const ribbon = document.querySelector('.ribbon');
  if(!ribbon) return;
  const fromN = (window.NODES||[]).find(n=>n.id===e.from);
  const toN   = (window.NODES||[]).find(n=>n.id===e.to);
  if(!fromN || !toN) return;
  const label = e._label || e.title || '关联';
  const arrow = e.arrows ? '→' : '——';
  const fName = fromN.category==='book' ? `《${fromN.name.replace(/^[《<]|[》>]$/g,'')}》` : fromN.name;
  const tName = toN.category==='book' ? `《${toN.name.replace(/^[《<]|[》>]$/g,'')}》` : toN.name;
  ribbon.innerHTML = `<span style="color:var(--gold-bright)">${fName}</span>　<span style="color:var(--paper-mute)">${arrow}</span>　<span style="color:var(--red-soft);letter-spacing:.18em">${label}</span>　<span style="color:var(--paper-mute)">${arrow}</span>　<span style="color:var(--gold-bright)">${tName}</span>`;
  ribbon.style.opacity = '1';
  clearTimeout(_edgeInfoTimer);
  if(isHover){
    _edgeInfoTimer = setTimeout(hideEdgeInfo, 2400);
  }
}
function hideEdgeInfo(isHover){
  const ribbon = document.querySelector('.ribbon');
  if(!ribbon) return;
  if(isHover){ // hover 结束后稍等再恢复
    clearTimeout(_edgeInfoTimer);
    _edgeInfoTimer = setTimeout(()=>{
      ribbon.innerHTML = '<span class="em">点节点看词条 · 点关系线看连接 · 拖动可移动 · 滚轮缩放</span>';
    }, 800);
  } else {
    ribbon.innerHTML = '<span class="em">点节点看词条 · 点关系线看连接 · 拖动可移动 · 滚轮缩放</span>';
  }
}

// 通过 edges + related_keys 计算相关节点
function computeRelated(node){
  const result = new Map();
  // 1. edges 中相连节点
  (window.EDGES||[]).forEach(e=>{
    if(e.from===node.id){
      const t = (window.NODES||[]).find(n=>n.id===e.to);
      if(t) result.set(t.id, t);
    } else if(e.to===node.id){
      const t = (window.NODES||[]).find(n=>n.id===e.from);
      if(t) result.set(t.id, t);
    }
  });
  // 2. related_keys 模糊匹配
  if(node.related_keys && node.related_keys.length){
    node.related_keys.forEach(k=>{
      if(!k) return;
      const hit = (window.NODES||[]).find(n=> n.id!==node.id && (n.name===k || n.name.includes(k) || (n.name_alt||'').includes(k) || k.includes(n.name)));
      if(hit) result.set(hit.id, hit);
    });
  }
  return Array.from(result.values()).slice(0, 16);
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
    if(!q){
      // 重置
      (window.NODES||[]).forEach(n=>{
        dataset.nodes.update({id:n.id, hidden:false, opacity:1});
      });
      return;
    }
    const hits = new Set();
    (window.NODES||[]).forEach(n=>{
      const hay = [n.name, n.name_alt, n.field, n.lead, n.years, (n.related_keys||[]).join(' ')].join(' ').toLowerCase();
      if(hay.includes(q)) hits.add(n.id);
    });
    (window.NODES||[]).forEach(n=>{
      dataset.nodes.update({id:n.id, hidden: !hits.has(n.id) && !nearMatch(n.id, hits)});
    });
  });
  input.addEventListener('keydown', e=>{
    if(e.key==='Enter'){
      const q = input.value.trim().toLowerCase();
      const hit = (window.NODES||[]).find(n=> n.name.toLowerCase()===q || (n.name_alt||'').toLowerCase()===q);
      if(hit){ openNode(hit.id); network.focus(hit.id,{scale:1.4,animation:{duration:600}}); }
    }
  });
}

function nearMatch(id, hitSet){
  // 显示与命中节点相连的一跳节点（提供上下文）
  for(const eid of hitSet){
    if((window.EDGES||[]).some(e=>(e.from===id && e.to===eid)||(e.to===id && e.from===eid))) return true;
  }
  return false;
}

// ===== 图例分类切换 =====
function setupLegend(){
  document.querySelectorAll('.legend .row').forEach(row=>{
    row.addEventListener('click', ()=>{
      const cat = row.dataset.cat;
      row.classList.toggle('off');
      const off = row.classList.contains('off');
      (window.NODES||[]).filter(n=>n.category===cat).forEach(n=>{
        dataset.nodes.update({id:n.id, hidden: off});
      });
    });
  });
}
function updateLegendCounts(){
  const counts = {};
  (window.NODES||[]).forEach(n=>{ counts[n.category]=(counts[n.category]||0)+1; });
  Object.keys(counts).forEach(c=>{
    const el = document.getElementById('cnt-'+c);
    if(el) el.textContent = counts[c];
  });
}

// ===== About 面板 =====
function setupAbout(){
  document.getElementById('btn-about').addEventListener('click', ()=>{
    const a = document.getElementById('about');
    a.style.display = a.style.display==='none'?'block':'none';
  });
  document.getElementById('about-close').addEventListener('click', ()=>{
    document.getElementById('about').style.display='none';
  });
  // 首次访问自动显示一次
  if(!localStorage.getItem('lzt-seen-about')){
    setTimeout(()=>{ document.getElementById('about').style.display='block'; localStorage.setItem('lzt-seen-about','1'); }, 1800);
  }
}

// ===== 字号控制 =====
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

// ===== 全局快捷键 =====
function setupKeys(){
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape'){ closeDrawer(); document.getElementById('about').style.display='none'; }
    if(e.key==='/' && document.activeElement.tagName!=='INPUT'){
      e.preventDefault(); document.getElementById('search').focus();
    }
  });
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('btn-reset').addEventListener('click', ()=>{
    network.fit({animation:{duration:700, easingFunction:'easeInOutQuad'}});
  });
}

// ===== 启动 =====
window.addEventListener('DOMContentLoaded', ()=>{
  if(!window.NODES || !window.NODES.length){
    document.getElementById('loading').innerHTML = '<div class="loading-inner"><div class="loading-title">数据载入中…</div><div class="loading-sub">data.js 尚未就绪</div></div>';
    return;
  }
  initNetwork();
  setupSearch();
  setupLegend();
  setupAbout();
  setupFontControls();
  setupKeys();
});

})();
