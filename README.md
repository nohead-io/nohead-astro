# Nohead for Astro

[Nohead](https://nohead.io) content in [Astro](https://astro.build): a content loader that turns a Nohead collection into an Astro content collection, typed from its fields, and an image service that resizes Nohead's images through their URLs. It reads the API through the TypeScript SDK, [`@nohead/sdk`](https://www.npmjs.com/package/@nohead/sdk), which comes with it.

```bash
npm install @nohead/astro
```

It needs Astro 5.9 or newer (types from the schema need Astro 6). Until 1.0, a minor release may break your site: its changelog marks each such change **Breaking**.

## Content collections

`noheadLoader` loads collections into Astro's content collections (Astro 5.9 or later), so pages read them with `getCollection`, `getEntry`, `reference()` and `render()`. On Astro 6 or later, the loader also gives each collection its schema and TypeScript type, from the collection's fields in Nohead (on Astro 5, give each collection a `schema`, under [Schema and types](#schema-and-types)):

```ts
// src/content.config.ts
import { defineCollection } from "astro:content"
import { noheadLoader } from "@nohead/astro"

// Astro reads .env into import.meta.env, not process.env.
const apiKey = import.meta.env.NOHEAD_API_KEY

export const collections = {
  people: defineCollection({
    loader: noheadLoader({ collection: "people", apiKey }),
  }),
  posts: defineCollection({
    loader: noheadLoader({
      collection: "posts",
      expand: ["cover"],
      body: "body",
      apiKey,
    }),
  }),
}
```

```astro
---
// src/pages/posts/[slug].astro
import { getCollection, getEntry, render } from "astro:content"
import { Image } from "astro:assets"
import { imageMetadata } from "@nohead/astro"

export async function getStaticPaths() {
  const posts = await getCollection("posts")
  return posts.map((post) => ({ params: { slug: post.data.slug }, props: { post } }))
}
const { post } = Astro.props // post.data.title: string, post.data.date: Date
const { Content } = await render(post)
const authors = await Promise.all(post.data.authors.map((author) => getEntry(author)))
const cover = imageMetadata(post.data.cover) // the image's URL and original size
---
<h1>{post.data.title}</h1>
<p>By {authors.map((author) => author?.data.name).join(" and ")}</p>
{cover && <Image src={cover} widths={[480, 960, 1440]} sizes="(min-width: 60rem) 48rem, 100vw" alt={post.data.cover?.alt ?? ""} />}
<Content />
```

## Schema and types

Before, each collection repeated its fields as a Zod schema:

```ts
posts: defineCollection({
  loader: noheadLoader({ collection: "posts", expand: ["cover"], body: "body", apiKey }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    authors: z.array(reference("people")),
    cover: z.object({ image_url: z.string(), width: z.number(), height: z.number() }).optional(),
    // …and every other field
  }),
}),
```

Now the loader reads the collection's fields when Astro syncs (`astro dev`, `astro build`, `astro sync`) and writes both the schema and the type, so `getCollection("posts")` is typed with none of that:

- Text fields are strings; integers and decimals, numbers; dates, `Date`s; enums, their options; booleans, `boolean` (`false` when unset); JSON, `unknown`. A multiple field is an array.
- A required field is required, others optional. An expanded asset or relation is always optional, since one deleted or unpublished since is left out.
- A relation is a `reference()` to the Astro collection named like its target's slug, so define one for every target that relations point to (`categories` for a post's `category`), or `getEntry` has nothing to find. To load a collection under another name, say which in `references`: with the people collection loaded as `authors`, `noheadLoader({ collection: "posts", references: { people: "authors" } })`. Expanded, it is an `EmbeddedRecord`, and an expanded asset an `EmbeddedAsset`. An asset that isn't expanded stays its ID.
- The `body` field isn't in the data: `render(entry)` has it.
- The schema takes the key's `schema:read` scope, which published-only keys can have; without it the sync fails and says so.
- A `schema` given to `defineCollection` takes its place, as in any Astro loader. Use one to transform values, or on Astro 5, which doesn't ask loaders for a schema.

- **Entries.** Each record becomes an entry whose `id` is the record ID and whose `data` is its fields, checked by the collection's schema. Collections load when the site builds and when `astro dev` starts. Each load lists the whole collection, removes the entries of records that are gone, and skips records that haven't changed.
- **Published only.** Only published records load, whatever the key may read, so a published-only key (`nohead_pk_…`) is enough. `filter` adds conditions (`{ featured: true }`); `filter: { published_at: undefined }` loads every record.
- **Rich text** reads as HTML (or Markdown with `richText: "markdown"`). `body` names the field that `render(entry)` renders: it moves out of `data` into the entry's rendered content. As Markdown, it goes through Astro's own Markdown pipeline (your plugins, syntax highlighting, `headings`). A record can have several rich text fields and an entry renders one; the others stay in `data` as HTML, for `<Fragment set:html={post.data.summary} />`.
- **Order.** Astro doesn't keep an order for a collection (from Astro 6, `getCollection` returns entries by ID), so sort what it returns: `posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())`.
- **Relations** stay record IDs, for `reference("people")` and `getEntry`.
- **Assets** named in `expand` replace their ID with the asset: `id`, `filename`, `content_type`, and when they have them `alt`, `width`, `height`, `image_url`, `file_url` and `media_url` (`EmbeddedAsset`). With the image service, `@nohead/astro/image-service` (under [Images](#images)), `<Image>` writes sizes and formats into the image's URL. An expanded relation becomes `{ id, data }`. An asset or record deleted since is left out, and so is an unpublished record, unless `filter` loads unpublished entries too.
- **The record's own times** are in `data` too: `published_at` (when it was published; publishing again moves it), `created_at` and `updated_at`. Nohead reserves these keys, so no field can clash with them. Sort or date posts by `published_at`, and give a sitemap `updated_at`. With entries limited to published records (the default), every entry has `published_at`.
- **Empty fields** are left out of `data` rather than `null`, so `.optional()` fits them. Without the loader's schema, dates and times are strings: `z.coerce.date()` makes them `Date`s.
- **Dates without a time** become `Date`s at midnight UTC, as Astro makes front-matter dates. Format them in UTC, `date.toLocaleDateString("en-GB", { timeZone: "UTC" })`, or west of Greenwich they show as the day before.
- **The key** is `apiKey`, or `NOHEAD_API_KEY` from the environment, and the API's address `NOHEAD_API_URL`, if set, as for the client; the other client options (`timeout`, `maxRetries`, `headers`) apply too. Astro keeps `.env` in `import.meta.env`, so pass the key from there as above.

## Images

`image: { service: { entrypoint: "@nohead/astro/image-service" } }` in astro.config, then `<Image>` and `<Picture>` (and `getImage`) write each size and format into a Nohead image's URL, which makes it on request: the build never downloads or resizes a Nohead image. Your site's own images (imported ones, and remote ones in `image.domains`) go through Astro's sharp service, resized and converted at build time as Astro does by default.

```astro
---
import { Image } from "astro:assets"
import { imageMetadata } from "@nohead/astro"
import logo from "../assets/logo.png"

const cover = imageMetadata(post.data.cover) // or an `Asset` from @nohead/sdk
---
<Image src={logo} alt="" />                                  <!-- resized at build -->
<Image src={cover} widths={[480, 960]} sizes="30rem" alt="" /> <!-- Nohead's image URLs -->
<Image src={asset.image_url} width={800} height={600} alt="" />
```

- **`imageMetadata(asset)`** gives an image asset's URL and original size, as Astro's image metadata: `width` and `height` become optional, and no `srcset` width is larger than the original (a larger one becomes the original's width). It's undefined for a file, a video or an image still processing. Only for this image service: Astro's own would look for the file in your site.
- **An `image_url`** works too, with `width` and `height`; Astro can't know the original's size from a URL.
- **Formats:** WebP unless a `format` says otherwise. Give an SVG `format="svg"` to keep it a vector (an asset's `content_type` tells).
- **Defaults** for every Nohead image go in the service's `config`, and an image's own options win: `service: { entrypoint: "@nohead/astro/image-service", config: { quality: 70 } }` (`format` too). The same `config` takes sharp's options (`jpeg`, `webp`, `avif`, `kernel`…) for your own images.
- **`sharp`** is needed for your own images, as with Astro's default service.

Needs Astro 5.9 or later.

## Development

```bash
npm install
npm test            # unit tests
npm run typecheck
npm run lint
npm run format      # Prettier
```

The client and the API's contract are `@nohead/sdk`'s, tested there; these tests cover what the loader and the image service do with the API's answers.

## Releasing

A release is a version in `package.json` with its section in `CHANGELOG.md` on `main`. The Nohead API repository's "Astro release" workflow checks them and tags the commit `v<version>`; the tag starts this repository's release workflow, which stages the package on npm (trusted publishing) and drafts the GitHub release, both approved by a maintainer.

## License

MIT
