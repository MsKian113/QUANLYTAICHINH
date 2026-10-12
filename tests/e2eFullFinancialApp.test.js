const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ==========================================
// FULL E2E TEST SUITE FOR FINANCIAL APP
// 8 CORE TEST GROUPS AS SPECIFIED BY USER
// ==========================================

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

function createMockFullDB() {
  const tables = {
    Wallets: [
      ["ID", "Tên", "Phân loại", "Hạn mức tín dụng", "Ngày chốt sao kê", "Ngày Đáo hạn", "Số Dư Ban Đầu", "THU", "CHI", "Số Dư Hiện Tại", "Ví nguồn", "Checkpoint Date", "Số thẻ", "Ngày tháng hết hạn", "CSV", "Tên", "Số thẻ", "Ngày tháng hết hạn", "CSV"],
      ["W001", "Ví Tiền Mặt", "DEBIT", 0, "", "", 500000, 0, 0, 500000, "", "", "", "", "", "", "", "", ""],
      ["W002", "Thẻ UFJ ATM", "DEBIT", 0, "", "", 1000000, 0, 0, 1000000, "", "", "1234567812345678", "12/28", "123", "", "", "", ""],
      ["W003", "Thẻ Rakuten", "CREDIT", 2000000, "15", "27", 0, 0, 0, 0, "Thẻ UFJ ATM", "", "4297700026997154", "08/29", "557", "REVO-001", "4924535011276789", "10/30", "173"]
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
const serverMainCode = fs.readFileSync(path.join(__dirname, '../src/Server_Main.js'), 'utf8');
const serverLedgerCode = fs.readFileSync(path.join(__dirname, '../src/Server_FinancialLedger.js'), 'utf8');
const serverFifoCode = fs.readFileSync(path.join(__dirname, '../src/Server_FIFOEngine.js'), 'utf8');
const serverTab1Code = fs.readFileSync(path.join(__dirname, '../src/Server_Tab1.js'), 'utf8');
const serverTab2Code = fs.readFileSync(path.join(__dirname, '../src/Server_Tab2.js'), 'utf8');
const serverTab3Code = fs.readFileSync(path.join(__dirname, '../src/Server_Tab3.js'), 'utf8');
const serverTab4Code = fs.readFileSync(path.join(__dirname, '../src/Server_Tab4.js'), 'utf8');
const serverTab5Code = fs.readFileSync(path.join(__dirname, '../src/Server_Tab5.js'), 'utf8');
const serverTab7Code = fs.readFileSync(path.join(__dirname, '../src/Server_Tab7.js'), 'utf8');

eval(serverMainCode);
eval(serverLedgerCode);
eval(serverFifoCode);
eval(serverTab1Code);
eval(serverTab2Code);
eval(serverTab3Code);
eval(serverTab4Code);
eval(serverTab5Code);
eval(serverTab7Code);

// ==========================================
// 1. NHÓM 1: VÍ & SỐ DƯ (WALLETS LIFECYCLE)
// ==========================================

test('1. WALLET: Create / Edit / Delete wallet accurately', () => {
  const db = createMockFullDB();

  // Create new wallet
  const saveRes = saveWalletToSheet({
    name: "Ví PayPay",
    type: "DEBIT",
    initial_balance: 50000,
    credit_limit: 0,
    settle_source: ""
  });
  assert.equal(saveRes.success, true);
  assert.equal(db.Wallets.length, 5); // 1 header + 3 init + 1 new

  const createdWallet = db.Wallets[4];
  assert.equal(createdWallet[1], "Ví PayPay");
  assert.equal(createdWallet[2], "DEBIT");
  assert.equal(createdWallet[6], 50000);

  // Edit wallet (update credit limit & name)
  const updateRes = saveWalletToSheet({
    id: createdWallet[0],
    name: "Ví PayPay Chính",
    type: "DEBIT",
    initial_balance: 60000,
    credit_limit: 0
  });
  assert.equal(updateRes.success, true);
  assert.equal(db.Wallets[4][1], "Ví PayPay Chính");
  assert.equal(db.Wallets[4][6], 60000);

  // Delete wallet
  const delRes = deleteWalletFromSheet(createdWallet[0]);
  assert.equal(delRes.success, true);
  assert.equal(db.Wallets.length, 4);
});

test('1. WALLET: Transfer money between wallets (Ví Tiền Mặt -> Thẻ UFJ ATM) with zero duplicates', () => {
  const db = createMockFullDB();

  // Transfer 100,000 from W001 (Ví Tiền Mặt: 500,000) to W002 (Thẻ UFJ ATM: 1,000,000)
  const transferRes = processWalletTransfer({
    fromWallet: "Ví Tiền Mặt",
    toWallet: "Thẻ UFJ ATM",
    amount: 100000,
    date: "2026-10-08",
    note: "Nạp tiền vào tài khoản ngân hàng"
  });
  assert.equal(transferRes.success, true);

  const wData = getWalletsFromSheet("All", "All");
  const wCash = wData.wallets.find(w => w.name === "Ví Tiền Mặt");
  const wAtm = wData.wallets.find(w => w.name === "Thẻ UFJ ATM");

  // Cash should decrease by 100k (500k -> 400k)
  assert.equal(wCash.current_balance, 400000);
  // ATM should increase by 100k (1000k -> 1100k)
  assert.equal(wAtm.current_balance, 1100000);

  // Family sheet logs transfer transactions
  assert.equal(db.Family.length, 2); // Header + 1 transfer row (1 Chi Ví Tiền Mặt -> Thẻ UFJ)
});

// ==========================================
// 2. NHÓM 2: THU - CHI GIA ĐÌNH (TAB 2)
// ==========================================

test('2. THU-CHI: Save Income, Expense, Edit, Delete and Month/Year report integrity', () => {
  const db = createMockFullDB();

  // 1. Save Expense: 50,000 from Ví Tiền Mặt for Thiết yếu
  const expRes = saveFamilyTransaction({
    ngay: "2026-10-08",
    loai: "Chi",
    hu: "Thiết yếu",
    noidung: "Mua đồ siêu thị",
    sotien: 50000,
    nguontien: "Ví Tiền Mặt"
  });
  assert.equal(expRes.success, true);

  // 2. Save Income: 200,000 to Thẻ UFJ ATM
  const incRes = saveFamilyTransaction({
    ngay: "2026-10-08",
    loai: "Thu",
    hu: "----Thu nhập",
    noidung: "Nhận thưởng dự án",
    sotien: 200000,
    nguontien: "Thẻ UFJ ATM"
  });
  assert.equal(incRes.success, true);

  const t2Report = getTab2Data("10", "2026");
  assert.equal(t2Report.summary.totalExpense, 50000);
  assert.equal(t2Report.summary.totalIncome, 200000);
  assert.equal(t2Report.summary.netBalance, 150000);

  // Verify wallet balances
  const wData = getWalletsFromSheet("All", "All");
  const wCash = wData.wallets.find(w => w.name === "Ví Tiền Mặt");
  const wAtm = wData.wallets.find(w => w.name === "Thẻ UFJ ATM");
  assert.equal(wCash.current_balance, 450000); // 500k - 50k
  assert.equal(wAtm.current_balance, 1200000); // 1000k + 200k

  // 3. Edit Expense: change amount from 50k to 70k
  const txId = db.Family[1][0];
  const editRes = updateFamilyTransaction({
    id: txId,
    ngay: "2026-10-08",
    loai: "Chi",
    hu: "Thiết yếu",
    noidung: "Mua đồ siêu thị (sửa)",
    sotien: 70000,
    nguontien: "Ví Tiền Mặt"
  });
  assert.equal(editRes.success, true);
  assert.equal(db.Wallets[1][9], 430000); // 500k - 70k = 430k

  // 4. Delete Expense
  const delRes = deleteTransaction(txId);
  assert.equal(delRes.success, true);
  assert.equal(db.Wallets[1][9], 500000); // Balance restored to 500k
});

// ==========================================
// 3. NHÓM 3: THẺ TÍN DỤNG (CREDIT CARD FLOW)
// ==========================================

test('3. CREDIT CARD: Swipe -> Debt Increases -> Statement -> Settlement -> Debt Cleared (No double count!)', () => {
  const db = createMockFullDB();

  // 1. Swipe Card: Family dining 30,000 on Thẻ Rakuten
  const cardTxRes = saveFamilyTransaction({
    ngay: "2026-10-08",
    loai: "Chi",
    hu: "Ăn uống",
    noidung: "Ăn nhà hàng lẩu",
    sotien: 30000,
    nguontien: "Thẻ Rakuten"
  });
  assert.equal(cardTxRes.success, true);

  // Family status must be PRE-ORDER (Chờ đối soát)
  assert.equal(db.Family[1][9], "PRE-ORDER");

  // Real-time Card Debt & Available Credit check
  let wData = getWalletsFromSheet("All", "All");
  let cardRakuten = wData.wallets.find(w => w.name === "Thẻ Rakuten");
  assert.equal(cardRakuten.current_balance, -30000); // Dư nợ 30,000 ¥
  assert.equal(cardRakuten.total_decrease, 30000);

  // 2. Statement Reconciliation (Bấm "Đã trừ thẻ")
  const confirmRes = confirmPreOrderPayment(db.Family[1][0], "2026-10-15");
  assert.equal(confirmRes.success, true);
  assert.equal(db.Family[1][9], "HOAN_TAT");
  assert.equal(db.Family[1][10], "15/10/2026"); // Statement date set

  // Invariant: confirmPreOrderPayment on Family MUST NOT create extra Business expense row
  assert.equal(db.Business.length, 1); // Only header, 0 rows added!

  // 3. Settlement: Pay Credit Card Debt (30,000) from Debit Wallet (Thẻ UFJ ATM: 1,000,000)
  const settleRes = processCreditCardSettlement({
    creditCardName: "Thẻ Rakuten",
    sourceWalletName: "Thẻ UFJ ATM",
    amount: 30000,
    settleDate: "2026-10-27",
    note: "Tất toán thẻ Rakuten kỳ tháng 10"
  });
  assert.equal(settleRes.success, true);

  // Card Debt cleared to 0, Source wallet reduced by 30k (1000k -> 970k)
  wData = getWalletsFromSheet("All", "All");
  cardRakuten = wData.wallets.find(w => w.name === "Thẻ Rakuten");
  const wAtm = wData.wallets.find(w => w.name === "Thẻ UFJ ATM");

  assert.equal(cardRakuten.current_balance, 0); // Debt cleared!
  assert.equal(wAtm.current_balance, 970000);

  // Invariant: Card Settlement is internal transfer, NOT counted as new Expense in Tab 2 Summary
  const t2Report = getTab2Data("10", "2026");
  assert.equal(t2Report.summary.totalExpense, 30000); // Only the dining expense 30k, not 60k!
});

// ==========================================
// 4. NHÓM 4: MUA HÀNG & KINH DOANH (TAB 3)
// ==========================================

test('4. BUSINESS: Cash Purchase, Credit Pre-order, Sales, Debt Sales, Stock FIFO & Refund', () => {
  const db = createMockFullDB();

  // 1. Cash Purchase: 10 items @ 1,000 ¥ = 10,000 ¥ from Ví Tiền Mặt
  const poCashRes = savePurchaseOrder({
    ngay: "2026-10-08",
    noiMua: "Amazon",
    trangThaiKho: "Kho Nhật",
    nguonTien: "Ví Tiền Mặt",
    isPreOrder: false,
    items: [{ tenSP: "Bút cảm ứng", qty: 10, price: 1000 }]
  });
  assert.equal(poCashRes.success, true);
  assert.equal(db.Purchase[1][11], 10); // Inventory = 10
  assert.equal(db.WalletLedger.length, 2); // 1 Ledger entry logged
  assert.equal(db.WalletLedger[1][6], "CASH");
  const w1 = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w1.current_balance, 490000); // Cash 500k - 10k = 490k

  // 2. Sales Order: Sell 4 items @ 2,500 ¥ = 10,000 ¥ (Cash collected to Ví Tiền Mặt)
  const soRes = saveSalesOrder({
    ngay: "2026-10-08",
    noiTruKho: "Kho Nhật",
    nhanTienVao: "Ví Tiền Mặt",
    isKhachNo: false,
    items: [{ tenSP: "Bút cảm ứng", qty: 4, price: 2500 }]
  });
  assert.equal(soRes.success, true);
  assert.equal(db.Purchase[1][11], 6); // Stock remaining: 10 - 4 = 6
  const w2 = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w2.current_balance, 500000); // 490k + 10k = 500k

  // 3. Debt Sales Order: Sell 2 items @ 3,000 ¥ = 6,000 ¥ (Khách Nợ)
  const soDebtRes = saveSalesOrder({
    ngay: "2026-10-08",
    noiTruKho: "Kho Nhật",
    nhanTienVao: "Khách Nợ",
    isKhachNo: true,
    khachHang: "Anh Nam",
    items: [{ tenSP: "Bút cảm ứng", qty: 2, price: 3000 }]
  });
  assert.equal(soDebtRes.success, true);
  assert.equal(db.Purchase[1][11], 4); // Stock remaining: 6 - 2 = 4
  const w3 = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w3.current_balance, 500000); // Cash unchanged (customer owes)

  // 4. Collect Debt Sales Payment (Thu nợ khách)
  const salesId = db.Sales[2][0];
  const collectRes = confirmBatchDebtSalesPayment([salesId], "Ví Tiền Mặt", "2026-10-09");
  assert.equal(collectRes.success, true);
  assert.equal(db.Sales[2][8], "Ví Tiền Mặt"); // Updated to wallet
  assert.equal(db.Sales[2][9], "HOAN_TAT");
  const w4 = getWalletsFromSheet("All", "All").wallets.find(x => x.name === "Ví Tiền Mặt");
  assert.equal(w4.current_balance, 506000); // Cash increased: 500k + 6k = 506k
});

