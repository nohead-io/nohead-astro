/**
 * Astro's content collections from Nohead (`@nohead/astro`). In
 * src/content.config.ts:
 *
 *   import { defineCollection } from "astro:content"
 *   import { noheadLoader } from "@nohead/astro"
 *
 *   export const collections = {
 *     posts: defineCollection({
 *       loader: noheadLoader({ collection: "posts", expand: ["cover"] }),
 *     }),
 *   }
 *
 * Every published record becomes an entry, by its record ID, when the site
 * builds (and when `astro dev` starts or syncs). On Astro 6 and later, the
 * collection's fields give the entries their schema and TypeScript type.
 */
import type { ImageMetadata } from "astro"
import type { Loader, LoaderContext } from "astro/loaders"

import {
  AuthorizationError,
  Nohead,
  NoheadError,
  type ClientOptions,
  type NoheadRecord,
  type RecordFilter,
} from "@nohead/sdk"
import type * as G from "@nohead/sdk"

import { collectionSchema } from "./schema.ts"
import { collectionFromFile } from "./schema-file.ts"

/** The environment's variables, where there is one (Node, Bun, Deno). */
function environment(): Record<string, string | undefined> {
  const process = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process
  return process?.env ?? {}
}

export interface NoheadLoaderOptions extends ClientOptions {
  /** The collection's slug or ID. */
  collection: string
  /**
   * Filters, added to the default `{ published_at: { exists: true } }`, so
   * only published records load whatever the key may read. Set
   * `published_at` to change that: `undefined` loads every record.
   */
  filter?: RecordFilter
  /**
   * Asset (or relation) fields whose IDs to replace with what they point
   * at: an asset as an `EmbeddedAsset`, a published record as an
   * `EmbeddedRecord`. At most 5. Relations otherwise stay record IDs, for
   * `reference()`.
   */
  expand?: string[]
  /**
   * A rich text field to render: it moves from `data` into the entry's
   * `rendered`, so `render(entry)` returns its `<Content />`. As HTML (the
   * default), or with `richText: "markdown"`, through Astro's Markdown
   * pipeline (your remark and rehype plugins, syntax highlighting,
   * headings).
   */
  body?: string
  /**
   * How rich text fields read: `"html"` by default, strings ready for
   * `set:html`, or `"markdown"`. The `"document"` form is the API's.
   */
  richText?: G.RichText
  /**
   * The Astro collection each related Nohead collection is loaded as, by
   * its slug, when the names differ: `{ people: "authors" }`. A relation is
   * a `reference()` to that collection; by default, the one named like the
   * Nohead collection.
   */
  references?: Record<string, string>
  /**
   * A schema file to read the collection's fields from, instead of the API:
   * the `nohead.schema.yaml` that `nohead schema pull` writes (relative to
   * where Astro runs, the project's root, or a URL). The entries' schema
   * and types then need no key, so `astro check` and `astro sync` run
   * without one (in CI, or in a fork's pull request), and a load without a
   * key leaves the collection empty, with a warning. Pull the file again
   * when the fields change; `nohead schema diff --exit-code` fails while it
   * and the project differ.
   */
  schemaFile?: string | URL
}

/** An expanded asset field's value: what a page needs to show the file. */
export interface EmbeddedAsset {
  id: string
  filename: string
  content_type: string
  /** The asset's alt text, when it has some. */
  alt?: string
  /** For images: their size, and their URL (see `@nohead/sdk/images`). */
  width?: number
  height?: number
  image_url?: string
  /** The file as uploaded, for any ready asset. */
  file_url?: string
  /** For video and audio: the URL that plays inline. */
  media_url?: string
}

/** An expanded relation field's value: the related record's ID and fields. */
export interface EmbeddedRecord {
  id: string
  data: Record<string, unknown>
}

/** Formats Astro reads image metadata in, by content type. */
const IMAGE_FORMATS: Record<string, ImageMetadata["format"]> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/apng": "apng",
  "image/tiff": "tiff",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
}

