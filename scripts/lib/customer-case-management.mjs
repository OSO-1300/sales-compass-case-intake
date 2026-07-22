import fs from "node:fs/promises";
import path from "node:path";

const CUSTOMER_ID_PATTERN = /^CUS-(\d{6})$/;
const CASE_ID_PATTERN = /^CASE-(\d{8})-(\d{3})$/;
const LEGAL_ENTITY_WORDS = [
  "株式会社",
  "有限会社",
  "合同会社",
  "合資会社",
  "合名会社",
  "（株）",
  "(株)",
  "㈱",
  "（有）",
  "(有)",
  "㈲"
];

export class PossibleMatchError extends Error {
  constructor(candidates, leonMessage) {
    super("POSSIBLE_MATCH");
    this.name = "PossibleMatchError";
    this.code = "POSSIBLE_MATCH";
    this.candidates = candidates;
    this.leon_message = leonMessage;
  }
}

export async function processIntake(intake, options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const customersDir = path.join(rootDir, "customers");
  const now = options.now ? new Date(options.now) : new Date();
  const nowIso = toJapanIsoString(now);
  const normalizedInput = normalizeCustomerName(intake.customer_name);
  const receivedDate = normalizeDate(intake.received_date || intake.contact_date);
  const expectedAttachments = normalizeAttachments(intake.expected_attachments);

  validateIntake({ ...intake, received_date: receivedDate, customer_name: intake.customer_name });

  await fs.mkdir(customersDir, { recursive: true });
  return withLock(customersDir, async () => {
    const customers = await loadCustomers(customersDir);
    const match = findCustomerMatch(customers, normalizedInput);

    if (match.type === "POSSIBLE_MATCH") {
      throw new PossibleMatchError(
        match.candidates.map(publicCustomer),
        leonPossibleMatch(match.candidates)
      );
    }

    const caseId = await nextCaseId(customersDir, receivedDate);
    let customer;
    let customerDir;
    let resultType;
    const warnings = [];

    if (match.type === "EXACT_MATCH") {
      customer = match.customer.data;
      customerDir = match.customer.dir;
      resultType = "EXACT_MATCH";

      const incomingIndustry = cleanText(intake.industry);
      if (incomingIndustry && customer.industry && incomingIndustry !== customer.industry) {
        warnings.push({
          type: "INDUSTRY_CONFLICT",
          existing: customer.industry,
          incoming: incomingIndustry
        });
      } else if (incomingIndustry && !customer.industry) {
        customer.industry = incomingIndustry;
      }
      customer.updated_at = nowIso;
    } else {
      const customerId = await nextCustomerId(customers);
      customer = {
        customer_id: customerId,
        customer_name: cleanText(intake.customer_name),
        normalized_customer_name: normalizedInput.normalized,
        industry: cleanText(intake.industry),
        created_at: nowIso,
        updated_at: nowIso,
        status: "ACTIVE"
      };
      customerDir = path.join(customersDir, `${customerId}_${safeFolderName(customer.customer_name)}`);
      resultType = "NEW_CUSTOMER";
    }

    const caseDir = path.join(customerDir, "cases", caseId);
    const caseData = {
      case_id: caseId,
      customer_id: customer.customer_id,
      received_date: receivedDate,
      contact_type: cleanText(intake.contact_type),
      industry: cleanText(intake.industry),
      consultation: cleanText(intake.consultation),
      expected_attachments: expectedAttachments,
      status: expectedAttachments.length ? "WAITING_ATTACHMENT" : "RECEIVED",
      created_at: nowIso,
      updated_at: nowIso
    };

    if (resultType === "NEW_CUSTOMER") {
      await createCustomerWithCase(customerDir, customer, caseDir, caseData);
    } else {
      await appendCaseToExistingCustomer(customerDir, customer, caseDir, caseData);
    }

    const leonMessage = resultType === "NEW_CUSTOMER"
      ? leonNewCustomer(customer.customer_id, caseId, caseData.status)
      : leonExistingCustomer(customer.customer_id, caseId, caseData.status);

    return {
      result: resultType,
      customer_id: customer.customer_id,
      case_id: caseId,
      customer_dir: customerDir,
      case_dir: caseDir,
      status: caseData.status,
      warnings,
      leon_message: leonMessage
    };
  });
}

