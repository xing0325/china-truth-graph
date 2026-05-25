/* 99-assemble.js — 汇总所有 _N_* 数组为 window.NODES，把 _EDGES 暴露为 window.EDGES。
 * 必须在所有 data/01–10 之后、在 graph.js 之前加载。
 */
(function(){
  const parts = [
    window._N_HIST || [],
    window._N_SINO || [],
    window._N_DISS || [],
    window._N_WRIT || [],
    window._N_JF   || [],
    window._N_BOOK || [],
    window._N_EVT  || [],
    window._N_CONC || [],
    window._N_PLAT || [],
  ];
  const seen = new Set();
  const merged = [];
  parts.forEach(arr=>{
    arr.forEach(n=>{
      if(!n || !n.id) return;
      if(seen.has(n.id)) return; // 去重（顾准等可能重复）
      seen.add(n.id);
      merged.push(n);
    });
  });
  window.NODES = merged;

  // 过滤边：只保留两端都存在的节点的边
  const idset = new Set(merged.map(n=>n.id));
  const validEdges = (window._EDGES||[]).filter(e=>idset.has(e.from) && idset.has(e.to));
  window.EDGES = validEdges;

  // 调试信息（不输出到 UI）
  if(window.console){
    console.log('[活在真实中] NODES:', merged.length, ' EDGES:', validEdges.length,
      ' (dropped edges:', (window._EDGES||[]).length - validEdges.length, ')');
  }
})();
