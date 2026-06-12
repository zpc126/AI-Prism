// input: SQLite 数据库连接
// output: PI 工具定义，支持 SQL 查询
// position: PI Agent 的数据库查询工具

const { getDb } = require('../../brain/db');

// 执行 SQL 查询
async function executeQuery(sql, params = []) {
  try {
    const db = getDb();
    
    // 检查是否是 SELECT 查询
    const isSelect = /^\s*SELECT/i.test(sql);
    
    if (isSelect) {
      // SELECT 查询
      const stmt = db.prepare(sql);
      const rows = stmt.all(...params);
      
      // 限制返回行数
      const maxRows = 100;
      const truncated = rows.length > maxRows;
      const resultRows = truncated ? rows.slice(0, maxRows) : rows;
      
      return {
        success: true,
        type: 'select',
        rowCount: resultRows.length,
        totalRows: rows.length,
        truncated,
        rows: resultRows,
      };
    } else {
      // INSERT, UPDATE, DELETE 等
      const stmt = db.prepare(sql);
      const result = stmt.run(...params);
      
      return {
        success: true,
        type: 'execute',
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      sql,
    };
  }
}

// 获取表结构
async function getTableInfo(tableName) {
  try {
    const db = getDb();
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const count = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
    
    return {
      success: true,
      table: tableName,
      columns: columns.map(col => ({
        name: col.name,
        type: col.type,
        notnull: col.notnull === 1,
        default: col.dflt_value,
        pk: col.pk === 1,
      })),
      rowCount: count.count,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// 获取所有表
async function getTables() {
  try {
    const db = getDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all();
    
    return {
      success: true,
      tables: tables.map(t => t.name),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// PI 工具定义
const databaseTool = {
  name: 'database',
  label: '数据库查询',
  description: '查询 SQLite 数据库验证数据',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '操作类型: query, table-info, list-tables',
        enum: ['query', 'table-info', 'list-tables'],
      },
      sql: {
        type: 'string',
        description: 'SQL 查询语句（仅 query 操作需要）',
      },
      table: {
        type: 'string',
        description: '表名（仅 table-info 操作需要）',
      },
    },
    required: ['action'],
  },
  execute: async (_toolCallId, params) => {
    try {
      let result;
      
      switch (params.action) {
        case 'query':
          if (!params.sql) {
            throw new Error('query 操作需要 sql 参数');
          }
          result = await executeQuery(params.sql);
          break;
          
        case 'table-info':
          if (!params.table) {
            throw new Error('table-info 操作需要 table 参数');
          }
          result = await getTableInfo(params.table);
          break;
          
        case 'list-tables':
          result = await getTables();
          break;
          
        default:
          throw new Error(`未知操作: ${params.action}`);
      }
      
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `数据库操作失败: ${error.message}` }],
        details: { error: error.message },
        isError: true,
      };
    }
  },
};

module.exports = {
  databaseTool,
  executeQuery,
  getTableInfo,
  getTables,
};
