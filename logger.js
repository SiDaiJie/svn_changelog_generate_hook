// logger.js

class Logger {
  constructor(prefix = "") {
    this.prefix = prefix;
    this.debugEnable = false; // 添加一个调试标志
  }

  log(level, ...args) {
    // 设置选项为使用中国的时区（UTC+8）
    const options = { timeZone: "Asia/Shanghai", hour12: false };
    // 使用 toLocaleString 来格式化日期和时间
    const timestamp = new Date().toLocaleString("zh-CN", options);
    console[level](`[${timestamp}] ${this.prefix}`, ...args);
  }

  debug(...args) {
    if (this.debugEnable) {
      // 检查调试标志
      this.log("info", "[DEBUG]", ...args);
    }
  }

  info(...args) {
    this.log("info", "[INFO]", ...args);
  }

  warn(...args) {
    this.log("warn", "[WARN]", ...args);
  }

  error(...args) {
    this.log("error", "[ERROR]", ...args);
  }
}

// 创建一个默认的 logger 实例
const defaultLogger = new Logger();

// 导出单独的方法，这样可以像 logger.info(...) 一样使用
module.exports = {
  debug: (...args) => defaultLogger.debug(...args),
  info: (...args) => defaultLogger.info(...args),
  warn: (...args) => defaultLogger.warn(...args),
  error: (...args) => defaultLogger.error(...args),
};
