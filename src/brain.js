// input: 用户输入、API 响应
// output: 大脑界面交互、知识图谱渲染
// position: 大脑前端模块

// 状态
const brainState = {
  fragments: [],
  tags: [],
  selectedTag: null,
  selectedFragment: null,
  graphView: {
    scale: 1,
    x: 0,
    y: 0,
    dragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0
  }
};

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
  initBrain();
});

function initBrain() {
  // 返回按钮
  const btnBrainBack = $('#btn-brain-back');
  if (btnBrainBack) {
    btnBrainBack.addEventListener('click', () => {
      switchView('input');
    });
  }
  
  // 大脑按钮
  const btnBrain = $('#btn-brain');
  if (btnBrain) {
    btnBrain.addEventListener('click', () => {
      switchView('brain');
      loadBrainData();
    });
  }
  
  // 教按钮
  const btnTeach = $('#btn-teach');
  if (btnTeach) {
    btnTeach.addEventListener('click', teachFragment);
  }
  
  // 输入框回车
  const brainInput = $('#brain-input');
  if (brainInput) {
    brainInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        teachFragment();
      }
    });
  }
  
  // 关闭详情面板
  const btnClosePanel = $('#btn-close-panel');
  if (btnClosePanel) {
    btnClosePanel.addEventListener('click', () => {
      $('#fragment-panel').classList.add('hidden');
    });
  }
  
  // 删除碎片
  const btnDelete = $('#btn-delete-fragment');
  if (btnDelete) {
    btnDelete.addEventListener('click', deleteFragment);
  }

  initGraphControls();
}

function initGraphControls() {
  const svg = document.getElementById('graph-svg');
  if (!svg || svg.dataset.controlsBound === 'true') return;

  svg.dataset.controlsBound = 'true';

  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    zoomGraphAt(event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.12 : 0.89);
  }, { passive: false });

  svg.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.graph-node')) return;

    brainState.graphView.dragging = true;
    brainState.graphView.pointerId = event.pointerId;
    brainState.graphView.lastX = event.clientX;
    brainState.graphView.lastY = event.clientY;
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('graph-dragging');
  });

  svg.addEventListener('pointermove', (event) => {
    const view = brainState.graphView;
    if (!view.dragging || view.pointerId !== event.pointerId) return;

    view.x += event.clientX - view.lastX;
    view.y += event.clientY - view.lastY;
    view.lastX = event.clientX;
    view.lastY = event.clientY;
    applyGraphTransform();
  });

  const stopDragging = (event) => {
    const view = brainState.graphView;
    if (!view.dragging || view.pointerId !== event.pointerId) return;

    view.dragging = false;
    view.pointerId = null;
    svg.classList.remove('graph-dragging');
    if (svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
  };

  svg.addEventListener('pointerup', stopDragging);
  svg.addEventListener('pointercancel', stopDragging);
  svg.addEventListener('dblclick', (event) => {
    if (!event.target.closest('.graph-node')) resetGraphView();
  });

  document.getElementById('btn-graph-zoom-in')?.addEventListener('click', () => {
    zoomGraphAt(svg.clientWidth / 2, svg.clientHeight / 2, 1.2);
  });
  document.getElementById('btn-graph-zoom-out')?.addEventListener('click', () => {
    zoomGraphAt(svg.clientWidth / 2, svg.clientHeight / 2, 1 / 1.2);
  });
  document.getElementById('btn-graph-fit')?.addEventListener('click', resetGraphView);
}

function zoomGraphAt(pointX, pointY, factor) {
  const view = brainState.graphView;
  const nextScale = Math.min(3, Math.max(0.35, view.scale * factor));
  const ratio = nextScale / view.scale;

  view.x = pointX - (pointX - view.x) * ratio;
  view.y = pointY - (pointY - view.y) * ratio;
  view.scale = nextScale;
  applyGraphTransform();
}

function resetGraphView() {
  Object.assign(brainState.graphView, {
    scale: 1,
    x: 0,
    y: 0,
    dragging: false,
    pointerId: null
  });
  document.getElementById('graph-svg')?.classList.remove('graph-dragging');
  applyGraphTransform();
}

