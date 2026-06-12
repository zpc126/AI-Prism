// input: 上传的文件（PDF、DOCX、HTML、图片）
// output: 提取的文本内容
// position: 文件解析模块，支持 PDF、DOCX、HTML、表格、图片和文本

const fs = require('fs');
const path = require('path');

/**
 * 解析 PDF 文件
 */
async function parsePdf(filePath) {
  try {
    const pdfParse = require('pdf-parse');
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);

    return {
      type: 'pdf',
      text: data.text,
      pages: data.numpages,
      metadata: data.info || {},
    };
  } catch (error) {
    throw new Error(`PDF 解析失败: ${error.message}`);
  }
}

/**
 * 解析 DOCX 文件
 */
async function parseDocx(filePath) {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });

    return {
      type: 'docx',
      text: result.value,
      warnings: result.messages || [],
    };
  } catch (error) {
    throw new Error(`DOCX 解析失败: ${error.message}`);
  }
}

/**
 * 解析 Excel/CSV 文件
 */
async function parseSpreadsheet(filePath) {
  try {
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(filePath);
    
    const sheets = [];
    let allText = '';
    
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      // 转换为文本
      const sheetText = jsonData
        .filter(row => row.some(cell => cell !== null && cell !== undefined && cell !== ''))
        .map(row => row.join('\t'))
        .join('\n');
      
      sheets.push({
        name: sheetName,
        rows: jsonData.length,
        columns: jsonData[0]?.length || 0,
        data: jsonData,
        text: sheetText
      });
      
      allText += `【${sheetName}】\n${sheetText}\n\n`;
    }
    
    return {
      type: 'spreadsheet',
      text: allText.trim(),
      sheets,
      sheetNames: workbook.SheetNames
    };
  } catch (error) {
    throw new Error(`表格解析失败: ${error.message}`);
  }
}

/**
 * 解析图片文件（返回描述，需要多模态 LLM）
 */
async function parseImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const supportedExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

  if (!supportedExts.includes(ext)) {
    throw new Error(`不支持的图片格式: ${ext}`);
  }

  // 读取图片为 base64
  const imageBuffer = fs.readFileSync(filePath);
  const base64 = imageBuffer.toString('base64');
  const mimeType = getMimeType(ext);

  return {
    type: 'image',
    path: filePath,
    base64: `data:${mimeType};base64,${base64}`,
    mimeType,
    size: imageBuffer.length,
  };
}

/**
 * 解析纯文本文件
 */
function parseText(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  return {
    type: 'text',
    text: content,
    lines: content.split('\n').length,
  };
}

/**
 * 解析 HTML 文件，保留需求文档中的可见结构化文本
 */
function parseHtml(filePath) {
  try {
    const cheerio = require('cheerio');
    const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
    const $ = cheerio.load(content);

    $('script, style, noscript, template, svg').remove();

    const title = $('title').first().text().replace(/\s+/g, ' ').trim();
    const lines = [];
    const pushLine = (value) => {
      const text = String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, ' ')
        .trim();
      if (text && lines[lines.length - 1] !== text) lines.push(text);
    };

    if (title) pushLine(title);
    $('h1, h2, h3, h4, h5, h6, p, li, th, td').each((_, element) => {
      pushLine($(element).text());
    });

    // 部分简单 HTML 没有语义标签，回退到 body 可见文本。
    if (lines.length <= (title ? 1 : 0)) {
      $('body').text().split(/\n+/).forEach(pushLine);
    }

    return {
      type: 'html',
      text: lines.join('\n'),
      title,
      lines: lines.length,
    };
  } catch (error) {
    throw new Error(`HTML 解析失败: ${error.message}`);
  }
}

/**
 * 根据文件扩展名选择解析器
 */
async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return await parsePdf(filePath);
    case '.docx':
    case '.doc':
      return await parseDocx(filePath);
    case '.xlsx':
    case '.xls':
    case '.csv':
      return await parseSpreadsheet(filePath);
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.webp':
    case '.bmp':
      return await parseImage(filePath);
    case '.txt':
    case '.md':
    case '.markdown':
      return parseText(filePath);
    case '.html':
    case '.htm':
      return parseHtml(filePath);
    default:
      throw new Error(`不支持的文件格式: ${ext}`);
  }
}

/**
 * 获取 MIME 类型
 */
function getMimeType(ext) {
  const mimeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * 检查文件是否支持
 */
function isSupportedFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  const supportedExts = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.txt', '.md', '.html', '.htm'];
  return supportedExts.includes(ext);
}

/**
 * 获取文件类型描述
 */
function getFileTypeDesc(filename) {
  const ext = path.extname(filename).toLowerCase();
  const descMap = {
    '.pdf': 'PDF 文档',
    '.docx': 'Word 文档',
    '.doc': 'Word 文档',
    '.xlsx': 'Excel 表格',
    '.xls': 'Excel 表格',
    '.csv': 'CSV 文件',
    '.png': 'PNG 图片',
    '.jpg': 'JPEG 图片',
    '.jpeg': 'JPEG 图片',
    '.gif': 'GIF 图片',
    '.webp': 'WebP 图片',
    '.txt': '纯文本',
    '.md': 'Markdown 文档',
    '.html': 'HTML 文档',
    '.htm': 'HTML 文档',
  };
  return descMap[ext] || '未知格式';
}

module.exports = {
  parseFile,
  parsePdf,
  parseDocx,
  parseSpreadsheet,
  parseImage,
  parseText,
  parseHtml,
  isSupportedFile,
  getFileTypeDesc,
};
