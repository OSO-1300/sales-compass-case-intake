#!/usr/bin/env node
import fs from "node:fs/promises";
import { processIntake, PossibleMatchError } from "./lib/customer-case-management.mjs";

function parseArgs(argv) {
  const args = { rootDir: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") {
      args.input = argv[++i];
    } else if (arg === "--root") {
      args.rootDir = argv[++i];
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`不明な引数: ${arg}`);
    }
  }
  if (!args.input) {
    throw new Error("--input を指定してください。");
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const intake = JSON.parse(await fs.readFile(args.input, "utf8"));
  const result = await processIntake(intake, { rootDir: args.rootDir });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.leon_message);
    if (result.warnings.length) {
      console.log("");
      console.log("警告：");
      for (const warning of result.warnings) {
        console.log(`${warning.type}: existing=${warning.existing} incoming=${warning.incoming}`);
      }
    }
  }
} catch (error) {
  if (error instanceof PossibleMatchError) {
    console.log(error.leon_message);
    process.exitCode = 2;
  } else {
    console.error(error.message);
    process.exitCode = 1;
  }
}
