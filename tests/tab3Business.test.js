const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.Logger = { log: () => {} };
global.Utilities = {
  formatDate: (date, tz, fmt) => '2026-09-09'
};

function createMockTab3DB() {
  const tables = {
    Business: [
      ['ID', 'Ngày', 'Loại', 'Số Tiền', 'Nguồn tiền', 'Nội Dung / Diễn Giải'],
      ['B001', '2026-09-01', 'Thu', 150000, 'Ví Tiền Mặt', 'Bán hàng'],
      ['B002', '2026-09-02', 'Chi', 105000, 'Thẻ Rakuten', 'Nhập vốn mua sản phẩm']
    ],
    Purchase: [
      ['ID', 'Ngày Mua', 'Nơi mua', 'Trạng Thái Kho', 'Tên Sản Phẩm', 'Số Lượng', 'Giá Mua (1 cái)', 'Tổng Tiền', 'Nguồn Tiền Mua', 'Trạng thái thẻ', 'Ghi chú', 'Tồn kho'],
      ['PO001', '2026-09-01', 'Amazon', 'Kho Nhật', 'Mỹ phẩm Amazon', 2, 2500, 5000, 'Thẻ Rakuten', 'HOAN_TAT', '', 2]
    ],
    Sales: [
      ['ID', 'Ngày Bán', 'Tên Sản Phẩm', 'Nơi Trừ Kho', 'Số Lượng Xuất', 'Giá Bán (1 cái)', 'Tổng Tiền Bán', 'Tồn kho', 'Nhận Tiền Vào', 'Ghi Chú'],
      ['SO001', '2026-09-02', 'iPhone 13 Pro Max', 'Kho Nhật', 1, 100000, 100000, 0, 'Khách Nợ', '[Khách Nợ]']
    ],
    Categories: [
      ['Danh sách Khách / Đối tác', 'Mẫu Nội Dung Thu Chi', 'Tự động Map Hũ', 'Tự động Map Nguồn', 'Danh sách Hũ', 'Danh sách Kho'],
      ['Khách 1', 'ND 1', 'Thiết yếu', 'Ví Tiền Mặt', 'Thiết yếu', 'Kho 1F Nhật'],
      ['Khách 2', 'ND 2', 'Giải trí', 'Thẻ Rakuten', 'Giải trí', 'Kho 2F VN']
    ],
    Wallets: [
      ['ID', 'Tên Ví', 'Phân Loại', 'Hạn Mức', 'Ngày Chốt', 'Ngày Trả', 'Ban đầu', 'Tăng', 'Giảm', 'Hiện tại', 'Ví nguồn'],
      ['W001', 'Ví Tiền Mặt', 'DEBIT', 0, '', '', 300000, 0, 0, 300000, '']
    ],
    LichMua: [
      ['ID', 'Ngày Lịch', 'Tên SP', 'Số Lượng', 'Giá', 'Nguồn Mua', 'Ghi Chú', 'Trạng Thái', 'Ref ID'],
      ['LM001', '2026-09-01', 'Mỹ phẩm Amazon', 2, 2500, 'Amazon', '', 'DA_DAT', 'PO001']
    ]
  };

  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      insertSheet: (name) => {
        tables[name] = [];
        return global.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
      },
      getSheetByName: (name) => {
        if (!tables[name]) return null;
        const rows = tables[name];
        return {
          getLastRow: () => rows.length,
          getLastColumn: () => rows[0] ? rows[0].length : 10,
          getDataRange: () => ({
            getValues: () => rows
          }),
          getRange: (startRow, startCol, numRows, numCols) => ({
            getValues: () => rows.slice(startRow - 1, startRow - 1 + (numRows || 1)),
            setValue: (val) => {
              if (rows[startRow - 1]) rows[startRow - 1][startCol - 1] = val;
            },
            setValues: (vals) => {
              for (let i = 0; i < vals.length; i++) {
                const targetIdx = startRow - 1 + i;
                if (!rows[targetIdx]) rows[targetIdx] = [];
                for (let j = 0; j < vals[i].length; j++) {
                  rows[targetIdx][startCol - 1 + j] = vals[i][j];
                }
              }
            }
          }),
          appendRow: (rowData) => {
            rows.push(rowData);
          },
          deleteRow: (rowIndex) => {
            rows.splice(rowIndex - 1, 1);
          },
          clearContents: () => {
            rows.length = 0;
          }
        };
      }
    })
  };

  return tables;
}

