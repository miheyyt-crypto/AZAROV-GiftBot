import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-test/**",
      "**/node_modules/**",
      "**/drizzle.config.ts",
      // Embedded/local Postgres scratch (gitignored); leftover .mjs must not fail lint.
      ".local-dev-pg/**",
      // Local load/preprod helper scripts (not package runtime).
      "tools/loadtest/**/*.mjs",
      "tools/loadtest/**/*.cjs",
      "tools/loadtest/_*.js",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
    },
  },
  {
    files: ["apps/web/**/*.test.ts", "apps/web/**/*.test.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./apps/web/tsconfig.test.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["scripts/**/*.mjs", "**/scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        Response: "readonly",
        Buffer: "readonly",
      },
    },
  },
);