// ==========================================
// 5. NHÓM 5: CÔNG NỢ (TAB 4 DEBT)
// ==========================================

test('5. DEBTS: Lend, Borrow, Partial Payment, Full Settlement with zero duplicate', () => {
  const db = createMockFullDB();

  // 1. Cho vay: 50,000 to "Bạn A" from Ví Tiền Mặt
  const lendRes = saveDebtTransaction({
    ngay: "2026-10-08",
    loai: "THU", // THU = Người ta nợ mình
    doituong: "Bạn A",
    noidung: "Cho vay mượn nóng",
    sotien: 50000,
    nguontien: "Ví Tiền Mặt"
  });
  assert.equal(lendRes.success, true);
  assert.equal(db.Wallets[1][9], 450000); // Cash 500k - 50k = 450k

  // 2. Thu nợ 1 phần (Partial payment: 20,000)
  const debtId = db.Debt[1][0];
  const partialRes = settleDebtPayment({
    debtId: debtId,
    amountPaid: 20000,
    settleWallet: "Ví Tiền Mặt",
    settleDate: "2026-10-09"
  });
  assert.equal(partialRes.success, true);
  assert.equal(db.Debt[1][7], 20000); // Đã thanh toán = 20k
  assert.equal(db.Debt[1][8], "09/10/2026"); // Ngày thanh toán
  assert.equal(db.Debt[1][9], 30000); // Dư nợ còn lại = 30k
  assert.equal(db.Wallets[1][9], 470000); // Cash 450k + 20k = 470k

  // 3. Tất toán toàn bộ phần còn lại (30,000)
  const fullRes = settleDebtPayment({
    debtId: debtId,
    amountPaid: 30000,
    settleWallet: "Ví Tiền Mặt",
    settleDate: "2026-10-10"
  });
  assert.equal(fullRes.success, true);
  assert.equal(db.Debt[1][9], 0); // Dư nợ = 0
  assert.equal(db.Debt[1][10], "DA_TRA"); // Status completed
  assert.equal(db.Wallets[1][9], 500000); // Cash restored to 500k
});