const serverMainCode = fs.readFileSync(path.join(__dirname, '../src/Server_Main.js'), 'utf8');
eval(serverMainCode);
const serverTab1Code = fs.readFileSync(path.join(__dirname, '../src/Server_Tab1.js'), 'utf8');
eval(serverTab1Code);
const serverTab5Code = fs.readFileSync(path.join(__dirname, '../src/Server_Tab5.js'), 'utf8');
eval(serverTab5Code);
const serverTab3Code = fs.readFileSync(path.join(__dirname, '../src/Server_Tab3.js'), 'utf8');
eval(serverTab3Code);

// -------------------------------------------------------------
// TESTS FOR TAB 3 BUSINESS OPERATIONS
// -------------------------------------------------------------
test('getBusinessData calculates summary totals and returns warehouse list', () => {
  const db = createMockTab3DB();
  const res = getBusinessData('9', '2026');

  assert.equal(res.success, true);
  assert.equal(res.summary.sales, 100000);
  assert.equal(res.summary.cogs, 105000);
  assert.equal(res.summary.stockValue, 5000);
  assert.equal(res.warehouses.includes('Kho 1F Nhật'), true);
});

test('savePurchaseOrder appends a purchase transaction', () => {
  const db = createMockTab3DB();
  const res = savePurchaseOrder({
    ngay: '2026-09-09',
    noiMua: 'Donki',
    trangThaiKho: 'Kho Nhật',
    nguonTien: 'Ví Tiền Mặt',
    isPreOrder: false,
    isMuonThe: false,
    items: [{ tenSP: 'Áo khoác Uniqlo', qty: 2, price: 3000 }]
  });

  assert.equal(res.success, true);
  assert.equal(db.Purchase.length, 3);
  assert.equal(db.Business.length, 4);
});

test('saveSalesOrder appends a sales transaction', () => {
  const db = createMockTab3DB();
  const res = saveSalesOrder({
    ngay: '2026-09-09',
    nhanTienVao: 'Ví Tiền Mặt',
    isKhachNo: false,
    items: [{ tenSP: 'Áo khoác Uniqlo', qty: 1, price: 4500 }]
  });

  assert.equal(res.success, true);
  assert.equal(db.Sales.length, 3);
  assert.equal(db.Business.length, 4);
});

test('saveSalesOrder handles zero-price sales order (unboxing) and deducts stock FIFO', () => {
  const db = createMockTab3DB();
  // Row 1 of Purchase is 'Mỹ phẩm Amazon' with initial stock Qty=2, Column 11 Tồn kho = 2
  db.Purchase[1][11] = 2;
  
  const res = saveSalesOrder({
    ngay: '2026-09-25',
    nhanTienVao: 'Tiền mặt',
    isKhachNo: false,
    items: [{ tenSP: 'Mỹ phẩm Amazon', qty: 2, price: 0, noiTru: 'Kho Nhật' }]
  });

  assert.equal(res.success, true);
  assert.equal(db.Sales.length, 3);
  assert.equal(db.Sales[2][5], 0); // price = 0
  assert.equal(db.Sales[2][6], 0); // total = 0
  assert.equal(db.Purchase[1][11], 0); // Stock reduced to 0

  // Second sales order for same product should NOT deduct from row 1 since remaining stock is 0
  const res2 = saveSalesOrder({
    ngay: '2026-09-25',
    nhanTienVao: 'Tiền mặt',
    isKhachNo: false,
    items: [{ tenSP: 'Mỹ phẩm Amazon', qty: 1, price: 1000, noiTru: 'Kho Nhật' }]
  });
  assert.equal(res2.success, true);
  // Column 11 of row 1 remains 0 (not reset to origQty 2)
  assert.equal(db.Purchase[1][11], 0);
});

