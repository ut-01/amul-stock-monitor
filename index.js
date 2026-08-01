const fs = require("fs");
const { chromium } = require("playwright");
require("dotenv").config();

const Logger = require("./src/logger");
const Webhook = require("./src/webhook");
const Monitor = require("./src/monitor");

const config = JSON.parse(fs.readFileSync("./config.json", "utf8"));

const logger = new Logger(config);
const webhook = new Webhook(config, logger);

let browserContext;

async function createMonitor(product) {
  while (true) {
    let page;

    try {
      page = await browserContext.newPage();

      const monitor = new Monitor(product, page, config, logger, webhook);

      await monitor.initialize();

      await monitor.start();

      break;
    } catch (err) {
      logger.warn(product.name, "Restarting browser...");

      try {
        await context.close();
      } catch {}

      try {
        await browser.close();
      } catch {}

      browser = await launchBrowser();

      context = await browser.newContext({
        storageState: "browser-data/storage-state.json",
      });

      page = await context.newPage();

      monitor = new Monitor(product, page, config, logger, webhook);

      await monitor.initialize();
    }
  }
}

(async () => {
  logger.info("Launching browser...");

  browserContext = await chromium.launchPersistentContext(
    config.browser.profileDir,
    {
      headless: config.browser.headless,
      args: [
        "--disable-gpu",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
      ],
    },
  );

  logger.success("Browser launched.");

  const monitors = [];

  for (const product of config.products) {
    monitors.push(createMonitor(product));
  }

  await Promise.all(monitors);
})();

async function shutdown() {
  logger.warn("Shutdown requested.");

  try {
    if (browserContext) {
      await browserContext.close();
    }
  } catch {}

  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
