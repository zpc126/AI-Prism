// input: 思维导图数据
// output: Canvas 类，使用 MindElixir 渲染
// position: 画布引擎，使用专业思维导图库

class Canvas {
  constructor(containerId) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    this.mind = null;
    this.tree = null;
  }

  setMindMap(rootNode) {
    this.tree = rootNode;
    this.render();
  }

  render() {
    if (!this.tree) return;

    // 清空容器
    this.container.innerHTML = '';

    // 转换数据格式为 MindElixir 格式
    const mindElixirData = this.convertToMindElixir(this.tree);

    // 初始化 MindElixir
    this.mind = new MindElixir({
      el: this.container,
      direction: MindElixir.RIGHT,
      draggable: true,
      editable: false,
      contextMenu: false,
      toolBar: false,
      nodeMenu: false,
      keypress: false,
      locale: 'zh_CN',
      overflowHidden: true,
      primaryLinkStyle: 2,
      primaryNodeVerticalGap: 15,
      primaryNodeHorizontalGap: 60,
    });

    this.mind.init(mindElixirData);
  }

  convertToMindElixir(node) {
    const convertNode = (n, id = 0) => {
      const result = {
        id: id.toString(),
        topic: n.title || '',
        style: this.getNodeStyle(n),
        children: []
      };

      if (n.children && n.children.length > 0) {
        result.children = n.children.map((child, index) => 
          convertNode(child, id * 100 + index + 1)
        );
      }

      return result;
    };

    const root = convertNode(this.tree, 1);

    return {
      nodeData: root,
      linkData: {}
    };
  }

  getNodeStyle(node) {
    if (node.type === 'expected') {
      return {
        background: '#f0fdf4',
        color: '#166534',
        fontSize: '12px',
        borderRadius: '4px',
        padding: '4px 8px'
      };
    }
    if (node.type === 'step') {
      return {
        background: '#f9fafb',
        color: '#374151',
        fontSize: '12px',
        borderRadius: '4px',
        padding: '4px 8px'
      };
    }
    return {};
  }

  fitToView() {
    if (this.mind) {
      this.mind.fit();
    }
  }

  clear() {
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.mind = null;
    this.tree = null;
  }
}

window.Canvas = Canvas;
