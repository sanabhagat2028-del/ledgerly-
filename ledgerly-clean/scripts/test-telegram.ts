import assert from "node:assert/strict";
import { parseTelegramLink, telegramCommand, verifyTelegramSecret } from "../lib/notify";
import { answerCommand } from "../lib/digest";

let passed = 0;
const t = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log("ok  ", name);
};

t("link code from the deep link", () => {
  assert.equal(parseTelegramLink("/start 123456"), "123456");
  assert.equal(parseTelegramLink("/start@LedgerlyBot 123456"), "123456");
  assert.equal(parseTelegramLink("  123456 "), "123456");
});

t("things that are not link codes", () => {
  assert.equal(parseTelegramLink("/start"), null);
  assert.equal(parseTelegramLink("12345"), null);
  assert.equal(parseTelegramLink("1234567"), null);
  assert.equal(parseTelegramLink("month"), null);
  assert.equal(parseTelegramLink("/start 12345a"), null);
});

t("commands lose the slash and bot name", () => {
  assert.equal(telegramCommand("/month"), "month");
  assert.equal(telegramCommand("/month@LedgerlyBot"), "month");
  assert.equal(telegramCommand("  Food "), "Food");
});

t("webhook secret check", () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret_value";
  assert.equal(verifyTelegramSecret("s3cret_value"), true);
  assert.equal(verifyTelegramSecret("wrong"), false);
  assert.equal(verifyTelegramSecret(null), false);
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  assert.equal(verifyTelegramSecret("s3cret_value"), false);
});

t("bot commands reach the same answers as before", () => {
  const today = { iso: "2026-10-15", year: 2026, month: 10, day: 15, dow: 4 };
  assert.match(answerCommand(telegramCommand("/help"), [], [], [], false, today), /Ledgerly/);
  assert.match(answerCommand(telegramCommand("/month"), [], [], [], false, today), /empty/);
});

console.log(`\n${passed} telegram tests passed`);
