# Search Console Phase 4 Implementation Result

Implementation date: 2026-05-25

## Scope

Phase 4 connects the saved Google Search Console OAuth token to the WordPress configuration UI.

The app can now:

- Check whether each registered WordPress site matches an accessible Search Console property.
- Store the property match result in `public.gsc_property_statuses`.
- Fetch Search Analytics data for the matched property.
- Show the past 28 days summary and top query rows inside each WordPress configuration card.

## Added Edge Functions

### `gsc-property-status`

Path:

```text
supabase/functions/gsc-property-status/index.ts
```

Role:

- Requires the logged-in user's Authorization header.
- Loads the user's `account_id`.
- Loads the target `wordpress_configs` row.
- Refreshes the Google access token when needed.
- Lists accessible Search Console properties.
- Matches URL prefix properties and `sc-domain:` properties.
- Saves the result into `public.gsc_property_statuses`.

### `gsc-search-analytics`

Path:

```text
supabase/functions/gsc-search-analytics/index.ts
```

Role:

- Requires the logged-in user's Authorization header.
- Loads the matched property from `gsc_property_statuses`.
- Calls the Search Console Search Analytics API.
- Supports `date` and `query` dimensions.
- Returns summary metrics: clicks, impressions, CTR, and average position.

Deploy commands:

```bash
supabase functions deploy gsc-property-status
supabase functions deploy gsc-search-analytics
```

These functions should be deployed normally. Do not use `--no-verify-jwt` for them.

## Added Frontend

### Service methods

Path:

```text
src/services/searchConsoleService.ts
```

Added:

- `checkPropertyStatus(wordpressConfigId)`
- `fetchAnalytics(wordpressConfigId, dimension, days, rowLimit)`

### Display component

Path:

```text
src/components/SearchConsole/GscSitePanel.tsx
```

The panel shows:

- Search Console status.
- Matched property URL.
- Reconnect button.
- Refresh button.
- Past 28 days metrics.
- Top query rows.
- Loading and error states.

### WordPress config integration

Path:

```text
src/components/WordPressConfig/ConfigList.tsx
```

Change:

- Replaced the placeholder Search Console text with `GscSitePanel`.
- Cleaned up visible Japanese labels in this component.

## Verification

Commands:

```bash
npx.cmd tsc -b
npm.cmd run build
```

Result:

- TypeScript check passed.
- Production build passed.

Note:

- The first build attempt failed because the project build script needs to fetch/use Node 22 when the local Node version is 24. The build passed after granting the required network/cache permission.
