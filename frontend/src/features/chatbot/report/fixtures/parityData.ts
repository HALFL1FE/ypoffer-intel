export const parityOffers = [
  {
    merchantId: "1001",
    brand: "Alpha Audio",
    merchantName: "Alpha Audio",
    tier: "Tier 1",
    mainCategory: "Electronics",
    clicks: 1000,
    orders: 50,
    salesAmount: 5000,
    affCommission: 250,
    epc: 0.25,
    aov: 100,
    conversionRate: 0.05,
    topAsins: ["B000000001"],
    productNameKeywords: ["headphones", "audio"]
  },
  {
    merchantId: "1002",
    brand: "Beta Home",
    merchantName: "Beta Home",
    tier: "Tier 2",
    mainCategory: "Home & Kitchen",
    clicks: 800,
    orders: 20,
    salesAmount: 1600,
    affCommission: 80,
    epc: 0.1,
    aov: 80,
    conversionRate: 0.025,
    topAsins: ["B000000002"],
    productNameKeywords: ["kitchen"]
  },
  {
    merchantId: "1003",
    brand: "Gamma Audio",
    merchantName: "Gamma Audio",
    tier: "Tier 2",
    mainCategory: "Electronics",
    clicks: 500,
    orders: 10,
    salesAmount: 1200,
    affCommission: 60,
    epc: 0.12,
    aov: 120,
    conversionRate: 0.02,
    topAsins: ["B000000003"],
    productNameKeywords: ["headphones"]
  },
  { merchantId: "1004", brand: "Delta Audio", tier: "Tier 4", mainCategory: "Electronics" },
  { merchantId: "1005", brand: "Epsilon Audio", tier: "BLACK TIER", mainCategory: "Electronics" }
] as const;

export const parityPaymentRecords = [
  {
    id: "payment-1001-2026-08",
    merchantId: "1001",
    merchantName: "Alpha Audio",
    network: "Levanta",
    region: "US",
    tier: "Tier 1",
    reportMonth: "2026-08",
    revenueMade: 5000,
    commissionMade: 250,
    paymentCycle: 30,
    paymentStatus: "Unpaid",
    expectedPaymentDate: "2026-09-30",
    paymentMadeDate: ""
  },
  {
    id: "payment-1002-2026-08",
    merchantId: "1002",
    merchantName: "Beta Home",
    network: "Levanta",
    region: "US",
    tier: "Tier 2",
    reportMonth: "2026-08",
    revenueMade: 1600,
    commissionMade: 80,
    paymentCycle: 60,
    paymentStatus: "Paid",
    expectedPaymentDate: "2026-10-30",
    paymentMadeDate: "2026-09-15"
  },
  {
    id: "payment-1003-2026-08",
    merchantId: "1003",
    merchantName: "Gamma Audio",
    network: "Levanta",
    region: "US",
    tier: "Tier 2",
    reportMonth: "2026-08",
    revenueMade: 1200,
    commissionMade: 60,
    paymentCycle: 30,
    paymentStatus: "Unpaid",
    expectedPaymentDate: "2026-09-30",
    paymentMadeDate: ""
  }
] as const;

export const parityPublishers = {
  publishers: [
    {
      userId: "p-1",
      userName: "Media One",
      adminName: "Manager A",
      total: { clicks: 1000, orders: 20, sales: 2000, allCommission: 200, affCommission: 80, dpv: 300, atc: 50 },
      networks: ["Levanta"],
      markets: { "amazon.com": { clicks: 1000, orders: 20, sales: 2000, allCommission: 200, affCommission: 80, dpv: 300, atc: 50 } },
      merchantIds: ["1001"]
    },
    {
      userId: "p-2",
      userName: "Media Two",
      adminName: "Manager B",
      total: { clicks: 500, orders: 10, sales: 1000, allCommission: 100, affCommission: 40, dpv: 100, atc: 20 },
      networks: ["Levanta"],
      markets: { "amazon.com": { clicks: 500, orders: 10, sales: 1000, allCommission: 100, affCommission: 40, dpv: 100, atc: 20 } },
      merchantIds: ["1002"]
    }
  ],
  networks: ["Levanta"],
  merchantNameMap: { "1001": "Alpha Audio", "1002": "Beta Home" }
} as const;