/**
 * An image asset (an expanded one, or the SDK's `Asset`) as Astro's image
 * metadata, for `<Image src={imageMetadata(entry.data.cover)} alt="…" />`
 * with `@nohead/astro/image-service`. Astro then knows the original's size:
 * `width` and `height` become optional, and no `srcset` width is larger
 * than the original. Undefined for an asset without an image URL and size
 * (a file, a video, or an image still processing). Only for that service:
 * Astro's own would read it as a file of the site's.
 */
export function imageMetadata(
  asset:
    | {
        content_type: string
        image_url?: string | null
        width?: number | null
        height?: number | null
      }
    | null
    | undefined
): ImageMetadata | undefined {
  if (!asset?.image_url || !asset.width || !asset.height) return undefined
  return {
    src: asset.image_url,
    width: asset.width,
    height: asset.height,
    // Astro reads only the size; another image type is still an image.
    format: IMAGE_FORMATS[asset.content_type] ?? "png",
  }
}

/**
 * An Astro content loader for a Nohead collection. It reads the key from
 * `apiKey` or `NOHEAD_API_KEY` (and the API's address from `NOHEAD_API_URL`,
 * if set, as the client does), and takes the other client options too
 * (`timeout`, `maxRetries`, `headers`…). Empty fields are left out of an
 * entry's data, so a schema's `.optional()` fits them.
 */
export function noheadLoader(options: NoheadLoaderOptions): Loader {
  const {
    collection,
    filter,
    expand,
    body,
    richText = "html",
    references = {},
    schemaFile,
    ...client
  } = options
  if (!collection) throw new TypeError("noheadLoader needs a collection")
  if (body && richText === "document") {
    throw new TypeError(
      'noheadLoader renders its body from HTML or Markdown: set richText to "html" or "markdown"'
    )
  }

  // Entries are published records unless the filter says otherwise.
  const publishedAt =
    filter && "published_at" in filter ? filter.published_at : { exists: true }
  const publishedOnly = !(
    publishedAt === undefined || publishedAt.exists === false
  )

  // Astro reads .env into import.meta.env, not process.env.
  const hasKey = () => Boolean(client.apiKey || environment().NOHEAD_API_KEY)
  const connect = () => {
    if (!hasKey()) {
      throw new NoheadError(
        "Missing API key: pass `apiKey: import.meta.env.NOHEAD_API_KEY` to noheadLoader, or set NOHEAD_API_KEY in the environment"
      )
    }
    return new Nohead({ ...client, richText })
  }

  return {
    name: "nohead",
    // Astro 6 and later: the entries' schema and type, from the collection's
    // fields. A schema given to defineCollection takes its place.
    async createSchema() {
      const { z } = await import("astro/zod")
      const schemaOptions = {
        expand: expand ?? [],
        body,
        richText,
        publishedOnly,
      }
      if (schemaFile !== undefined) {
        const { collection: fields, slugs } = await collectionFromFile(
          schemaFile,
          collection,
          references
        )
        return collectionSchema(z, fields, { ...schemaOptions, slugs })
      }
      const nohead = connect()
      try {
        // Relations name their target by ID; references need the Astro
        // collection it loads as: its slug, unless `references` renames it.
        const slugsById = async () => {
          const slugs = new Map<string, string>()
          for await (const each of nohead.collections.list()) {
            const renamed = Object.hasOwn(references, each.slug)
            slugs.set(each.id, renamed ? references[each.slug]! : each.slug)
          }
          return slugs
        }
        const [fields, slugs] = await Promise.all([
          nohead.collections.get(collection),
          slugsById(),
        ])
        return collectionSchema(z, fields, { ...schemaOptions, slugs })
      } catch (error) {
        if (!(error instanceof AuthorizationError)) throw error
        throw new NoheadError(
          `noheadLoader reads the ${collection} collection's fields for its schema, which takes the key's schema:read scope: add it, or pass a schema to defineCollection`,
          { cause: error }
        )
      }
    },
    async load(context: LoaderContext) {
      const { store, logger } = context
      // With the types from a file, a run without a key (a check in CI)
      // has nothing to load, rather than failing.
      if (schemaFile !== undefined && !hasKey()) {
        logger.warn(
          `No API key, so no ${collection} records: its types come from ${String(schemaFile)}. Set NOHEAD_API_KEY to load them.`
        )
        return
      }
      const nohead = connect()
      const records = []
      for await (const record of nohead.records.list(collection, {
        limit: 100,
        filter: { published_at: { exists: true }, ...filter },
        expand,
      })) {
        records.push(record)
      }
      // Embedded records are published too, unless entries may not be.

      // Every entry is made before the store changes, so a failure leaves
      // the entries as they were.
      const entries = await Promise.all(
        records.map(async (record) => {
          const data = entryData(record, publishedOnly)
          const digest = context.generateDigest(data)
          if (store.get(record.id)?.digest === digest) return undefined
          let rendered
          if (body !== undefined) {
            const value = data[body]
            delete data[body]
            if (typeof value === "string") {
              rendered =
                richText === "markdown"
                  ? await context.renderMarkdown(value)
                  : { html: value }
            }
          }
          const parsed = await context.parseData({ id: record.id, data })
          return { id: record.id, data: parsed, digest, rendered }
        })
      )

      const ids = new Set(records.map((record) => record.id))
      for (const id of store.keys()) if (!ids.has(id)) store.delete(id)
      for (const entry of entries) if (entry) store.set(entry)
      logger.info(`Loaded ${records.length} records from ${collection}`)
    },
  }
}

