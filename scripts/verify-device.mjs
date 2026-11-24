#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_PACKAGE = "com.sikorokoro44.cloudopencode";

function parseArgs(argv) {
  const options = {
    apk: "",
    packageName: DEFAULT_PACKAGE,
    adb: process.env.ADB_BIN || "adb",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apk") options.apk = argv[++index] || "";
    else if (argument === "--package") options.packageName = argv[++index] || DEFAULT_PACKAGE;
    else if (argument === "--adb") options.adb = argv[++index] || options.adb;
  }
  return options;
}

function emit(report, exitCode) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = exitCode;
}

function run(adb, args) {
  return spawnSync(adb, args, { encoding: "utf8", timeout: 120_000 });
}

function firstLine(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

const options = parseArgs(process.argv.slice(2));
if (!options.apk) {
  emit({ status: "blocked", reason: "apk_not_provided", usage: "node scripts/verify-device.mjs --apk /path/to/app-release.apk" }, 2);
} else {
  const apkPath = resolve(options.apk);
  if (!existsSync(apkPath)) {
    emit({ status: "blocked", reason: "apk_not_found", package: options.packageName }, 2);
  } else {
    const apkSha256 = createHash("sha256").update(readFileSync(apkPath)).digest("hex");
    const version = run(options.adb, ["version"]);
    if (version.error || version.status !== 0) {
      emit({
        status: "blocked",
        reason: "adb_unavailable",
        package: options.packageName,
        apkSha256,
        note: "Install Android platform-tools and connect a physical device with USB debugging enabled.",
      }, 2);
    } else {
      const devices = run(options.adb, ["devices"]);
      const serials = String(devices.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.match(/^(\S+)\s+device\s*$/)?.[1] || "")
        .filter((serial) => serial && !serial.startsWith("emulator-"));
      if (!serials.length) {
        emit({
          status: "blocked",
          reason: "no_authorized_physical_device",
          package: options.packageName,
          apkSha256,
          note: "No authorized non-emulator device was found. Emulator runs are not physical-device evidence.",
        }, 2);
      } else {
        const serial = serials[0];
        const install = run(options.adb, ["-s", serial, "install", "-r", apkPath]);
        if (install.status !== 0) {
          emit({
            status: "failed",
            reason: "install_failed",
            device: serial,
            package: options.packageName,
            apkSha256,
            output: firstLine(install.stderr || install.stdout),
          }, 1);
        } else {
          const pathResult = run(options.adb, ["-s", serial, "shell", "pm", "path", options.packageName]);
          const installedPath = String(pathResult.stdout || "").match(/package:(\/\S+)/)?.[1] || "";
          const launch = run(options.adb, ["-s", serial, "shell", "monkey", "-p", options.packageName, "-c", "android.intent.category.LAUNCHER", "1"]);
          const verified = pathResult.status === 0 && Boolean(installedPath) && launch.status === 0 && /Events injected: 1/i.test(String(launch.stdout || ""));
          emit({
            status: verified ? "verified" : "failed",
            reason: verified ? null : "launch_or_package_check_failed",
            device: serial,
            package: options.packageName,
            apkSha256,
            installedPath: installedPath || null,
            installOutput: firstLine(install.stdout),
            launchOutput: firstLine(launch.stdout || launch.stderr),
            verifiedAt: verified ? new Date().toISOString() : null,
            note: verified
              ? "Installation and launcher launch were observed on the reported physical device serial."
              : "Installation or launch was not observed; no device verification is claimed.",
          }, verified ? 0 : 1);
        }
      }
    }
  }
}
