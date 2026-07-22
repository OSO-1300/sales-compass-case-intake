import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { processIntake, PossibleMatchError } from "../scripts/lib/customer-case-management.mjs";

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "sales-compass-phase2-"));
}

function intake(overrides = {}) {
  return {
    received_date: "2026-07-22",
    contact_type: "訪問",
    customer_name: "H鉄工所",
    industry: "製造業",
    consultation: "工場内Wi-Fiの通信が不安定",
    expected_attachments: [],
    ...overrides
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const root = await tempRoot();

  const first = await processIntake(intake({ expected_attachments: ["ネットワーク構成図"] }), {
    rootDir: root,
    now: "2026-07-22T03:00:00Z"
  });
  assert.equal(first.result, "NEW_CUSTOMER");
  assert.equal(first.customer_id, "CUS-000001");
  assert.equal(first.case_id, "CASE-20260722-001");
  assert.equal(first.status, "WAITING_ATTACHMENT");
  assert.equal(await exists(path.join(root, "customers")), true);
  assert.equal(await exists(path.join(first.case_dir, "intake")), true);
  assert.equal(await exists(path.join(first.case_dir, "attachments")), true);
  assert.equal(await exists(path.join(first.case_dir, "research")), true);
  assert.equal(await exists(path.join(first.case_dir, "tasks")), true);

  const firstCustomer = await readJson(path.join(first.customer_dir, "customer.json"));
  assert.equal(firstCustomer.customer_id, "CUS-000001");

  const second = await processIntake(intake({ customer_name: "  H鉄工所  " }), { rootDir: root });
  assert.equal(second.result, "EXACT_MATCH");
  assert.equal(second.customer_id, "CUS-000001");
  assert.equal(second.case_id, "CASE-20260722-002");
  assert.equal(second.status, "RECEIVED");

  const third = await processIntake(intake({ customer_name: "M運送", expected_attachments: ["平面図"] }), { rootDir: root });
  assert.equal(third.customer_id, "CUS-000002");
  assert.equal(third.case_id, "CASE-20260722-003");

  const otherDay = await processIntake(intake({ received_date: "2026-07-23", customer_name: "K病院" }), { rootDir: root });
  assert.equal(otherDay.case_id, "CASE-20260723-001");

  const unsafe = await processIntake(intake({ customer_name: "A/B:工業*テスト?", received_date: "2026-07-24" }), { rootDir: root });
  assert.equal(unsafe.customer_id, "CUS-000004");
  assert.match(path.basename(unsafe.customer_dir), /^CUS-000004_A_B_工業_テスト$/);

  const beforeConflict = await readJson(path.join(first.customer_dir, "customer.json"));
  const conflict = await processIntake(intake({ customer_name: "H鉄工所", industry: "建設業", received_date: "2026-07-24" }), { rootDir: root });
  const afterConflict = await readJson(path.join(first.customer_dir, "customer.json"));
  assert.equal(conflict.warnings[0].type, "INDUSTRY_CONFLICT");
  assert.equal(afterConflict.industry, beforeConflict.industry);

  await assert.rejects(
    () => processIntake(intake({ customer_name: "株式会社H鉄工所" }), { rootDir: root }),
    (error) => {
      assert.equal(error instanceof PossibleMatchError, true);
      assert.equal(error.candidates[0].customer_id, "CUS-000001");
      return true;
    }
  );

  const concurrentRoot = await tempRoot();
  const jobs = [];
  for (let i = 0; i < 5; i += 1) {
    jobs.push(processIntake(intake({ customer_name: `連続${i}`, expected_attachments: ["見積書"] }), { rootDir: concurrentRoot }));
  }
  const results = await Promise.all(jobs);
  assert.deepEqual(
    results.map((result) => result.customer_id).sort(),
    ["CUS-000001", "CUS-000002", "CUS-000003", "CUS-000004", "CUS-000005"]
  );
  assert.deepEqual(
    results.map((result) => result.case_id).sort(),
    ["CASE-20260722-001", "CASE-20260722-002", "CASE-20260722-003", "CASE-20260722-004", "CASE-20260722-005"]
  );

  const repoIndex = await fs.readFile(path.resolve("index.html"), "utf8");
  assert.match(repoIndex, /apple-mobile-web-app-capable/);
  assert.match(repoIndex, /SC_updateAttachmentSummary/);

  console.log("All Phase2 Customer & Case Management tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
