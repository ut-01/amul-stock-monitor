const fs = require("fs/promises");
const path = require("path");
const { setTimeout: sleep } = require("timers/promises");

class Monitor {
  constructor(product, page, config, logger, webhook) {
    this.product = product;
    this.page = page;
    this.config = config;
    this.logger = logger;
    this.webhook = webhook;

    this.stopped = false;
  }

  async initialize() {
    await fs.mkdir("logs", {
      recursive: true,
    });

    this.logger.info(this.product.name, "Opening product page...");

    await this.withTimeout(
      "goto",
      this.page.goto(this.product.url, {
        waitUntil: "domcontentloaded",
        timeout: this.config.browser.timeout,
      }),
    );

    this.page.setDefaultTimeout(10000);
    this.page.setDefaultNavigationTimeout(15000);

    await this.withTimeout(
      "ensurePincodeSelected",
      this.ensurePincodeSelected(),
    );
  }

  isMonitoringWindow() {
    const hour = new Date().getHours();

    return (
      hour >= this.config.monitor.startHour &&
      hour < this.config.monitor.endHour
    );
  }

  async waitUntilMorning() {
    const now = new Date();
    const wake = new Date(now);

    if (now.getHours() >= this.config.monitor.endHour) {
      wake.setDate(wake.getDate() + 1);
    }

    wake.setHours(this.config.monitor.startHour, 0, 0, 0);

    const ms = wake - now;

    this.logger.info(
      this.product.name,
      `Sleeping until ${wake.toLocaleString()}`,
    );

    await sleep(ms);
  }

  async ensurePincodeSelected() {
    const input = this.page.locator("#search");

    try {
      await input.waitFor({
        state: "visible",
        timeout: 2000,
      });
    } catch {
      return;
    }

    this.logger.info(this.product.name, "Selecting pincode...");

    await input.fill(this.config.location.pincode);

    const option = this.page.locator("#automatic a.searchitem-name").filter({
      hasText: this.config.location.pincode,
    });

    await option.waitFor({
      state: "visible",
      timeout: 10000,
    });

    await option.click();

    await this.page.waitForLoadState("domcontentloaded");

    await this.page.waitForTimeout(1500);

    this.logger.success(this.product.name, "Pincode selected.");
  }

  async captureUnknown(reason) {
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");

      const safeName = this.product.name.replace(/[^a-z0-9]/gi, "_");

      const png = path.join("logs", `${safeName}-${reason}-${ts}.png`);

      const html = path.join("logs", `${safeName}-${reason}-${ts}.html`);

      await this.page.screenshot({
        path: png,
        fullPage: true,
      });

      await fs.writeFile(html, await this.page.content(), "utf8");

      this.logger.warn(this.product.name, `Captured diagnostics (${reason})`);
    } catch (err) {
      this.logger.warn(
        this.product.name,
        `Unable to capture diagnostics: ${err.message}`,
      );
    }
  }

  async withTimeout(operation, promise) {
    const timeout = this.config.browser.operationTimeout || 15000;

    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => {
          reject(new Error(`${operation} timed out after ${timeout}ms`));
        }, timeout),
      ),
    ]);
  }

  async detectState() {
    await this.page.waitForTimeout(1500);

    await this.withTimeout(
      "ensurePincodeSelected",
      this.ensurePincodeSelected(),
    );

    const body = await this.page.locator("body").innerText();

    if (
      body.includes("Checking your browser") ||
      body.includes("Verify you are human") ||
      body.includes("Just a moment")
    ) {
      this.logger.warn(this.product.name, "Cloudflare challenge detected.");

      return "challenge";
    }

    const pincodeInput = await this.page.locator("#search").count();

    if (pincodeInput > 0) {
      this.logger.warn(this.product.name, "Still on pincode page.");

      await this.captureUnknown("pincode");

      return "pincode";
    }

    const button = this.page.locator(
      ".product-buttons .buttons > a[title='Add to Cart']",
    );

    if ((await button.count()) === 0) {
      this.logger.warn(this.product.name, "Add to Cart button not found.");

      await this.captureUnknown("missing-button");

      return "unknown";
    }

    const soldOut = this.page.getByText("Sold Out", {
      exact: true,
    });

    const soldOutVisible = await soldOut.isVisible().catch(() => false);

    const disabled = await button.getAttribute("disabled");

    const available = !disabled && !soldOutVisible;

    return available ? "available" : "soldout";
  }
  async check() {
    this.logger.info(this.product.name, "Refreshing page...");

    try {
      await this.withTimeout(
        "reload",
        this.page.reload({
          waitUntil: "domcontentloaded",
          timeout: this.config.browser.timeout,
        }),
      );
    } catch (err) {
      this.logger.warn(
        this.product.name,
        `Reload failed (${err.message}). Navigating directly...`,
      );

      await this.withTimeout(
        "goto",
        this.page.goto(this.product.url, {
          waitUntil: "domcontentloaded",
          timeout: this.config.browser.timeout,
        }),
      );
    }

    const state = await this.withTimeout("detectState", this.detectState());

    switch (state) {
      case "available":
        this.logger.success(this.product.name, "PRODUCT AVAILABLE!");

        await this.webhook.send(this.product);

        return;

      case "soldout":
        this.logger.info(this.product.name, "Sold Out");

        return;

      case "challenge":
        this.logger.warn(this.product.name, "Cloudflare challenge detected.");

        return;

      case "pincode":
        this.logger.warn(this.product.name, "Pincode page detected.");

        return;

      case "unknown":
        this.logger.warn(this.product.name, "Unknown page state.");

        return;
    }
  }

  nextDelay() {
    const base = this.config.monitor.intervalMinutes * 60 * 1000;

    const jitter =
      (this.config.monitor.minJitterSeconds +
        Math.random() *
          (this.config.monitor.maxJitterSeconds -
            this.config.monitor.minJitterSeconds)) *
      1000;

    return Math.round(base + jitter);
  }

  async start() {
    const initialDelay = Math.floor(Math.random() * 10000);

    this.logger.info(
      this.product.name,
      `Initial delay ${Math.round(initialDelay / 1000)}s`,
    );

    await sleep(initialDelay);

    while (!this.stopped) {
      try {
        if (!this.isMonitoringWindow()) {
          await this.waitUntilMorning();
          continue;
        }

        await this.check();
      } catch (err) {
        this.logger.error(this.product.name, err.stack || err.message);

        await this.captureUnknown("exception");

        this.logger.warn(this.product.name, "Recovering in 30 seconds...");

        await sleep(30000);

        try {
          await this.withTimeout(
            "goto",
            this.page.goto(this.product.url, {
              waitUntil: "domcontentloaded",
              timeout: this.config.browser.timeout,
            }),
          );

          await this.withTimeout(
            "ensurePincodeSelected",
            this.ensurePincodeSelected(),
          );
        } catch (recoveryError) {
          this.logger.error(
            this.product.name,
            `Recovery failed: ${recoveryError.message}`,
          );
        }
      }

      const delay = this.nextDelay();

      this.logger.info(
        this.product.name,
        `Next check in ${Math.round(delay / 1000)}s`,
      );

      await sleep(delay);
    }
  }

  stop() {
    this.stopped = true;
  }
}

module.exports = Monitor;