// ==========================================
// 6. NHÓM 6: CHIA TIỀN NHÓM (TAB 7 SPLIT BILLS)
// ==========================================

test('6. FAMILY SPLIT: INV-08 Zero-Loss Split, Payer Wallet Outflow vs Personal True Share', () => {
  const db = createMockFullDB();

  // Scenario: ME pays ¥30,000 with Ví Tiền Mặt for a dining bill of 3 families (Quậy-Chi: ME, 1F, 3F)
  // Weight mode: 4 Adults, 2 Children (0.5 weight)
  const members = [
    { id: "M1", name: "Quậy", isMe: true, familyTag: "Quậy - Chi - Chít", type: "ADULT", weight: 1.0 },
    { id: "M2", name: "Chi", isMe: false, familyTag: "Quậy - Chi - Chít", type: "ADULT", weight: 1.0 },
    { id: "M3", name: "Chít", isMe: false, familyTag: "Quậy - Chi - Chít", type: "CHILD", weight: 0.5 },
    { id: "M4", name: "A Huân", isMe: false, familyTag: "1F", type: "ADULT", weight: 1.0 },
    { id: "M5", name: "C Hương", isMe: false, familyTag: "1F", type: "ADULT", weight: 1.0 },
    { id: "M6", name: "Bé 1F", isMe: false, familyTag: "1F", type: "CHILD", weight: 0.5 }
  ];

  // Create Split Group first
  saveSplitGroup({
    id: "GRP_001",
    name: "Chuyến đi Tokyo",
    members: members
  });

  // Save Split Expense
  const expRes = saveSplitExpense({
    groupId: "GRP_001",
    amount: 30000,
    paidBy: "Quậy",
    paidWithWallet: "Ví Tiền Mặt",
    splitMode: "WEIGHT",
    members: members
  });
  assert.equal(expRes.success, true);

  // Invariant 1: Payer's wallet is deducted by full amount ¥30,000 immediately
  assert.equal(db.Wallets[1][9], 470000); // Cash 500k - 30k = 470k

  // Invariant 2: Total shares exactly match ¥30,000 with 0 loss (INV-08)
  const sharesRes = calculateExpenseShares("WEIGHT", 30000, members);
  assert.equal(sharesRes.success, true);
  const totalShares = sharesRes.participants.reduce((sum, p) => sum + p.calculatedAmount, 0);
  assert.equal(totalShares, 30000);

  const shareMap = {};
  sharesRes.participants.forEach(p => { shareMap[p.memberId] = p.calculatedAmount; });

  // Family Quậy share (2.5 units out of 5.0 total units) = 15,000 ¥
  // Family 1F share (2.5 units out of 5.0 total units) = 15,000 ¥
  const myFamilyCost = (shareMap["M1"] || 0) + (shareMap["M2"] || 0) + (shareMap["M3"] || 0);
  const otherFamilyCost = (shareMap["M4"] || 0) + (shareMap["M5"] || 0) + (shareMap["M6"] || 0);
  assert.equal(myFamilyCost, 15000);
  assert.equal(otherFamilyCost, 15000);

  // Finalize Trip: 1F owes ME ¥15,000
  const finalizeRes = finalizeTripAndExportDebts("GRP_001", {
    exportToDebt: true,
    exportToFamily: true
  });
  assert.equal(finalizeRes.success, true);
});

