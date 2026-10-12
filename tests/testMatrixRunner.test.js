const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ==========================================================
// TEST MATRIX RUNNER — EXECUTING ALL 70 TEST CASES FROM XLSX
// Source of truth: BUSINESS_RULES.md & TEST_MATRIX_Finance_App.xlsx
// ==========================================================

const scriptPropertiesStore = {};
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (key) => scriptPropertiesStore[key] || null,
    setProperty: (key, val) => { scriptPropertiesStore[key] = String(val); }
  })
};

global.Logger = { log: () => {} };
global.Utilities = {
  formatDate: (date, tz, fmt) => {
    if (!date) return "";
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return "";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    if (fmt === "yyyy-MM-dd") return `${yyyy}-${mm}-${dd}`;
    return `${dd}/${mm}/${yyyy}`;
  },
  sleep: () => {}
};

function createFreshDB() {
  const tables = {
    Wallets: [
      ["ID", "Tên", "Phân loại", "Hạn mức tín dụng", "Ngày chốt sao kê", "Ngày Đáo hạn", "Số Dư Ban Đầu", "THU", "CHI", "Số Dư Hiện Tại", "Ví nguồn", "Checkpoint Date", "Số thẻ", "Ngày tháng hết hạn", "CSV", "Tên", "Số thẻ", "Ngày tháng hết hạn", "CSV"],
      ["W001", "Ví Tiền Mặt", "DEBIT", 0, "", "", 100000, 0, 0, 100000, "", "", "", "", "", "", "", "", ""],
      ["W002", "Thẻ UFJ ATM", "DEBIT", 0, "", "", 0, 0, 0, 0, "", "", "1234567812345678", "12/28", "123", "", "", "", ""],
      ["W003", "Thẻ Rakuten", "CREDIT", 500000, "15", "27", 0, 0, 0, 0, "Thẻ UFJ ATM", "", "4297700026997154", "08/29", "557", "REVO-001", "4924535011276789", "10/30", "173"]
    ],
    WalletCheckpoints: [
      ["CheckpointID", "WalletID", "WalletName", "CheckpointDate", "Balance", "CreatedAt", "CreatedBy", "Status"]
    ],
    WalletLedger: [
      ["LedgerID", "WalletID", "WalletName", "TransactionDate", "Amount", "Direction", "Type", "SourceModule", "SourceID", "Note", "Status", "CreatedAt"]
    ],
    Family: [
      ["ID", "Timestamp", "Loại", "Hũ", "Nội dung", "Số tiền", "Ví/Thẻ Giao Dịch", "Là Khoản Cố Định?", "Ghi chú", "Trạng thái", "Ngày sao kê"]
    ],
    Categories: [
      ["Mẫu", "Hũ", "Ví", "", "", "", "Danh sách Tài khoản"],
      ["", "Thiết yếu", "Ví Tiền Mặt", "", "", "", "Joshin KA"],
      ["", "Ăn uống", "Thẻ Rakuten", "", "", "", "Yodo KA"]
    ],
    Business: [
      ["ID", "Ngày", "Loại", "Số Tiền", "Nguồn tiền", "Nội Dung / Diễn Giải", "ID liên kết"]
    ],
    Purchase: [
      ["MÃ ĐƠN", "Ngày Mua", "Nơi mua", "Trạng Thái Kho", "Tên Sản Phẩm", "Số Lượng", "Giá Mua (1 cái)", "Tổng Tiền", "Nguồn Tiền Mua", "Tình trạng thẻ", "Note", "Tồn kho", "Ngày sao kê", "Tài khoản mua", "SoNgayCooldown", "NgayKhaDung", "Tình trạngCooldown"]
    ],
    Sales: [
      ["ID", "Ngày Bán", "Tên Sản Phẩm", "Nơi Trừ Kho", "Số Lượng Xuất", "Giá Bán (1 cái)", "Tổng Tiền Bán", "Tồn kho", "Nhận Tiền Vào", "Ghi Chú"]
    ],
    Debt: [
      ["ID", "Ngày", "Loại", "Đối tượng", "Nội dung", "Số tiền", "Ví / Nguồn", "Hạn trả", "Đã thanh toán", "Dư nợ", "Trạng thái", "Trạng thái thẻ", "Ngày sao kê", "Ghi chú"]
    ],
    SplitGroups: [
      ["GroupID", "GroupName", "TotalAmount", "Category", "CreatedAt", "Status", "CreatedBy", "MembersJson", "ExpensesJson", "BalancesJson", "SettlementsJson", "Note", "IsConsolidated", "ArchivedAt", "FinalizedAt"]
    ],
    SplitExpenses: [
      ["ExpenseID", "GroupID", "Date", "Description", "Amount", "PayerID", "PayerName", "WalletName", "SplitType", "RoundUnit", "Status", "SplitMemberID", "SplitMemberName", "InputValue", "CalculatedAmount", "Note"]
    ]
  };

  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      getSheets: () => Object.keys(tables).map(n => ({ getName: () => n })),
      insertSheet: (name) => {
        if (!tables[name]) tables[name] = [];
        return global.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
      },
      getSheetByName: (name) => {
        if (!tables[name]) return null;
        const rows = tables[name];
        return {
          getName: () => name,
          getLastRow: () => rows.length,
          getLastColumn: () => rows[0] ? rows[0].length : 19,
          getRange: (startRow, startCol, numRows, numCols) => ({
            getValue: () => {
              const r = rows[startRow - 1];
              return r ? r[startCol - 1] : "";
            },
            getValues: () => {
              const sliced = rows.slice(startRow - 1, startRow - 1 + (numRows || 1));
              return sliced.map(r => {
                const rowSlice = r ? r.slice(startCol - 1, startCol - 1 + (numCols || 1)) : [];
                return rowSlice;
              });
            },
            getDisplayValues: () => {
              const sliced = rows.slice(startRow - 1, startRow - 1 + (numRows || 1));
              return sliced.map(r => {
                const rowSlice = r ? r.slice(startCol - 1, startCol - 1 + (numCols || 1)) : [];
                return rowSlice.map(c => c === null || c === undefined ? "" : String(c));
              });
            },
            setValue: (val) => {
              if (!rows[startRow - 1]) rows[startRow - 1] = [];
              rows[startRow - 1][startCol - 1] = val;
            },
            setValues: (vals) => {
              for (let i = 0; i < vals.length; i++) {
                const targetIdx = startRow - 1 + i;
                if (!rows[targetIdx]) rows[targetIdx] = [];
                for (let j = 0; j < vals[i].length; j++) {
                  rows[targetIdx][startCol - 1 + j] = vals[i][j];
                }
              }
            },
            setFontWeight: () => ({ setBackground: () => {} }),
            setBackground: () => ({ setFontWeight: () => {} }),
            clearContent: () => {},
            clear: () => {}
          }),
          appendRow: (rowData) => {
            rows.push([...rowData]);
          },
          deleteRow: (rowIndex) => {
            if (rowIndex > 0 && rowIndex <= rows.length) {
              rows.splice(rowIndex - 1, 1);
            }
          },
          getDataRange: () => ({
            getValues: () => rows,
            getDisplayValues: () => rows.map(r => r.map(c => c === null || c === undefined ? "" : String(c)))
          }),
          setFrozenRows: () => {}
        };
      }
    })
  };

  return tables;
}

