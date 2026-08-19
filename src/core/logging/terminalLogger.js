const fs = require('node:fs');
const path = require('node:path');
const { Chalk } = require('chalk');

const chalk = new Chalk();
const DEBUG = String(process.env.DEBUG || '').toLowerCase() === 'true';

const {
  getRuntimePaths,
} = require('../../config/runtimePaths');

const runtimePaths = getRuntimePaths(process.env.BOT_MODE);

const logsDir = runtimePaths.logs;

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function now() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function isoNow() {
  return new Date().toISOString();
}

function dateKey() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

function stamp() {
  return chalk.gray(`[${now()}]`);
}

function label(text) {
  return chalk.gray(String(text).padEnd(10));
}

function level(type, icon) {
  const map = {
    info: chalk.cyan,
    success: chalk.green,
    warn: chalk.yellow,
    error: chalk.red,
    debug: chalk.magenta,
  };

  return map[type] ? map[type](icon) : icon;
}

function safeStringify(value) {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return '[unserializable value]';
  }
}

function getLogPaths(service = 'app') {
  const key = dateKey();

  return {
    combined: path.join(logsDir, `${service}-combined-${key}.log`),
    error: path.join(logsDir, `${service}-error-${key}.log`),
  };
}

function writeLog(filename, line) {
  try {
    fs.appendFileSync(filename, `${line}\n`, 'utf8');
  } catch (error) {
    console.error('Failed to write log file:', error.message);
  }
}

function cleanupOldLogs(daysToKeep = 14) {
  try {
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(logsDir);

    for (const file of files) {
      const fullPath = path.join(logsDir, file);
      const stat = fs.statSync(fullPath);

      if (!stat.isFile()) continue;
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(fullPath);
      }
    }
  } catch (error) {
    console.error('Failed to clean old logs:', error.message);
  }
}

function createLogger(service = 'app') {
  const paths = getLogPaths(service);

  function writeCombined(type, message) {
    writeLog(
      paths.combined,
      `[${isoNow()}] [${service.toUpperCase()}] [${type.toUpperCase()}] ${message}`
    );
  }

  function writeError(message) {
    writeLog(
      paths.error,
      `[${isoNow()}] [${service.toUpperCase()}] [ERROR] ${message}`
    );
  }

  return {
    start(title = 'Diamond Goliath Dev') {
      cleanupOldLogs(14);

      const msg = `🚀 ${title}`;
      console.clear();
      console.log(`${stamp()} ${chalk.bold.cyan(msg)}`);
      writeCombined('info', msg);
    },

    line(name, value) {
      const msg = `${String(name).padEnd(10)} → ${value}`;
      console.log(`${stamp()} ${label(name)} → ${chalk.white(value)}`);
      writeCombined('info', msg);
    },

    banner(items = []) {
      const rendered = items
        .map(({ label: itemLabel, value, ok = true }) => {
          const icon = ok ? chalk.green('●') : chalk.red('●');
          return `${icon} ${chalk.gray(itemLabel)} ${chalk.white(value)}`;
        })
        .join(chalk.gray('  |  '));

      console.log(`${stamp()} ${rendered}`);
      writeCombined(
        'info',
        items.map((x) => `${x.label} ${x.value}`).join(' | ')
      );
    },

    info(msg) {
      console.log(`${stamp()} ${level('info', 'ℹ')} ${chalk.white(msg)}`);
      writeCombined('info', msg);
    },

    success(msg) {
      console.log(`${stamp()} ${level('success', '✅')} ${chalk.white(msg)}`);
      writeCombined('success', msg);
    },

    warn(msg) {
      console.warn(`${stamp()} ${level('warn', '⚠️')} ${chalk.white(msg)}`);
      writeCombined('warn', msg);
    },

    error(msg, error = null) {
      console.error(`${stamp()} ${level('error', '❌')} ${chalk.white(msg)}`);

      let detail = msg;

      if (DEBUG && error) {
        console.error(error);
        detail = `${msg} | ${error.stack || error.message || String(error)}`;
      } else if (error?.message) {
        console.error(`${stamp()} ${chalk.red(error.message)}`);
        detail = `${msg} | ${error.message}`;
      }

      writeCombined('error', detail);
      writeError(detail);
    },

    debug(msg, value) {
      if (!DEBUG) return;

      if (typeof value === 'undefined') {
        console.log(`${stamp()} ${level('debug', '🐞')} ${chalk.white(msg)}`);
        writeCombined('debug', msg);
        return;
      }

      console.log(`${stamp()} ${level('debug', '🐞')} ${chalk.white(msg)}`, value);
      writeCombined('debug', `${msg} ${safeStringify(value)}`);
    },

    request(method, requestPath, status, ms) {
      const color =
        status >= 500 ? chalk.red :
        status >= 400 ? chalk.yellow :
        chalk.green;

      const icon =
        status >= 500 ? '❌' :
        status >= 400 ? '⚠️' :
        '→';

      console.log(
        `${stamp()} ${color(icon)} ${chalk.white(method.padEnd(6))} ${chalk.gray(requestPath)} ${color(status)} ${chalk.gray(`${ms}ms`)}`
      );

      const msg = `${method.padEnd(6)} ${requestPath} ${status} ${ms}ms`;
      writeCombined('request', msg);

      if (status >= 400) {
        writeError(msg);
      }
    },
  };
}

const terminal = createLogger('app');
terminal.createLogger = createLogger;

module.exports = terminal;