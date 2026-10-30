import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  ACK_STATUSES,
  ACKNOWLEDGED,
  DEFAULT_CAPACITY,
  DEFAULT_MODULUS,
  DUPLICATE,
  MAX_CAPACITY,
  MAX_MODULUS,
  MIN_MODULUS,
  OUT_OF_ORDER,
  OVERFLOW,
  PUSH_STATUSES,
  STALE,
  STORED
} from "../src/index.js";
import * as api from "../src/index.js";

const root = new URL("..", import.meta.url);

test("public exports stay limited to the documented surface", () => {
  assert.deepEqual(Object.keys(api).sort(), [
    "ACKNOWLEDGED",
    "ACK_STATUSES",
    "DEFAULT_CAPACITY",
    "DEFAULT_MODULUS",
    "DUPLICATE",
    "InputReplay",
    "MAX_CAPACITY",
    "MAX_MODULUS",
    "MIN_MODULUS",
    "OUT_OF_ORDER",
    "OVERFLOW",
    "PUSH_STATUSES",
    "STALE",
    "STORED"
  ]);
  assert.equal(STORED, "stored");
  assert.equal(DUPLICATE, "duplicate");
  assert.equal(STALE, "stale");
  assert.equal(OVERFLOW, "overflow");
  assert.equal(OUT_OF_ORDER, "out-of-order");
  assert.equal(ACKNOWLEDGED, "acknowledged");
  assert.deepEqual(PUSH_STATUSES, ["stored", "duplicate", "stale", "overflow", "out-of-order"]);
  assert.deepEqual(ACK_STATUSES, ["acknowledged", "duplicate", "stale"]);
  assert.equal(Object.isFrozen(PUSH_STATUSES), true);
  assert.equal(Object.isFrozen(ACK_STATUSES), true);
  assert.equal(MIN_MODULUS, 8);
  assert.equal(MAX_MODULUS, 4294967296);
  assert.equal(DEFAULT_MODULUS, 65536);
  assert.equal(DEFAULT_CAPACITY, 64);
  assert.equal(MAX_CAPACITY, 32766);
});

test("package metadata names the module and the author", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.equal(pkg.name, "@aneron/input-replay");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.author, "Vadim Gubin");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.sideEffects, false);
  assert.equal(pkg.engines.node, ">=20");
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.main, "./src/index.js");
  assert.equal(pkg.exports, "./src/index.js");
  assert.equal(pkg.repository.type, "git");
  assert.equal(pkg.repository.url, "git+https://github.com/ANERON-GAMES/input-replay.git");
  assert.equal(pkg.scripts.test, "node --test test/*.test.js");
  assert.equal(pkg.scripts.lint, "eslint .");
  assert.equal(pkg.scripts["format:check"], "prettier --check .");
  const license = readFileSync(new URL("LICENSE", root), "utf8");
  assert.equal(license.includes("Copyright (c) 2026 Vadim Gubin"), true);
  assert.equal(license.includes("anerongames"), false);
  const readme = readFileSync(new URL("README.md", root), "utf8");
  for (const heading of [
    "## Purpose",
    "## Install",
    "## Usage",
    "## API",
    "## Design",
    "## License"
  ]) {
    assert.equal(readme.includes(heading), true, heading);
  }
  assert.equal(readme.includes("## Design notes"), false);
  assert.equal(readme.includes("## API reference"), false);
  assert.equal(readme.includes("`predicted.state.x` is `9`"), true);
  assert.equal(readme.includes("`corrected.state.x` is `17`"), true);
  assert.equal(readme.includes("`corrected.dropped` sequences are `[1]`"), true);
  assert.equal(readme.includes("`corrected.applied` sequences are `[2, 3]`"), true);
  assert.equal(readme.includes('`again.status` is `"duplicate"`'), true);
  assert.equal(readme.includes('`late.status` is `"stale"`'), true);
  assert.equal(readme.includes("`late.state` is `null`"), true);
  assert.equal(readme.includes('`skip.status` is `"out-of-order"`'), true);
  assert.equal(readme.includes("`across.state.x` is `106`"), true);
  assert.equal(readme.includes("`across.applied` sequences are `[0, 1]`"), true);
  assert.equal(readme.includes('`full.status` is `"overflow"`'), true);
  assert.equal(readme.includes("`limited.size` is `2`"), true);
  assert.equal(readme.includes("`32766`"), true);
  assert.equal(readme.includes("leave `0` and `1` queued"), true);
});

test("source files do not contain comments, clocks, timers, or network calls", () => {
  const files = readdirSync(new URL("src/", root));
  assert.deepEqual(files, ["index.js"]);
  const source = readFileSync(new URL("src/index.js", root), "utf8");
  assert.equal(source.includes("/*"), false);
  assert.equal(source.includes("//"), false);
  assert.equal(source.includes("import "), false);
  assert.equal(source.includes("require("), false);
  assert.equal(source.includes("node:"), false);
  for (const token of [
    "Date",
    "setTimeout",
    "setInterval",
    "Math.random",
    "process",
    "fetch(",
    "globalThis",
    "queueMicrotask",
    "setImmediate",
    "performance"
  ]) {
    assert.equal(source.includes(token), false, token);
  }
});

test("the lockfile resolves only from the npm registry", () => {
  const lockPath = new URL("package-lock.json", root);
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  assert.equal(lock.lockfileVersion >= 2, true);
  const text = readFileSync(lockPath, "utf8");
  assert.equal(text.includes("git+"), false);
  assert.equal(text.includes("github:"), false);
  assert.equal(text.includes("registry.yarnpkg.com"), false);
  let resolved = 0;
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    if (value !== null && typeof value === "object") {
      if (typeof value.resolved === "string") {
        resolved += 1;
        assert.equal(
          value.resolved.startsWith("https://registry.npmjs.org/"),
          true,
          value.resolved
        );
      }
      for (const key of Object.keys(value)) {
        walk(value[key]);
      }
    }
  };
  walk(lock);
  assert.equal(resolved > 0, true);
});