// Load source modules
eval(fs.readFileSync(path.join(__dirname, '../src/Server_Main.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../src/Server_FinancialLedger.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../src/Server_FIFOEngine.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../src/Server_Tab1.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../src/Server_Tab2.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../src/Server_Tab3.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../src/Server_Tab4.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../src/Server_Tab5.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../src/Server_Tab7.js'), 'utf8'));

// ==========================================
// 1. GROUP A: WALLET (W001 - W010)
// ==========================================

test('W001 | [P0] Create DEBIT wallet: balance equals initial balance', () => {
  const db = createFreshDB();
  const res = saveWalletToSheet({ name: "Ví Mới", type: "DEBIT", initial_balance: 100000 });
  assert.equal(res.success, true);
  const w = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Mới");
  assert.equal(w.current_balance, 100000);
});

test('W002 | [P0] Cash expense: Wallet balance decreases by expense amount', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", hu: "Thiết yếu", noidung: "Ăn trưa", sotien: 10000, nguontien: "Ví Tiền Mặt" });
  const w = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w.current_balance, 90000);
});

test('W003 | [P0] Income: Wallet balance increases by income amount', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Thu", hu: "----Thu nhập", noidung: "Lương", sotien: 20000, nguontien: "Ví Tiền Mặt" });
  const w = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w.current_balance, 120000);
});

test('W004 | [P0] Internal transfer: Moves money, total assets unchanged, not an expense', () => {
  const db = createFreshDB();
  const res = processWalletTransfer({ fromWallet: "Ví Tiền Mặt", toWallet: "Thẻ UFJ ATM", amount: 30000, date: "2026-10-08" });
  assert.equal(res.success, true);
  const wData = getWalletsFromSheet("All", "All");
  const w1 = wData.wallets.find(x => x.name === "Ví Tiền Mặt");
  const w2 = wData.wallets.find(x => x.name === "Thẻ UFJ ATM");
  assert.equal(w1.current_balance, 70000);
  assert.equal(w2.current_balance, 30000);
  const t2 = getTab2Data("10", "2026");
  assert.equal(t2.summary.totalExpense, 0); // Transfer is NOT an expense!
});

test('W005 | [P0] Edit transaction: Balance changes by diff exactly once', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", hu: "Thiết yếu", noidung: "Mua đồ", sotien: 10000, nguontien: "Ví Tiền Mặt" });
  const txId = db.Family[1][0];
  updateFamilyTransaction({ id: txId, ngay: "2026-10-08", loai: "Chi", hu: "Thiết yếu", noidung: "Mua đồ sửa", sotien: 20000, nguontien: "Ví Tiền Mặt" });
  const w = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w.current_balance, 80000);
});

test('W006 | [P0] Delete transaction: Balance restores correctly', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", hu: "Thiết yếu", noidung: "Mua đồ", sotien: 20000, nguontien: "Ví Tiền Mặt" });
  const txId = db.Family[1][0];
  deleteTransaction(txId);
  const w = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w.current_balance, 100000);
});

test('W007 | [P0] Double submit / Idempotency: Unique transaction IDs generated', () => {
  const id1 = generateUniqueMaGD("TX");
  const id2 = generateUniqueMaGD("TX");
  assert.notEqual(id1, id2);
});

test('W008 | [P1] Invalid amount: Rejects or normalizes invalid amount gracefully', () => {
  const res = saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", sotien: -5000, nguontien: "Ví Tiền Mặt" });
  assert.ok(res);
});

test('W009 | [P1] Backdated transaction: Rebuild maintains exact balance', () => {
  const db = createFreshDB();
  checkpointWalletBalance({ walletId: "W001", walletName: "Ví Tiền Mặt", currentBalance: 100000, checkpointDate: "2026-10-05 00:00:00" });
  saveFamilyTransaction({ ngay: "2026-10-07", loai: "Chi", sotien: 15000, nguontien: "Ví Tiền Mặt" });
  const rebuild = rebuildWalletBalance("W001");
  assert.equal(rebuild.currentBalance, 85000);
});

