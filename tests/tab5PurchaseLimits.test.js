const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPropertiesStore = {};
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (key) => scriptPropertiesStore[key] || null,
    setProperty: (key, val) => { scriptPropertiesStore[key] = String(val); }
  })
};

global.Logger = { log: () => {} };
global.Utilities = {
  formatDate: (date, tz, fmt) => '2026-09-11'
};

function createMockTab5DB() {
  const tables = {
    LichMua: [
      ["ID", "NgayMua", "TaiKhoan", "CuaHang", "TenSanPham", "SoNgayCooldown", "NgayKhaDung", "TrangThai", "MaDonTab3", "GhiChu"],
      ["LM0001", "2026-09-01", "Joshin KA", "Joshin", "Film Fuji Instax Mini 11", 30, "2026-10-01", "DANG_CHO", "", "Đang chờ cooldown"],
      ["LM0002", "2026-09-05", "Yodo KA", "Yodobashi", "Film Mini Instax", 13, "2026-09-18", "KET_THUC", "", "Đơn bị hủy - đã kết thúc cooldown"]
    ],
    Categories: [
      ["Mẫu", "Hũ", "Ví", "", "", "", "Danh sách Tài khoản"],
      ["", "", "", "", "", "", "Joshin KA"],
      ["", "", "", "", "", "", "Joshin Chi"],
      ["", "", "", "", "", "", "Joshin Giao"],
      ["", "", "", "", "", "", "Edion Ka"],
      ["", "", "", "", "", "", "Edion Chi"],
      ["", "", "", "", "", "", "Yodo KA"],
      ["", "", "", "", "", "", "Yodo Chi"],
      ["", "", "", "", "", "", "Yodo Chít"],
      ["", "", "", "", "", "", "Yodo 602"],
      ["", "", "", "", "", "", "Yodo 303"],
      ["", "", "", "", "", "", "Yodo Trinh"],
      ["", "", "", "", "", "", "Yodo Giao"]
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
          getRange: (startRow, startCol, numRows, numCols) => ({
            getValues: () => {
              const sliced = rows.slice(startRow - 1, startRow - 1 + (numRows || 1));
              return sliced.map(r => {
                const rowSlice = r ? r.slice(startCol - 1, startCol - 1 + (numCols || 1)) : [];
                return rowSlice;
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
            setBackground: () => ({ setFontWeight: () => {} })
          }),
          appendRow: (rowData) => {
            rows.push(rowData);
          },
          deleteRow: (rowIndex) => {
            if (rowIndex > 0 && rowIndex <= rows.length) {
              rows.splice(rowIndex - 1, 1);
            }
          },
          getDataRange: () => ({
            getValues: () => rows
          })
        };
      }
    })
  };

  return tables;
}

const serverTab5Code = fs.readFileSync(path.join(__dirname, '../src/Server_Tab5.js'), 'utf8');
eval(serverTab5Code);

test('getTab5Data calculates cooldown matrix and loads accounts from Categories Column G', () => {
  createMockTab5DB();
  const res = getTab5Data();

  assert.equal(res.success, true);
  assert.equal(res.items.length, 2);

  // Kiểm tra nạp tài khoản từ Categories cột G
  assert.ok(res.accounts.includes("Joshin KA"));
  assert.ok(res.accounts.includes("Yodo 602"));
  assert.ok(res.accounts.includes("Yodo Trinh"));

  const joshinStore = res.matrix.find(m => m.store === "Joshin");
  assert.ok(joshinStore);

  const joshinKA = joshinStore.accountsStatus.find(a => a.account === "Joshin KA");
  assert.ok(joshinKA);
  assert.equal(joshinKA.isCooldown, true); // Joshin KA đã mua 01/09 -> Cooldown đến 01/10

  const yodoStore = res.matrix.find(m => m.store === "Yodobashi" || m.store === "Yodo");
  assert.ok(yodoStore);
  const yodoKA = yodoStore.accountsStatus.find(a => a.account === "Yodo KA");
  assert.ok(yodoKA);
  assert.equal(yodoKA.isCooldown, false); // Yodo KA đơn bị DA_HUY -> Sẵn sàng mua (không cooldown)
});

