import {
  clipsManifestSchema,
  type ClipsManifest,
  type TransmissionModule,
  type TransmissionsIndex,
  transmissionModuleSchema,
  transmissionsIndexSchema,
} from "./schema";

const TRANSMISSION_DATA_DIR = "/data/transmissions";
const CLIPS_DATA_DIR = "/data/clips";

async function fetchJson(path: string): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(path);
  } catch {
    throw new Error(`Unable to reach ${path}. Please check your network connection.`);
  }

  if (!response.ok) {
    throw new Error(`Failed to load ${path} (HTTP ${response.status}).`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`The file ${path} is not valid JSON.`);
  }
}

export async function loadIndex(): Promise<TransmissionsIndex> {
  const path = `${TRANSMISSION_DATA_DIR}/transmissions.index.json`;
  const raw = await fetchJson(path);

  const parsed = transmissionsIndexSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid transmissions index at ${path}: ${issue.path.join(".") || "root"} ${issue.message}.`,
    );
  }

  return parsed.data;
}

export async function loadModule(file: string): Promise<TransmissionModule> {
  const path = `${TRANSMISSION_DATA_DIR}/${file}`;
  const raw = await fetchJson(path);

  const parsed = transmissionModuleSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid transmission module ${file}: ${issue.path.join(".") || "root"} ${issue.message}.`);
  }

  return parsed.data;
}

export async function loadClipsManifest(): Promise<ClipsManifest> {
  const path = `${CLIPS_DATA_DIR}/clips.manifest.json`;
  const raw = await fetchJson(path);
  const parsed = clipsManifestSchema.safeParse(raw);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid clips manifest at ${path}: ${issue.path.join(".") || "root"} ${issue.message}.`);
  }

  return parsed.data;
}

export type ModuleValidationStatus = {
  file: string;
  transmissionId: string;
  ok: boolean;
  errors: string[];
};

export type ClipsValidationStatus = {
  file: string;
  ok: boolean;
  errors: string[];
};

export type ValidationReport = {
  ok: boolean;
  modules: ModuleValidationStatus[];
  clipsManifest: ClipsValidationStatus;
};

export async function validateSearchMap(): Promise<ValidationReport> {
  const index = await loadIndex();
  const categoryIds = new Set(index.category_defs.map((category) => category.category_id));
  const seenIds = new Set<string>();
  const modules: ModuleValidationStatus[] = [];

  for (const entry of index.transmissions) {
    const errors: string[] = [];

    if (seenIds.has(entry.transmission_id)) {
      errors.push(`Duplicate transmission_id '${entry.transmission_id}' in index.`);
    }
    seenIds.add(entry.transmission_id);

    try {
      const moduleData = await loadModule(entry.file);

      if (moduleData.transmission_id !== entry.transmission_id) {
        errors.push(
          `Transmission id mismatch: index=${entry.transmission_id} module=${moduleData.transmission_id}.`,
        );
      }

      for (const category of moduleData.categories) {
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

    modules.push({
      file: entry.file,
      transmissionId: entry.transmission_id,
      ok: errors.length === 0,
      errors,
    });
  }

  const clipsErrors: string[] = [];
  try {
    await loadClipsManifest();
  } catch (error) {
    clipsErrors.push(error instanceof Error ? error.message : String(error));
  }

  const clipsManifest: ClipsValidationStatus = {
    file: "data/clips/clips.manifest.json",
    ok: clipsErrors.length === 0,
    errors: clipsErrors,
  };

  return {
    ok: modules.every((moduleStatus) => moduleStatus.ok) && clipsManifest.ok,
    modules,
    clipsManifest,
  };
}
