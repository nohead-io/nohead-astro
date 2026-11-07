# Changelog

Changes to `@nohead/astro` that you can notice. Versions follow
[Semantic Versioning](https://semver.org): additive changes are minor
releases; a change that could break your site is a major one. Before 1.0, a
minor release may also break it, and its notes mark each such change
**Breaking**. Each release's section is its GitHub release's notes.

## 0.1.0

- Nohead's Astro content loader and image service, until now in
  `@nohead/sdk` as `@nohead/sdk/astro` and `@nohead/sdk/astro/image-service`,
  as a package of their own with its own releases. Import `noheadLoader` from
  `@nohead/astro`, and use `@nohead/astro/image-service` as the image
  service's entrypoint. Nothing else changes: it is the loader of
  `@nohead/sdk` 0.17.0, `references` and the records' times included.