test('confirmPreOrderPayment confirms card deduction and appends Business expense', () => {
  const db = createMockTab3DB();
  const res = confirmPreOrderPayment('PO001');

  assert.equal(res.success, true);
  assert.equal(db.Business.length, 4);
  assert.equal(db.Purchase[1][9], 'HOAN_TAT'); // Card status updated
  assert.equal(db.Purchase[1][10], ''); // Note cleared of pre-order flag
});

test('confirmPreOrderPayment records custom card deduction date in Business sheet', () => {
  const db = createMockTab3DB();
  const res = confirmPreOrderPayment('PO001', '2026-09-15');

  assert.equal(res.success, true);
  assert.equal(db.Business.length, 4);
  assert.equal(db.Business[3][1], '15/09/2026'); // Check custom date formatted and recorded
  assert.equal(db.Purchase[1][9], 'HOAN_TAT'); // Card status updated
  assert.equal(db.Purchase[1][10], ''); // Note cleared of pre-order flag
});

test('cancelPreOrderOrder marks pre-order as Hủy and populates pending refund list', () => {
  const db = createMockTab3DB();
  const res = cancelPreOrderOrder('PO001');
  if (!res.success) console.log("CANCEL ERROR:", res);

  assert.equal(res.success, true);
  assert.equal(db.Purchase.length, 2);
  assert.equal(db.Purchase[1][3], 'Hủy');
  assert.equal(db.Purchase[1][9], 'CHO_HOAN_TIEN');
  assert.equal(res.freshData.cancelledRefundPending.length > 0, true);
});

test('getBusinessData returns groupedInventory aggregated by product name', () => {
  const db = createMockTab3DB();
  const res = getBusinessData('9', '2026');

  assert.equal(res.success, true);
  assert.equal(Array.isArray(res.groupedInventory), true);
  assert.equal(res.groupedInventory.length, 1);
  assert.equal(res.groupedInventory[0].tenSP, 'Mỹ phẩm Amazon');
  assert.equal(res.groupedInventory[0].totalQty, 2);
  assert.equal(res.groupedInventory[0].purchasePlaces.includes('Amazon'), true);
});

test('getBusinessData excludes Chờ Ship and Pre-order items from groupedInventory', () => {
  const db = createMockTab3DB();
  // Add a Chờ Ship purchase item
  db.Purchase.push(['PO002', '2026-09-02', 'Rakuten', 'Chờ Ship', 'Tai nghe Sony', 3, 10000, 30000, 'Thẻ', 'HOAN_TAT', '', 3]);
  // Add a Pre-order purchase item
  db.Purchase.push(['PO003', '2026-09-02', 'Yodobashi', 'Kho Nhật', 'iPhone 15', 1, 120000, 120000, 'Thẻ', 'PRE-ORDER', '[Pre-order/Chờ trừ thẻ]', 1]);

  const res = getBusinessData('9', '2026');
  assert.equal(res.success, true);

  // Neither Tai nghe Sony (Chờ Ship) nor iPhone 15 (Pre-order) should be in groupedInventory
  const sonyGroup = res.groupedInventory.find(g => g.tenSP === 'Tai nghe Sony');
  const iphoneGroup = res.groupedInventory.find(g => g.tenSP === 'iPhone 15');
  assert.equal(Boolean(sonyGroup), false);
  assert.equal(Boolean(iphoneGroup), false);

  // Pre-order item should still be present in preOrders array
  const preOrderItem = res.preOrders.find(p => p.tenSP === 'iPhone 15');
  assert.equal(Boolean(preOrderItem), true);
});

test('transferWarehouseBatch transfers matching product rows to new destination warehouse', () => {
  const db = createMockTab3DB();
  const res = transferWarehouseBatch('Mỹ phẩm Amazon', 'Kho Nhật', 'Kho 2F VN');

  assert.equal(res.success, true);
  assert.equal(db.Purchase[1][3], 'Kho 2F VN');
});

