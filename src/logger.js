const fs = require("fs");
const path = require("path");

class Logger {
  constructor(config) {
    this.enabled = config.logging.enabled;
    this.logDir = config.logging.directory;

    if (this.enabled) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  getLogFile() {
    const date = new Date().toISOString().split("T")[0];
    return path.join(this.logDir, `${date}.log`);
  }

  timestamp() {
    return new Date().toISOString();
  }

  format(level, productName, message) {
    if (productName) {
      return `[${this.timestamp()}] [${level}] [${productName}] ${message}`;
    }

    return `[${this.timestamp()}] [${level}] ${message}`;
  }

  log(level, productName, message) {
    // Allow logger.info("message")
    if (message === undefined) {
      message = productName;
      productName = null;
    }

    const line = this.format(level, productName, message);

    console.log(line);

    if (!this.enabled) return;

    fs.appendFileSync(this.getLogFile(), line + "\n", "utf8");
  }

  info(productName, message) {
    this.log("INFO", productName, message);
  }

  warn(productName, message) {
    this.log("WARN", productName, message);
  }

  error(productName, message) {
    this.log("ERROR", productName, message);
  }

  success(productName, message) {
    this.log("SUCCESS", productName, message);
  }
}

module.exports = Logger;