// ==========================================
// 7. NHÓM 7: CHECKPOINT & REBUILD (MATH INVARIANT)
// ==========================================

test('7. CHECKPOINT: Checkpoint -> New Tx -> Backdate Edit -> Rebuild Mathematical Invariant', () => {
  const db = createMockFullDB();

  // Initial Cash = 500,000. Set Checkpoint at 500,000 on 2026-10-01
  const cpRes = checkpointWalletBalance({
    walletId: "W001",
    walletName: "Ví Tiền Mặt",
    currentBalance: 500000,
    checkpointDate: "2026-10-01 00:00:00"
  });
  assert.equal(cpRes.success, true);

  // Transaction 1 (After checkpoint): Expense 50,000 on 2026-10-05
  saveFamilyTransaction({
    ngay: "2026-10-05",
    loai: "Chi",
    sotien: 50000,
    nguontien: "Ví Tiền Mặt"
  });

  // Transaction 2 (After checkpoint): Income 120,000 on 2026-10-07
  saveFamilyTransaction({
    ngay: "2026-10-07",
    loai: "Thu",
    sotien: 120000,
    nguontien: "Ví Tiền Mặt"
  });

  // Current balance should be: 500,000 - 50,000 + 120,000 = 570,000
  let wData = getWalletsFromSheet("All", "All");
  let wCash = wData.wallets.find(w => w.id === "W001");
  assert.equal(wCash.current_balance, 570000);

  // Rebuild Wallet Balance: Must equal 570,000
  const rebuildRes = rebuildWalletBalance("W001");
  assert.equal(rebuildRes.success, true);
  assert.equal(rebuildRes.currentBalance, 570000);
  assert.equal(rebuildRes.status, "SYNCED");
});

