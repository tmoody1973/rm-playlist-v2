// Flat config for ESLint 9. Per-package configs may extend this.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.convex/_generated/**",
      "**/.turbo/**",
      "radiomke-playlist-app V1/**",
      "v1-reference/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Prefer named exports for traceability (rm-playlist-v2 clean-code rule)
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
    },
  },
);
