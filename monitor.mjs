import { chromium } from "playwright";
import fs from "node:fs";

const PRODUCT_URL =
  "https://www.pokemonstore.co.kr/pages/product/product-list.html?categoryNo=488339";

const END_DATE = new Date("2026-08-06T00:00:00+09:00");
const NOTIFIED_FILE = ".restock-notified";

if (new Date() >= END_DATE) {
  console.log("감시 기간이 종료되었습니다.");
  process.exit(0);
}

if (fs.existsSync(NOTIFIED_FILE)) {
  console.log("이미 재입고 알림을 보냈습니다.");
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();

  await page.goto(PRODUCT_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(5000);

  const pageText = await page.locator("body").innerText();
  const match = pageText.match(/총\s*([0-9,]+)\s*건/);

  if (!match) {
    throw new Error("페이지에서 상품 개수를 확인하지 못했습니다.");
  }

  const productCount = Number(match[1].replaceAll(",", ""));
  console.log(`현재 상품 수: ${productCount}건`);

  if (productCount > 0) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      throw new Error("Telegram 비밀정보를 찾지 못했습니다.");
    }

    const message = [
      "🚨 포켓몬스토어 재입고 감지!",
      "",
      `현재 상품 수: ${productCount}건`,
      PRODUCT_URL,
    ].join("\n");

    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
        }),
      },
    );

    const result = await response.json();

    if (!result.ok) {
      throw new Error(`Telegram 전송 실패: ${result.description}`);
    }

    fs.writeFileSync(
      NOTIFIED_FILE,
      `알림 전송 시각: ${new Date().toISOString()}\n상품 수: ${productCount}\n`,
    );

    console.log("Telegram 알림을 전송했습니다.");
  }
} finally {
  await browser.close();
}
