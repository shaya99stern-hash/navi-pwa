/** Money maths. Exact arithmetic, stated assumptions, no advice. */
import type { Executor } from "../registry";
import { fail, ok, str } from "./text";

const num = (input: Record<string, unknown>, key: string, fallback?: number) => {
  const raw = input[key];
  const value = typeof raw === "string" ? Number(raw.replace(/[^\d.-]/g, "")) : Number(raw);
  return Number.isFinite(value) ? value : fallback;
};
const firstNumber = (text: string) => {
  const m = text.match(/-?[\d,]*\.?\d+/g);
  return m ? m.map((v) => Number(v.replace(/,/g, ""))) : [];
};
const money = (n: number, currency = "") => `${currency}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const compoundInterest: Executor = async (input) => {
  const nums = firstNumber(str(input));
  const principal = num(input, "principal", nums[0]);
  const rate = num(input, "rate", nums[1]);
  const years = num(input, "years", nums[2]);
  if (![principal, rate, years].every((v) => Number.isFinite(v))) {
    return fail("Give principal=, rate= (percent per year) and years=.");
  }
  const perYear = num(input, "compounds", 12)!;
  const contribution = num(input, "contribution", 0)!;
  const r = rate! / 100;
  const growth = (1 + r / perYear) ** (perYear * years!);
  const fromPrincipal = principal! * growth;
  const fromContributions = r === 0 ? contribution * perYear * years! : contribution * ((growth - 1) / (r / perYear));
  const total = fromPrincipal + fromContributions;
  const paidIn = principal! + contribution * perYear * years!;
  return ok([
    `Future value   ${money(total)}`,
    `Paid in        ${money(paidIn)}`,
    `Interest       ${money(total - paidIn)}`,
    ``,
    `${principal} at ${rate}% for ${years} years, compounded ${perYear}x/year${contribution ? `, plus ${money(contribution)} per period` : ""}.`
  ].join("\n"));
};

export const loanPayment: Executor = async (input) => {
  const nums = firstNumber(str(input));
  const principal = num(input, "principal", nums[0]);
  const rate = num(input, "rate", nums[1]);
  const years = num(input, "years", nums[2]);
  if (![principal, rate, years].every((v) => Number.isFinite(v))) return fail("Give principal=, rate= and years=.");
  const n = years! * 12;
  const i = rate! / 100 / 12;
  const payment = i === 0 ? principal! / n : (principal! * i) / (1 - (1 + i) ** -n);
  const total = payment * n;
  return ok([
    `Monthly payment ${money(payment)}`,
    `Total repaid    ${money(total)}`,
    `Total interest  ${money(total - principal!)}`,
    `Over ${n} payments at ${rate}% APR.`
  ].join("\n"));
};

export const currencyFormat: Executor = async (input) => {
  const nums = firstNumber(str(input));
  const amount = num(input, "amount", nums[0]);
  if (!Number.isFinite(amount)) return fail("Give an amount.");
  const currency = String(input.currency ?? "USD").toUpperCase();
  const locale = String(input.locale ?? "en-US");
  try {
    return ok(new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount!));
  } catch {
    return fail(`Unknown currency or locale: ${currency} / ${locale}`);
  }
};

export const tipCalculate: Executor = async (input) => {
  const nums = firstNumber(str(input));
  const bill = num(input, "bill", nums[0]);
  if (!Number.isFinite(bill)) return fail("Give the bill amount.");
  const percent = num(input, "percent", nums[1] ?? 15)!;
  const split = Math.max(1, num(input, "split", 1)!);
  const tip = bill! * percent / 100;
  const total = bill! + tip;
  return ok([
    `Tip (${percent}%)  ${money(tip)}`,
    `Total       ${money(total)}`,
    split > 1 ? `Each of ${split}  ${money(total / split)}` : ""
  ].filter(Boolean).join("\n"));
};

export const discountCalculate: Executor = async (input) => {
  const nums = firstNumber(str(input));
  const price = num(input, "price", nums[0]);
  const percent = num(input, "percent", nums[1]);
  if (![price, percent].every((v) => Number.isFinite(v))) return fail("Give price= and percent=.");
  const saved = price! * percent! / 100;
  return ok(`Was ${money(price!)}\nSave ${money(saved)} (${percent}%)\nNow ${money(price! - saved)}`);
};

export const vatCalculate: Executor = async (input) => {
  const nums = firstNumber(str(input));
  const amount = num(input, "amount", nums[0]);
  const rate = num(input, "rate", nums[1] ?? 20);
  if (!Number.isFinite(amount)) return fail("Give an amount and rate=.");
  const inclusive = input.inclusive === true || /incl/i.test(str(input));
  const net = inclusive ? amount! / (1 + rate! / 100) : amount!;
  const tax = net * rate! / 100;
  return ok([
    `Net    ${money(net)}`,
    `VAT    ${money(tax)} at ${rate}%`,
    `Gross  ${money(net + tax)}`,
    inclusive ? "(treated the figure you gave as VAT-inclusive)" : "(treated the figure you gave as VAT-exclusive)"
  ].join("\n"));
};

export const roiCalculate: Executor = async (input) => {
  const nums = firstNumber(str(input));
  const cost = num(input, "cost", nums[0]);
  const gain = num(input, "gain", nums[1]);
  if (![cost, gain].every((v) => Number.isFinite(v))) return fail("Give cost= and gain= (final value).");
  const profit = gain! - cost!;
  const roi = (profit / cost!) * 100;
  const years = num(input, "years", 0)!;
  const annualised = years > 0 ? ((gain! / cost!) ** (1 / years) - 1) * 100 : null;
  return ok([
    `Profit ${money(profit)}`,
    `ROI    ${roi.toFixed(2)}%`,
    annualised !== null ? `Annualised ${annualised.toFixed(2)}% over ${years} years` : ""
  ].filter(Boolean).join("\n"));
};

export const breakEven: Executor = async (input) => {
  const fixed = num(input, "fixed", firstNumber(str(input))[0]);
  const price = num(input, "price", firstNumber(str(input))[1]);
  const variable = num(input, "variable", firstNumber(str(input))[2] ?? 0)!;
  if (![fixed, price].every((v) => Number.isFinite(v))) return fail("Give fixed=, price= and variable= per unit.");
  const contribution = price! - variable;
  if (contribution <= 0) return fail("Price must exceed variable cost, or there is no break-even.");
  const units = fixed! / contribution;
  return ok([
    `Break-even ${Math.ceil(units)} units`,
    `Revenue at break-even ${money(Math.ceil(units) * price!)}`,
    `Contribution per unit ${money(contribution)}`
  ].join("\n"));
};

export const depreciation: Executor = async (input) => {
  const cost = num(input, "cost", firstNumber(str(input))[0]);
  const years = num(input, "years", firstNumber(str(input))[1]);
  if (![cost, years].every((v) => Number.isFinite(v))) return fail("Give cost= and years=.");
  const salvage = num(input, "salvage", 0)!;
  const straight = (cost! - salvage) / years!;
  const rows: string[] = [];
  let book = cost!;
  for (let y = 1; y <= Math.min(years!, 15); y += 1) {
    book -= straight;
    rows.push(`year ${String(y).padStart(2)}  charge ${money(straight)}  book ${money(Math.max(salvage, book))}`);
  }
  return ok([`Straight line, ${money(straight)} per year.`, "", ...rows].join("\n"));
};

export const marginMarkup: Executor = async (input) => {
  const cost = num(input, "cost", firstNumber(str(input))[0]);
  const price = num(input, "price", firstNumber(str(input))[1]);
  if (![cost, price].every((v) => Number.isFinite(v))) return fail("Give cost= and price=.");
  const profit = price! - cost!;
  return ok([
    `Profit  ${money(profit)}`,
    `Margin  ${((profit / price!) * 100).toFixed(2)}%  (profit ÷ price)`,
    `Markup  ${((profit / cost!) * 100).toFixed(2)}%  (profit ÷ cost)`,
    "Margin and markup are different numbers for the same sale; mixing them up is the usual pricing error."
  ].join("\n"));
};
