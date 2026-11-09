// A collection's fields from a schema file, the nohead.schema.yaml that
// `nohead schema pull` writes, so createSchema needs no API (and no key).
// Internal to @nohead/astro. The format is the CLI's: collections keyed by
// slug, fields by API key, a field's type options beside its type, and a
// relation's target as its collection's slug (`collection`). Only what the
// schema needs is read; `nohead schema push` checks the rest.
import { NoheadError, type FieldType } from "@nohead/sdk"

import type { SchemaCollection, SchemaField } from "./schema.ts"

const TYPES: readonly string[] = [
  "text",
  "long_text",
  "rich_text",
  "integer",
  "decimal",
  "date",
  "boolean",
  "enum",
  "asset",
  "relation",
  "json",
] satisfies FieldType[]

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** "lead_author" -> "Lead Author": a field's name when the file gives none, as the CLI's. */
const humanize = (key: string) =>
  key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ")

/**
 * The collection's fields from the file, with relations' targets as slugs,
 * and the Astro collection each slug in the file loads as (`references`).
 */
export async function collectionFromFile(
  file: string | URL,
  slug: string,
  references: Record<string, string>
): Promise<{ collection: SchemaCollection; slugs: Map<string, string> }> {
  const name = String(file)
  const fail = (message: string) =>
    new NoheadError(`noheadLoader's schemaFile ${name}: ${message}`)
  const [{ readFile }, { parse }] = await Promise.all([
    import("node:fs/promises"),
    import("yaml"),
  ])
  let document: unknown
  try {
    document = parse(await readFile(file, "utf8"))
  } catch (error) {
    throw fail(error instanceof Error ? error.message : String(error))
  }
  const collections = isObject(document) ? document.collections : undefined
  if (!isObject(collections)) {
    throw fail(
      'it has no "collections" mapping (`nohead schema pull` writes the file)'
    )
  }
  const raw = collections[slug]
  if (!isObject(raw)) {
    throw fail(
      `it has no ${slug} collection (it has ${Object.keys(collections).join(", ") || "none"}); the loader's collection is its slug there`
    )
  }
  const fields = raw.fields ?? {}
  if (!isObject(fields)) throw fail(`collections.${slug}.fields is no mapping`)

  const slugs = new Map(
    Object.keys(collections).map((each) => [
      each,
      Object.hasOwn(references, each) ? references[each]! : each,
    ])
  )
  return {
    collection: {
      slug,
      fields: Object.entries(fields).map(([key, value]) =>
        fieldOf(key, value, `collections.${slug}.fields.${key}`, fail)
      ),
    },
    slugs,
  }
}

function fieldOf(
  key: string,
  value: unknown,
  at: string,
  fail: (message: string) => NoheadError
): SchemaField {
  // `title: text` is short for `title: { type: text }`.
  const field = typeof value === "string" ? { type: value } : value
  if (!isObject(field)) throw fail(`${at} is no mapping or type name`)
  const type = String(field.type).replaceAll("-", "_")
  if (!TYPES.includes(type)) {
    throw fail(`${at} has an unknown type, ${JSON.stringify(field.type)}`)
  }
  const options = field.options
  if (
    type === "enum" &&
    !(
      Array.isArray(options) &&
      options.length > 0 &&
      options.every((option) => typeof option === "string")
    )
  ) {
    throw fail(`${at} is an enum without options`)
  }
  if (type === "relation" && typeof field.collection !== "string") {
    throw fail(`${at} is a relation without its collection's slug`)
  }
  return {
    key,
    name: typeof field.name === "string" ? field.name : humanize(key),
    type: type as FieldType,
    required: field.required === true,
    multiple: field.multiple === true,
    configuration: {
      ...(typeof field.description === "string"
        ? { description: field.description }
        : {}),
      ...(type === "enum" ? { options: options as string[] } : {}),
      ...(type === "relation"
        ? { target_collection_id: field.collection as string }
        : {}),
    },
  }
}
