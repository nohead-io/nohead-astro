/**
 * Astro's image service for Nohead images
 * (`@nohead/astro/image-service`). In astro.config:
 *
 *   image: { service: { entrypoint: "@nohead/astro/image-service" } }
 *
 * then `<Image src={asset.image_url} width={…} height={…} alt={…} />`, or
 * `<Image src={entry.data.cover} alt={…} />` with an image the loader
 * expanded, which carries its own size. `<Image>` and `<Picture>` write each
 * size and format into the image's URL, and Nohead makes it on request, so
 * the build never downloads or resizes a Nohead image. WebP unless a
 * `format` says otherwise. With `widths`, an image's URL is never larger than
 * the largest of them, and with its original size known, no `srcset` width
 * is larger than the original.
 *
 * The site's own images (imported, or remote ones in `image.domains`) are
 * Astro's sharp service's, resized and converted at build time as Astro does
 * by default; the service's `config` takes sharp's options for them too.
 *
 * Defaults for every Nohead image go in the service's `config`, and an
 * image's own `quality` or `format` wins:
 *
 *   service: { entrypoint: "@nohead/astro/image-service", config: { quality: 70 } }
 *
 * How it stays out of the build: Astro writes an image into the build only
 * when the service is local and the image's URL isn't its validated `src`
 * as it is (`getImage`, astro/assets). So `validateOptions` makes a Nohead
 * image's `src` its final URL, and `getURL` returns that URL unchanged.
 * test/build.test.ts builds a site to keep that true.
 */
import type { ImageMetadata, ImageTransform, LocalImageService } from "astro"
import sharpService, {
  type SharpImageServiceConfig,
} from "astro/assets/services/sharp"
import { imageUrl, isImageUrl } from "@nohead/sdk/images"

import { fitOf, formatOf, qualityOf } from "./frameworks.ts"

/**
 * The service's `config` in astro.config: defaults for every Nohead image,
 * and sharp's options for the site's own images.
 */
export interface ImageServiceConfig extends SharpImageServiceConfig {
  /** 1 to 100, or one of Astro's presets (`"high"` is 80). */
  quality?: number | "low" | "mid" | "high" | "max"
  /** `"webp"` unless set. */
  format?: "webp" | "avif" | "jpeg" | "jpg" | "png"
}

type Config = Parameters<LocalImageService<ImageServiceConfig>["getURL"]>[1]

/** A Nohead image's `image_url`, and its size when Astro was given it. */
interface Original {
  url: string
  width?: number
  height?: number
}

/**
 * Each Nohead image's final URL, as `validateOptions` made it `src`, with
 * the original it came from: `srcset` widths are made from the original's
 * URL, since `imageUrl` can't take a URL that already has options.
 */
const originals = new Map<string, Original>()

/**
 * The Nohead image a `src` is: an `image_url`, an image's final URL, or
 * image metadata (an image the loader expanded) whose `src` is one.
 */
function originalOf(src: ImageTransform["src"]): Original | undefined {
  if (typeof src === "string")
    return originals.get(src) ?? (isImageUrl(src) ? { url: src } : undefined)
  if (isImageUrl(src.src))
    return { url: src.src, width: src.width, height: src.height }
  return undefined
}

/**
 * The size an image's URL is made at: its own, but at most the largest of
 * its `widths`, the height scaled with it. Astro makes `src` (the fallback
 * for browsers without `srcset`) at the image's own size, and sites pass an
 * asset's, an original's, which can be huge; capped, `src` is the largest
 * `srcset` entry, one URL the CDN makes once. Only the URL: the `width` and
 * `height` attributes stay the image's, its display size without CSS.
 * Without `widths` (`densities`, or one size), the size asked for. Never
 * wider than the original, when its size is known: Nohead doesn't enlarge.
 */
function sizeOf({ width, height, widths }: ImageTransform, original: Original) {
  const largest = Math.min(
    widths?.length ? Math.max(...widths) : Infinity,
    original.width ?? Infinity
  )
  if (typeof width !== "number" || width <= largest) return { width, height }
  return {
    width: largest,
    height:
      typeof height === "number"
        ? Math.round((height * largest) / width)
        : height,
  }
}

/** The URL of a Nohead image at a transform's size, format and quality. */
function urlOf(options: ImageTransform, original: Original, config: Config) {
  const defaults = config?.service?.config
  const { width, height } = sizeOf(options, original)
  return imageUrl(original.url, {
    width,
    height,
    fit: fitOf(options.fit, width, height),
    format: formatOf(options.format ?? defaults?.format ?? "webp"),
    quality: qualityOf(options.quality ?? defaults?.quality),
  })
}

const imageService: LocalImageService<ImageServiceConfig> = {
  ...sharpService,
  async validateOptions(options, imageConfig, logger) {
    const original = originalOf(options.src)
    if (!original)
      return sharpService.validateOptions!(options, imageConfig, logger)
    // Checked as Astro checks a remote image, then given its final URL. The
    // format first, so the srcset's <source type> says what the URLs serve
    // (a Picture's needs `jpeg`, not `jpg`), and before Astro 6 picks its
    // own default.
    const validated: ImageTransform = await sharpService.validateOptions!(
      {
        ...options,
        src: original.url,
        format:
          options.format ??
          formatOf(imageConfig?.service?.config?.format) ??
          "webp",
      },
      imageConfig,
      logger
    )
    const url = urlOf(validated, original, imageConfig)
    originals.set(url, original)
    validated.src = url
    return validated
  },
  getSrcSet(options, imageConfig, logger) {
    const original =
      typeof options.src === "string" ? originals.get(options.src) : undefined
    if (!original?.width || !original.height)
      return sharpService.getSrcSet!(options, imageConfig, logger)
    // As image metadata, so Astro keeps the widths within the original's
    // and adds its own width in place of those above it (it reads only the
    // size; the format is the transform's).
    const src: ImageMetadata = {
      src: original.url,
      width: original.width,
      height: original.height,
      format: "webp",
    }
    return sharpService.getSrcSet!({ ...options, src }, imageConfig, logger)
  },
  getURL(options, imageConfig, logger) {
    const original = originalOf(options.src)
    if (!original) return sharpService.getURL(options, imageConfig, logger)
    const url = urlOf(options, original, imageConfig)
    originals.set(url, original)
    return url
  },
}

export default imageService
