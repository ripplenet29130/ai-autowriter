# Search Console Report Page Split

Implementation date: 2026-05-25

## Decision

Separate WordPress connection management from Search Console reporting.

The WordPress connection page should stay focused on setup and maintenance. The SEO report page should be the place for analysis and future article-generation workflows.

## Page Responsibilities

### Connection Settings

Purpose:

- Manage WordPress connections.
- Test WordPress connection.
- Edit, activate, or delete WordPress settings.
- Check Search Console connection status.
- Open the SEO report for the selected site.

Search Console details shown here are intentionally minimal:

- Connected or not connected.
- Matched Search Console property URL.
- Reconnect button.
- Refresh status button.
- Report button.

### SEO Report

Purpose:

- Analyze Search Console performance by WordPress site.
- Switch target site.
- Switch period.
- Show metrics and queries.
- Later, connect query insights to article creation and rewrite suggestions.

Initial report features:

- Site selector.
- Period selector: 7 days, 28 days, 90 days.
- Same-period previous-year comparison.
- Summary metrics:
  - Clicks
  - Impressions
  - CTR
  - Average position
- Query table:
  - Query
  - Clicks
  - Impressions
  - CTR
  - Average position

## Implemented Files

### Navigation

- `src/components/Layout.tsx`
  - Added `SEOレポート` to the left menu.
  - Cleaned visible sidebar labels.

### Routing / View Selection

- `src/App.tsx`
  - Added `seo-report` view.
  - Renders `SEOReport`.

### State

- `src/store/useAppStore.ts`
  - Added `selectedSeoReportConfigId`.
  - Added `setSelectedSeoReportConfigId`.
  - This lets the connection page open the report page for a specific WordPress site.

### Connection Page

- `src/components/SearchConsole/GscConnectionSummary.tsx`
  - New compact Search Console status panel for WordPress connection cards.
- `src/components/WordPressConfig/ConfigList.tsx`
  - Replaced the detailed report panel with the compact status panel.

### Report Page

- `src/components/SEOReport.tsx`
  - New dedicated Search Console report page.
  - Uses existing `gsc-property-status` and `gsc-search-analytics` functions through `searchConsoleService`.
  - Compares the selected period with the same period in the previous year.

## Previous-Year Comparison

Implementation date: 2026-05-26

The SEO report now fetches two date ranges:

- Current selected range.
- Same date range in the previous year.

Example:

- Current 90 days: `2026-02-26` to `2026-05-26`
- Previous-year comparison: `2025-02-26` to `2025-05-26`

Implemented changes:

- `supabase/functions/gsc-search-analytics/index.ts`
  - Added optional `start_date` and `end_date` request parameters.
  - Keeps the existing `days` request shape for backward compatibility.
  - Fills missing date rows with zero values for cleaner chart comparison.
- `src/services/searchConsoleService.ts`
  - Added date-range options to `fetchAnalytics`.
- `src/components/SEOReport.tsx`
  - Fetches current date data, previous-year date data, and current query data.
  - Shows previous-year values in metric cards.
  - Shows change labels for clicks, impressions, CTR, and average position.
  - Adds dashed previous-year lines to the daily trend chart.
  - Adds a comparison-mode toggle. When comparison mode is off, previous-year data is not fetched.

### Settings Text Cleanup

- `src/components/Settings.tsx`
  - Cleaned visible Japanese labels.

## Next Suggested Phase

The next product step is not more connection work. It should be SEO interpretation:

- Extract high-impression, low-CTR queries.
- Extract queries ranking around positions 5 to 20.
- Separate new-article candidates from rewrite candidates.
- Add actions such as:
  - Create article from this query.
  - Create rewrite brief from this query.
