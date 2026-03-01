import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  transmissionModuleSchema,
  transmissionsIndexSchema,
  type TransmissionModule,
  type TransmissionsIndex,
} from "../src/lib/schema";

type ModuleReport = {
  transmissionId: string;
  file: string;
  ok: boolean;
  errors: string[];
};

function parseJsonFile(filePath: string): unknown {
  const content = readFileSync(filePath, "utf8");
  return JSON.parse(content);
}

function loadIndex(dataDir: string): TransmissionsIndex {
  const indexPath = path.join(dataDir, "transmissions.index.json");
  const raw = parseJsonFile(indexPath);
  const parsed = transmissionsIndexSchema.safeParse(raw);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Index schema error in ${indexPath}: ${issue.path.join(".") || "root"} ${issue.message}.`);
  }

  return parsed.data;
}

function loadModule(modulePath: string): TransmissionModule {
  const raw = parseJsonFile(modulePath);
  const parsed = transmissionModuleSchema.safeParse(raw);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Module schema error in ${modulePath}: ${issue.path.join(".") || "root"} ${issue.message}.`);
  }

  return parsed.data;
}

function validate(dataDir: string): { ok: boolean; reports: ModuleReport[]; globalErrors: string[] } {
  const index = loadIndex(dataDir);
  const globalErrors: string[] = [];
  const reports: ModuleReport[] = [];

  const categoryIds = new Set(index.category_defs.map((category) => category.category_id));
  const seenTransmissionIds = new Set<string>();

  for (const entry of index.transmissions) {
    const errors: string[] = [];

    if (seenTransmissionIds.has(entry.transmission_id)) {
      errors.push(`Duplicate transmission_id '${entry.transmission_id}' found in index.`);
    }
    seenTransmissionIds.add(entry.transmission_id);

    const modulePath = path.join(dataDir, entry.file);
    if (!existsSync(modulePath)) {
      errors.push(`Missing module file: ${entry.file}.`);
    } else {
      try {
        const moduleJson = loadModule(modulePath);

        if (moduleJson.transmission_id !== entry.transmission_id) {
          errors.push(
            `Transmission mismatch: index=${entry.transmission_id}, module=${moduleJson.transmission_id}.`,
          );
        }

        for (const category of moduleJson.categories) {
          if (!categoryIds.has(category.category_id)) {
            errors.push(`Unknown category_id '${category.category_id}'.`);
          }
          if (category.queries.length === 0) {
            errors.push(`Category '${category.category_id}' has an empty queries array.`);
          }
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    reports.push({
      transmissionId: entry.transmission_id,
      file: entry.file,
      ok: errors.length === 0,
      errors,
    });
  }

  return {
    ok: globalErrors.length === 0 && reports.every((report) => report.ok),
    reports,
    globalErrors,
  };
}

function main(): void {
  const dataDir = path.resolve(process.cwd(), "data/transmissions");

  try {
    const result = validate(dataDir);

    console.log("Transmission validation report");
    console.log("============================");

    for (const report of result.reports) {
      console.log(`${report.ok ? "PASS" : "FAIL"} ${report.transmissionId} (${report.file})`);
      for (const error of report.errors) {
        console.log(`  - ${error}`);
      }
    }

    for (const error of result.globalErrors) {
      console.log(`GLOBAL ERROR: ${error}`);
    }

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

main();