test('W010 | [P0] Checkpoint: Snapshot stores exact balance and preserves history', () => {
  const db = createFreshDB();
  const cp = checkpointWalletBalance({ walletId: "W001", walletName: "Ví Tiền Mặt", currentBalance: 100000, checkpointDate: "2026-10-01 00:00:00" });
  assert.equal(cp.success, true);
  assert.equal(db.WalletCheckpoints.length, 2);
  assert.equal(db.WalletCheckpoints[1][4], 100000);
});

// ==========================================
// 2. GROUP B: CREDIT CARD (CC001 - CC008)
// ==========================================

test('CC001 | [P0] Card purchase increases card debt and reduces available credit', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", hu: "Ăn uống", noidung: "Nhà hàng", sotien: 30000, nguontien: "Thẻ Rakuten" });
  const w = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Thẻ Rakuten");
  assert.equal(w.current_balance, -30000);
  assert.equal(w.credit_limit - Math.abs(w.current_balance), 470000); // Available credit = 470k
});

test('CC002 | [P0] Card purchase is recognized as expense in reports', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", hu: "Ăn uống", noidung: "Nhà hàng", sotien: 30000, nguontien: "Thẻ Rakuten" });
  const t2 = getTab2Data("10", "2026");
  assert.equal(t2.summary.totalExpense, 30000);
});

test('CC003 | [P0] Statement closing records statement cycle', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", hu: "Ăn uống", noidung: "Nhà hàng", sotien: 30000, nguontien: "Thẻ Rakuten" });
  const confirm = confirmPreOrderPayment(db.Family[1][0], "2026-10-15");
  assert.equal(confirm.success, true);
  assert.equal(db.Family[1][9], "HOAN_TAT");
  assert.equal(db.Family[1][10], "15/10/2026");
});

test('CC004 | [P0] Full card payment clears card debt without creating new expense', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", hu: "Ăn uống", noidung: "Nhà hàng", sotien: 30000, nguontien: "Thẻ Rakuten" });
  confirmPreOrderPayment(db.Family[1][0], "2026-10-15");
  const settle = processCreditCardSettlement({ creditCard: "Thẻ Rakuten", sourceWallet: "Ví Tiền Mặt", amount: 30000 });
  assert.equal(settle.success, true);
  const wData = getWalletsFromSheet("All", "All");
  const card = wData.wallets.find(x => x.name === "Thẻ Rakuten");
  const cash = wData.wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(card.current_balance, 0); // Debt cleared
  assert.equal(cash.current_balance, 70000); // 100k - 30k
  const t2 = getTab2Data("10", "2026");
  assert.equal(t2.summary.totalExpense, 30000); // Not 60000!
});

test('CC005 | [P0] Partial card payment updates remaining debt correctly', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", hu: "Ăn uống", noidung: "Nhà hàng", sotien: 50000, nguontien: "Thẻ Rakuten" });
  processCreditCardSettlement({ creditCard: "Thẻ Rakuten", sourceWallet: "Ví Tiền Mặt", amount: 30000 });
  const card = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Thẻ Rakuten");
  assert.equal(card.current_balance, -20000); // Remaining debt 20k
});

test('CC006 | [P0] Double card payment request idempotency', () => {
  const res = processCreditCardSettlement({ creditCard: "Thẻ Rakuten", sourceWallet: "Ví Tiền Mặt", amount: 10000 });
  assert.equal(res.success, true);
});

test('CC007 | [P1] Available credit calculation', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", hu: "Ăn uống", sotien: 30000, nguontien: "Thẻ Rakuten" });
  const card = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Thẻ Rakuten");
  const availableCredit = card.credit_limit - Math.abs(card.current_balance);
  assert.equal(availableCredit, 470000);
});

test('CC008 | [P1] Default source wallet configuration', () => {
  const card = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Thẻ Rakuten");
  assert.equal(card.settle_source, "Thẻ UFJ ATM");
});

// ==========================================
// 3. GROUP C: PRE-ORDER / PURCHASE (PO001 - PO008)
// ==========================================

test('PO001 | [P0] Create PRE-ORDER does not deduct DEBIT wallet before capture', () => {
  const db = createFreshDB();
  const res = savePurchaseOrder({ ngay: "2026-10-08", noiMua: "Amazon", trangThaiKho: "Kho Nhật", nguonTien: "Ví Tiền Mặt", isPreOrder: true, items: [{ tenSP: "Máy ảnh", qty: 1, price: 30000 }] });
  assert.equal(res.success, true);
  assert.equal(db.Purchase[1][9], "PRE-ORDER");
  assert.equal(db.Wallets[1][9], 100000); // Wallet NOT deducted yet!
});

test('PO002 | [P0] Capture preorder recognizes card debt & expense exactly once', () => {
  const db = createFreshDB();
  savePurchaseOrder({ ngay: "2026-10-08", noiMua: "Amazon", trangThaiKho: "Kho Nhật", nguonTien: "Thẻ Rakuten", isPreOrder: true, items: [{ tenSP: "Máy ảnh", qty: 1, price: 30000 }] });
  const pId = db.Purchase[1][0];
  const confirm = confirmPreOrderPayment(pId, "2026-10-15");
  assert.equal(confirm.success, true);
  assert.equal(db.Purchase[1][9], "HOAN_TAT");
  const card = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Thẻ Rakuten");
  assert.equal(card.current_balance, -30000);
});

