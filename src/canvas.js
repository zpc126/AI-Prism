// input: 思维导图数据
// output: Canvas 类，节点渲染、交互（支持触控板双指拖拽/捏合缩放、用例操作栏与状态标记）
// position: 画布引擎，负责思维导图的布局和渲染

class Canvas {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.canvasContent = document.getElementById('canvas-content');
    
    // 画布状态
    this.state = {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      isPanning: false,
      panStartX: 0,
      panStartY: 0,
      panReady: false,
      spacePressed: false,
      tree: null,
      nodePositions: new Map(),
      caseStatus: this.loadCaseStatus() // 用例状态：{ nodeId: 'pass' | 'fail' | 'confirmed' | 'unconfirmed' | 'pending' }
    };

    // 配置
    this.config = {
      minScale: 0.1,
      maxScale: 2,
      scaleStep: 0.1,
      nodeGap: 16,      // 同级节点间距
      levelGap: 80,      // 层级间距
      rootWidth: 120,
      rootHeight: 44,
      branchWidth: 140,
      branchHeight: 36,
      leafWidth: 180,
      leafHeight: 32,
      stepWidth: 160,
      stepHeight: 26,
      expectedWidth: 140,
      expectedHeight: 22,
      // 动态宽度：根据文字长度计算，不再截断
      maxWidth: 360,
      textPadding: 24,
      fontSize: { root: 15, branch: 13, leaf: 12, step: 11, expected: 11 }
    };

    // 文字测量 canvas
    this._measureCanvas = document.createElement('canvas');
    this._measureCtx = this._measureCanvas.getContext('2d');

