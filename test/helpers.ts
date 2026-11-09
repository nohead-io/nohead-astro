import type { Asset, Collection, NoheadRecord } from "@nohead/sdk"

// Test helpers: a fetch that answers from a list of replies and records the
// calls, and the API's shapes the loader reads. The client and its contract
// are @nohead/sdk's, tested there; these tests cover what the loader does
// with the API's answers.

/** The host of the loader's mocked API. */
export const API_HOST = "api.test"

export interface Call {
  method: string
  url: URL
  headers: Headers
}

type Reply = Response | Error | ((call: Call) => Response | Promise<Response>)

/** JSON response helper. */
export function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

export function apiError(status: number, type: string): Response {
  return json(status, {
    error: { type, message: `${type} message`, request_id: "req_1" },
  })
}

/** A fetch that answers from `replies` in order (the last one repeats). */
export function mockFetch(replies: Reply[]): {
  fetch: typeof fetch
  calls: Call[]
} {
  const calls: Call[] = []
  let index = 0
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? "GET",
      url: new URL(input instanceof Request ? input.url : input),
      headers: new Headers(init.headers),
    }
    calls.push(call)
    const reply = replies[Math.min(index++, replies.length - 1)]!
    if (reply instanceof Error) throw reply
    const response = typeof reply === "function" ? await reply(call) : reply
    return response.clone()
  }
  return { fetch, calls }
}

/**
 * The API's answers the loader reads, as the contract's examples give them
 * (taken from @nohead/sdk's tests). `satisfies` the SDK's types, so the
 * typecheck fails when the API's shapes move on from these copies.
 */
const EXAMPLES: Record<string, Record<string, unknown>> = {
  collections_get: {
    id: "col_01J9ZQ3F8X5W2K7M4N6P0R1S2T",
    object: "collection",
    project_id: "string",
    name: "string",
    slug: "string",
    description: "string",
    schema_version: 1,
    deleted_at: "2026-10-02T12:00:00Z",
    purge_after: "2026-10-02T12:00:00Z",
    public_search: false,
    fields: [
      {
        id: "fld_01J9ZQ3F8X5W2K7M4N6P0R1S2T",
        object: "field",
        collection_id: "string",
        name: "string",
        key: "string",
        required: false,
        multiple: false,
        position: 1,
        deleted_at: "2026-10-02T12:00:00Z",
        purge_after: "2026-10-02T12:00:00Z",
        aliases: [
          {
            key: "string",
            expires_at: "2026-09-27T12:00:00.000Z",
          },
        ],
        created_at: "2026-09-27T12:00:00.000Z",
        updated_at: "2026-09-27T12:00:00.000Z",
        type: "text",
        configuration: {
          description: "string",
          searchable: false,
          filterable: false,
          sortable: false,
          min_length: 0,
          max_length: 0,
          format: "slug",
          unique: false,
        },
      },
    ],
    created_at: "2026-09-27T12:00:00.000Z",
    updated_at: "2026-09-27T12:00:00.000Z",
  } satisfies Collection,
  assets_get: {
    id: "ast_01J9ZQ3F8X5W2K7M4N6P0R1S2T",
    object: "asset",
    project_id: "string",
    filename: "string",
    alt: "string",
    content_type: "image/png",
    byte_size: 1,
    width: 1,
    height: 1,
    status: "pending",
    deleted_at: "2026-10-02T12:00:00Z",
    purge_after: "2026-10-02T12:00:00Z",
    image_url:
      "https://images.nohead.io/plain/0199f5c2-7b1e-7c3a-9d4f-2a6b8c0e1f3d/0199f5c2-8a2d-7e4b-b1c3-5d7e9f1a2b4c",
    preview_url: "string",
    file_url:
      "https://files.nohead.io/0199f5c2-7b1e-7c3a-9d4f-2a6b8c0e1f3d/0199f5c2-8a2d-7e4b-b1c3-5d7e9f1a2b4c",
    media_url:
      "https://media.nohead.io/0199f5c2-7b1e-7c3a-9d4f-2a6b8c0e1f3d/0199f5c2-8a2d-7e4b-b1c3-5d7e9f1a2b4c",
    uploaded_at: "2026-10-02T12:00:00Z",
    created_at: "2026-09-27T12:00:00.000Z",
    updated_at: "2026-09-27T12:00:00.000Z",
  } satisfies Asset,
}

/** The example of what `operation` answers, with `fields` changed. */
export function exampleOf(
  operation: string,
  fields: Record<string, unknown> = {}
): Record<string, unknown> {
  const example = EXAMPLES[operation]
  if (!example) throw new Error(`No example for ${operation}`)
  return { ...structuredClone(example), ...fields }
}

export const record = (
  id: string,
  data: Record<string, unknown> = {}
): NoheadRecord<Record<string, unknown>> => ({
  id,
  object: "record",
  collection_id: "col_1",
  collection: "posts",
  published_at: null,
  revision: 1,
  schema_version: 1,
  history_pruned_through: null,
  deleted_at: null,
  purge_after: null,
  data,
  created_at: "2026-10-02T12:00:00.000Z",
  updated_at: "2026-10-02T12:00:00.000Z",
})

/** A list's page; `has_more` is whether there's a cursor, unless given. */
export const page = (
  items: unknown[],
  next: string | null,
  hasMore = next !== null
) =>
  json(200, {
    data: items,
    meta: { next_cursor: next, has_more: hasMore },
  })
