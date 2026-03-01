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

export const clipManifestClipSchema = z
  .object({
    clip_id: z.string().min(1),
    source_type: z.literal("youtube"),
    video_id: z.string().min(1),
    video_url: z.string().url(),
    title: z.string().min(1),
    channel: z.string().min(1),
    published_at: z.string().datetime().nullable(),
    start_sec: z.number().int().nonnegative(),
    end_sec: z.number().int().nonnegative(),
    duration_sec: z.number().int().nonnegative(),
    notes: z.string(),
    tags: z.array(z.string()),
    playlist_id: z.string().min(1).nullable().optional(),
    playlist_title: z.string().min(1).nullable().optional(),
    share_url: z.string().url(),
  })
  .superRefine((clip, ctx) => {
    if (clip.end_sec <= clip.start_sec) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "end_sec must be greater than start_sec", path: ["end_sec"] });
    }

    if (clip.duration_sec !== clip.end_sec - clip.start_sec) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duration_sec must equal end_sec - start_sec",
        path: ["duration_sec"],
      });
    }
  });

export const clipsManifestSchema = z.object({
  schema_version: z.literal(1),
  created_at: z.string().datetime(),
  clips: z.array(clipManifestClipSchema),
});

export type TransmissionsIndex = z.infer<typeof transmissionsIndexSchema>;
export type TransmissionIndexEntry = z.infer<typeof transmissionIndexEntrySchema>;
export type TransmissionModule = z.infer<typeof transmissionModuleSchema>;
export type ClipManifestClip = z.infer<typeof clipManifestClipSchema>;
export type ClipsManifest = z.infer<typeof clipsManifestSchema>;
