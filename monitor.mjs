import { chromium } from "playwright";
import fs from "node:fs";

const CATEGORY_URL =
  "https://www.pokemonstore.co.kr/pages/product/product-list.html?categoryNo=488339";

const END_DATE = new Date("2026-08-06T00:00:00+09:00");
const STATE_FILE = "stock-state.json";
const PAGE_SIZE = 80;

if (new Date() >= END_DATE) {
  console.log("감시 기간이 종료되었습니다.");
  process.exit(0);
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
  throw new Error("Telegram 비밀정보를 찾지 못했습니다.");
}

async function sendTelegram(product) {
  const message = [
    "🚨 포켓몬 카드 게임 재입고!",
    "",
    product.name,
    "",
    "바로 구매하기:",
    product.url,
  ].join("\n");

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: false,
      }),
    },
  );

  const result = await response.json();

  if (!result.ok) {
    throw new Error(`Telegram 전송 실패: ${result.description}`);
  }
}

const previousState = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  : null;

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const currentState = {};

  await page.goto(
    `${CATEGORY_URL}&sortType=SALE_CNT&direction=&pageSize=${PAGE_SIZE}&pageNumber=1`,
    {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    },
  );

  await page.waitForTimeout(5000);

  const totalText = await page.locator(".total-count").innerText();
  const totalMatch = totalText.match(/([0-9,]+)/);

  if (!totalMatch) {
    throw new Error("전체 상품 수를 확인하지 못했습니다.");
  }

  const totalCount = Number(totalMatch[1].replaceAll(",", ""));
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
    if (pageNumber > 1) {
      await page.goto(
        `${CATEGORY_URL}&sortType=SALE_CNT&direction=&pageSize=${PAGE_SIZE}&pageNumber=${pageNumber}`,
        {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        },
      );

      await page.waitForTimeout(3000);
    }

    const products = await page.locator(".thumb-item").evaluateAll((cards) =>
      cards.map((card) => {
        const link = card.querySelector(
          'a[href*="/pages/product/product-detail.html"]',
        );
        const title = card.querySelector(".product-thumb-title");
        const soldOut = card.querySelector(".thumb-item__overlay");

        return {
          name: title?.textContent?.trim() || "상품명 확인 필요",
          url: link ? new URL(link.href, location.origin).href : "",
          soldOut: soldOut?.textContent?.includes("SOLD OUT") || false,
        };
      }),
    );

    for (const product of products) {
      if (product.url) {
        currentState[product.url] = product;
      }
    }
  }

  const collectedCount = Object.keys(currentState).length;
  console.log(`카드 게임 상품 ${collectedCount}건 확인 완료`);

  if (collectedCount !== totalCount) {
    throw new Error(
      `상품 수가 일치하지 않습니다: 전체 ${totalCount}건, 확인 ${collectedCount}건`,
    );
  }

  if (previousState) {
    const restockedProducts = Object.values(currentState).filter((product) => {
      const previous = previousState[product.url];
      return previous?.soldOut === true && product.soldOut === false;
    });

    console.log(`재입고 상품 ${restockedProducts.length}건`);

    for (const product of restockedProducts) {
      await sendTelegram(product);
      console.log(`알림 전송: ${product.name}`);
    }
  } else {
    console.log("최초 실행: 현재 품절 상태를 기준으로 저장합니다.");
  }

  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(currentState, null, 2) + "\n",
  );
} finally {
  await browser.close();
}