test('savePurchaseLimitRecord applies 13-day cooldown for Yodo store', () => {
  const tables = createMockTab5DB();

  const formData = {
    ngayMua: "2026-09-10",
    taiKhoan: "Yodo 602",
    cuaHang: "Yodobashi Camera",
    tenSanPham: "Tai nghe Sony",
    ghiChu: "Test Yodo 13 ngày"
  };

  const res = savePurchaseLimitRecord(formData);
  assert.equal(res.success, true);

  const rows = tables.LichMua;
  assert.equal(rows.length, 4);
  const newRow = rows[3];
  assert.equal(newRow[2], "Yodo 602");
  assert.equal(newRow[3], "Yodobashi Camera");
  assert.equal(newRow[5], 13); // Tự động nhận diện 13 ngày cho Yodo
  assert.equal(newRow[6], "2026-09-23"); // 10/09 + 13 ngày = 23/09
});

test('updatePurchaseLimitStatus releases cooldown and updates status columns when set to KET_THUC or DANG_CHO', () => {
  const tables = createMockTab5DB();

  const updateRes = updatePurchaseLimitStatus("LM0001", "KET_THUC");
  assert.equal(updateRes.success, true);

  const res = getTab5Data();
  const joshinStore = res.matrix.find(m => m.store === "Joshin");
  const joshinKA = joshinStore.accountsStatus.find(a => a.account === "Joshin KA");
  assert.equal(joshinKA.isCooldown, false);

  // Khôi phục lại trạng thái DANG_CHO
  const restoreRes = updatePurchaseLimitStatus("LM0001", "DANG_CHO");
  assert.equal(restoreRes.success, true);

  const res2 = getTab5Data();
  const joshinStore2 = res2.matrix.find(m => m.store === "Joshin");
  const joshinKA2 = joshinStore2.accountsStatus.find(a => a.account === "Joshin KA");
  assert.equal(joshinKA2.isCooldown, true);
});

test('deletePurchaseLimitRecord removes row from LichMua sheet', () => {
  const tables = createMockTab5DB();

  const delRes = deletePurchaseLimitRecord("LM0001");
  assert.equal(delRes.success, true);
  assert.equal(tables.LichMua.length, 2);
});

test('addTab5Account appends new account string to next empty cell of Categories Column G without duplicate store prefix', () => {
  const tables = createMockTab5DB();
  // Khi thêm "Fuji anh", không bị prefix trùng thành "Yodo Fuji anh" dù storeName truyền vào là Yodo
  const addRes = addTab5Account("Yodo", "Fuji anh");
  assert.equal(addRes.success, true);
  assert.equal(addRes.account, "Fuji anh");

  const catRows = tables.Categories;
  // Dòng mới được thêm vào cuối Cột G chứa "Fuji anh"
  assert.equal(catRows[catRows.length - 1][6], "Fuji anh");
});

test('getTab5Data correctly assigns Fuji accounts to Fuji store', () => {
  const tables = createMockTab5DB();
  tables.Categories.push(["", "", "", "", "", "", "Fuji anh"]);

  const res = getTab5Data();
  const fujiStore = res.matrix.find(m => m.store === "Fuji");
  assert.ok(fujiStore);

  const fujiAcc = fujiStore.accountsStatus.find(a => a.account === "Fuji anh");
  assert.ok(fujiAcc);
  assert.equal(fujiAcc.shortName, "anh");

  // Đảm bảo "Fuji anh" không bị nhảy sang Yodo
  const yodoStore = res.matrix.find(m => m.store === "Yodo");
  const yodoFujiAcc = yodoStore.accountsStatus.find(a => a.account.includes("Fuji anh"));
  assert.equal(yodoFujiAcc, undefined);
});

test('getProductCategory maps Film MINI INSTAX to Trắng and other Film items to Màu, Yodo Color Film ignores cooldown', () => {
  assert.equal(getProductCategory("Film MINI INSTAX", "Yodo"), "Film MINI Trắng");
  assert.equal(getProductCategory("Film SQUARE STAR ILLUMINATION", "Yodo"), "Film MINI Màu");
  assert.equal(getProductCategory("Film MINI SOFT LAVENDER", "Fuji"), "Film MINI Màu");

  const tables = createMockTab5DB();
  tables.LichMua.push([
    "LM0099", "2026-09-18", "Yodo KA", "Yodo", "Film SQUARE STAR ILLUMINATION", 13, "2026-10-01", "THANH_CONG", "", ""
  ]);

  const res = getTab5Data();
  const yodoStore = res.matrix.find(m => m.store === "Yodo");
  const yodoColorKA = yodoStore.accountsStatus.find(a => a.account === "Yodo KA" && a.category === "Film MINI Màu");
  assert.ok(yodoColorKA);
  assert.equal(yodoColorKA.isCooldown, false); // Yodo Film Màu không tính cooldown
});