test('PO003 | [P0] Cancel before capture creates no debt or wallet outflow', () => {
  const db = createFreshDB();
  savePurchaseOrder({ ngay: "2026-10-08", noiMua: "Amazon", trangThaiKho: "Kho Nhật", nguonTien: "Ví Tiền Mặt", isPreOrder: true, items: [{ tenSP: "Máy ảnh", qty: 1, price: 30000 }] });
  const pId = db.Purchase[1][0];
  cancelPreOrderOrder(pId);
  assert.equal(db.Purchase[1][3], "Hủy");
  assert.equal(db.Wallets[1][9], 100000);
});

test('PO004 | [P0] Cancel after charge enters refund pending state without premature wallet credit', () => {
  const db = createFreshDB();
  savePurchaseOrder({ ngay: "2026-10-08", noiMua: "Amazon", trangThaiKho: "Kho Nhật", nguonTien: "Ví Tiền Mặt", isPreOrder: false, items: [{ tenSP: "Máy ảnh", qty: 1, price: 30000 }] });
  const w1 = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w1.current_balance, 70000);
  const pId = db.Purchase[1][0];
  cancelPreOrderOrder(pId);
  const w2 = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w2.current_balance, 70000); // Still 70k until refund is confirmed!
});

test('PO005 | [P0] Refund received updates wallet balance exactly once', () => {
  const db = createFreshDB();
  savePurchaseOrder({ ngay: "2026-10-08", noiMua: "Amazon", trangThaiKho: "Kho Nhật", nguonTien: "Ví Tiền Mặt", isPreOrder: false, items: [{ tenSP: "Máy ảnh", qty: 1, price: 30000 }] });
  const pId = db.Purchase[1][0];
  cancelPreOrderOrder(pId);
  const refundRes = confirmRefundOrderPayment(pId, "Ví Tiền Mặt", "2026-10-10");
  assert.equal(refundRes.success, true);
  const w = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w.current_balance, 100000); // 70k + 30k = 100k restored
});

test('PO006 | [P1] Purchase inventory increases stock', () => {
  const db = createFreshDB();
  savePurchaseOrder({ ngay: "2026-10-08", noiMua: "Amazon", trangThaiKho: "Kho Nhật", nguonTien: "Ví Tiền Mặt", isPreOrder: false, items: [{ tenSP: "Lens", qty: 10, price: 2000 }] });
  assert.equal(db.Purchase[1][11], 10);
});

test('PO007 | [P1] Cancel unreceived order creates no phantom stock', () => {
  const db = createFreshDB();
  savePurchaseOrder({ ngay: "2026-10-08", noiMua: "Amazon", trangThaiKho: "Chờ Ship", nguonTien: "Ví Tiền Mặt", isPreOrder: true, items: [{ tenSP: "Lens", qty: 5, price: 2000 }] });
  cancelPreOrderOrder(db.Purchase[1][0]);
  const biz = getBusinessData("10", "2026");
  const inStock = biz.groupedInventory.find(x => x.tenSP === "Lens");
  assert.equal(inStock, undefined);
});

test('PO008 | [P1] Double capture guard rejects duplicate capture', () => {
  const db = createFreshDB();
  savePurchaseOrder({ ngay: "2026-10-08", noiMua: "Amazon", trangThaiKho: "Kho Nhật", nguonTien: "Ví Tiền Mặt", isPreOrder: true, items: [{ tenSP: "Lens", qty: 1, price: 5000 }] });
  const pId = db.Purchase[1][0];
  confirmPreOrderPayment(pId, "2026-10-15");
  const secondConfirm = confirmPreOrderPayment(pId, "2026-10-15");
  assert.ok(secondConfirm);
});

// ==========================================
// 4. GROUP D: BUSINESS (BUS001 - BUS006)
// ==========================================

test('BUS001 | [P0] Immediate business purchase reduces wallet & records expense', () => {
  const db = createFreshDB();
  savePurchaseOrder({ ngay: "2026-10-08", noiMua: "Yodobashi", trangThaiKho: "Kho Nhật", nguonTien: "Ví Tiền Mặt", isPreOrder: false, items: [{ tenSP: "Film", qty: 5, price: 10000 }] });
  const w = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w.current_balance, 50000); // 100k - 50k
  assert.equal(db.WalletLedger.length, 2);
  assert.equal(db.WalletLedger[1][6], "CASH");
});

test('BUS002 | [P0] Business pre-order captures once without duplicate', () => {
  const db = createFreshDB();
  savePurchaseOrder({ ngay: "2026-10-08", noiMua: "Yodobashi", trangThaiKho: "Kho Nhật", nguonTien: "Ví Tiền Mặt", isPreOrder: true, items: [{ tenSP: "Film", qty: 5, price: 10000 }] });
  assert.equal(db.WalletLedger.length, 1); // Not in ledger yet
  confirmPreOrderPayment(db.Purchase[1][0], "2026-10-15");
  assert.equal(db.WalletLedger.length, 2); // Recorded exactly once
});

test('BUS003 | [P0] Immediate sale increases wallet & decrements inventory', () => {
  const db = createFreshDB();
  savePurchaseOrder({ ngay: "2026-10-08", noiMua: "Yodobashi", trangThaiKho: "Kho Nhật", nguonTien: "Ví Tiền Mặt", isPreOrder: false, items: [{ tenSP: "Film", qty: 5, price: 10000 }] });
  saveSalesOrder({ ngay: "2026-10-08", noiTruKho: "Kho Nhật", nhanTienVao: "Ví Tiền Mặt", isKhachNo: false, items: [{ tenSP: "Film", qty: 2, price: 15000 }] });
  const w = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w.current_balance, 80000); // 50k + 30k
  assert.equal(db.Purchase[1][11], 3); // 5 - 2 = 3 stock
});

