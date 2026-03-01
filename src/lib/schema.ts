import { z } from "zod";

export const categoryDefinitionSchema = z.object({
  category_id: z.string().min(1),
  title: z.string().min(1),
});

export const transmissionIndexEntrySchema = z.object({
  transmission_id: z.string().min(1),
  title: z.string().min(1),
  file: z.string().min(1),
});

export const transmissionsIndexSchema = z.object({
  schema_version: z.string().min(1),
  project: z
    .object({
      id: z.string().min(1),
      title: z.string().min(1),
      notes: z.string().optional(),
    })
    .passthrough(),
  defaults: z
    .object({
      platform: z.string(),
      language: z.string(),
      region: z.string(),
      max_results_per_query: z.number(),
      safe_search: z.string(),
      sort: z.string(),
      filters: z
        .object({
          video_duration: z.string(),
          upload_date: z.string(),
        })
        .passthrough(),
    })
    .passthrough(),
  category_defs: z.array(categoryDefinitionSchema),
  transmissions: z.array(transmissionIndexEntrySchema),
  clip_selection: z
    .object({
      enabled: z.boolean(),
      min_clip_sec: z.number(),
      max_clip_sec: z.number(),
      allow_overlaps: z.boolean(),
      fields: z.array(z.string()),
    })
    .passthrough(),
});

export const moduleCategorySchema = z.object({
  category_id: z.string().min(1),
  queries: z.array(z.string().min(1)),
});

export const transmissionModuleSchema = z.object({
  transmission_id: z.string().min(1),
  title: z.string().min(1),
  categories: z.array(moduleCategorySchema),
});

export type TransmissionsIndex = z.infer<typeof transmissionsIndexSchema>;
export type TransmissionIndexEntry = z.infer<typeof transmissionIndexEntrySchema>;
export type TransmissionModule = z.infer<typeof transmissionModuleSchema>;
