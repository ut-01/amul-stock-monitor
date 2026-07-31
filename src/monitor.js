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
    this.logger.info(this.product.name, "Opening product page...");

    await this.page.goto(this.product.url, {
      waitUntil: "domcontentloaded",
      timeout: this.config.browser.timeout,
    });

    await this.ensurePincodeSelected();
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

  async detectState() {
    // Allow Vue to finish mounting.
    await this.page.waitForTimeout(1500);

    const currentUrl = this.page.url();

    if (currentUrl !== this.product.url) {
      this.logger.warn(this.product.name, `Redirected to ${currentUrl}`);
    }

    const body = await this.page.locator("body").innerText();

    if (
      body.includes("Checking your browser") ||
      body.includes("Verify you are human") ||
      body.includes("Just a moment")
    ) {
      this.logger.warn(this.product.name, "Cloudflare challenge detected.");

      return "challenge";
    }

    const button = this.page.locator(
      ".product-buttons .buttons > a[title='Add to Cart']",
    );

    const isDisabled = await button.evaluate((el) =>
      el.hasAttribute("disabled"),
    );

    const soldOutVisible = await this.page
      .getByText("Sold Out", { exact: true })
      .isVisible()
      .catch(() => false);

    const available = !isDisabled && !soldOutVisible;

    return available ? "available" : "soldout";
  }

  async check() {
    this.logger.info(this.product.name, "Refreshing page...");

    await this.page.reload({
      waitUntil: "domcontentloaded",
      timeout: this.config.browser.timeout,
    });

    await this.ensurePincodeSelected();

    const state = await this.detectState();

    switch (state) {
      case "available":
        this.logger.success(this.product.name, "AVAILABLE");

        await this.webhook.send(this.product);
        break;

      case "soldout":
        this.logger.info(this.product.name, "Sold Out");
        break;

      case "challenge":
        this.logger.warn(
          this.product.name,
          "Cloudflare challenge encountered. Will retry later.",
        );
        break;

      case "unknown":
        this.logger.warn(this.product.name, "Unknown page state.");
        break;
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

  async ensurePincodeSelected() {
    const input = this.page.locator("#search");

    try {
      await input.waitFor({
        state: "visible",
        timeout: 2000,
      });
    } catch {
      // Already on product page
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

  async start() {
    const initialDelay = Math.floor(Math.random() * 50000);

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

        throw err;
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