test('updateBatchWarehouseStatus updates warehouse for selected order items', () => {
  const db = createMockTab3DB();
  const res = updateBatchWarehouseStatus(['PO001'], 'Kho 2F VN');

  assert.equal(res.success, true);
  assert.equal(db.Purchase[1][3], 'Kho 2F VN');
});

test('updateWarehouseStatus and updateBatchWarehouseStatus restrict CANCEL to Chờ Ship items only', () => {
  const db = createMockTab3DB();
  // PO001 is currently 'Kho Nhật'
  const failRes = updateWarehouseStatus('PO001', 'CANCEL');
  assert.equal(failRes.success, false);
  assert.equal(failRes.message.includes("Chỉ đơn hàng ở trạng thái 'Chờ Ship'"), true);

  // Change PO001 to 'Chusen' and retry CANCEL
  db.Purchase[1][3] = 'Chusen';
  const passResChusen = updateWarehouseStatus('PO001', 'CANCEL');
  assert.equal(passResChusen.success, true);
  assert.equal(db.Purchase[1][3], 'Hủy');

  // Change PO001 to 'Chờ Ship' and retry CANCEL
  db.Purchase[1][3] = 'Chờ Ship';
  const passRes = updateWarehouseStatus('PO001', 'CANCEL');
  assert.equal(passRes.success, true);
  assert.equal(db.Purchase[1][3], 'Hủy');
  if (db.Log_HuyDon) {
    assert.equal(db.Log_HuyDon.length >= 1, true);
  }
});

test('confirmRefundOrderPayment updates status to ĐÃ HOÀN TIỀN, appends Business Thu row and increases Wallet (with double-refund guard)', () => {
  const db = createMockTab3DB();
  db.Purchase[1][3] = 'Chờ Ship';
  updateWarehouseStatus('PO001', 'CANCEL');

  assert.equal(db.Purchase[1][3], 'Hủy');

  const resRefund = confirmRefundOrderPayment('PO001', 'Ví Tiền Mặt');
  assert.equal(resRefund.success, true);
  assert.equal(db.Purchase[1][3], 'ĐÃ HOÀN TIỀN');
  assert.equal(db.Business.length, 4);
  assert.equal(db.Business[3][2], 'Thu');
  assert.equal(db.Business[3][3], 5000); // 5000 refund total

  // Attempt double refund on same order -> must be rejected
  const resRefund2 = confirmRefundOrderPayment('PO001', 'Ví Tiền Mặt');
  assert.equal(resRefund2.success, false);
  assert.equal(resRefund2.message.includes('đã được xác nhận hoàn tiền trước đó'), true);
});

test('updatePurchaseItemDetail updates warehouse, quantity, price, card status, and tai khoản mua for single item', () => {
  const db = createMockTab3DB();
  const res = updatePurchaseItemDetail('PO001', 'Kho 2F VN', 5, 3000, 'Đã sửa', 'Bicamera', 'Mỹ phẩm Amazon', '2026-09-01', 'Thẻ Rakuten', 'HOAN_TAT', 'Fuji Ena03');

  assert.equal(res.success, true);
  assert.equal(db.Purchase[1][3], 'Kho 2F VN');
  assert.equal(db.Purchase[1][5], 5);
  assert.equal(db.Purchase[1][6], 3000);
  assert.equal(db.Purchase[1][7], 15000);
  assert.equal(db.Purchase[1][9], 'HOAN_TAT'); // Column J (index 9) - Tình trạng thẻ
  assert.equal(db.Purchase[1][10], 'Đã sửa'); // Column K (index 10) - Note
  assert.equal(db.Purchase[1][13], 'Fuji Ena03'); // Column N (index 13) - Tài khoản mua
});

test('confirmBatchDebtSalesPayment collects payment for debt sales and updates Business sheet', () => {
  const db = createMockTab3DB();
  const res = confirmBatchDebtSalesPayment(['SO001'], 'Ví Tiền Mặt');

  assert.equal(res.success, true);
  assert.equal(db.Sales[1][8], 'Ví Tiền Mặt');
  assert.equal(db.Business.length, 4);
});

