# Rule: Automatic Version Info & Changelog Maintenance

## 📌 Requirement
Whenever new features are implemented, improvements are made, or bug fixes are applied to the codebase:
- **Do NOT ask the user for permission** to update the version info page or changelog.
- **Automatically update** `src/components/settings/VersionInfo.tsx`.
- **Bump the version** in `package.json` appropriately (e.g., patch or minor version bump).

## 📝 Release Guidelines in `src/components/settings/VersionInfo.tsx`
1. Add the new release at the top of the `RELEASES` array.
2. Mark the new release as `isCurrent: true`, and remove `isCurrent: true` from older releases.
3. Use formatted date (e.g. `October 2026`).
4. Include structured `changes` with:
   - `type`: `'feature' | 'improvement' | 'fix'`
   - `title`: Short descriptive title
   - `description`: Plain-English explanation of the change and user value.