function applyGraphTransform() {
  const view = brainState.graphView;
  const viewport = document.getElementById('graph-viewport');
  if (viewport) {
    viewport.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.scale})`);
  }

  const zoomLevel = document.getElementById('graph-zoom-level');
  if (zoomLevel) zoomLevel.textContent = `${Math.round(view.scale * 100)}%`;
  document.querySelector('.flipbook-card')?.remove();
}

// ========== 数据加载 ==========
async function loadBrainData() {
  try {
    // 并行加载
    const [fragmentsRes, tagsRes, statsRes] = await Promise.all([
      fetch(`${API_BASE}/brain/fragments`).then(r => r.json()),
      fetch(`${API_BASE}/brain/tags`).then(r => r.json()),
      fetch(`${API_BASE}/brain/stats`).then(r => r.json())
    ]);
    
    if (fragmentsRes.success) {
      brainState.fragments = fragmentsRes.fragments;
    }
    
    if (tagsRes.success) {
      brainState.tags = tagsRes.tags;
    }
    
    // 更新界面
    updateStats(statsRes.stats);
    renderTags();
    renderGraph();
    
  } catch (error) {
    console.error('加载大脑数据失败:', error);
  }
}

// ========== 教知识（智能拆碎片） ==========
async function teachFragment() {
  const input = $('#brain-input');
  if (!input) return;
  
  const content = input.value.trim();
  if (!content) return;
  
  // 立即显示用户消息
  addChatMessage('user', content);
  input.value = '';
  
  // 显示思考状态
  const thinkingId = addChatMessage('system', '正在提取记忆点...');
  
  try {
    const response = await fetch(`${API_BASE}/brain/fragments/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: content })
    });
    
    const data = await response.json();
    
    // 移除思考状态
    if (thinkingId) thinkingId.remove();
    
    if (data.success && data.fragments.length > 0) {
      // 展示提取的碎片
      const fragList = data.fragments.map((f, i) => 
        `${i + 1}. ${f.content}`
      ).join('\n\n');
      
      addChatMessage('system', `提取了 ${data.count} 个记忆点：\n\n${fragList}`);
      
      // 重新加载数据
      await loadBrainData();
      
      // 自动整合记忆
      autoDream();
    } else {
      addChatMessage('system', '没有提取到有效的记忆点，换个说法试试？');
    }
  } catch (error) {
    console.error('提取碎片失败:', error);
    if (thinkingId) thinkingId.remove();
    addChatMessage('system', '提取失败，请重试');
  }
}

// ========== 提取标签 ==========
function extractTags(text) {
  const tags = new Set();
  
  // 提取 #标签
  const hashTags = text.match(/#(\S+)/g) || [];
  hashTags.forEach(t => tags.add(t.substring(1)));
  
  // 自动提取关键词
  const keywords = ['账号', '密码', '权限', 'SSO', '登录', '管理员', '测试', '环境', '系统'];
  keywords.forEach(k => {
    if (text.includes(k)) {
      tags.add(k);
    }
  });
  
  return [...tags];
}

// ========== 添加聊天消息 ==========
function addChatMessage(role, content) {
  const chat = $('#brain-chat');
  if (!chat) return;
  
  const isUser = role === 'user';
  const div = document.createElement('div');
  div.className = `chat-message flex gap-3 ${isUser ? 'justify-end' : ''}`;
  
  // 系统消息支持换行
  const formattedContent = isUser ? escapeHtml(content) : escapeHtml(content).replace(/\n/g, '<br>');
  
  div.innerHTML = isUser ? `
    <div class="chat-user p-4 max-w-xs">
      <p class="text-sm">${formattedContent}</p>
    </div>
  ` : `
    <div class="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
      <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"/>
      </svg>
    </div>
    <div class="chat-system p-4 max-w-sm">
      <p class="text-sm text-gray-600 leading-relaxed">${formattedContent}</p>
    </div>
  `;
  
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

// ========== 渲染标签 ==========
function renderTags() {
  const container = $('#brain-tags');
  if (!container) return;
  
  // “全部”按钮 + 各标签
  const allActive = !brainState.selectedTag;
  let html = `<button class="tag-filter px-2.5 py-1 text-xs rounded-md ${allActive ? 'active' : ''}" data-tag="__all__">全部</button>`;
  
  html += brainState.tags.slice(0, 8).map(tag => `
    <button 
      class="tag-filter px-2.5 py-1 text-xs rounded-md ${
        brainState.selectedTag === tag.tag ? 'active' : ''
      }"
      data-tag="${tag.tag}"
    >
      ${tag.tag} (${tag.count})
    </button>
  `).join('');
  
  container.innerHTML = html;
  
  // 绑定点击事件
  $$('.tag-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      brainState.selectedTag = tag === '__all__' ? null : (brainState.selectedTag === tag ? null : tag);
      resetGraphView();
      renderTags();
      renderGraph();
    });
  });
}