test('getBusinessData filters in-stock products for sales suggestion based on purchases minus sales', () => {
  const db = createMockTab3DB();
  // Purchase 3 items of 'Áo thun' and 1 item of 'Giày Nike'
  savePurchaseOrder({ ngay: '2026-09-03', noiMua: 'Donki', trangThaiKho: 'Kho Nhật', nguonTien: 'Ví Tiền Mặt', items: [{ tenSP: 'Áo thun', qty: 3, price: 1000 }] });
  savePurchaseOrder({ ngay: '2026-09-03', noiMua: 'Amazon', trangThaiKho: 'Kho Nhật', nguonTien: 'Ví Tiền Mặt', items: [{ tenSP: 'Giày Nike', qty: 1, price: 5000 }] });
  // Sell 1 item of 'Áo thun' and 1 item of 'Giày Nike' (Giày Nike remaining stock becomes 0)
  saveSalesOrder({ ngay: '2026-09-04', nhanTienVao: 'Ví Tiền Mặt', items: [{ tenSP: 'Áo thun', qty: 1, price: 2000, noiTru: 'Kho Nhật' }] });
  saveSalesOrder({ ngay: '2026-09-04', nhanTienVao: 'Ví Tiền Mặt', items: [{ tenSP: 'Giày Nike', qty: 1, price: 8000, noiTru: 'Kho Nhật' }] });

  const res = getBusinessData('9', '2026');
  assert.equal(res.success, true);
  
  // Áo thun stock should be 3 - 1 = 2
  const aoThunGroup = res.groupedInventory.find(g => g.tenSP === 'Áo thun');
  assert.equal(aoThunGroup.totalQty, 2);

  // Giày Nike stock is 1 - 1 = 0, so it should be excluded from groupedInventory
  const nikeGroup = res.groupedInventory.find(g => g.tenSP === 'Giày Nike');
  assert.equal(Boolean(nikeGroup), false);

  // Suggested in-stock products should include Áo thun (qty: 2) but exclude Giày Nike (qty: 0)
  const aoThunProd = res.products.find(p => p.tenSP === 'Áo thun');
  assert.equal(Boolean(aoThunProd), true);
  assert.equal(aoThunProd.qty, 2);

  const nikeProd = res.products.find(p => p.tenSP === 'Giày Nike');
  assert.equal(Boolean(nikeProd), false);
});

test('getBusinessData filters out empty rows and handles empty Purchase sheet', () => {
  const db = createMockTab3DB();
  // Clear all data rows in Purchase, keeping header and empty rows
  db.Purchase = [
    ['ID', 'Ngày Mua', 'Nơi mua', 'Trạng Thái Kho', 'Tên Sản Phẩm', 'Số Lượng', 'Giá Mua (1 cái)', 'Tổng Tiền', 'Nguồn Tiền Mua', 'Ghi Chú'],
    ['PO099', '2026-09-01', '', 'Kho Nhật', '', 0, 0, 0, '', '']
  ];

  const res = getBusinessData('9', '2026', null, true);
  assert.equal(res.success, true);
  assert.equal(res.inventory.length, 0);
  assert.equal(res.groupedInventory.length, 0);
});

test('saveSalesOrder creates distinct sub-IDs for multi-item sales orders', () => {
  const db = createMockTab3DB();
  const res = saveSalesOrder({
    ngay: '2026-09-09',
    nhanTienVao: 'Ví Tiền Mặt',
    isKhachNo: true,
    items: [
      { tenSP: 'Sản phẩm 1', qty: 1, price: 1000 },
      { tenSP: 'Sản phẩm 2', qty: 2, price: 2000 }
    ]
  });

  assert.equal(res.success, true);
  // Row 1 header, Row 2 existing SO001, Row 3 & 4 new multi-item sale
  assert.equal(db.Sales.length, 4);
  const row1Id = String(db.Sales[2][0]);
  const row2Id = String(db.Sales[3][0]);

  assert.equal(row1Id.endsWith('-1'), true);
  assert.equal(row2Id.endsWith('-2'), true);
  assert.notEqual(row1Id, row2Id);
});

