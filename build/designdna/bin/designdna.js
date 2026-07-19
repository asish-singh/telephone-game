#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { extractDesign } from "../src/extract.js";
import { renderDesignMd } from "../src/report.js";

function usage() {
  return "Usage: node bin/designdna.js <url> [-o <DESIGN.md>] [--json <capture.json>]";
}

function parseArguments(argv) {
  let url;
  let jsonPath;
  let outputPath;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (argument === "--json") {
      jsonPath = argv[index + 1];
      if (!jsonPath || jsonPath.startsWith("-")) throw new Error("--json requires a file path.");
      index += 1;
      continue;
    }
    if (argument.startsWith("--json=")) {
      jsonPath = argument.slice("--json=".length);
      if (!jsonPath) throw new Error("--json requires a file path.");
      continue;
    }
    if (argument === "-o" || argument === "--output") {
      outputPath = argv[index + 1];
      if (!outputPath || outputPath.startsWith("-")) throw new Error(`${argument} requires a file path.`);
      index += 1;
      continue;
    }
    if (argument.startsWith("--output=")) {
      outputPath = argument.slice("--output=".length);
      if (!outputPath) throw new Error("--output requires a file path.");
      continue;
    }
    if (!argument.startsWith("-") && !url) {
      url = argument;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!url || (!jsonPath && !outputPath)) {
    throw new Error(usage());
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (!new Set(["http:", "https:"]).has(parsedUrl.protocol)) {
    throw new Error("Only http:// and https:// URLs are supported.");
  }

  return {
    url: parsedUrl.href,
    jsonPath: jsonPath ? resolve(jsonPath) : null,
    outputPath: outputPath ? resolve(outputPath) : null,
  };
}

async function writeOutput(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
  console.log(`Wrote ${path}`);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const capture = await extractDesign(args.url);
  if (args.jsonPath) {
    await writeOutput(args.jsonPath, `${JSON.stringify(capture, null, 2)}\n`);
  }
  if (args.outputPath) {
    await writeOutput(args.outputPath, renderDesignMd(capture));
  }
  console.log(
    `Captured ${capture.colors.items.length} colors, ` +
      `${capture.animations.keyframes.length} keyframes, and ` +
      `${capture.sections.items.length} sections.`,
  );
}

main().catch((error) => {
  console.error(`designdna: ${error.message}`);
  process.exitCode = 1;
});
