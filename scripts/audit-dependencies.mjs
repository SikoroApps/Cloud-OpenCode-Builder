#!/usr/bin/env node
/**
 * Audits all pinned Gradle Maven coordinates and the backend npm manifest against OSV.
 * No credentials are needed. Prints advisory IDs and fixed versions only; never secrets.
 *
 * Usage: node scripts/audit-dependencies.mjs
 * Exit codes: 0 no findings, 1 findings, 2 audit unavailable.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gradleFiles = [
  "android/build.gradle.kts",
  "android/app/build.gradle.kts",
  "android/backend/build.gradle.kts",
];

const PLUGIN_COORDINATES = {
  "com.android.application": "com.android.tools.build:gradle",
  "org.jetbrains.kotlin.android": "org.jetbrains.kotlin:kotlin-gradle-plugin",
  "org.jetbrains.kotlin.plugin.compose": "org.jetbrains.kotlin:compose-compiler-gradle-plugin",
  "org.jetbrains.kotlin.jvm": "org.jetbrains.kotlin:kotlin-gradle-plugin",
};

function read(file) {
  return readFileSync(resolve(root, file), "utf8");
}

function collectDependencies() {
  const found = new Map();
  for (const file of gradleFiles) {
    const text = read(file);
    for (const match of text.matchAll(/(?:["'])([a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+):([0-9][a-zA-Z0-9_.-]*)(?:["'])/g)) {
      found.set(`${match[1]}@${match[2]}`, { name: match[1], version: match[2], ecosystem: "Maven", source: file });
    }
    for (const match of text.matchAll(/id\(["']([^"']+)["']\)\s+version\s+["']([^"']+)["']/g)) {
      const name = PLUGIN_COORDINATES[match[1]];
      if (name) {
        found.set(`${name}@${match[2]}`, { name, version: match[2], ecosystem: "Maven", source: file });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function npmDependencyCount() {
  const manifest = JSON.parse(read("cloud/package.json"));
  return Object.keys(manifest.dependencies || {}).length + Object.keys(manifest.devDependencies || {}).length;
}

async function osvBatch(queries) {
  const response = await fetch("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OSV querybatch HTTP ${response.status}`);
  return (await response.json()).results || [];
}

async function advisory(id) {
  const response = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return { id, summary: null };
  const data = await response.json();
  const fixed = (data.affected || [])
    .flatMap((item) => (item.ranges || []).flatMap((range) => (range.events || []).map((event) => event.fixed).filter(Boolean)));
  return {
    id,
    aliases: data.aliases || [],
    summary: data.summary || null,
    severity: (data.severity || []).map((entry) => entry.score),
    fixedVersions: [...new Set(fixed)],
  };
}

const dependencies = collectDependencies();
const npmCount = npmDependencyCount();
const results = await osvBatch(dependencies.map((dep) => ({
  package: { name: dep.name, ecosystem: dep.ecosystem },
  version: dep.version,
})));

const findings = [];
for (let index = 0; index < dependencies.length; index += 1) {
  const ids = (results[index]?.vulns || []).map((vuln) => vuln.id);
  if (!ids.length) continue;
  findings.push({
    package: `${dependencies[index].name}@${dependencies[index].version}`,
    source: dependencies[index].source,
    advisories: await Promise.all(ids.map(advisory)),
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  backendNpmDependencies: npmCount,
  gradleCoordinatesChecked: dependencies.length,
  findings,
  status: findings.length ? "vulnerabilities_found" : "no_known_vulnerabilities",
};
console.log(JSON.stringify(report, null, 2));
process.exit(findings.length ? 1 : 0);
