import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
    test: {
        include: "./test/*.js",
        poolOptions: {
            workers: {
                wrangler: { configPath: "./wrangler.toml" },
                singleWorker: false
            },
        },
        watch: {
            clearCache: true,
            silent: true,
            dirs: ['.'],
            extensions: ['js'],
            ignore: ['node_modules'],
        },
    },
});
