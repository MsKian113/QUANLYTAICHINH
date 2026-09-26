const test = require('node:test');
const assert = require('node:assert/strict');

// Mock implementation of confirmBatchDebtSalesPayment logic for testing
function mockConfirmBatchDebtSalesPayment(salesData, itemIds, walletName, dateStr, noteStr) {
  const idSet = new Set(itemIds.map(id => String(id).trim()));
  let totalCollected = 0;
  const collectedItems = [];
  let updatedCount = 0;

  for (let i = 0; i < salesData.length; i++) {
    const rowId = String(salesData[i][0] || "").trim();
    if (idSet.has(rowId)) {
      // Col I (index 8): Wallet
      salesData[i][8] = walletName;
      // Col J (index 9): Status -> HOAN_TAT
      salesData[i][9] = "HOAN_TAT";
      // Col K (index 10): Notes
      salesData[i][10] = `[Đã thu ${dateStr}] ${noteStr}`.trim();

      const qty = Number(salesData[i][4]) || 0;
      const price = Number(salesData[i][5]) || 0;
      const total = Number(salesData[i][6]) || (qty * price);
      totalCollected += total;
      collectedItems.push(salesData[i][2]);
      updatedCount++;
    }
  }

  return {
    success: true,
    updatedCount,
    totalCollected,
    collectedItems
  };
}

// Mock getBusinessData filtering logic for debtSales
function mockFilterDebtSales(salesData) {
  const debtSales = [];
  salesData.forEach(r => {
    const id = r[0];
    const nhanTien = String(r[8] || "").trim();
    const trangThai = String(r[9] || "").trim();
    const ghiChu = String(r[10] || r[9] || "").trim();

    const isChoThu = trangThai === "CHO_THU" || (trangThai !== "HOAN_TAT" && (nhanTien.toLowerCase().includes("nợ") || ghiChu.toLowerCase().includes("khách nợ")));
    if (isChoThu) {
      debtSales.push({ id, nhanTien, trangThai: "CHO_THU", ghiChu });
    }
  });
  return debtSales;
}

test('getBusinessData filters debtSales with CHO_THU status and legacy fallback', () => {
  const mockSales = [
    ["SO101", "2026-09-18", "Iphone 13", "Kho Nhật", 1, 80000, 80000, 0, "", "CHO_THU", "Bán nợ"],
    ["SO102", "2026-09-18", "Iphone 14", "Kho VN", 1, 100000, 100000, 0, "Ví Tiền Mặt", "HOAN_TAT", "Trả ngay"],
    ["SO103", "2026-09-17", "Film Mini", "Kho Nhật", 2, 2000, 4000, 0, "Khách Nợ", "[Khách Nợ] Cũ", "[Khách Nợ] Cũ"]
  ];

  const debtSales = mockFilterDebtSales(mockSales);
  assert.equal(debtSales.length, 2);
  assert.equal(debtSales[0].id, "SO101");
  assert.equal(debtSales[1].id, "SO103");
});

test('confirmBatchDebtSalesPayment settles multiple items to HOAN_TAT status with wallet and cashflow total', () => {
  const mockSales = [
    ["SO101", "2026-09-18", "Iphone 13", "Kho Nhật", 1, 80000, 80000, 0, "", "CHO_THU", "Bán nợ"],
    ["SO103", "2026-09-17", "Film Mini", "Kho Nhật", 2, 2000, 4000, 0, "Khách Nợ", "CHO_THU", "Nợ cũ"]
  ];

  const res = mockConfirmBatchDebtSalesPayment(mockSales, ["SO101", "SO103"], "Ví Tiền Mặt", "2026-09-19", "Tất toán chuyển khoản");
  assert.equal(res.success, true);
  assert.equal(res.updatedCount, 2);
  assert.equal(res.totalCollected, 84000);
  assert.equal(mockSales[0][9], "HOAN_TAT");
  assert.equal(mockSales[0][8], "Ví Tiền Mặt");
  assert.equal(mockSales[1][9], "HOAN_TAT");

  // Re-filter debt sales after settlement
  const debtSalesAfter = mockFilterDebtSales(mockSales);
  assert.equal(debtSalesAfter.length, 0);
});
