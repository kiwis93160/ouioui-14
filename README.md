<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1iJ5atJAu7tHsxLPqDE6UpJlnRbKgY8K_

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Public data surface

The Firebase Realtime Database now exposes a dedicated `public_menu` node that mirrors a
sanitised subset of the restaurant data. The Cloud Functions copy only the fields required by
anonymous users:

- **Products** – name, category, availability state, price and public image URL.
- **Categories** – name only, filtered to those used by the public catalogue.
- **Recipes** – ingredient references without cost or quantity information (quantities are
  zeroed so preparation ratios stay private).
- **Ingredients** – display name and unit so customers can request exclusions while stock and
  pricing stay internal.
- **Site assets** – marketing assets already intended for public rendering.

Because the `public_menu` node is world-readable while the rest of the dataset remains locked
down, the front-end can serve menu browsing and takeaway flows without an authenticated role.

## Deployment workflow

1. Deploy the updated security rules so the anonymous surface is read-only:
   ```bash
   firebase deploy --only database:rules
   ```
2. Deploy the new replication triggers (they run in `us-central1`):
   ```bash
   firebase deploy --only \
     functions:publicMenuOnProductsWrite,\
     functions:publicMenuOnCategoriesWrite,\
     functions:publicMenuOnRecettesWrite,\
     functions:publicMenuOnIngredientsWrite,\
     functions:publicMenuOnSiteConfigWrite
   ```
3. After the first deployment, trigger an initial backfill (any write on the source nodes will
   do). One option with the Firebase CLI is to reapply the existing site configuration:
   ```bash
   firebase database:get /site_configuration > /tmp/site_config.json
   firebase database:update /site_configuration /tmp/site_config.json
   ```
   This causes the Cloud Function to recompute `public_menu`. Subsequent product/category/
   recipe/ingredient/site configuration edits will keep the public node in sync automatically.