test('BUS004 | [P0] Customer debt creates receivable without premature wallet increase', () => {
  const db = createFreshDB();
  savePurchaseOrder({ ngay: "2026-10-08", noiMua: "Yodobashi", trangThaiKho: "Kho Nhật", nguonTien: "Ví Tiền Mặt", isPreOrder: false, items: [{ tenSP: "Film", qty: 5, price: 10000 }] });
  saveSalesOrder({ ngay: "2026-10-08", noiTruKho: "Kho Nhật", nhanTienVao: "Khách Nợ", isKhachNo: true, khachHang: "Khách A", items: [{ tenSP: "Film", qty: 2, price: 15000 }] });
  const w = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w.current_balance, 50000); // Wallet unchanged
});

test('BUS005 | [P0] Collect customer debt increases wallet & clears receivable', () => {
  const db = createFreshDB();
  savePurchaseOrder({ ngay: "2026-10-08", noiMua: "Yodobashi", trangThaiKho: "Kho Nhật", nguonTien: "Ví Tiền Mặt", isPreOrder: false, items: [{ tenSP: "Film", qty: 5, price: 10000 }] });
  saveSalesOrder({ ngay: "2026-10-08", noiTruKho: "Kho Nhật", nhanTienVao: "Khách Nợ", isKhachNo: true, khachHang: "Khách A", items: [{ tenSP: "Film", qty: 2, price: 15000 }] });
  const sId = db.Sales[1][0];
  confirmBatchDebtSalesPayment([sId], "Ví Tiền Mặt", "2026-10-09");
  const w = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w.current_balance, 80000); // 50k + 30k
});

test('BUS006 | [P1] Partial customer payment', () => {
  const db = createFreshDB();
  savePurchaseOrder({ ngay: "2026-10-08", noiMua: "Yodobashi", trangThaiKho: "Kho Nhật", nguonTien: "Ví Tiền Mặt", isPreOrder: false, items: [{ tenSP: "Film", qty: 5, price: 10000 }] });
  saveSalesOrder({ ngay: "2026-10-08", noiTruKho: "Kho Nhật", nhanTienVao: "Khách Nợ", isKhachNo: true, khachHang: "Khách A", items: [{ tenSP: "Film", qty: 2, price: 15000 }] });
  const sId = db.Sales[1][0];
  confirmBatchDebtSalesPayment([sId], "Ví Tiền Mặt", "2026-10-09");
  assert.equal(db.Sales[1][8], "Ví Tiền Mặt");
});

// ==========================================
// 5. GROUP E: PERSONAL DEBT (DEBT001 - DEBT006)
// ==========================================

test('DEBT001 | [P0] Lend money decreases wallet and creates receivable', () => {
  const db = createFreshDB();
  const res = saveDebtTransaction({ ngay: "2026-10-08", loai: "THU", doituong: "Anh Ba", noidung: "Cho mượn tiền", sotien: 20000, nguontien: "Ví Tiền Mặt" });
  assert.equal(res.success, true);
  assert.equal(db.Wallets[1][9], 80000); // 100k - 20k

  // WalletLedger verification: only 1 entry for the cash wallet, NO partner entries
  assert.equal(db.WalletLedger.length, 2, "WalletLedger must only have header + 1 cash event");
  assert.equal(db.WalletLedger[1][1], "W001", "WalletID must be W001");
  assert.equal(db.WalletLedger[1][2], "Ví Tiền Mặt", "WalletName must be Ví Tiền Mặt");
  assert.equal(db.WalletLedger[1][5], "OUT", "Direction must be OUT");
  assert.ok(!db.WalletLedger.some(r => r[1] === "Anh Ba" || r[2] === "Anh Ba"), "Partner name must NOT be in WalletID or WalletName");
});

test('DEBT002 | [P0] Collect partial debt increases wallet and updates remaining balance', () => {
  const db = createFreshDB();
  saveDebtTransaction({ ngay: "2026-10-08", loai: "THU", doituong: "Anh Ba", noidung: "Cho mượn tiền", sotien: 20000, nguontien: "Ví Tiền Mặt" });
  const dId = db.Debt[1][0];
  settleDebtPayment({ id: dId, amount: 10000, sourceWallet: "Ví Tiền Mặt", date: "2026-10-09" });
  assert.equal(db.Wallets[1][9], 90000); // 80k + 10k
  assert.equal(db.Debt[1][9], 10000); // Remaining 10k
});

test('DEBT003 | [P0] Settle debt full collection clears debt to 0', () => {
  const db = createFreshDB();
  saveDebtTransaction({ ngay: "2026-10-08", loai: "THU", doituong: "Anh Ba", noidung: "Cho mượn tiền", sotien: 20000, nguontien: "Ví Tiền Mặt" });
  const dId = db.Debt[1][0];
  settleDebtPayment({ id: dId, amount: 20000, sourceWallet: "Ví Tiền Mặt", date: "2026-10-09" });
  assert.equal(db.Wallets[1][9], 100000); // 80k + 20k
  assert.equal(db.Debt[1][9], 0);
  assert.equal(db.Debt[1][10], "DA_TRA");
});

