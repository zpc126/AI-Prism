// input: 测试执行期间的页面截图帧
// output: 失败用例回放视频 mp4
// position: 自动化报告视频录制器，仅失败时保留视频

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function safeName(value) {
  return String(value || 'case')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '_')
    .slice(0, 60);
}

class VideoRecorder {
  constructor({ reportDir, caseId, captureFrame, intervalMs = 1000 }) {
    this.reportDir = reportDir;
    this.caseId = safeName(caseId);
    this.captureFrame = captureFrame;
    this.intervalMs = intervalMs;
    this.frameDir = path.join(reportDir, `frames_${this.caseId}_${Date.now()}`);
    this.frameCount = 0;
    this.timer = null;
    this.capturing = false;
    this.stopped = false;
  }

  async start() {
    if (typeof this.captureFrame !== 'function') return;
    fs.mkdirSync(this.frameDir, { recursive: true });
    await this.capture();
    this.timer = setInterval(() => {
      this.capture().catch(() => {});
    }, this.intervalMs);
  }

  async capture() {
    if (this.stopped || this.capturing) return;
    this.capturing = true;
    try {
      const frame = await this.captureFrame();
      if (!frame) return;
      const buffer = Buffer.isBuffer(frame)
        ? frame
        : frame.buffer && Buffer.isBuffer(frame.buffer)
          ? frame.buffer
          : null;
      if (!buffer) return;
      this.frameCount++;
      const filename = `frame_${String(this.frameCount).padStart(6, '0')}.png`;
      fs.writeFileSync(path.join(this.frameDir, filename), buffer);
    } catch (_) {
      // 录屏不能影响测试执行。
    } finally {
      this.capturing = false;
    }
  }

  async stop({ keep = false } = {}) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.capture().catch(() => {});
    this.stopped = true;

    try {
      if (!keep || this.frameCount === 0) return null;
      const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
      const videoPath = path.join(this.reportDir, `failure_${this.caseId}_${Date.now()}.mp4`);
      await execFileAsync(ffmpeg, [
        '-y',
        '-framerate', '1',
        '-i', path.join(this.frameDir, 'frame_%06d.png'),
        '-vf', 'scale=max(2\\,trunc(iw/2)*2):max(2\\,trunc(ih/2)*2)',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        videoPath,
      ]);
      return videoPath;
    } catch (error) {
      console.warn('[VideoRecorder] 生成失败视频失败:', error.message);
      return null;
    } finally {
      fs.rmSync(this.frameDir, { recursive: true, force: true });
    }
  }
}

module.exports = { VideoRecorder };