// ========== 渲染知识图谱 ==========
function renderGraph() {
  const svg = document.getElementById('graph-svg');
  if (!svg) return;
  
  // 清空
  svg.innerHTML = '';
  
  // 获取容器尺寸
  const rect = svg.getBoundingClientRect();
  const width = rect.width || 800;
  const height = rect.height || 600;
  
  // 筛选碎片
  let fragments = brainState.fragments;
  if (brainState.selectedTag) {
    fragments = fragments.filter(f => f.tags.includes(brainState.selectedTag));
  }
  
  if (fragments.length === 0) {
    svg.innerHTML = `
      <text x="${width/2}" y="${height/2}" text-anchor="middle" fill="#9ca3af" font-size="14">
        暂无知识碎片
      </text>
    `;
    return;
  }
  
  // 有机布局（带抖动的力导向）
  const nodes = calculateNodePositions(fragments, width, height);
  
  // 定义 SVG 滤镜（发光效果）
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  `;
  svg.appendChild(defs);

  const viewport = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  viewport.id = 'graph-viewport';
  svg.appendChild(viewport);
  
  // 绘制连线（流动虚线）
  const linesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  nodes.forEach(node => {
    node.connections.forEach((connId, ci) => {
      const target = nodes.find(n => n.id === connId);
      if (!target) return;
      
      // 贝塞尔曲线（有机感）
      const midX = (node.x + target.x) / 2;
      const midY = (node.y + target.y) / 2;
      const dx = target.x - node.x;
      const dy = target.y - node.y;
      // 控制点偏移，让曲线有弧度
      const offset = (ci % 2 === 0 ? 1 : -1) * Math.min(30, Math.sqrt(dx*dx+dy*dy) * 0.15);
      const cpX = midX - dy * 0.1 + offset;
      const cpY = midY + dx * 0.1;
      
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${node.x} ${node.y} Q ${cpX} ${cpY} ${target.x} ${target.y}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', node.color);
      path.setAttribute('stroke-width', '1.8');
      path.setAttribute('stroke-opacity', '0.58');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('class', 'graph-line');
      linesGroup.appendChild(path);
    });
  });
  viewport.appendChild(linesGroup);

  // 标注业务分组，避免只能通过颜色猜测节点含义。
  const clusterLabelsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const clusterNames = [...new Set(nodes.map(node => node.cluster))];
  clusterNames.forEach(clusterName => {
    const clusterNodes = nodes.filter(node => node.cluster === clusterName);
    const minX = Math.min(...clusterNodes.map(node => node.x - node.radius));
    const maxX = Math.max(...clusterNodes.map(node => node.x + node.radius));
    const minY = Math.min(...clusterNodes.map(node => node.y - node.radius));
    const title = `${clusterName} (${clusterNodes.length})`;
    const titleWidth = Math.max(54, title.length * 12);
    const titleX = (minX + maxX) / 2;
    const titleY = Math.max(22, minY - 16);

    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('x', titleX - titleWidth / 2);
    background.setAttribute('y', titleY - 15);
    background.setAttribute('width', titleWidth);
    background.setAttribute('height', '22');
    background.setAttribute('rx', '11');
    background.setAttribute('fill', 'rgba(255,255,255,0.82)');
    background.setAttribute('stroke', clusterNodes[0].color);
    background.setAttribute('stroke-opacity', '0.22');
    clusterLabelsGroup.appendChild(background);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', titleX);
    text.setAttribute('y', titleY);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', '#57534e');
    text.setAttribute('font-size', '11');
    text.setAttribute('font-weight', '600');
    text.textContent = title;
    clusterLabelsGroup.appendChild(text);
  });
  viewport.appendChild(clusterLabelsGroup);
  
  // 绘制节点
  const nodesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  nodes.forEach((node, ni) => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'graph-node');
    g.setAttribute('data-id', node.id);
    g.style.cursor = 'pointer';
    
    // 外层光晕（呼吸）
    const glow = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    glow.setAttribute('cx', node.x);
    glow.setAttribute('cy', node.y);
    glow.setAttribute('r', node.radius + 4);
    glow.setAttribute('fill', node.color);
    glow.setAttribute('opacity', '0.15');
    glow.setAttribute('class', 'graph-node-pulse');
    glow.style.animationDelay = `${ni * 0.3}s`;
    g.appendChild(glow);
    
    // 主圆圈
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', node.x);
    circle.setAttribute('cy', node.y);
    circle.setAttribute('r', node.radius);
    circle.setAttribute('fill', node.color);
    circle.setAttribute('stroke', '#fff');
    circle.setAttribute('stroke-width', '2');
    circle.setAttribute('filter', 'url(#glow)');
    g.appendChild(circle);
    
    // 透明热区
    const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hitArea.setAttribute('cx', node.x);
    hitArea.setAttribute('cy', node.y);
    hitArea.setAttribute('r', node.radius + 8);
    hitArea.setAttribute('fill', 'transparent');
    g.appendChild(hitArea);
    
    // hover
    g.addEventListener('mouseenter', () => {
      circle.setAttribute('r', node.radius + 2);
      circle.setAttribute('stroke-width', '3');
      glow.setAttribute('opacity', '0.35');
      tooltipBg.style.opacity = '1';
      tooltipText.style.opacity = '1';
    });
    g.addEventListener('mouseleave', () => {
      circle.setAttribute('r', node.radius);
      circle.setAttribute('stroke-width', '2');
      glow.setAttribute('opacity', '0.15');
      tooltipBg.style.opacity = '0';
      tooltipText.style.opacity = '0';
    });
    
    // 标签小字
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', node.x);
    label.setAttribute('y', node.y + node.radius + 14);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', '#a1a1aa');
    label.setAttribute('font-size', '10');
    label.textContent = fragments.length <= 24 ? node.cluster : '';
    g.appendChild(label);
    
    // 悬浮提示背景
    const tooltipBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const tooltipY = node.y - node.radius - 30;
    tooltipBg.setAttribute('x', node.x - 100);
    tooltipBg.setAttribute('y', tooltipY - 10);
    tooltipBg.setAttribute('width', '200');
    tooltipBg.setAttribute('height', '24');
    tooltipBg.setAttribute('rx', '6');
    tooltipBg.setAttribute('fill', 'rgba(24,24,27,0.85)');
    tooltipBg.style.opacity = '0';
    tooltipBg.style.transition = 'opacity 0.15s';
    g.appendChild(tooltipBg);
    
    // 悬浮提示文字
    const tooltipText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tooltipText.setAttribute('x', node.x);
    tooltipText.setAttribute('y', tooltipY + 5);
    tooltipText.setAttribute('text-anchor', 'middle');
    tooltipText.setAttribute('fill', '#e4e4e7');
    tooltipText.setAttribute('font-size', '11');
    tooltipText.style.opacity = '0';
    tooltipText.style.transition = 'opacity 0.15s';
    tooltipText.textContent = node.fullLabel.length > 25 ? node.fullLabel.substring(0, 25) + '...' : node.fullLabel;
    g.appendChild(tooltipText);
    
    g.addEventListener('click', () => showFragmentDetail(node.id));
    nodesGroup.appendChild(g);
  });
  viewport.appendChild(nodesGroup);
  
  // 流动粒子层（知识碎片在流动的感觉）
  const particleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const particleColors = ['#c4b5fd', '#93c5fd', '#a7f3d0', '#fcd34d', '#fca5a5'];
  for (let i = 0; i < 20; i++) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const px = width * 0.1 + Math.random() * width * 0.8;
    const py = height * 0.1 + Math.random() * height * 0.8;
    p.setAttribute('cx', px);
    p.setAttribute('cy', py);
    p.setAttribute('r', 1.5 + Math.random() * 2);
    p.setAttribute('fill', particleColors[i % particleColors.length]);
    p.setAttribute('opacity', '0');
    p.setAttribute('class', 'graph-particle');
    p.style.animationDelay = `${Math.random() * 8}s`;
    p.style.animationDuration = `${6 + Math.random() * 6}s`;
    particleGroup.appendChild(p);
  }
  viewport.insertBefore(particleGroup, viewport.firstChild);
  applyGraphTransform();
}

// ========== 计算节点位置（业务分组 + 碰撞布局） ==========
function calculateNodePositions(fragments, width, height) {
  const genericTags = new Set(['历史用例', '测试用例', 'P0', 'P1', 'P2', 'P3']);
  const getClusterKey = (fragment) => {
    const tags = Array.isArray(fragment.tags) ? fragment.tags : [];
    return tags.find(tag => tag && !genericTags.has(tag)) || '其他';
  };

  // 通用标签不代表业务模块，优先使用模块名分组。
  const clusters = {};
  fragments.forEach(fragment => {
    const key = getClusterKey(fragment);
    if (!clusters[key]) clusters[key] = [];
    clusters[key].push(fragment);
  });

  const clusterKeys = Object.keys(clusters).sort((a, b) => clusters[b].length - clusters[a].length);
  const aspect = Math.max(1, width / Math.max(height, 1));
  const columns = Math.max(1, Math.ceil(Math.sqrt(clusterKeys.length * aspect)));
  const rows = Math.max(1, Math.ceil(clusterKeys.length / columns));
  const paddingX = Math.min(80, width * 0.08);
  const paddingY = Math.min(70, height * 0.1);
  const usableWidth = Math.max(100, width - paddingX * 2);
  const usableHeight = Math.max(100, height - paddingY * 2);
  const cellWidth = usableWidth / columns;
  const cellHeight = usableHeight / rows;
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
  const nodes = [];

  clusterKeys.forEach((key, clusterIndex) => {
    const column = clusterIndex % columns;
    const row = Math.floor(clusterIndex / columns);
    const clusterX = paddingX + cellWidth * (column + 0.5);
    const clusterY = paddingY + cellHeight * (row + 0.5);
    const color = colors[clusterIndex % colors.length];

    clusters[key].forEach((fragment, fragmentIndex) => {
      // 黄金角螺旋提供稳定初始位置，避免每次刷新图谱乱跳。
      const angle = fragmentIndex * 2.399963229728653;
      const localRadius = 18 * Math.sqrt(fragmentIndex);
      const tags = Array.isArray(fragment.tags) ? fragment.tags : [];
      const content = fragment.content || '';
      const nodeRadius = Math.max(7, Math.min(14, 7 + tags.length * 0.8 + content.length * 0.025));

      nodes.push({
        id: fragment.id,
        x: clusterX + localRadius * Math.cos(angle),
        y: clusterY + localRadius * Math.sin(angle),
        radius: nodeRadius,
        label: content.substring(0, 15) + (content.length > 15 ? '...' : ''),
        fullLabel: content,
        tags,
        cluster: key,
        clusterX,
        clusterY,
        color,
        connections: []
      });
    });
  });

  // 迭代消除节点重叠，同时保留业务分组的聚合关系。
  const margin = 24;
  for (let iteration = 0; iteration < 150; iteration++) {
    nodes.forEach(node => {
      node.x += (node.clusterX - node.x) * 0.004;
      node.y += (node.clusterY - node.y) * 0.004;
    });

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const first = nodes[i];
        const second = nodes[j];
        let dx = second.x - first.x;
        let dy = second.y - first.y;
        let distance = Math.sqrt(dx * dx + dy * dy);
        const minimumDistance = first.radius + second.radius + 12;

        if (distance >= minimumDistance) continue;
        if (distance < 0.01) {
          dx = ((i * 37 + j * 17) % 11) - 5;
          dy = ((i * 19 + j * 29) % 11) - 5;
          distance = Math.sqrt(dx * dx + dy * dy) || 1;
        }

        const push = (minimumDistance - distance) / 2;
        const unitX = dx / distance;
        const unitY = dy / distance;
        first.x -= unitX * push;
        first.y -= unitY * push;
        second.x += unitX * push;
        second.y += unitY * push;
      }
    }

    nodes.forEach(node => {
      node.x = Math.max(margin + node.radius, Math.min(width - margin - node.radius, node.x));
      node.y = Math.max(margin + node.radius, Math.min(height - margin - node.radius, node.y));
    });
  }

  // 每个节点连接最近的同模块节点，并去重，保持关系清晰可见。
  const connectionKeys = new Set();
  nodes.forEach(node => {
    const sameCluster = nodes.filter(other => other.id !== node.id && other.cluster === node.cluster);
    const candidates = sameCluster.length > 0
      ? sameCluster
      : nodes.filter(other => other.id !== node.id);
    const nearest = candidates
      .sort((a, b) => (
        Math.hypot(a.x - node.x, a.y - node.y) -
        Math.hypot(b.x - node.x, b.y - node.y)
      ))
      .slice(0, sameCluster.length > 0 ? 2 : 1);

    nearest.forEach(other => {
      const key = [String(node.id), String(other.id)].sort().join(':');
      if (connectionKeys.has(key)) return;
      connectionKeys.add(key);
      node.connections.push(other.id);
    });
  });

  return nodes;
}

// ========== 显示碎片详情（Flipbook 效果） ==========
function showFragmentDetail(fragmentId) {
  console.log('[Flipbook] 点击节点:', fragmentId);
  const fragment = brainState.fragments.find(f => f.id === fragmentId);
  if (!fragment) {
    console.log('[Flipbook] 未找到碎片:', fragmentId);
    return;
  }
  
  brainState.selectedFragment = fragment;
  
  // 移除已有的展开卡片
  const existing = document.querySelector('.flipbook-card');
  if (existing) existing.remove();
  
  // 找到对应的节点
  const nodeEl = document.querySelector(`.graph-node[data-id="${fragmentId}"]`);
  if (!nodeEl) return;
  
  // 获取节点位置
  const circle = nodeEl.querySelector('circle:nth-child(2)');
  const circleRect = circle.getBoundingClientRect();

  // 使用变换后的实际位置，并限制在视口内，避免卡片上下被截断。
  const pageX = Math.max(190, Math.min(window.innerWidth - 190, circleRect.left + circleRect.width / 2));
  const pageY = Math.max(260, Math.min(window.innerHeight - 260, circleRect.top + circleRect.height / 2));
  
  // 创建 Flipbook 卡片
  const card = document.createElement('div');
  card.className = 'flipbook-card';
  card.style.cssText = `
    position: fixed;
    left: ${pageX}px;
    top: ${pageY}px;
    transform: translate(-50%, -50%) scale(0);
    z-index: 100;
  `;
  
  // 获取节点颜色
  const nodeColor = circle.getAttribute('fill') || '#6366f1';
  
  const tags = Array.isArray(fragment.tags) ? fragment.tags : [];

  card.innerHTML = `
    <div class="flipbook-inner" style="background: white; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.15); width: 340px; max-height: min(520px, calc(100vh - 48px)); overflow: hidden; display: flex; flex-direction: column;">
      <!-- 头部 -->
      <div style="background: ${nodeColor}; padding: 20px; position: relative; flex-shrink: 0;">
        <div style="position: absolute; top: 12px; right: 12px;">
          <button class="flipbook-close" style="background: rgba(255,255,255,0.2); border: none; border-radius: 8px; padding: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; padding-right: 34px; max-height: 58px; overflow-y: auto;">
          ${tags.map(tag => `
            <span style="background: rgba(255,255,255,0.2); color: white; padding: 3px 10px; border-radius: 20px; font-size: 11px; flex-shrink: 0;">${escapeHtml(tag)}</span>
          `).join('') || '<span style="color: rgba(255,255,255,0.75); font-size: 11px;">暂无标签</span>'}
        </div>
        <div style="border-top: 1px solid rgba(255,255,255,0.24); padding-top: 12px;">
          <div style="font-size: 11px; color: rgba(255,255,255,0.72); margin-bottom: 8px;">内容</div>
          <div style="max-height: 190px; overflow-y: auto; padding: 10px 8px 10px 10px; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.14); border-radius: 12px;">
            <p style="color: white; font-size: 15px; line-height: 1.6; margin: 0; font-weight: 500; white-space: pre-wrap; word-break: break-word;">${escapeHtml(fragment.content)}</p>
          </div>
        </div>
      </div>
      
      <!-- 详情 -->
      <div style="padding: 12px 18px; overflow-y: auto; flex: 1; min-height: 0;">
        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
          <div style="flex: 1; background: #f9f9f9; border-radius: 10px; padding: 12px; text-align: center;">
            <div style="font-size: 20px; font-weight: 600; color: #333;">${fragment.usage_count || 0}</div>
            <div style="font-size: 11px; color: #999; margin-top: 4px;">使用次数</div>
          </div>
          <div style="flex: 1; background: #f9f9f9; border-radius: 10px; padding: 12px; text-align: center;">
            <div style="font-size: 20px; font-weight: 600; color: #333;">${tags.length}</div>
            <div style="font-size: 11px; color: #999; margin-top: 4px;">标签数</div>
          </div>
        </div>
        
        <div style="background: #f9f9f9; border-radius: 10px; padding: 10px; margin-bottom: 12px;">
          <div style="font-size: 11px; color: #999; margin-bottom: 4px;">来源</div>
          <div style="font-size: 13px; color: #666; word-break: break-word;">${escapeHtml(fragment.source || '手动输入')}</div>
        </div>
        
        <div style="display: flex; gap: 8px;">
          <button class="flipbook-copy" style="flex: 1; background: #f3f4f6; border: none; border-radius: 10px; padding: 10px; cursor: pointer; font-size: 13px; color: #666; transition: all 0.2s;">
            复制
          </button>
          <button class="flipbook-delete" style="flex: 1; background: #fef2f2; border: none; border-radius: 10px; padding: 10px; cursor: pointer; font-size: 13px; color: #ef4444; transition: all 0.2s;">
            删除
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(card);
  
  // 动画展开
  requestAnimationFrame(() => {
    card.style.transition = 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    card.style.transform = 'translate(-50%, -50%) scale(1)';
  });
  
  // 事件绑定
  card.querySelector('.flipbook-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeFlipbookCard(card);
  });
  
  card.querySelector('.flipbook-copy').addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(fragment.content);
    const btn = e.target;
    btn.textContent = '已复制';
    btn.style.background = '#d1fae5';
    btn.style.color = '#059669';
    setTimeout(() => {
      btn.textContent = '复制';
      btn.style.background = '#f3f4f6';
      btn.style.color = '#666';
    }, 1500);
  });
  
  card.querySelector('.flipbook-delete').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm('确定删除这条记忆？')) {
      await deleteFragment();
      closeFlipbookCard(card);
    }
  });
  
  // 点击外部关闭
  const closeOnOutside = (e) => {
    if (!card.contains(e.target)) {
      closeFlipbookCard(card);
      document.removeEventListener('click', closeOnOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnOutside), 100);
}