export function normalizeCustomerName(value) {
  const source = cleanText(value).replace(/\u3000/g, " ").replace(/\s+/g, " ");
  const lower = source.toLocaleLowerCase("ja-JP");
  const withoutSpaces = lower.replace(/\s+/g, "");
  let legalEntityRemoved = withoutSpaces;
  for (const word of LEGAL_ENTITY_WORDS) {
    legalEntityRemoved = legalEntityRemoved.split(word.toLocaleLowerCase("ja-JP")).join("");
  }
  return {
    normalized: withoutSpaces,
    legal_entity_removed: legalEntityRemoved
  };
}

export function findCustomerMatch(customers, normalizedInput) {
  const exact = customers.find((entry) => {
    const data = entry.data;
    return data.customer_id === normalizedInput.normalized
      || normalizeCustomerName(data.customer_name).normalized === normalizedInput.normalized
      || cleanText(data.normalized_customer_name) === normalizedInput.normalized;
  });

  if (exact) {
    return { type: "EXACT_MATCH", customer: exact };
  }

  const possible = customers.filter((entry) => {
    const candidate = normalizeCustomerName(entry.data.customer_name);
    return candidate.legal_entity_removed
      && normalizedInput.legal_entity_removed
      && candidate.legal_entity_removed === normalizedInput.legal_entity_removed;
  });

  if (possible.length) {
    return { type: "POSSIBLE_MATCH", candidates: possible };
  }

  return { type: "NEW_CUSTOMER" };
}

export async function loadCustomers(customersDir) {
  const entries = await safeReaddir(customersDir, { withFileTypes: true });
  const customers = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("CUS-")) {
      continue;
    }

    const dir = path.join(customersDir, entry.name);
    const jsonPath = path.join(dir, "customer.json");
    const data = await readJsonIfExists(jsonPath);
    if (data && data.customer_id) {
      customers.push({ dir, data });
    }
  }

  return customers;
}

