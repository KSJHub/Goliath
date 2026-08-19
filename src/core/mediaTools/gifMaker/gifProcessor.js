'use strict';

const fs = require('node:fs');
const { spawn } = require('node:child_process');

const { TOOL_PRESETS } = require('../mediaConfig');

function hasFfmpeg() {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args);
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      return reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

function normalizeNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

async function getGifProcessorStatus() {
  const available = await hasFfmpeg();
  return {
    key: 'ffmpeg',
    label: 'FFmpeg',
    available,
    requiredFor: ['GIF conversion', 'video trimming', 'FPS/resize processing'],
    warning: available ? null : 'FFmpeg is not installed. GIF Maker will save the original upload as a fallback.',
  };
}

async function createGif({ inputPath, outputPath, options = {} }) {
  const ffmpegAvailable = await hasFfmpeg();
  const fps = normalizeNumber(options.fps, TOOL_PRESETS.gif.defaultFps, 5, 30);
  const width = normalizeNumber(options.width, TOOL_PRESETS.gif.defaultWidth, 64, 960);
  const start = normalizeNumber(options.start, 0, 0, 3600);
  const duration = normalizeNumber(options.duration, 6, 1, 15);

  if (!ffmpegAvailable) {
    fs.copyFileSync(inputPath, outputPath);
    return {
      outputPath,
      fallback: true,
      warning: 'FFmpeg is not installed on this host. Original file was saved instead of converted.',
    };
  }

  const scale = `fps=${fps},scale=${width}:-1:flags=lanczos`;
  const palettePath = outputPath.replace(/\.gif$/i, '.palette.png');

  try {
    await runFfmpeg(['-y', '-ss', String(start), '-t', String(duration), '-i', inputPath, '-vf', `${scale},palettegen`, palettePath]);
    await runFfmpeg(['-y', '-ss', String(start), '-t', String(duration), '-i', inputPath, '-i', palettePath, '-lavfi', `${scale} [x]; [x][1:v] paletteuse`, outputPath]);
  } finally {
    if (fs.existsSync(palettePath)) fs.unlinkSync(palettePath);
  }

  return { outputPath, fallback: false };
}

module.exports = {
  createGif,
  getGifProcessorStatus,
};