function closeFlipbookCard(card) {
  card.style.transform = 'translate(-50%, -50%) scale(0)';
  card.style.opacity = '0';
  setTimeout(() => card.remove(), 300);
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ========== 删除碎片 ==========
async function deleteFragment() {
  if (!brainState.selectedFragment) return;
  
  const fragment = brainState.selectedFragment;
  const btn = $('#btn-delete-fragment');
  
  try {
    btn.textContent = '删除中...';
    btn.disabled = true;
    
    const response = await fetch(`${API_BASE}/brain/fragments/${fragment.id}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 关闭面板
      $('#fragment-panel').classList.add('hidden');
      brainState.selectedFragment = null;
      
      // 重新加载
      await loadBrainData();
      addChatMessage('system', `已删除：「${fragment.content.substring(0, 20)}...」`);
    }
  } catch (error) {
    console.error('删除失败:', error);
    addChatMessage('system', '删除失败，请重试');
  } finally {
    btn.textContent = '删除这条记忆';
    btn.disabled = false;
  }
}

// ========== 自动整合记忆（无感知） ==========
let _dreamTimer = null;
function autoDream() {
  clearTimeout(_dreamTimer);
  _dreamTimer = setTimeout(async () => {
    try {
      await fetch(`${API_BASE}/brain/dream`, { method: 'POST' });
      await loadBrainData();
    } catch (e) {}
  }, 5000);
}

// ========== 更新统计 ==========
function updateStats(stats) {
  if (!stats) return;
  
  const brainStats = $('#brain-stats');
  if (brainStats) {
    brainStats.textContent = `${stats.active} 个碎片`;
  }
  
  const fragmentCount = $('#fragment-count');
  if (fragmentCount) {
    fragmentCount.textContent = `${stats.active} 个碎片`;
  }
  
  const tagCount = $('#tag-count');
  if (tagCount) {
    tagCount.textContent = `${brainState.tags.length} 个标签`;
  }
}