test('getTab5Data releases cooldown when Column D (Trạng Thái Kho) is set to Hủy', () => {
  const tables = createMockTab5DB();
  tables.Categories.push(["", "", "", "", "", "", "Fuji KA"]);
  tables.Purchase = [
    ["ID", "Ngày Mua", "Nơi mua", "Trạng Thái Kho", "Tên Sản Phẩm", "Số Lượng", "Giá Mua", "Tổng Tiền", "Nguồn Tiền", "Trạng thái thẻ", "Note", "Tồn kho", "Ngày Sao kê", "Thông tin tài khoản mua", "SoNgayCooldown", "NgayKhaDung", "TrangThai"],
    ["PUR_001", "2026-09-14", "Fuji", "Hủy", "Film MINI INSTAX", 3, 1075, 3225, "Ví Tiền Mặt", "HOAN_TAT", "", 3, "2026-09-14", "Fuji KA", 30, "2026-10-14", "THANH_CONG"]
  ];

  const res = getTab5Data();
  assert.equal(res.success, true, res.error);
  const fujiStore = res.matrix.find(m => m.store === "Fuji");
  assert.ok(fujiStore);

  const fujiKA = fujiStore.accountsStatus.find(a => a.account === "Fuji KA" && a.category === "Film MINI Trắng");
  assert.ok(fujiKA);
  assert.equal(fujiKA.isCooldown, false); // Trạng Thái Kho = "Hủy" ➔ Cooldown lập tức giải phóng (false)
});

test('savePurchaseLimitRecord saves multiple product items in 1 purchase order', () => {
  const tables = createMockTab5DB();
  tables.Purchase = [
    ["ID", "Ngày Mua", "Nơi mua", "Trạng Thái Kho", "Tên Sản Phẩm", "Số Lượng", "Giá Mua (1 cái)", "Tổng Tiền", "Nguồn Tiền Mua", "Trạng thái thẻ", "Note", "Tồn kho", "Ngày Sao kê", "Thông tin tài khoản mua", "SoNgayCooldown", "NgayKhaDung", "TrangThai"]
  ];

  const formData = {
    ngayMua: "2026-09-19",
    taiKhoan: "Joshin KA",
    cuaHang: "Joshin",
    items: [
      { tenSP: "Film MINI INSTAX", qty: 3, price: "=3225/3" },
      { tenSP: "30th Deki", qty: 1, price: 6200 }
    ],
    ghiChu: "Đơn mua gộp 2 món"
  };

  const res = savePurchaseLimitRecord(formData);
  assert.equal(res.success, true);
  assert.equal(res.count, 2);

  const pRows = tables.Purchase;
  assert.equal(pRows.length, 3); // Header + 2 items
  assert.equal(pRows[1][4], "Film MINI INSTAX");
  assert.equal(pRows[1][5], 3);
  assert.equal(pRows[1][6], 1075); // 3225/3 = 1075
  assert.equal(pRows[2][4], "30th Deki");
  assert.equal(pRows[2][6], 6200);
});

test('saveStoreCooldownSettings and getStoreCooldownSettings dynamically save and retrieve custom store cooldown days', () => {
  createMockTab5DB();

  const initialSettings = getStoreCooldownSettings();
  assert.equal(initialSettings.Yodo, 13);
  assert.equal(initialSettings.Fuji, 30);
  assert.equal(initialSettings.Joshin, 30);

  const updateRes = saveStoreCooldownSettings({ Yodo: 15, Fuji: 25, Joshin: 20 });
  assert.equal(updateRes.success, true);

  const updatedSettings = getStoreCooldownSettings();
  assert.equal(updatedSettings.Yodo, 15);
  assert.equal(updatedSettings.Fuji, 25);
  assert.equal(updatedSettings.Joshin, 20);

  // getDefaultCooldownDays should use updated settings for Film products
  assert.equal(getDefaultCooldownDays("Yodo", "Film Mini Instax"), 15);
  assert.equal(getDefaultCooldownDays("Fuji", "Film Mini Instax"), 25);
  assert.equal(getDefaultCooldownDays("Joshin", "Film Mini Instax"), 20);
  assert.equal(getDefaultCooldownDays("Edion", "Film Mini Instax"), 0); // Edion không có cooldown
  assert.equal(getDefaultCooldownDays("Amazon", "Film Mini Instax"), 0); // Amazon không có cooldown
  assert.equal(getDefaultCooldownDays("Yodo", "NonFilm Product"), 0);
});


