# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-04-10

### Features

- Add provider adapter pattern with auto-detection by @Saturate ([6d8f53b](https://github.com/Saturate/mitid-cli/commit/6d8f53b0b55dfbe20981be3e363978fb1ff1fbe3))

- Export/import identities + fix bugs from audit by @Saturate ([b586d04](https://github.com/Saturate/mitid-cli/commit/b586d0445fb912c776729f2370c189c8c0d55a5d))

- Output JSON from login, capture response body with tokens by @Saturate ([e698546](https://github.com/Saturate/mitid-cli/commit/e698546dc2c3db9427bc2ecef8540b98edb61abd))

- Auto-approve during login by default by @Saturate ([12c8c02](https://github.com/Saturate/mitid-cli/commit/12c8c024a7dbcd75079833b15b0e1ed9af47c758))

- Auto-register simulator code app when none exists by @Saturate ([ff80c01](https://github.com/Saturate/mitid-cli/commit/ff80c0111ccc43bad18242aa38af5311779d2909))


### Bug Fixes

- Read version from package.json instead of hardcoding by @Saturate ([08122eb](https://github.com/Saturate/mitid-cli/commit/08122eb6f998adfccbc1a97f91c2ff608150a809))

- Always include body in login output by @Saturate ([6bf2095](https://github.com/Saturate/mitid-cli/commit/6bf2095f940744fa77436294c2d025d5c1769e5a))


### Documentation

- Explain aux in README and how it works section by @Saturate ([937a0e7](https://github.com/Saturate/mitid-cli/commit/937a0e7c8421d3254544e282e72d0e88f64d8b09))

- Update command descriptions for auto-approve by @Saturate ([25664a4](https://github.com/Saturate/mitid-cli/commit/25664a4a6841370ec15a26b80ffd29e812c574bb))


### Styling

- Fix biome formatting by @Saturate ([1e0d656](https://github.com/Saturate/mitid-cli/commit/1e0d65651f818282b66e78b450f27985f4e860e6))


### Miscellaneous

- Add CI, release workflows and switch to pnpm by @Saturate ([34ac524](https://github.com/Saturate/mitid-cli/commit/34ac524dc5eaae06d1cb1a109236747b3dee5ede))

- Simplify to Node 24 only by @Saturate ([31e61d4](https://github.com/Saturate/mitid-cli/commit/31e61d4fe0a56749df6dbbd8fd06cc8402cfd298))

- Add GitHub Sponsors funding config by @Saturate ([b7c4c62](https://github.com/Saturate/mitid-cli/commit/b7c4c62dd5bf5e21389f396f01b92c423d3e1e8d))

- Add biome linting, fix changelog push, format codebase by @Saturate ([60de24c](https://github.com/Saturate/mitid-cli/commit/60de24c6715fa2d9b2858416531d7e532c3b8e0d))

- Revert changelog push workaround, now using rulesets with app bypass by @Saturate ([c2a1aeb](https://github.com/Saturate/mitid-cli/commit/c2a1aeb36c70e1fcd42f6d4f5fcb7310179429d6))

- Fix release workflow - remove broken npm upgrade, use Node 24 by @Saturate ([5a4b68a](https://github.com/Saturate/mitid-cli/commit/5a4b68acc8ddf699ad978129a1f8930d17f93d21))

- Fix prepare-release race with changelog bot by @Saturate ([b0c2df1](https://github.com/Saturate/mitid-cli/commit/b0c2df1690d7dbf9ec5e46c75ee0cee65e707328))

- Fix lint warning, update docs for always-present body field by @Saturate ([43b90e2](https://github.com/Saturate/mitid-cli/commit/43b90e22c37f54cedb83796e5824546c70c44176))


