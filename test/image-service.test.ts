import type { ImageTransform } from "astro"
import sharpService from "astro/assets/services/sharp"
import { describe, expect, it, vi } from "vitest"

import imageService from "../src/image-service.ts"
import { imageMetadata } from "../src/index.ts"

const base =
  "https://images.nohead.io/plain/0199f5c2-7b1e-7c3a-9d4f-2a6b8c0e1f3d/0199f5c2-8a2d-7e4b-b1c3-5d7e9f1a2b4c"
const at = (options: string) => base.replace("/plain/", `/${options}/plain/`)

type Config = Parameters<typeof imageService.getURL>[1]
type Logger = Parameters<typeof imageService.getURL>[2]
const config = {} as Config
const logger = {} as Logger

/**
 * What Astro's getImage does with an <Image>'s props (astro/assets,
 * getImage): validate them, then ask for the srcset, the URLs and the
 * attributes.
 */
async function image(props: ImageTransform, using: Config = config) {
  const options = await imageService.validateOptions!(
    { ...props },
    using,
    logger
  )
  const srcSet = await imageService.getSrcSet!(options, using, logger)
  return {
    src: await imageService.getURL(options, using, logger),
    srcset: await Promise.all(
      srcSet.map(
        async ({ transform, descriptor, attributes }) =>
          [
            await imageService.getURL(transform, using, logger),
            descriptor,
            attributes,
          ] as const
      )
    ),
    attributes: await imageService.getHTMLAttributes!(options, using, logger),
  }
}