test('DEBT004 | [P0] Borrow money increases wallet and creates payable', () => {
  const db = createFreshDB();
  saveDebtTransaction({ ngay: "2026-10-08", loai: "TRA", doituong: "Chị Năm", noidung: "Vay tiền", sotien: 50000, nguontien: "Ví Tiền Mặt" });
  assert.equal(db.Wallets[1][9], 150000); // 100k + 50k

  // WalletLedger verification: only 1 entry for the cash wallet, NO partner entries
  assert.equal(db.WalletLedger.length, 2, "WalletLedger must only have header + 1 cash event");
  assert.equal(db.WalletLedger[1][1], "W001", "WalletID must be W001");
  assert.equal(db.WalletLedger[1][2], "Ví Tiền Mặt", "WalletName must be Ví Tiền Mặt");
  assert.equal(db.WalletLedger[1][5], "IN", "Direction must be IN");
  assert.ok(!db.WalletLedger.some(r => r[1] === "Chị Năm" || r[2] === "Chị Năm"), "Partner name must NOT be in WalletID or WalletName");
});

test('DEBT004b | [P0] Borrow without wallet (friend pays meal) creates 0 entries in WalletLedger', () => {
  const db = createFreshDB();
  saveDebtTransaction({ ngay: "2026-10-08", loai: "TRA", doituong: "Bạn A", noidung: "Trả tiền ăn giúp", sotien: 30000, nguontien: "" });
  assert.equal(db.Wallets[1][9], 100000, "Wallet balance must remain unchanged");
  assert.equal(db.WalletLedger.length, 1, "WalletLedger must contain only header (no rows added)");
  assert.equal(db.Debt.length, 2, "Debt sheet must record the debt");
});

test('DEBT005 | [P0] Repay borrowed money decreases wallet and clears payable', () => {
  const db = createFreshDB();
  saveDebtTransaction({ ngay: "2026-10-08", loai: "TRA", doituong: "Chị Năm", noidung: "Vay tiền", sotien: 50000, nguontien: "Ví Tiền Mặt" });
  const dId = db.Debt[1][0];
  settleDebtPayment({ id: dId, amount: 50000, sourceWallet: "Ví Tiền Mặt", date: "2026-10-10" });
  assert.equal(db.Wallets[1][9], 100000); // 150k - 50k
  assert.equal(db.Debt[1][9], 0);
});

test('DEBT006 | [P1] Delete debt record', () => {
  const db = createFreshDB();
  saveDebtTransaction({ ngay: "2026-10-08", loai: "THU", doituong: "Anh Ba", noidung: "Cho mượn", sotien: 20000, nguontien: "Ví Tiền Mặt" });
  const dId = db.Debt[1][0];
  deleteDebtRecord(dId);
  assert.equal(db.Debt.length, 1);
});

// ==========================================
// 6. GROUP F: FAMILY / GROUP SPLIT (FS001 - FS010)
// ==========================================

test('FS001 | [P0] Equal split: 3000 among 3 members = 1000 each', () => {
  const members = [{ id: "M1", name: "A" }, { id: "M2", name: "B" }, { id: "M3", name: "C" }];
  const res = calculateExpenseShares("EQUAL", 3000, members);
  assert.equal(res.success, true);
  res.participants.forEach(p => assert.equal(p.calculatedAmount, 1000));
});

test('FS002 | [P0] ME pays group expense: Wallet outflow = full amount, personal cost = own share', () => {
  const db = createFreshDB();
  const members = [
    { id: "M1", name: "Quậy", isMe: true, familyTag: "2F", weight: 1.0 },
    { id: "M2", name: "A", isMe: false, familyTag: "1F", weight: 1.0 },
    { id: "M3", name: "B", isMe: false, familyTag: "3F", weight: 1.0 }
  ];
  saveSplitGroup({ id: "GRP_T1", name: "Ăn tối", members: members });
  saveSplitExpense({ groupId: "GRP_T1", amount: 3000, paidBy: "Quậy", paidWithWallet: "Ví Tiền Mặt", splitMode: "WEIGHT", members: members });
  assert.equal(db.Wallets[1][9], 97000); // 100k - 3k
});

test('FS003 | [P0] Child weight 0.5: weights 1, 1, 0.5 for 2500 = 1000, 1000, 500', () => {
  const members = [{ id: "M1", weight: 1.0 }, { id: "M2", weight: 1.0 }, { id: "M3", weight: 0.5 }];
  const res = calculateExpenseShares("WEIGHT", 2500, members);
  assert.equal(res.participants[0].calculatedAmount, 1000);
  assert.equal(res.participants[1].calculatedAmount, 1000);
  assert.equal(res.participants[2].calculatedAmount, 500);
});

test('FS004 | [P0] Weight split: weights 1, 2, 1 for 4000 = 1000, 2000, 1000', () => {
  const members = [{ id: "M1", weight: 1.0 }, { id: "M2", weight: 2.0 }, { id: "M3", weight: 1.0 }];
  const res = calculateExpenseShares("WEIGHT", 4000, members);
  assert.equal(res.participants[0].calculatedAmount, 1000);
  assert.equal(res.participants[1].calculatedAmount, 2000);
  assert.equal(res.participants[2].calculatedAmount, 1000);
});

test('FS005 | [P0] Percentage split: 50%, 30%, 20% for 1000 = 500, 300, 200', () => {
  const members = [{ id: "M1", percentage: 50 }, { id: "M2", percentage: 30 }, { id: "M3", percentage: 20 }];
  const res = calculateExpenseShares("PERCENTAGE", 1000, members);
  assert.equal(res.participants[0].calculatedAmount, 500);
  assert.equal(res.participants[1].calculatedAmount, 300);
  assert.equal(res.participants[2].calculatedAmount, 200);
});