test('getWalletsFromSheet returns normalized pendingPreOrders with complete fields from Purchase and Family sheets', () => {
  const db = createMockTab3DB();
  db.Purchase.push([
    'PO005', '2026-09-05', 'Amazon', 'Kho Nhật', 'Áo khoác Uniqlo', 2, 3000, 6000, 'Thẻ Rakuten', 'PRE-ORDER', '[Pre-order/Chờ Sao Kê]', 0
  ]);
  db.Family = [
    ['ID', 'Timestamp', 'Loại', 'Hũ', 'Nội dung', 'Số tiền', 'Ví/Thẻ Giao Dịch', 'Là Khoản Cố Định?', 'Ghi chú', 'Trạng thái'],
    ['F001', '2026-09-06', 'Chi', 'Thiết yếu', 'Mua máy pha cà phê', 15000, 'Thẻ Rakuten', 'Không', '[Pre-order/Chờ sao kê]', 'PRE-ORDER']
  ];

  const res = getWalletsFromSheet('9', '2026');
  assert.equal(res.success, true);
  assert.equal(Array.isArray(res.pendingPreOrders), true);
  assert.equal(res.pendingPreOrders.length, 2);

  const poItem = res.pendingPreOrders.find(p => p.id === 'PO005');
  assert.equal(Boolean(poItem), true);
  assert.equal(poItem.content, 'Áo khoác Uniqlo');
  assert.equal(poItem.amount, 6000);
  assert.equal(poItem.wallet, 'Thẻ Rakuten');

  const famItem = res.pendingPreOrders.find(p => p.id === 'F001');
  assert.equal(Boolean(famItem), true);
  assert.equal(famItem.content, 'Mua máy pha cà phê');
  assert.equal(famItem.amount, 15000);
  assert.equal(famItem.wallet, 'Thẻ Rakuten');

  // Confirm statement for both pre-orders
  const confirmRes = confirmBatchPreOrdersPayment(['PO005', 'F001'], '2026-09-15');
  assert.equal(confirmRes.success, true);

  // Check note cleared in Purchase and Family
  assert.equal(db.Purchase[db.Purchase.length - 1][9].includes('Pre-order'), false);
  assert.equal(db.Family[1][7].includes('Pre-order'), false);
});

test('standardizeAllSheetStatuses normalizes legacy statuses across Purchase, Family, and Debt sheets', () => {
  const db = createMockTab3DB();
  db.Family = [
    ['ID', 'Timestamp', 'Loại', 'Hũ', 'Nội dung', 'Số tiền', 'Ví/Thẻ Giao Dịch', 'Là Khoản Cố Định?', 'Ghi chú', 'Trạng thái'],
    ['F001', '2026-09-01', 'Chi', 'Thiết yếu', 'Quẹt thẻ Amazon [Pre-order]', 5000, 'Thẻ Rakuten', 'Không', '[Pre-order]', 'preorder']
  ];
  db.Debt = [
    ['ID', 'Ngày Ghi Nợ', 'Tên Đối Tượng', 'Loại Nợ', 'Nội dung', 'Tổng Tiền Nợ', 'Nguồn', 'Đã Thanh Toán', 'Ngày thanh toán', 'Dư Nợ Còn Lại', 'Trạng Thái'],
    ['D001', '2026-09-01', 'Anh Hiếu', 'THU', 'Cho nợ hàng', 10000, 'Ví Tiền Mặt', 0, '', 10000, '']
  ];

  const res = standardizeAllSheetStatuses();
  assert.equal(res.success, true);
  assert.equal(db.Purchase[1][9], 'HOAN_TAT');
  assert.equal(db.Family[1][9], 'PRE-ORDER');
  assert.equal(db.Debt[1][10], 'DANG_NO');
});