describe("the Astro image service", () => {
  it("renders an <Image> with its alt, size and srcset, as WebP, cropped to its box", async () => {
    const rendered = await image({
      src: base,
      width: 800,
      height: 600,
      alt: "A chalkboard",
      widths: [400, 800],
      class: "cover",
    })
    expect(rendered.src).toBe(`${at("rs:fill:800:600")}@webp`)
    expect(rendered.attributes).toEqual({
      alt: "A chalkboard",
      class: "cover",
      width: 800,
      height: 600,
      loading: "lazy",
      decoding: "async",
    })
    expect(rendered.srcset).toEqual([
      [`${at("rs:fill:400:300")}@webp`, "400w", { type: "image/webp" }],
      [`${at("rs:fill:800:600")}@webp`, "800w", { type: "image/webp" }],
    ])
  })

  it("never makes an image larger than its largest width, as an original's size would", async () => {
    // A 6000 × 4000 original: its src would be made at 6000 pixels.
    const rendered = await image({
      src: base,
      width: 6000,
      height: 4000,
      alt: "",
      widths: [400, 1600],
    })
    expect(rendered.src).toBe(`${at("rs:fill:1600:1067")}@webp`)
    expect(
      rendered.srcset.map(([url, descriptor]) => [url, descriptor])
    ).toEqual([
      [`${at("rs:fill:400:267")}@webp`, "400w"],
      [`${at("rs:fill:1600:1067")}@webp`, "1600w"],
    ])
    // The same URL as the largest srcset entry: made once.
    expect(rendered.src).toBe(rendered.srcset.at(-1)?.[0])
    // Only the URL: the attributes, its size without CSS, stay its own.
    expect(rendered.attributes).toMatchObject({ width: 6000, height: 4000 })

    // Densities, or no widths at all: the size asked for.
    expect(
      (
        await image({
          src: base,
          width: 250,
          height: 250,
          alt: "",
          densities: [1, 2],
        })
      ).src
    ).toBe(`${at("rs:fill:250:250")}@webp`)
    expect(
      (await image({ src: base, width: 2400, height: 1600, alt: "" })).src
    ).toBe(`${at("rs:fill:2400:1600")}@webp`)
  })

  it("takes Astro's formats, fits and qualities", async () => {
    const url = async (props: Partial<ImageTransform>) =>
      (await image({ src: base, width: 300, height: 200, ...props })).src
    expect(await url({ format: "avif" })).toBe(`${at("rs:fill:300:200")}@avif`)
    expect(await url({ format: "jpg" })).toBe(`${at("rs:fill:300:200")}@jpeg`)
    expect(await url({ fit: "contain", quality: "high" })).toBe(
      `${at("rs:fit:300:200/q:80")}@webp`
    )
    expect(await url({ fit: "scale-down" })).toBe(
      `${at("rs:fit:300:200")}@webp`
    )
    expect(await url({ fit: "somehow" })).toBe(`${at("rs:fit:300:200")}@webp`)
    expect(await url({ quality: 70 })).toBe(
      `${at("rs:fill:300:200/q:70")}@webp`
    )
    expect(await url({ quality: "60" })).toBe(
      `${at("rs:fill:300:200/q:60")}@webp`
    )
    // An SVG kept as a vector: no format, so the image's own.
    expect(await url({ format: "svg" })).toBe(at("rs:fill:300:200"))
  })

  it("takes defaults from the service's config, which an image's own options override", async () => {
    const using = {
      service: { config: { quality: 70, format: "avif" } },
    } as unknown as Config
    const rendered = await image(
      { src: base, width: 400, height: 300, widths: [400] },
      using
    )
    expect(rendered.src).toBe(`${at("rs:fill:400:300/q:70")}@avif`)
    expect(rendered.srcset).toEqual([
      [`${at("rs:fill:400:300/q:70")}@avif`, "400w", { type: "image/avif" }],
    ])
    expect(
      (
        await image(
          {
            src: base,
            width: 400,
            height: 300,
            quality: "high",
            format: "jpg",
          },
          using
        )
      ).src
    ).toBe(`${at("rs:fill:400:300/q:80")}@jpeg`)
    const jpg = { service: { config: { format: "jpg" } } } as unknown as Config
    const asJpeg = await image(
      { src: base, width: 400, height: 300, widths: [400] },
      jpg
    )
    expect(asJpeg.srcset[0]![2]).toEqual({ type: "image/jpeg" })
    const presetOnly = {
      service: { config: { quality: "low" } },
    } as unknown as Config
    expect(
      (await image({ src: base, width: 400, height: 300 }, presetOnly)).src
    ).toBe(`${at("rs:fill:400:300/q:25")}@webp`)
  })

  it("hands the site's own images to Astro's sharp service, which resizes them at build", async () => {
    // Its URLs need Astro's env; test/build.test.ts builds them for real.
    const sharpURL = vi
      .spyOn(sharpService, "getURL")
      .mockReturnValue("/_image?href=logo.png")
    const local = {
      src: "/@fs/site/src/assets/logo.png",
      width: 1000,
      height: 500,
      format: "png" as const,
    }
    const options = await imageService.validateOptions!(
      { src: local, width: 400 },
      config,
      logger
    )
    expect(options.src).toBe(local)
    expect(imageService.getURL(options, config, logger)).toBe(
      "/_image?href=logo.png"
    )
    const remote = { src: "https://example.com/cat.png", width: 100 }
    await imageService.getURL(remote, config, logger)
    expect(sharpURL).toHaveBeenCalledWith(remote, config, logger)
    // Astro builds files only with a local service: one with a transform.
    expect(imageService.transform).toBe(sharpService.transform)
    sharpURL.mockRestore()
  })

  it("gives a Nohead image its final URL as src, which getURL returns as it is, so Astro never downloads it", async () => {
    const options = await imageService.validateOptions!(
      { src: base, width: 800, height: 600, widths: [400, 800] },
      config,
      logger
    )
    expect(options.src).toBe(`${at("rs:fill:800:600")}@webp`)
    // getImage writes an image into the build unless this holds.
    expect(await imageService.getURL(options, config, logger)).toBe(options.src)
  })

  it("keeps an image with a known original size within it", async () => {
    // A 1000 × 500 original, as imageMetadata gives it.
    const original = {
      src: base,
      width: 1000,
      height: 500,
      format: "png" as const,
    }
    const rendered = await image({
      src: original,
      width: 1000,
      height: 500,
      alt: "",
      widths: [400, 800, 1600, 2400],
    })
    expect(
      rendered.srcset.map(([url, descriptor]) => [url, descriptor])
    ).toEqual([
      [`${at("rs:fill:400:200")}@webp`, "400w"],
      [`${at("rs:fill:800:400")}@webp`, "800w"],
      [`${at("rs:fill:1000:500")}@webp`, "1000w"],
    ])
    expect(rendered.src).toBe(`${at("rs:fill:1000:500")}@webp`)
    // Asked for more than there is: the original's size, not an enlargement.
    expect(
      (await image({ src: original, width: 2000, height: 1000, alt: "" })).src
    ).toBe(`${at("rs:fill:1000:500")}@webp`)
  })
})

describe("imageMetadata", () => {
  it("gives an image asset's URL, size and format, and nothing for other assets", () => {
    const asset = {
      content_type: "image/jpeg",
      image_url: base,
      width: 1200,
      height: 800,
    }
    expect(imageMetadata(asset)).toEqual({
      src: base,
      width: 1200,
      height: 800,
      format: "jpg",
    })
    expect(
      imageMetadata({ ...asset, content_type: "image/svg+xml" })?.format
    ).toBe("svg")
    // A file, or an image still processing.
    expect(
      imageMetadata({ content_type: "application/pdf", image_url: null })
    ).toBeUndefined()
    expect(imageMetadata({ ...asset, width: null })).toBeUndefined()
    expect(imageMetadata(undefined)).toBeUndefined()
  })
})
