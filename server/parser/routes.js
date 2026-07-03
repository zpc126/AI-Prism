// input: HTTP 文件上传请求
// output: 文件解析结果
// position: 文件上传 API 路由

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseFile, isSupportedFile, getFileTypeDesc } = require('./file-parser');

// 配置 multer
const UPLOAD_DIR = path.join(__dirname, '../../data/uploads');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // 保持原始文件名，加上时间戳避免冲突
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    const timestamp = Date.now();
    cb(null, `${name}_${timestamp}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
  },
  fileFilter: (req, file, cb) => {
    if (isSupportedFile(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${path.extname(file.originalname)}`));
    }
  },
});

/**
 * 单文件上传并解析
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '请上传文件' });
    }

    const filePath = req.file.path;
    const result = await parseFile(filePath);

    // 清理上传的文件（解析完就删除）
    // 如果是图片，保留用于多模态 LLM
    if (result.type !== 'image') {
      fs.unlinkSync(filePath);
    }

    res.json({
      success: true,
      data: {
        ...result,
        filename: req.file.originalname,
        fileType: getFileTypeDesc(req.file.originalname),
      },
    });
  } catch (error) {
    // 清理上传的文件
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 多文件上传并解析
 */
router.post('/upload-multiple', upload.array('files', 500), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: '请上传文件' });
    }

    const results = [];

    for (const file of req.files) {
      try {
        const result = await parseFile(file.path);
        results.push({
          success: true,
          ...result,
          filename: file.originalname,
          fileType: getFileTypeDesc(file.originalname),
        });

        // 清理非图片文件
        if (result.type !== 'image') {
          fs.unlinkSync(file.path);
        }
      } catch (error) {
        results.push({
          success: false,
          filename: file.originalname,
          error: error.message,
        });
        // 清理失败的文件
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }

    res.json({ success: true, files: results });
  } catch (error) {
    // 清理所有上传的文件
    if (req.files) {
      for (const file of req.files) {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 获取支持的文件格式
 */
router.get('/supported-formats', (req, res) => {
  res.json({
    success: true,
    formats: {
      documents: ['.pdf', '.docx', '.doc', '.html', '.htm', '.zip'],
      images: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'],
      text: ['.txt', '.md'],
    },
  });
});

module.exports = router;