/** A record's own times, which its entry's data (or embedding's) carries too. */
function timesOf(record: NoheadRecord): Record<string, string> {
  const times: Record<string, string> = {}
  for (const key of ["published_at", "created_at", "updated_at"] as const) {
    const time = record[key]
    if (time) times[key] = time
  }
  return times
}

/**
 * A record's fields as an entry's data: without empty values, and with each
 * expanded asset or relation in place of its ID. With them, the record's own
 * times (`published_at`, `created_at`, `updated_at`), under keys Nohead
 * reserves, so no field can have them: a post can be dated by when it was
 * published, a sitemap by when it last changed.
 */
function entryData(
  record: NoheadRecord,
  publishedOnly: boolean
): Record<string, unknown> {
  const data = present(record.data)
  Object.assign(data, timesOf(record))
  // Gone since, or (as entries are) unpublished: left out.
  const shown = (
    embedded: NoheadRecord | G.Asset | null
  ): embedded is NoheadRecord | G.Asset =>
    embedded !== null &&
    !(publishedOnly && embedded.object === "record" && !embedded.published_at)
  for (const [key, embedded] of Object.entries(record.expanded ?? {})) {
    const value = record.data[key]
    // A rich text field's expansion (the assets its images show) is a list
    // beside a single value: the field keeps its text.
    if (Array.isArray(value) && Array.isArray(embedded)) {
      data[key] = embedded.filter(shown).map(entryValue)
    } else if (typeof value === "string" && !Array.isArray(embedded)) {
      if (shown(embedded)) data[key] = entryValue(embedded)
      else delete data[key]
    }
  }
  return data
}

function entryValue(
  embedded: NoheadRecord | G.Asset
): EmbeddedAsset | EmbeddedRecord {
  if (embedded.object === "record") {
    return {
      id: embedded.id,
      data: { ...present(embedded.data), ...timesOf(embedded) },
    }
  }
  const { id, filename, content_type } = embedded
  return {
    id,
    filename,
    content_type,
    ...present({
      alt: embedded.alt,
      width: embedded.width,
      height: embedded.height,
      image_url: embedded.image_url,
      file_url: embedded.file_url,
      media_url: embedded.media_url,
    }),
  }
}

/** The values that are set: Zod's `.optional()` takes undefined, not null. */
function present(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => value !== null && value !== undefined
    )
  )
}
