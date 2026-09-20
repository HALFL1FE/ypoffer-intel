# Four-sheet offer workbook

The Offer Tracker main table has four tabs: Offer list, Google Ads, Deal Sites, and Creators. Offer list merges merchant offer details with product Top ASINs. The existing filters and table remain in place.

The export button directly produces one workbook with `全部商家汇总`,
`谷歌广告`, `折扣网站`, and `红人`. The master contains every merchant in the
selected/filtered export scope.
Exact duplicate Merchant IDs retain the first row in the current order. Channel
selection never removes a merchant from the master. Missing-ID rows remain in
the master but cannot be assigned to a channel.

All four sheets share columns and retain the current global Top 5 ASIN ranking.
`Channel ASINs` is independent per merchant/channel, with overlap allowed and
manual additional ASINs supported. Additional ASIN ownership must be verified.
Empty channel sheets retain the legend and headers. Each sheet uses its own
priority colors; channel edits never recolor the master or other channels. Pagination never limits exported rows.

## Candidate rules v1

All automatic selections are **unverified candidates**, never confirmed traffic
permission, historical channel performance, or proven product/channel fit.
Candidates require an exact Merchant ID, at least one Top ASIN, positive AFF
commission and a Tier other than BLACK TIER.

- Google Ads: positive overall merchant revenue, as a search-test screening signal.
- Deal sites: 0 < merchant AOV <= 100, as an accessible-price screening signal.
- Creators: beauty, personal care, home, kitchen, sports, outdoors, pets, toys,
  electronics or clothing/fashion category wording (Chinese/English).

These starting rules deliberately do not infer PPC permission from BB preference,
a genuine discount from AOV, or creator fit from overall revenue. They do not
rank products separately per channel: without product evidence, each starts
with the global Top 5. Users can include merchants missed by the heuristic,
including high-value expensive deals, and select different products and reasons.

## Review and export

Each main-page channel tab has a collapsed optional editor for inclusion, priority,
ASINs, merchant/ASIN reasons and verification notes. All changes are held only
in the current page session, with no database or browser persistence. Tab switches preserve edits; reloading the page discards them. The inclusion checkbox removes a merchant from that channel.
Invalid/empty ASINs for an included merchant block export until corrected or
the merchant is removed. Priority and verification status are independent; changing
priority or ASINs never automatically confirms verification.

Workbook rows include the applied reporting start/end, rule version, selection
source and a metric-scope note identifying revenue as overall merchant data.
ASIN columns remain present in both the main table and workbook, because they
are required by the combined workbook contract. Other optional columns retain
the existing visibility controls. Export uses the four-sheet workbook builder. Export all uses the complete filtered master even when a channel tab is open; export selected uses selected rows in the active tab.

## Three-grade colors (user workbook, 2026-09-20)

The source workbook `YP Amazon Offers (9-7) (2).xlsx` has exactly these legend labels:

| Grade | Fill | Label |
| --- | --- | --- |
| high | #D6EEDD | 高优先级offer |
| recommended | #CCFFFF | 推荐offer、低单价优选 |
| low-aov | #FFFFFF | 低单价优选 |

All four sheets start with the three-row legend, followed by the #1F4E78 header
on row 4, a filter, and freeze at A5. Priority text and entire data-row fill always
agree. The redundant export editing modal is removed.
Default page order and workbook order use each list's own grade: green high priority,
cyan recommended, then white low-price picks. Ties preserve the source order.
The Tier column remains a separate merchant attribute, not a coloring key.
The master grade follows the applied priority rules; channel grades initially
inherit that grade, then can be edited independently. This preserves the existing
scoring thresholds rather than inferring business ranking rules from color alone.
Automatic candidates have a separate unverified status; manual verification is
explicit and scoped to that merchant/channel.
