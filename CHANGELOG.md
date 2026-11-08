# Changelog

Changes to `@nohead/astro` that you can notice. Versions follow
[Semantic Versioning](https://semver.org): additive changes are minor
releases; a change that could break your site is a major one. Before 1.0, a
minor release may also break it, and its notes mark each such change
**Breaking**. Each release's section is its GitHub release's notes.

## 0.2.0

- **Breaking:** the image service resizes your site's own images again.
  It used to serve every image that wasn't Nohead's as it was, so an
  imported PNG stopped being resized and converted once the service was
  set. Now those go through Astro's sharp service, as with Astro's default:
  `sharp` is needed for them, as it is there, and the service's `config`
  takes sharp's options for them. Nohead's images are still made from their
  URLs, never downloaded or resized by the build.
- `imageMetadata(asset)` gives an image asset (an expanded one, or the
  SDK's `Asset`) as Astro's image metadata, for
  `<Image src={imageMetadata(entry.data.cover)} alt="…" />`: `width` and
  `height` become optional, and no `srcset` width is larger than the
  original. An image's URL is never made larger than its original either.
- On Astro 5, the service's `format` default applies to Nohead images; it
  was WebP whatever the config said.

## 0.1.0

- Nohead's Astro content loader and image service, until now in
  `@nohead/sdk` as `@nohead/sdk/astro` and `@nohead/sdk/astro/image-service`,
  as a package of their own with its own releases. Import `noheadLoader` from
  `@nohead/astro`, and use `@nohead/astro/image-service` as the image
  service's entrypoint. Nothing else changes: it is the loader of
  `@nohead/sdk` 0.17.0, `references` and the records' times included.
