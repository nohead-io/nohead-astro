// The site test/build.test.ts builds, with the image service from source.
import { defineConfig } from "astro/config"

export default defineConfig({
  image: { service: { entrypoint: "../../../src/image-service.ts" } },
  logLevel: "error",
})
