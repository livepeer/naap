/**
 * lr-gen-runners.mjs — CI validator/generator for `live-runner-v2/runners.json`.
 *
 * Single source of truth = the embedded `capability` descriptor in each runner
 * entry. This script:
 *   1. Validates every `capability` block with the EXACT `validateDescriptor`
 *      the Storyboard discovery-sync uses ("cap-check passes locally" ≡ "the
 *      sync ingests it").
 *   2. Asserts the native v0.9.0 `price_info` ({price,currency,unit}) is
 *      derived-consistent with `capability.offering` (price == display_usd,
 *      currency == usd, unit ∈ {fixed,720p,hour}, app/mode/capacity match).
 *   3. Runs the PURE discovery-sync dedup planner against the committed
 *      `registry.json` and prints the verdict (REGISTER / ADD-CAPACITY /
 *      SYNONYM-SKIP) so we can confirm all entries dedup to ADD-CAPACITY.
 *
 * Run under the storyboard capability lib's toolchain (has tsx + zod):
 *   cd <storyboard repo> && \
 *   STORYBOARD_CAPS=$PWD/lib/capabilities \
 *   RUNNERS_JSON=<path>/live-runner-v2/runners.json \
 *   npx tsx <path>/live-runner-v2/scripts/lr-gen-runners.mjs
 *
 * Exits non-zero on any schema, derivation, or dedup (SYNONYM / invalid) failure.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const CAPS_DIR = process.env.STORYBOARD_CAPS
  ? resolve(process.env.STORYBOARD_CAPS)
  : resolve(process.cwd(), "lib/capabilities");
const RUNNERS_JSON = process.env.RUNNERS_JSON
  ? resolve(process.env.RUNNERS_JSON)
  : resolve(process.cwd(), "runners.json");

const descriptorMod = await import(pathToFileURL(resolve(CAPS_DIR, "descriptor.ts")).href);
const { validateDescriptor, computeSemanticKey } = descriptorMod;

const NATIVE_UNITS = new Set(["fixed", "720p", "hour"]);

/** Read the committed registry as the existing-identity view for dedup. */
function readRegistry() {
  const raw = JSON.parse(readFileSync(resolve(CAPS_DIR, "registry.json"), "utf8"));
  const entries = Array.isArray(raw) ? raw : raw.capabilities ?? raw.entries ?? [];
  const seen = new Map();
  for (const e of entries) {
    const key =
      e.semantic_key ??
      computeSemanticKey({
        kind: e.kind,
        modality: e.modality ?? "",
        family: e.family ?? "",
        variant: e.variant ?? null,
      });
    seen.set(key, e.name);
  }
  return seen;
}

function approxEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < 1e-9;
}

function main() {
  const cfg = JSON.parse(readFileSync(RUNNERS_JSON, "utf8"));
  const runners = cfg.runners ?? [];
  const seen = readRegistry();

  let failures = 0;
  const verdicts = { register: [], addCapacity: [], synonymSkipped: [] };

  console.log(`lr-gen-runners: ${runners.length} runner entries from ${RUNNERS_JSON}\n`);

  for (const r of runners) {
    const label = r.label ?? r.app ?? "<unknown>";
    if (!r.capability) {
      console.error(`  ✗ ${label}: missing 'capability' descriptor block`);
      failures++;
      continue;
    }

    // (1) schema validity — the exact validator discovery-sync uses.
    const res = validateDescriptor({ capability: r.capability });
    if (!res.ok) {
      console.error(`  ✗ ${label}: descriptor INVALID:`);
      for (const err of res.errors) console.error(`       - ${err}`);
      failures++;
      continue;
    }
    const cap = res.value.capability;

    // (2) native price_info derived-consistency.
    const pi = r.price_info ?? {};
    const off = cap.offering;
    const problems = [];
    if (!pi.price || !approxEqual(pi.price, off.price.display_usd)) {
      problems.push(
        `price_info.price (${pi.price}) != offering.price.display_usd (${off.price.display_usd})`,
      );
    }
    if ((pi.currency ?? "usd").toLowerCase() !== "usd") {
      problems.push(`price_info.currency must be "usd" (got ${pi.currency})`);
    }
    if (!NATIVE_UNITS.has((pi.unit ?? "hour").toLowerCase())) {
      problems.push(`price_info.unit must be fixed|720p|hour (got ${pi.unit})`);
    }
    if (r.app !== off.app) problems.push(`app (${r.app}) != offering.app (${off.app})`);
    if (r.mode !== off.mode) problems.push(`mode (${r.mode}) != offering.mode (${off.mode})`);
    if (r.capacity !== off.capacity)
      problems.push(`capacity (${r.capacity}) != offering.capacity (${off.capacity})`);
    if (!r.health_url) problems.push(`health_url is required (v0.9.0 buildStaticRunner)`);

    if (problems.length) {
      console.error(`  ✗ ${label}: native/derivation mismatch:`);
      for (const p of problems) console.error(`       - ${p}`);
      failures++;
      continue;
    }

    // (3) dedup verdict against the committed registry.
    const key = cap.semantic_key ?? computeSemanticKey(cap);
    const owner = seen.get(key);
    if (owner) {
      if (cap.name && cap.name !== owner) {
        verdicts.synonymSkipped.push({ name: cap.name, key, owner });
        console.error(`  ✗ ${label}: SYNONYM-SKIP (key ${key} owned by "${owner}")`);
        failures++;
      } else {
        verdicts.addCapacity.push({ name: owner, key });
        console.log(`  ✓ ${label}: ADD-CAPACITY  key=${key}  price=$${off.price.display_usd} (${pi.unit})`);
      }
    } else {
      verdicts.register.push({ name: cap.name ?? key, key });
      console.log(`  ✓ ${label}: REGISTER (new identity)  key=${key}`);
    }
  }

  console.log(
    `\nSYNC PLAN: ${verdicts.register.length} REGISTER, ` +
      `${verdicts.addCapacity.length} ADD-CAPACITY, ` +
      `${verdicts.synonymSkipped.length} SYNONYM-SKIP, ${failures} invalid/failed`,
  );

  if (failures > 0) {
    console.error(`\nFAILED: ${failures} entr${failures === 1 ? "y" : "ies"} did not pass.`);
    process.exit(1);
  }
  console.log(`\nOK: all ${runners.length} runners schema-valid, native-derived, and dedup-clean.`);
}

main();
