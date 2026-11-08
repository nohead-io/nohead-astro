import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { build } from "astro"
import sharp from "sharp"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * A real build of a site with one image of its own and one of Nohead's,
 * through the image service. The service rests on a condition inside
 * Astro's getImage (a remote `src` that getURL returns as it is gets no
 * file in the build): this keeps it true across Astro releases.
 */
const root = fileURLToPath(new URL("fixtures/site/", import.meta.url))
let outDir: string
let html: string
const fetched: string[] = []

beforeAll(async () => {
  await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: "#c33" },
  })
    .png()
    .toFile(join(root, "src/assets/local.png"))
  outDir = await mkdtemp(join(tmpdir(), "nohead-astro-build-"))
  const realFetch = globalThis.fetch
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    fetched.push(String(input instanceof Request ? input.url : input))
    return realFetch(input, init)
  })
  await build({ root, outDir, logLevel: "error" })
  html = await readFile(join(outDir, "index.html"), "utf8")
}, 60_000)

afterAll(async () => {
  vi.restoreAllMocks()
  await rm(outDir, { recursive: true, force: true })
})

const img = (id: string) =>
  html.match(new RegExp(`<img[^>]*id="${id}"[^>]*>`))?.[0] ?? ""

describe("a build with the image service", () => {
  it("resizes and converts the site's own images, as Astro's default service does", async () => {
    const files = await readdir(join(outDir, "_astro"))
    expect(files.filter((file) => /^local\..*\.webp$/.test(file))).toHaveLength(
      3
    )
    expect(img("local")).toMatch(/src="\/_astro\/local\.[^"]+\.webp"/)
    expect(img("local")).toMatch(/srcset="\/_astro\/local\.[^"]+\.webp 400w, /)
  })

  it("leaves Nohead's images to their URLs: nothing downloaded, nothing in the build", async () => {
    expect(fetched.filter((url) => url.includes("images.nohead.io"))).toEqual(
      []
    )
    const files = await readdir(join(outDir, "_astro"))
    expect(files.filter((file) => !file.startsWith("local."))).toEqual([])
    // 1600 is above the 1000 px original: its own width instead.
    expect(img("nohead")).toContain(
      'src="https://images.nohead.io/rs:fill:1000:500/plain/0000/0000@webp"'
    )
    expect(img("nohead")).toContain(
      'srcset="https://images.nohead.io/rs:fill:400:200/plain/0000/0000@webp 400w, https://images.nohead.io/rs:fill:800:400/plain/0000/0000@webp 800w, https://images.nohead.io/rs:fill:1000:500/plain/0000/0000@webp 1000w"'
    )
    expect(img("nohead")).toContain('width="1000" height="500"')
  })
})