    this.init();
  }

  init() {
    this.bindEvents();
    this.updateTransform();
  }

  bindEvents() {
    // 滚轮事件：触控板双指拖拽平移 + 捏合缩放
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Mac 触控板捏合缩放时 ctrlKey=true
      if (e.ctrlKey) {
        // 缩放
        const delta = e.deltaY > 0 ? -this.config.scaleStep : this.config.scaleStep;
        const newScale = Math.max(this.config.minScale, Math.min(this.config.maxScale, this.state.scale + delta));
        
        const rect = this.container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const ratio = newScale / this.state.scale;
        this.state.offsetX = mouseX - (mouseX - this.state.offsetX) * ratio;
        this.state.offsetY = mouseY - (mouseY - this.state.offsetY) * ratio;
        this.state.scale = newScale;
      } else {
        // 平移（触控板双指拖拽）
        this.state.offsetX -= e.deltaX;
        this.state.offsetY -= e.deltaY;
      }
      
      this.updateTransform();
    }, { passive: false });

    // 鼠标按下 - 记录起始位置，但不立即开始拖拽
    this.container.addEventListener('mousedown', (e) => {
      // 点击节点时不拖动
      if (e.target.closest('.mind-node')) return;
      // 只响应左键
      if (e.button !== 0) return;
      
      this.state.panStartX = e.clientX;
      this.state.panStartY = e.clientY;
      this.state.panReady = true;
      this.state.isPanning = false;
    });

    // 鼠标移动 - 超过阈值才开始拖拽
    document.addEventListener('mousemove', (e) => {
      if (this.state.panReady && !this.state.isPanning) {
        const dx = e.clientX - this.state.panStartX;
        const dy = e.clientY - this.state.panStartY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          this.state.isPanning = true;
          this.state.panStartX = e.clientX - this.state.offsetX;
          this.state.panStartY = e.clientY - this.state.offsetY;
          this.container.style.cursor = 'grabbing';
        }
        return;
      }
      
      if (!this.state.isPanning) return;
      this.state.offsetX = e.clientX - this.state.panStartX;
      this.state.offsetY = e.clientY - this.state.panStartY;
      this.updateTransform();
    });

    // 鼠标释放
    document.addEventListener('mouseup', () => {
      this.state.isPanning = false;
      this.state.panReady = false;
      this.container.style.cursor = this.state.spacePressed ? 'grab' : 'default';
    });

    // 空格键
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.target.matches('input, textarea')) {
        e.preventDefault();
        this.state.spacePressed = true;
        this.container.style.cursor = 'grab';
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.state.spacePressed = false;
        this.container.style.cursor = 'default';
      }
    });
  }

  updateTransform() {
    if (this.canvasContent) {
      this.canvasContent.style.transform = `translate(${this.state.offsetX}px, ${this.state.offsetY}px) scale(${this.state.scale})`;
      this.canvasContent.style.transformOrigin = '0 0';
      
      // 更新缩放百分比显示
      this.updateZoomDisplay();
    }
  }
  
  updateZoomDisplay() {
    const zoomEl = document.getElementById('zoom-level');
    if (zoomEl) {
      zoomEl.textContent = `${Math.round(this.state.scale * 100)}%`;
    }
  }
  
  updateCaseCount() {
    const caseCountEl = document.getElementById('case-count');
    if (caseCountEl && this.state.nodePositions) {
      const stats = this.getCaseStats();
      if (stats.total > 0) {
        let text = `${stats.total} 条用例`;
        if (stats.passed > 0 || stats.failed > 0) {
          text += ` · ✓${stats.passed} ✗${stats.failed}`;
        }
        caseCountEl.textContent = text;
      }
    }
  }

  // 设置思维导图
  setMindMap(rootNode) {
    this.state.tree = rootNode;
    this.state.nodePositions.clear();
    
    // 设置深度
    this.setDepth(rootNode, 0);
    
    // 计算每个节点需要的高度
    const heights = this.calculateHeights(rootNode);
    
    // 计算每个节点的位置
    this.calculatePositions(rootNode, 80, 0, heights);
    
    // 渲染
    this.renderAll();
    
    // 适配视图
    setTimeout(() => this.fitToView(), 150);
  }

  // 计算每个节点及其子树需要的总高度
  calculateHeights(rootNode) {
    const heights = new Map();
    
    const calc = (n) => {
      if (!n.children || n.children.length === 0) {
        const h = this.getNodeHeight(n);
        heights.set(n.id, h);
        return h;
      }
      
      let total = 0;
      n.children.forEach((child, i) => {
        total += calc(child);
        if (i < n.children.length - 1) total += this.config.nodeGap;
      });
      
      const nodeH = this.getNodeHeight(n);
      const h = Math.max(nodeH, total);
      heights.set(n.id, h);
      return h;
    };
    
    calc(rootNode);
    return heights;
  }

  // 计算每个节点的位置
  calculatePositions(node, x, centerY, heights) {
    const width = this.getNodeWidth(node);
    const height = this.getNodeHeight(node);
    
    this.state.nodePositions.set(node.id, {
      x, y: centerY, width, height, depth: node._depth || 0
    });
    
    if (!node.children || node.children.length === 0) return;
    
    const childX = x + width + this.config.levelGap;
    const subtreeH = heights.get(node.id) || 0;
    
    let childY = centerY - subtreeH / 2;
    
    node.children.forEach(child => {
      const childH = heights.get(child.id) || 0;
      this.calculatePositions(child, childX, childY + childH / 2, heights);
      childY += childH + this.config.nodeGap;
    });
  }

  // 测量文字宽度
  measureTextWidth(text, fontSize) {
    if (!text) return 0;
    this._measureCtx.font = `${fontSize}px -apple-system, "SF Pro Text", sans-serif`;
    return this._measureCtx.measureText(text).width;
  }

  getNodeWidth(node) {
    const depth = node._depth || 0;
    const title = node.title || '';
    const baseWidth = depth === 0 ? this.config.rootWidth
      : depth === 1 ? this.config.branchWidth
      : depth === 2 ? this.config.leafWidth
      : node.type === 'expected' ? this.config.expectedWidth
      : this.config.stepWidth;
    
    // 测量文字实际宽度
    let fontSize;
    if (depth === 0) fontSize = this.config.fontSize.root;
    else if (depth === 1) fontSize = this.config.fontSize.branch;
    else if (depth === 2) fontSize = this.config.fontSize.leaf;
    else if (node.type === 'expected') fontSize = this.config.fontSize.expected;
    else fontSize = this.config.fontSize.step;
    
    // 加上优先级 badge 的宽度
    let extraWidth = 0;
    if (depth === 2 && node.priority) extraWidth = 36;
    
    const textW = this.measureTextWidth(title, fontSize) + this.config.textPadding + extraWidth;
    return Math.min(this.config.maxWidth, Math.max(baseWidth, textW));
  }

  getNodeHeight(node) {
    const depth = node._depth || 0;
    if (depth === 0) return this.config.rootHeight;
    if (depth === 1) return this.config.branchHeight;
    if (depth === 2) return this.config.leafHeight;
    if (node.type === 'step') return this.config.stepHeight;
    if (node.type === 'expected') return this.config.expectedHeight;
    return this.config.stepHeight;
  }

  // 渲染所有内容
  renderAll() {
    if (!this.canvasContent) return;
    this.canvasContent.innerHTML = '';
    
    if (!this.state.tree) return;
    
    // 先画连线
    this.renderLines(this.state.tree);
    
    // 再画节点
    this.renderNodes(this.state.tree);
  }

  setDepth(node, depth) {
    node._depth = depth;
    if (node.children) {
      node.children.forEach(child => this.setDepth(child, depth + 1));
    }
  }

  // 渲染连线
  renderLines(node) {
    if (!node.children || node.children.length === 0) return;
    
    const parentPos = this.state.nodePositions.get(node.id);
    if (!parentPos) return;
    
    const startX = parentPos.x + parentPos.width;
    const startY = parentPos.y;
    
    node.children.forEach(child => {
      const childPos = this.state.nodePositions.get(child.id);
      if (!childPos) return;
      
      const endX = childPos.x;
      const endY = childPos.y;
      const midX = (startX + endX) / 2;
      
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;';
      
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#d1d5db');
      path.setAttribute('stroke-width', '1.5');
      
      svg.appendChild(path);
      this.canvasContent.appendChild(svg);
      
      this.renderLines(child);
    });
  }

  // 渲染节点
  renderNodes(node) {
    const pos = this.state.nodePositions.get(node.id);
    if (!pos) return;
    
    const el = document.createElement('div');
    el.className = 'mind-node';
    el.dataset.id = node.id;
    el.style.cssText = `
      position: absolute;
      left: ${pos.x}px;
      top: ${pos.y - pos.height / 2}px;
      width: ${pos.width}px;
      height: ${pos.height}px;
    `;
    
    const depth = pos.depth || 0;
    
    if (depth === 0) {
      el.innerHTML = `<div class="node-root">${this.escapeHtml(node.title)}</div>`;
    } else if (depth === 1) {
      el.innerHTML = `<div class="node-branch">${this.escapeHtml(node.title)}</div>`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('.node-action-bar')) return;
        this.showActionBar(el, node);
      });
      el.style.cursor = 'pointer';
    } else if (depth === 2) {
      const priority = node.priority || 'P1';
      const status = this.state.caseStatus[node.id];
      const statusHtml = status === 'pass' 
        ? '<span class="case-status case-pass">✓</span>' 
        : status === 'fail' 
        ? '<span class="case-status case-fail">✗</span>' 
        : status === 'confirmed'
        ? '<span class="case-status case-confirmed">✦</span>'
        : status === 'unconfirmed'
        ? '<span class="case-status case-unconfirmed">?</span>'
        : status === 'pending'
        ? '<span class="case-status case-pending">⋯</span>'
        : '';
      const sourceAttr = node.source ? ` title="${this.escapeHtml(node.source)}"` : '';
      el.innerHTML = `<div class="node-leaf ${status ? 'node-leaf-' + status : ''}"${sourceAttr}><span class="priority-badge priority-${priority}">${priority}</span> ${this.escapeHtml(node.title)}${statusHtml}</div>`;
      
      // 点击用例只打开操作栏，执行必须通过操作栏按钮触发，避免误触。
      el.addEventListener('click', (e) => {
        if (e.target.closest('.node-action-bar')) return;
        this.showActionBar(el, node);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showActionBar(el, node);
      });
      
      // 双击节点：编辑
      el.addEventListener('dblclick', (e) => {
        e.preventDefault();
        this.onEditCase?.(node);
      });
      
      el.style.cursor = 'pointer';
    } else if (node.type === 'expected') {
      el.innerHTML = `<div class="node-expected">${this.escapeHtml(node.title)}</div>`;
    } else {
      el.innerHTML = `<div class="node-step">${this.escapeHtml(node.title)}</div>`;
    }
    
    this.canvasContent.appendChild(el);
    
    if (node.children) {
      node.children.forEach(child => this.renderNodes(child));
    }
  }

  // 切换用例状态（通过/不通过/未标记）
  toggleCaseStatus(nodeId, status) {
    if (status) {
      this.state.caseStatus[nodeId] = status;
    } else {
      const current = this.state.caseStatus[nodeId];
      if (!current) {
        this.state.caseStatus[nodeId] = 'pass';
      } else if (current === 'pass') {
        this.state.caseStatus[nodeId] = 'fail';
      } else {
        delete this.state.caseStatus[nodeId];
      }
    }
    this.persistCaseStatus();
    this.renderAll();
    this.updateCaseCount();
  }

  collectCaseNodeIds(node) {
    const ids = [];
    const walk = (item) => {
      if (!item) return;
      if ((item._depth || 0) === 2) ids.push(item.id);
      (item.children || []).forEach(walk);
    };
    walk(node);
    return ids;
  }

  applyStatusToNode(node, status) {
    const caseIds = this.collectCaseNodeIds(node);
    if (caseIds.length <= 1 && (node._depth || 0) === 2) {
      this.toggleCaseStatus(node.id, status);
      return;
    }
    caseIds.forEach(id => {
      this.state.caseStatus[id] = status;
    });
    this.persistCaseStatus();
    this.renderAll();
    this.updateCaseCount();
  }

  loadCaseStatus() {
    try {
      const raw = localStorage.getItem('prism.caseStatus');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  persistCaseStatus() {
    try {
      localStorage.setItem('prism.caseStatus', JSON.stringify(this.state.caseStatus));
    } catch (_) {}
  }

  // 平移画布让指定节点居中显示，避免使用浏览器 scrollIntoView 影响外层滚动
  focusNode(nodeEl) {
    if (!nodeEl || !this.container || !this.canvasContent) return;
    const containerRect = this.container.getBoundingClientRect();
    const nodeRect = nodeEl.getBoundingClientRect();
    const dx = containerRect.left + containerRect.width / 2 - (nodeRect.left + nodeRect.width / 2);
    const dy = containerRect.top + containerRect.height / 2 - (nodeRect.top + nodeRect.height / 2);
    this.state.offsetX += dx;
    this.state.offsetY += dy;
    this.canvasContent.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)';
    this.updateTransform();
    setTimeout(() => {
      if (this.canvasContent) this.canvasContent.style.transition = '';
    }, 400);
  }

  focusNodeById(nodeId, { scale = 1.18 } = {}) {
    if (!nodeId || !this.canvasContent) return false;
    const safeNodeId = typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(String(nodeId))
      : String(nodeId).replace(/"/g, '\\"');
    const nodeEl = this.canvasContent.querySelector(`.mind-node[data-id="${safeNodeId}"]`);
    if (!nodeEl) return false;
    const pos = this.state.nodePositions.get(nodeId);
    if (!pos || !this.container) {
      this.focusNode(nodeEl);
      return true;
    }

    const nextScale = Math.max(this.config.minScale, Math.min(this.config.maxScale, scale));
    const targetX = this.container.clientWidth * 0.58;
    const targetY = this.container.clientHeight * 0.5;
    this.state.scale = nextScale;
    this.state.offsetX = targetX - (pos.x + pos.width / 2) * nextScale;
    this.state.offsetY = targetY - pos.y * nextScale;
    this.canvasContent.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)';
    this.updateTransform();
    setTimeout(() => {
      if (this.canvasContent) this.canvasContent.style.transition = '';
    }, 400);
    this.canvasContent.querySelectorAll('.mind-node-active').forEach(el => {
      el.classList.remove('mind-node-active');
      el.style.zIndex = '';
    });
    nodeEl.classList.add('mind-node-active');
    nodeEl.style.zIndex = '260';
    return true;
  }
	  
  // 显示操作栏
  showActionBar(el, node) {
    // 移除已有的操作栏
    this.hideActionBar();
    this.canvasContent.querySelectorAll('.mind-node-active').forEach(nodeEl => {
      nodeEl.classList.remove('mind-node-active');
      nodeEl.style.zIndex = '';
    });
    el.classList.add('mind-node-active');
    el.style.zIndex = '300';
    
    const bar = document.createElement('div');
    bar.className = 'node-action-bar';
    const isModuleNode = (node._depth || 0) === 1;
    bar.innerHTML = `
      <button class="action-btn action-pass" data-status="pass">✓ Pass</button>
      <button class="action-btn action-fail" data-status="fail">✗ Fail</button>
      <button class="action-btn action-confirmed" data-status="confirmed">✦ 已确认</button>
      <button class="action-btn action-unconfirmed" data-status="unconfirmed">? 未确认</button>
      <button class="action-btn action-pending" data-status="pending">⋯ 待确认</button>
      <button class="action-btn action-run" data-action="run">▶ ${isModuleNode ? '执行模块' : '自动执行'}</button>
      ${isModuleNode ? '' : '<button class="action-btn action-edit" data-action="edit">编辑</button>'}
      <button class="action-btn action-delete" data-action="delete">${isModuleNode ? '删除模块' : '删除'}</button>
    `;
    
    // 节点本身已经是 absolute，保持原定位，避免点击后发生位移。
    el.appendChild(bar);
    
    // 绑定事件
    bar.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('.action-btn');
      if (!btn) return;
      
      const status = btn.dataset.status;
      const action = btn.dataset.action;
      
      if (status) {
        this.applyStatusToNode(node, status);
      } else if (action === 'run') {
        this.onRunCase?.(node);
      } else if (action === 'edit') {
        this.onEditCase?.(node);
      } else if (action === 'delete') {
        this.onDeleteCase?.(node);
      }
      
      this.hideActionBar();
    });
    
    // 点击其他地方关闭
    this._hideHandler = (e) => {
      if (!bar.contains(e.target)) {
        this.hideActionBar();
      }
    };
    setTimeout(() => document.addEventListener('click', this._hideHandler), 0);
  }
  
  // 隐藏操作栏
  hideActionBar() {
    const bar = document.querySelector('.node-action-bar');
    if (bar) bar.remove();
    this.canvasContent?.querySelectorAll('.mind-node-active').forEach(nodeEl => {
      nodeEl.classList.remove('mind-node-active');
      nodeEl.style.zIndex = '';
    });
    if (this._hideHandler) {
      document.removeEventListener('click', this._hideHandler);
      this._hideHandler = null;
    }
  }

  // 获取用例统计
  getCaseStats() {
    let total = 0, passed = 0, failed = 0;
    this.state.nodePositions.forEach((pos, id) => {
      if (pos.depth === 2) {
        total++;
        if (this.state.caseStatus[id] === 'pass') passed++;
        if (this.state.caseStatus[id] === 'fail') failed++;
      }
    });
    return { total, passed, failed };
  }

  escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  fitToView() {
    if (!this.state.nodePositions.size) return;
    
    const containerRect = this.container.getBoundingClientRect();
    const padding = 60;
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    this.state.nodePositions.forEach(pos => {
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y - pos.height / 2);
      maxX = Math.max(maxX, pos.x + pos.width);
      maxY = Math.max(maxY, pos.y + pos.height / 2);
    });
    
    if (minX === Infinity) return;
    
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    
    if (contentW <= 0 || contentH <= 0) return;
    
    const scaleX = (containerRect.width - padding * 2) / contentW;
    const scaleY = (containerRect.height - padding * 2) / contentH;
    
    this.state.scale = Math.min(1.2, Math.min(scaleX, scaleY));
    this.state.offsetX = (containerRect.width - contentW * this.state.scale) / 2 - minX * this.state.scale;
    this.state.offsetY = (containerRect.height - contentH * this.state.scale) / 2 - minY * this.state.scale;
    
    this.updateTransform();
  }

  // 节点逐个生长动画
  animateReveal(callback) {
    if (!this.canvasContent || !this.state.tree) return;

    const allNodes = this.canvasContent.querySelectorAll('.mind-node');
    const allPaths = this.canvasContent.querySelectorAll('path');

    // 隐藏所有连线
    allPaths.forEach(p => {
      p.style.opacity = '0';
      p.style.transition = 'opacity 0.4s ease';
    });

    // 隐藏所有节点
    allNodes.forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-8px)';
      el.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
    });

    // 收集所有元素，按深度+位置排序
    const items = [];
    const collect = (node) => {
      const el = this.canvasContent.querySelector(`.mind-node[data-id="${node.id}"]`);
      if (el) items.push({ el, node });
      if (node.children) node.children.forEach(collect);
    };
    collect(this.state.tree);

    // 逐个显现
    let i = 0;
    const revealNext = () => {
      if (i >= items.length) {
        if (callback) callback();
        return;
      }

      const { el } = items[i];
      el.style.opacity = '1';
      el.style.transform = 'translateX(0)';

      // 显示该节点的连线
      const nodeId = el.dataset.id;
      allPaths.forEach(p => {
        if (p.getAttribute('d')?.includes(nodeId) || p.parentElement?.querySelector(`[data-id="${nodeId}"]`)) {
          // 简单方式：按顺序显示连线
        }
      });

      i++;
      setTimeout(revealNext, i <= 3 ? 300 : 120);
    };

    // 先显示连线
    allPaths.forEach((p, idx) => {
      setTimeout(() => { p.style.opacity = '1'; }, idx * 30);
    });

    // 延迟后开始显示节点
    setTimeout(revealNext, 200);
  }

  clear() {
    if (this.canvasContent) {
      this.canvasContent.innerHTML = '';
    }
    this.state.tree = null;
    this.state.nodePositions.clear();
  }

  // 显示 Loading 状态（用例正在生成）
  showLoading(message = '正在生成用例...') {
    // 移除现有的 loading
    this.hideLoading();
    
    const loadingEl = document.createElement('div');
    loadingEl.id = 'canvas-loading';
    loadingEl.className = 'canvas-loading-container';
    loadingEl.innerHTML = `
      <div class="canvas-loading-content">
        <div class="canvas-loading-spinner">
          <div class="spinner-ring"></div>
          <div class="spinner-ring"></div>
          <div class="spinner-ring"></div>
        </div>
        <div class="canvas-loading-text">${message}</div>
        <div class="canvas-loading-progress">
          <div class="progress-bar"></div>
        </div>
        <div class="canvas-loading-meta">
          <span class="canvas-loading-hint">正在分析需求，规划测试场景...</span>
          <span class="canvas-loading-percent">0% · 0秒</span>
        </div>
      </div>
    `;
    
    this.container.appendChild(loadingEl);
    
    // 动态更新提示文字
    const hints = [
      '正在分析需求，规划测试场景...',
      '梳理业务流程和边界条件...',
      '考虑异常情况和用户路径...',
      '编写测试步骤和预期结果...',
      '整理用例分类和优先级...'
    ];
    let hintIndex = 0;
    const startedAt = Date.now();
    this._loadingInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const percentEl = loadingEl.querySelector('.canvas-loading-percent');
      if (percentEl) {
        const progress = loadingEl.dataset.progress || '0';
        percentEl.textContent = `${progress}% · ${elapsed}秒`;
      }
      if (elapsed > 0 && elapsed % 4 !== 0) return;
      hintIndex = (hintIndex + 1) % hints.length;
      const hintEl = loadingEl.querySelector('.canvas-loading-hint');
      if (hintEl) {
        hintEl.style.opacity = '0';
        setTimeout(() => {
          hintEl.textContent = hints[hintIndex];
          hintEl.style.opacity = '1';
        }, 200);
      }
    }, 1000);
  }

  // 隐藏 Loading 状态
  hideLoading() {
    if (this._loadingInterval) {
      clearInterval(this._loadingInterval);
      this._loadingInterval = null;
    }
    const loadingEl = document.getElementById('canvas-loading');
    if (loadingEl) {
      loadingEl.style.opacity = '0';
      loadingEl.style.transform = 'scale(0.95)';
      setTimeout(() => loadingEl.remove(), 300);
    }
  }

  // 更新 Loading 进度
  updateLoadingProgress(progress, message) {
    const loadingEl = document.getElementById('canvas-loading');
    if (!loadingEl) return;
    
    const progressBar = loadingEl.querySelector('.progress-bar');
    if (progressBar) {
      progressBar.style.width = `${progress}%`;
    }
    loadingEl.dataset.progress = String(progress);
    
    const textEl = loadingEl.querySelector('.canvas-loading-text');
    if (textEl && message) {
      textEl.textContent = message;
    }
  }

  // 增量添加一条用例到画布（不重绘已有节点）
  addCaseNode(categoryName, caseData) {
    if (!this.state.tree) return;

    // 找到或创建分类节点
    let catNode = this.state.tree.children.find(c => c.title === categoryName);
    if (!catNode) {
      catNode = {
        id: 'cat_' + Math.random().toString(36).substr(2, 9),
        title: categoryName,
        _depth: 1,
        children: []
      };
      this.state.tree.children.push(catNode);
    }

    // 构建用例子树
    const caseNode = {
      id: caseData.id,
      title: caseData.title,
      priority: caseData.priority,
      source: caseData.source || '',
      _depth: 2,
      children: []
    };
    if (caseData.steps && caseData.steps.length > 0) {
      caseData.steps.forEach((step, i) => {
        const stepNode = {
          id: 's_' + Math.random().toString(36).substr(2, 9),
          title: step,
          type: 'step',
          _depth: 3,
          children: []
        };
        if (i === caseData.steps.length - 1 && caseData.expected) {
          stepNode.children.push({
            id: 'e_' + Math.random().toString(36).substr(2, 9),
            title: caseData.expected,
            type: 'expected',
            _depth: 4,
            children: []
          });
        }
        caseNode.children.push(stepNode);
      });
    } else if (caseData.expected) {
      caseNode.children.push({
        id: 'e_' + Math.random().toString(36).substr(2, 9),
        title: caseData.expected,
        type: 'expected',
        _depth: 4,
        children: []
      });
    }
    catNode.children.push(caseNode);

    // 重新计算布局并全量渲染（但保留已有节点位置，减少闪烁）
    this.setDepth(this.state.tree, 0);
    const heights = this.calculateHeights(this.state.tree);
    this.calculatePositions(this.state.tree, 80, 0, heights);
    this.renderAll();
    
    // 更新用例数量显示
    this.updateCaseCount();
    
    // 返回新添加的节点元素，用于聚焦效果
    return this.canvasContent.querySelector(`.mind-node[data-id="${caseData.id}"]`);
  }
}

window.Canvas = Canvas;