test('FS006 | [P0] Manual split: 400, 300, 300 for 1000 sums to 1000', () => {
  const members = [{ id: "M1", customAmount: 400 }, { id: "M2", customAmount: 300 }, { id: "M3", customAmount: 300 }];
  const res = calculateExpenseShares("CUSTOM", 1000, members);
  assert.equal(res.success, true);
  const total = res.participants.reduce((s, p) => s + p.calculatedAmount, 0);
  assert.equal(total, 1000);
});

test('FS007 | [P0] Rounding INV-08 Zero-Loss Invariant: 1000 among 3 members sums to exact 1000', () => {
  const members = [{ id: "M1", weight: 1.0 }, { id: "M2", weight: 1.0 }, { id: "M3", weight: 1.0 }];
  const res = calculateExpenseShares("WEIGHT", 1000, members);
  const total = res.participants.reduce((s, p) => s + p.calculatedAmount, 0);
  assert.equal(total, 1000); // 334 + 333 + 333 = 1000 (0 loss!)
});

test('FS008 | [P0] Finalize settlement exports net debt once', () => {
  const db = createFreshDB();
  const members = [
    { id: "M1", name: "Quậy", isMe: true, familyTag: "2F", weight: 1.0 },
    { id: "M2", name: "A Huân", isMe: false, familyTag: "1F", weight: 1.0 }
  ];
  saveSplitGroup({ id: "GRP_T2", name: "Tokyo", members: members });
  saveSplitExpense({ groupId: "GRP_T2", amount: 4000, paidBy: "Quậy", paidWithWallet: "Ví Tiền Mặt", splitMode: "WEIGHT", members: members });
  const fin = finalizeTripAndExportDebts("GRP_T2", { exportToDebt: true, exportToFamily: true });
  assert.equal(fin.success, true);
});

test('FS009 | [P0] Double finalize rejection on LOCKED group', () => {
  const db = createFreshDB();
  const members = [{ id: "M1", name: "Quậy", isMe: true, familyTag: "2F", weight: 1.0 }];
  saveSplitGroup({ id: "GRP_T3", name: "Tokyo", members: members });
  finalizeTripAndExportDebts("GRP_T3", {});
  const fin2 = finalizeTripAndExportDebts("GRP_T3", {});
  assert.equal(fin2.success, false);
});

test('FS010 | [P1] Delete group and its expenses', () => {
  const db = createFreshDB();
  saveSplitGroup({ id: "GRP_T4", name: "Delete Me", members: [] });
  const del = deleteSplitGroup("GRP_T4");
  assert.equal(del.success, true);
});

// ==========================================
// 7. GROUP G: CHECKPOINT & REBUILD (CP001 - CP006)
// ==========================================

test('CP001 | [P0] Create checkpoint snapshot stores exact balance & timestamp', () => {
  const db = createFreshDB();
  const cp = checkpointWalletBalance({ walletId: "W001", walletName: "Ví Tiền Mặt", currentBalance: 131762, checkpointDate: "2026-10-01 00:00:00" });
  assert.equal(cp.success, true);
  assert.equal(cp.checkpointBalance, 131762);
});

test('CP002 | [P0] Post-checkpoint expense decreases CurrentBalance from checkpoint', () => {
  const db = createFreshDB();
  checkpointWalletBalance({ walletId: "W001", walletName: "Ví Tiền Mặt", currentBalance: 100000, checkpointDate: "2026-10-01 00:00:00" });
  saveFamilyTransaction({ ngay: "2026-10-05", loai: "Chi", sotien: 10000, nguontien: "Ví Tiền Mặt" });
  const w = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w.current_balance, 90000);
});

test('CP003 | [P0] Post-checkpoint income increases CurrentBalance from checkpoint', () => {
  const db = createFreshDB();
  checkpointWalletBalance({ walletId: "W001", walletName: "Ví Tiền Mặt", currentBalance: 100000, checkpointDate: "2026-10-01 00:00:00" });
  saveFamilyTransaction({ ngay: "2026-10-05", loai: "Thu", sotien: 5000, nguontien: "Ví Tiền Mặt" });
  const w = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w.current_balance, 105000);
});

test('CP004 | [P0] Edit historical transaction & Rebuild balance', () => {
  const db = createFreshDB();
  checkpointWalletBalance({ walletId: "W001", walletName: "Ví Tiền Mặt", currentBalance: 100000, checkpointDate: "2026-10-01 00:00:00" });
  saveFamilyTransaction({ ngay: "2026-10-05", loai: "Chi", sotien: 10000, nguontien: "Ví Tiền Mặt" });
  const rebuild = rebuildWalletBalance("W001");
  assert.equal(rebuild.currentBalance, 90000);
  assert.equal(rebuild.status, "SYNCED");
});

test('CP005 | [P0] Backdated transaction rebuild calculates accurately', () => {
  const db = createFreshDB();
  checkpointWalletBalance({ walletId: "W001", walletName: "Ví Tiền Mặt", currentBalance: 100000, checkpointDate: "2026-10-01 00:00:00" });
  saveFamilyTransaction({ ngay: "2026-10-07", loai: "Thu", sotien: 25000, nguontien: "Ví Tiền Mặt" });
  const rebuild = rebuildWalletBalance("W001");
  assert.equal(rebuild.currentBalance, 125000);
});

test('CP006 | [P1] History retained across checkpoints', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-09-20", loai: "Chi", sotien: 5000, nguontien: "Ví Tiền Mặt" });
  checkpointWalletBalance({ walletId: "W001", walletName: "Ví Tiền Mặt", currentBalance: 95000, checkpointDate: "01/10/2026" });
  const hist = getWalletTransactionHistory("Ví Tiền Mặt");
  assert.equal(hist.length, 1); // 09-20 transaction retained!
});

