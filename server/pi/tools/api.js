// input: HTTP 请求
// output: PI 工具定义，支持 GET、POST、PUT、DELETE
// position: PI Agent 的 API 测试工具

// 发送 HTTP 请求
async function sendRequest(method, url, body = null, headers = {}) {
  try {
    const options = {
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };
    
    if (body && ['POST', 'PUT', 'PATCH'].includes(options.method)) {
      options.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
    
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    // 读取响应体
    const responseText = await response.text();
    
    // 尝试解析 JSON
    let jsonData = null;
    try {
      jsonData = JSON.parse(responseText);
    } catch {
      // 不是 JSON 格式
    }
    
    return {
      success: true,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      data: jsonData || responseText,
      truncated: false,
      size: responseText.length,
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        success: false,
        error: '请求超时（超过 10 秒）',
        url,
      };
    }
    return {
      success: false,
      error: error.message,
      url,
    };
  }
}

// PI 工具定义
const apiTool = {
  name: 'api',
  label: 'API 测试',
  description: '发送 HTTP 请求测试 API 接口',
  parameters: {
    type: 'object',
    properties: {
      method: {
        type: 'string',
        description: 'HTTP 方法: GET, POST, PUT, DELETE, PATCH',
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      },
      url: {
        type: 'string',
        description: '请求 URL',
      },
      body: {
        type: 'string',
        description: '请求体（JSON 字符串，仅 POST/PUT/PATCH 需要）',
      },
      headers: {
        type: 'string',
        description: '请求头（JSON 字符串）',
      },
    },
    required: ['method', 'url'],
  },
  execute: async (_toolCallId, params) => {
    try {
      const { method, url, body, headers } = params;
      
      // 解析 headers
      let parsedHeaders = {};
      if (headers) {
        try {
          parsedHeaders = JSON.parse(headers);
        } catch {
          return {
            content: [{ type: 'text', text: 'headers 参数必须是有效的 JSON 字符串' }],
            details: { error: 'Invalid headers JSON' },
            isError: true,
          };
        }
      }
      
      const result = await sendRequest(method, url, body, parsedHeaders);
      
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `API 请求失败: ${error.message}` }],
        details: { error: error.message },
        isError: true,
      };
    }
  },
};

module.exports = {
  apiTool,
  sendRequest,
};
