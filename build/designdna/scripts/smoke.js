#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractDesign } from "../src/extract.js";

const targets = [
  { name: "example", url: "https://example.com/" },
  { name: "shopify-winter2026", url: "https://www.shopify.com/editions/winter2026" },
];

const outputDirectory = resolve("captures");
await mkdir(outputDirectory, { recursive: true });
let failures = 0;

for (const target of targets) {
  try {
    const capture = await extractDesign(target.url);
    const outputPath = resolve(outputDirectory, `${target.name}.json`);
    await writeFile(outputPath, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
    console.log(
      `${target.name}: ${capture.colors.items.length} colors, ` +
        `${capture.animations.keyframes.length} keyframes, ` +
        `${capture.sections.items.length} sections -> ${outputPath}`,
    );
  } catch (error) {
    failures += 1;
    const firstLine = (error instanceof Error ? error.message : String(error)).split("\n", 1)[0];
    console.error(`${target.name}: FAILED — ${firstLine}`);
  }
}

if (failures) process.exitCode = 1;