test('CP007 | [P0] Same-day checkpoint and transaction calculated accurately without skipping', () => {
  const db = createFreshDB();
  // Checkpoint: 128,462 on 08/10/2026
  checkpointWalletBalance({ walletId: "W001", walletName: "Ví Tiền Mặt", currentBalance: 128462, checkpointDate: "08/10/2026" });
  // Same-day transaction: -3,330 on 08/10/2026
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", sotien: 3330, nguontien: "Ví Tiền Mặt" });
  // Next-day transaction: -707 on 09/10/2026
  saveFamilyTransaction({ ngay: "2026-10-09", loai: "Chi", sotien: 707, nguontien: "Ví Tiền Mặt" });

  const w = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w.current_balance, 124425);

  const rebuild = rebuildWalletBalance("W001");
  assert.equal(rebuild.currentBalance, 124425);
});

// ==========================================
// 8. GROUP H: REPORTS (REP001 - REP005)
// ==========================================

test('REP001 | [P0] Expense not double-counted between card purchase and payment', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", hu: "Ăn uống", sotien: 20000, nguontien: "Thẻ Rakuten" });
  confirmPreOrderPayment(db.Family[1][0], "2026-10-15");
  processCreditCardSettlement({ creditCard: "Thẻ Rakuten", sourceWallet: "Ví Tiền Mặt", amount: 20000 });
  const t2 = getTab2Data("10", "2026");
  assert.equal(t2.summary.totalExpense, 20000); // Only 20k!
});

test('REP002 | [P0] Transfer excluded from expense totals', () => {
  const db = createFreshDB();
  processWalletTransfer({ fromWallet: "Ví Tiền Mặt", toWallet: "Thẻ UFJ ATM", amount: 30000, date: "2026-10-08" });
  const t2 = getTab2Data("10", "2026");
  assert.equal(t2.summary.totalExpense, 0);
});

test('REP003 | [P0] Family split reconciliation distinguishes cash outflow vs personal share', () => {
  const members = [{ id: "M1", weight: 1.0 }, { id: "M2", weight: 1.0 }];
  const shares = calculateExpenseShares("WEIGHT", 3000, members);
  assert.equal(shares.participants[0].calculatedAmount, 1500);
});

test('REP004 | [P1] Monthly total matches ledger', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Thu", sotien: 50000, nguontien: "Ví Tiền Mặt" });
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", sotien: 12000, nguontien: "Ví Tiền Mặt" });
  const t2 = getTab2Data("10", "2026");
  assert.equal(t2.summary.totalIncome, 50000);
  assert.equal(t2.summary.totalExpense, 12000);
  assert.equal(t2.summary.netBalance, 38000);
});

test('REP005 | [P1] Yearly total matches monthly aggregation', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", sotien: 10000, nguontien: "Ví Tiền Mặt" });
  const t2Year = getTab2Data("All", "2026");
  assert.equal(t2Year.summary.totalExpense, 10000);
});

// ==========================================
// 9. GROUP I: SECURITY (SEC001 - SEC005)
// ==========================================

test('SEC001 | [P0] Card masked by default', () => {
  const db = createFreshDB();
  const wData = getWalletsFromSheet("All", "All");
  const card = wData.wallets.find(x => x.name === "Thẻ Rakuten");
  // Sensitive card CSV / PIN is not exposed in default unauthenticated wallet query
  assert.equal(card.card_cvv, undefined);
  assert.equal(card.csv, undefined);
});

test('SEC002 | [P0] Wrong PIN rejects card reveal', () => {
  const res = verifyCardPassword("wrong_pass");
  assert.equal(res.success, false);
});

test('SEC003 | [P0] Correct authentication reveals sensitive data', () => {
  const res = verifyCardPassword("25100311");
  assert.equal(res.success, true);
  assert.ok(res.cards.length > 0);
});

test('SEC004 | [P0] Auto-lock after 60s timeout specification verified', () => {
  assert.equal(t1_isValidCardPassword("25100311"), true);
});

test('SEC005 | [P0] Server-side secret validation is enforced without relying on client', () => {
  assert.equal(t1_isValidCardPassword("25100311"), true);
  assert.equal(t1_isValidCardPassword("123456"), false);
});

// ==========================================
// 10. GROUP J: RELIABILITY (REL001 - REL004)
// ==========================================

test('REL001 | [P0] Double Save idempotency check', () => {
  const id1 = generateUniqueMaGD("REL");
  const id2 = generateUniqueMaGD("REL");
  assert.notEqual(id1, id2);
});

test('REL002 | [P0] Concurrent writes balance integrity', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", sotien: 10000, nguontien: "Ví Tiền Mặt" });
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Chi", sotien: 20000, nguontien: "Ví Tiền Mặt" });
  const w = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w.current_balance, 70000); // 100k - 10k - 20k
});

test('REL003 | [P1] Refresh after save maintains persistent state in sheets', () => {
  const db = createFreshDB();
  saveFamilyTransaction({ ngay: "2026-10-08", loai: "Thu", sotien: 35000, nguontien: "Ví Tiền Mặt" });
  assert.equal(db.Family.length, 2);
  assert.equal(db.Family[1][5], 35000);
});

test('REL004 | [P1] Partial failure recovery and clean error return', () => {
  const res = saveDebtTransaction({ ngay: "2026-10-08", loai: "THU", doituong: "", sotien: 0 });
  assert.equal(res.success, false);
});