async function nextCustomerId(customers) {
  let max = 0;
  for (const entry of customers) {
    const match = CUSTOMER_ID_PATTERN.exec(entry.data.customer_id || "");
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `CUS-${String(max + 1).padStart(6, "0")}`;
}

async function nextCaseId(customersDir, receivedDate) {
  const ymd = receivedDate.replace(/-/g, "");
  const customers = await loadCustomers(customersDir);
  let max = 0;

  for (const customer of customers) {
    const casesDir = path.join(customer.dir, "cases");
    const entries = await safeReaddir(casesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const match = CASE_ID_PATTERN.exec(entry.name);
      if (match && match[1] === ymd) {
        max = Math.max(max, Number(match[2]));
      }
    }
  }

  return `CASE-${ymd}-${String(max + 1).padStart(3, "0")}`;
}

async function createCustomerWithCase(customerDir, customer, caseDir, caseData) {
  const parentDir = path.dirname(customerDir);
  const tempDir = path.join(parentDir, `.tmp-${customer.customer_id}-${Date.now()}-${process.pid}`);

  await fs.mkdir(path.join(tempDir, "cases", caseData.case_id, "intake"), { recursive: true });
  await fs.mkdir(path.join(tempDir, "cases", caseData.case_id, "attachments"), { recursive: true });
  await fs.mkdir(path.join(tempDir, "cases", caseData.case_id, "research"), { recursive: true });
  await fs.mkdir(path.join(tempDir, "cases", caseData.case_id, "tasks"), { recursive: true });
  await writeJsonAtomic(path.join(tempDir, "customer.json"), customer);
  await writeJsonAtomic(path.join(tempDir, "cases", caseData.case_id, "case.json"), caseData);

  try {
    await fs.rename(tempDir, customerDir);
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function appendCaseToExistingCustomer(customerDir, customer, caseDir, caseData) {
  const casesDir = path.dirname(caseDir);
  const tempCaseDir = path.join(casesDir, `.tmp-${caseData.case_id}-${Date.now()}-${process.pid}`);

  await fs.mkdir(path.join(tempCaseDir, "intake"), { recursive: true });
  await fs.mkdir(path.join(tempCaseDir, "attachments"), { recursive: true });
  await fs.mkdir(path.join(tempCaseDir, "research"), { recursive: true });
  await fs.mkdir(path.join(tempCaseDir, "tasks"), { recursive: true });
  await writeJsonAtomic(path.join(tempCaseDir, "case.json"), caseData);

  try {
    await fs.rename(tempCaseDir, caseDir);
    await writeJsonAtomic(path.join(customerDir, "customer.json"), customer);
  } catch (error) {
    await fs.rm(tempCaseDir, { recursive: true, force: true });
    throw error;
  }
}

async function withLock(customersDir, fn) {
  const lockDir = path.join(customersDir, ".sales-compass-lock");
  const started = Date.now();

  while (true) {
    try {
      await fs.mkdir(lockDir);
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || Date.now() - started > 5000) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  try {
    return await fn();
  } finally {
    await fs.rm(lockDir, { recursive: true, force: true });
  }
}

async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${Date.now()}.${process.pid}.tmp`);
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

function validateIntake(intake) {
  const missing = [];
  if (!normalizeDate(intake.received_date)) missing.push("received_date");
  if (!cleanText(intake.contact_type)) missing.push("contact_type");
  if (!cleanText(intake.customer_name)) missing.push("customer_name");
  if (!cleanText(intake.industry)) missing.push("industry");
  if (!cleanText(intake.consultation)) missing.push("consultation");
  if (missing.length) {
    throw new Error(`必須項目が不足: ${missing.join(", ")}`);
  }
}

function normalizeDate(value) {
  const text = cleanText(value).replace(/\//g, "-");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return "";
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(cleanText).filter(Boolean);
}

function cleanText(value) {
  return String(value ?? "").replace(/\u3000/g, " ").trim();
}

function safeFolderName(value) {
  const cleaned = cleanText(value)
    .replace(/[\\/:*?"<>|%]/g, "_")
    .replace(/[\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "customer";
}

function toJapanIsoString(date) {
  const japan = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${japan.getUTCFullYear()}-${String(japan.getUTCMonth() + 1).padStart(2, "0")}-${String(japan.getUTCDate()).padStart(2, "0")}T${String(japan.getUTCHours()).padStart(2, "0")}:${String(japan.getUTCMinutes()).padStart(2, "0")}:${String(japan.getUTCSeconds()).padStart(2, "0")}+09:00`;
}

async function safeReaddir(dir, options) {
  try {
    return await fs.readdir(dir, options);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function publicCustomer(entry) {
  return {
    customer_id: entry.data.customer_id,
    customer_name: entry.data.customer_name
  };
}

function leonNewCustomer(customerId, caseId, status) {
  return [
    "案件を受領した。",
    "",
    "新規Customerを登録。",
    "",
    "Customer ID：",
    customerId,
    "",
    "Case ID：",
    caseId,
    "",
    "格納先を作成した。",
    "",
    status === "WAITING_ATTACHMENT" ? "添付資料を待つ。" : "添付予定なし。"
  ].join("\n");
}

function leonExistingCustomer(customerId, caseId, status) {
  return [
    "案件を受領した。",
    "",
    "既存Customerを確認。",
    "",
    "Customer ID：",
    customerId,
    "",
    "Case ID：",
    caseId,
    "",
    "既存顧客フォルダへ追加した。",
    "",
    status === "WAITING_ATTACHMENT" ? "添付資料を待つ。" : "添付予定なし。"
  ].join("\n");
}

function leonPossibleMatch(candidates) {
  return [
    "案件を受領した。",
    "",
    "似たCustomerがある。",
    "",
    "自動登録は止めた。",
    "",
    "候補：",
    ...candidates.map((entry) => `${entry.data.customer_id} ${entry.data.customer_name}`),
    "",
    "確認が必要だ。"
  ].join("\n");
}
