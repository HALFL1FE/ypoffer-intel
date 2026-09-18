# Offer media review / Offer 媒体复盘

Open **Products & offers → Promotion tracking → Multi-list publisher review**.
入口：**产品与 Offer → 推广追踪 → 多清单 · 媒体复盘**。

## Temporary imports / 临时导入

Imports live only in the review component's memory. Refreshing or leaving this
view clears them. No new database table, write privileges, browser storage or
server file storage is required. Export the workbook to retain the analysis.
导入只保留在复盘组件内存中，刷新或离开视图即清除。不建数据库表、不增加写权限，
不写浏览器存储或服务端文件。需要保留分析时导出 Excel。

Each XLSX is parsed on the authenticated server, previewed, then explicitly
added to the temporary session. Up to ten files can be staged together and up
to thirty retained in memory (2.5 MB compressed / 30 MB expanded per file).
Session metadata includes SHA-256, actual UTC parsing/import time, authenticated
actor, list date, logical identity, parser version, source rows and cell fills.
同次可预览十份 XLSX，会话最多三十份；每份压缩前最多 2.5 MB、解压后最多 30 MB。
服务端鉴权解析后，确认加入临时会话，保留文件哈希、本次实际 UTC 导入时间、登录用户、
清单日期、逻辑标识、解析器版本、源行和填充色。

Identical bytes produce the same identity and are deduplicated within the session.
Changed files may be revisions of an existing logical list: count the additional
session import separately from the logical-list count. These are session counts,
not lifetime audit records. Historical entries retain unknown import time/actor.
Importing does not count as sending a recommendation.
同文件按哈希在本会话去重。更正文件可选择修订原清单，分别计算本次导入数和逻辑清单数。
这些数只代表本次会话，不是历史审计记录。历史目录的导入时间/导入人保持未知，导入不
等于发送推荐。

`List of Offers` is authoritative for merchant AOV; a different product-sheet
AOV is retained in source evidence and flagged in preview. Color legends and
explicit priority columns stay separate from site Tier. Negated ASIN sentences
are flagged and excluded from automatically extracted reason targets. Blocking
ID/duplicate conflicts must be corrected in the source workbook.
商家 AOV 以 Offer 主表为准；产品表不同值保留来源并在预览提示。颜色图例/明确等级
与网站 Tier 分开。否定句 ASIN 提示后不自动纳入理由目标；阻断的 ID 或重复内容冲突
需在源文件修正。

## Reporting rules / 报表口径

- Select 1–30 lists, with at most 200 distinct eligible Merchant IDs. Merchant
  identity is exact ID, never display name. A list dated after the recommendation
  date supplies neither merchants nor targets. For repeated merchants, the latest
  selected eligible version supplies targets. Conflicting same-day versions block
  calculation until the user selects one.
- 选择 1–30 份清单，最多 200 个有效去重 Merchant ID。以 ID 识别商家，不按名称合并。
  推荐日之后的清单不提供商家和目标；重复商家采用已选有效清单的最新版本。同日冲突
  阻断计算，需只选一个版本。
- Before-end < recommendation <= after-start. Both bounds are inclusive. The
  cutoff is editable, never hardcoded. Default comparison uses daily averages;
  totals remain visible. A zero baseline is labelled new, never infinity.
- 前期结束 < 推荐日 ≤ 后期开始，首尾均含。截止日可选择，无固定日期。默认日均比较，
  同时保留总量；零基数显示新增，不显示无穷增长。
- Only USD order records contribute revenue, purchases and historical Top 3.
  Clicks use the independent click table when available. Purchased ASINs are
  separate from promoted link targets; storefront and unknown destinations remain
  distinct. Future-list ASINs in actual transactions are kept as outside-list
  activity, rather than deleting those transactions.
- 收入、购买次数与历史 Top 3 使用 USD 订单。点击优先独立点击表。购买 ASIN 不等于
  推广 ASIN，店铺/未知链接独立保留。真实交易中的未来清单 ASIN 计为清单外，不删除交易。
- Recommended ASINs are product-list targets plus positive reason targets.
  Historical Top 3 ranks pre-period purchases, then revenue and ASIN to resolve
  ties. Coverage shows numerator/denominator for all clicks, identified product
  clicks, recommended ASIN count and distinct promoted ASIN count.
- 清单目标是产品表与正向理由 ASIN 的并集。历史 Top 3 只用前期购买次数排名，再按收入
  与 ASIN 打破并列。四种命中占比均显示分子/分母，不混用全部点击与有效单品点击。
- Daily charts span both windows, leaving gaps and dates after the source
  watermark blank. Incomplete windows suppress growth conclusions. The source
  watermark is recency evidence, not a guarantee of ingestion completeness.
- 每日图覆盖前后窗口，间隔及最新记录之后的日期留空。未结束的窗口不下增长结论；
  最新记录日期只表示数据新鲜度，不保证每日完整回传。

## Evidence and limits / 证据边界

The merchant drawer drills into publishers, daily changes, product/storefront
mix, recommended targets, historical Top 3 and original reasons. The follow-up
view lists investigation candidates; it does not send messages or assert causes.
商家抽屉可下钻媒体、每日变化、单品/店铺结构、推荐目标、历史 Top 3 和推荐原文。
待跟进视图列出需核实对象，不自动发送消息，也不声称已确认原因。

Observed clicks are not post counts. No activity means no clicks or purchases
observed in the selected completed windows, not lifetime non-promotion. Delivery
receipts, publisher explanations and causal recommendation adoption require
additional evidence not present in Amazon metrics. Imported AOV is a price-band
proxy, not each ASIN's selling price.
点击不是发帖数量。“未见活动”只限已完成的所选窗口，不代表历史从未推广。是否收到
推荐、媒体减量原因、是否因推荐调整，都需要 Amazon 指标之外的发送/反馈证据。AOV
只作价格层代理，不是每个 ASIN 售价。

Exports contain separate merchant, media, target, import-history and daily sheets,
with applied dates, selected/excluded lists, currency and source cutoff. UI row
pagination does not truncate exports. Files and real report snapshots are not
added to the public repository or static assets.
导出分为商家、媒体、目标、导入记录、每日数据表，附已应用日期、选中/排除清单、币种
与数据截止信息。页面分页不截断导出，实际文件和销售快照不会写入公开仓库或静态资源。

Summary and publisher relations are requested independently and reconciled before
display. The DB function has a 180-second duration budget on the existing Fluid
Compute project; the client allows 210 seconds including network overhead.
汇总与媒体关系独立请求，核对一致后展示。现有 Fluid Compute 项目的 DB 函数时限为
180 秒，客户端含网络开销等待 210 秒。