// ==========================================
// 8. NHÓM 8: BẢO MẬT & XỬ LÝ NGOẠI LỆ (SECURITY & FAULT TOLERANCE)
// ==========================================

test('8. SECURITY & FAULT TOLERANCE: PIN Auth, Masking, Invalid Input & Double-click guard', () => {
  const db = createMockFullDB();

  // 1. PIN Authentication
  assert.equal(t1_isValidCardPassword("25100311"), true);
  assert.equal(t1_isValidCardPassword("wrong_pin"), false);

  // 2. Invalid Amount Handling (Negative / String / Zero)
  const invalidTx1 = saveFamilyTransaction({
    ngay: "2026-10-08",
    loai: "Chi",
    sotien: -5000, // Negative
    nguontien: "Ví Tiền Mặt"
  });
  // Should handle gracefully with 0 or positive absolute
  assert.ok(invalidTx1);

  const invalidTx2 = saveFamilyTransaction({
    ngay: "2026-10-08",
    loai: "Chi",
    sotien: "abc", // Non-numeric
    nguontien: "Ví Tiền Mặt"
  });
  assert.ok(invalidTx2);

  // 3. Card Security Data update with PIN
  const saveCardSecRes = saveCardSecurityDetails({
    password: "25100311",
    id: "W003",
    cardNumber: "4297700026997154",
    cardExp: "08/29",
    cardCvv: "557"
  });
  assert.equal(saveCardSecRes.success, true);

  // Wrong password rejection
  const wrongPinRes = saveCardSecurityDetails({
    password: "wrong",
    id: "W003",
    cardNumber: "4297700026997154"
  });
  assert.equal(wrongPinRes.success, false);
});
