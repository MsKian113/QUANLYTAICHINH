// ==========================================
// FILE: Server_Tab3.js
// NHIỆM VỤ: Backend Logic cho Tab 3 (Kinh Doanh & QL Kho)
// Schemas:
// - Sheet Business: A: ID | B: Ngày | C: Loại | D: Số Tiền | E: Nguồn tiền | F: Nội Dung / Diễn Giải
// - Sheet Purchase: A: ID | B: Ngày Mua | C: Nơi mua | D: Trạng Thái Kho | E: Tên Sản Phẩm | F: Số Lượng | G: Giá Mua (1 cái) | H: Tổng Tiền | I: Nguồn Tiền Mua | J: Ghi Chú
// - Sheet Sales:    A: ID | B: Ngày Bán | C: Tên Sản Phẩm | D: Nơi Trừ Kho | E: Số Lượng Xuất | F: Giá Bán (1 cái) | G: Tổng Tiền Bán | H: Tồn kho | I: Nhận Tiền Vào | J: Ghi Chú
// ==========================================

const SHEET_BUSINESS = "Business";
const SHEET_PURCHASE = "Purchase";
const SHEET_SALES = "Sales";
const SHEET_CATEGORIES_T3 = "Categories";

/**
 * Helper parse số tiền an toàn
 */
function parseBizMoney(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).trim();
  if (!str) return 0;
  const cleanStr = str.replace(/[^0-9-]/g, '');
  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? 0 : parsed;
}

function formatBizDateServer(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return typeof Utilities !== 'undefined' ? Utilities.formatDate(val, "Asia/Tokyo", "yyyy-MM-dd") : val.toISOString().split('T')[0];
  }
  const str = String(val).trim();
  if (!str) return "";
  if (str.length > 10 && str.indexOf("-") === -1 && str.indexOf("/") === -1) {
    try {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        return typeof Utilities !== 'undefined' ? Utilities.formatDate(d, "Asia/Tokyo", "yyyy-MM-dd") : d.toISOString().split('T')[0];
      }
    } catch(e) {}
  }
  if (str.length > 10) return str.substring(0, 10);
  return str;
}

/**
 * 1. LẤY DỮ LIỆU KINH DOANH, KHO HÀNG & DANH SÁCH KHO TỪ CATEGORIES CỘT H
 */
function getBusinessData(month, year, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    
    let warehouses = ["Chờ Ship", "Kho Nhật (Kho 1)", "Kho VN (Kho 2)"];
    let products = [];
    let suppliers = [];
    let sources = [];
    let preOrders = [];
    let debtSales = [];
    let inventory = [];

    let totalSales = 0;
    let totalCogs = 0;
    let totalStockValue = 0;

    if (ss) {
      // 1. Load kho từ Sheet Categories (Cột H - Column 8) và Nơi Mua từ Cột C (Column 3)
      const catSheet = ss.getSheetByName(SHEET_CATEGORIES_T3) || ss.getSheetByName("DanhMuc");
      if (catSheet && catSheet.getLastRow() >= 2) {
        const lastRow = catSheet.getLastRow();
        const lastCol = Math.max(catSheet.getLastColumn(), 8);
        const catData = catSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
        const customWh = [];
        catData.forEach(r => {
          const whName = String(r[7] || "").trim(); // Column H (index 7)
          if (whName && whName !== "Kho" && whName !== "Trạng Thái Kho" && !customWh.includes(whName)) {
            customWh.push(whName);
          }

          // Nơi mua từ Cột C (Column 3, index 2)
          const suppName = String(r[2] || "").trim();
          if (suppName && !["Nơi mua", "Nơi Mua", "Ví", "Ví/Thẻ"].includes(suppName) && !suppliers.includes(suppName)) {
            suppliers.push(suppName);
          }
        });
        if (customWh.length > 0) warehouses = customWh;
      }

      // 2. Load Purchase Sheet & Extract UNIQUE product names from Column E
      const pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
      if (pSheet && pSheet.getLastRow() >= 2) {
        const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 10).getValues();
        pData.forEach(r => {
          const id = String(r[0] || "").trim();
          if (!id) return;
          const ngayMua = formatBizDateServer(r[1]);
          const noiMua = String(r[2] || "").trim();
          const trangThaiKho = String(r[3] || "").trim();
          const tenSP = String(r[4] || "").trim(); // Column E (index 4)
          const qty = parseBizMoney(r[5]);
          const price = parseBizMoney(r[6]);
          const total = parseBizMoney(r[7]) || (qty * price);
          const nguonTien = String(r[8] || "").trim();
          const ghiChu = String(r[9] || "").trim();

          if (noiMua && !suppliers.includes(noiMua)) suppliers.push(noiMua);
          // Lấy Tên Sản Phẩm duy nhất từ Cột E
          if (tenSP && tenSP !== "Tên Sản Phẩm" && !products.includes(tenSP)) {
            products.push(tenSP);
          }
          if (nguonTien && !sources.includes(nguonTien)) sources.push(nguonTien);

          // Phân loại Pre-order (chờ trừ thẻ / mượn tiền)
          if (ghiChu.toLowerCase().includes("pre-order") || ghiChu.toLowerCase().includes("chờ trừ thẻ")) {
            preOrders.push({
              id, ngayMua, noiMua, trangThaiKho, tenSP, qty, price, total, nguonTien, ghiChu
            });
          }

          // Tính tồn kho
          totalStockValue += total;
          inventory.push({
            id, ngayMua, noiMua, trangThaiKho, tenSP, qty, price, total, nguonTien
          });
        });
      }

      // 3. Load Sales Sheet
      const sSheet = ss.getSheetByName(SHEET_SALES) || ss.getSheetByName("BanHang");
      if (sSheet && sSheet.getLastRow() >= 2) {
        const sData = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, 10).getValues();
        sData.forEach(r => {
          const id = String(r[0] || "").trim();
          if (!id) return;
          const ngayBan = formatBizDateServer(r[1]);
          const tenSP = String(r[2] || "").trim();
          const noiTru = String(r[3] || "").trim();
          const qty = parseBizMoney(r[4]);
          const price = parseBizMoney(r[5]);
          const total = parseBizMoney(r[6]) || (qty * price);
          const tonKho = parseBizMoney(r[7]);
          const nhanTien = String(r[8] || "").trim();
          const ghiChu = String(r[9] || "").trim();

          totalSales += total;

          if (nhanTien.toLowerCase().includes("nợ") || ghiChu.toLowerCase().includes("khách nợ")) {
            debtSales.push({
              id, ngayBan, tenSP, noiTru, qty, price, total, nhanTien, ghiChu
            });
          }
        });
      }

      // 4. Load Business Sheet (TỔNG HỢP THU CHI BIZ)
      const bSheet = ss.getSheetByName(SHEET_BUSINESS) || ss.getSheetByName("KinhDoanh");
      if (bSheet && bSheet.getLastRow() >= 2) {
        const bData = bSheet.getRange(2, 1, bSheet.getLastRow() - 1, 6).getValues();
        bData.forEach(r => {
          const loai = String(r[2] || "").trim().toUpperCase();
          const amt = parseBizMoney(r[3]);
          if (loai === "CHI") totalCogs += amt;
        });
      }
    }

    const netProfit = totalSales - totalCogs;

    return {
      success: true,
      summary: {
        net: netProfit,
        sales: totalSales,
        cogs: totalCogs,
        stockValue: totalStockValue
      },
      warehouses: warehouses,
      products: products,
      suppliers: suppliers,
      sources: sources,
      preOrders: preOrders,
      debtSales: debtSales,
      inventory: inventory
    };
  } catch (err) {
    return {
      success: false,
      message: "Lỗi backend: " + err.toString(),
      summary: { net: 0, sales: 0, cogs: 0, stockValue: 0 },
      warehouses: ["Chờ Ship", "Kho Nhật (Kho 1)", "Kho VN (Kho 2)"],
      products: [],
      suppliers: [],
      sources: [],
      preOrders: [],
      debtSales: [],
      inventory: []
    };
  }
}

/**
 * 2. LƯU ĐƠN NHẬP MUA HÀNG (PURCHASE) - TỐI ƯU TỐC ĐỘ BẰNG BATCH SETVALUES
 */
function savePurchaseOrder(formData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    let pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
    if (!pSheet) {
      pSheet = ss.insertSheet(SHEET_PURCHASE);
      pSheet.appendRow(["ID", "Ngày Mua", "Nơi mua", "Trạng Thái Kho", "Tên Sản Phẩm", "Số Lượng", "Giá Mua (1 cái)", "Tổng Tiền", "Nguồn Tiền Mua", "Ghi Chú"]);
    }

    const newId = "PO" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90);
    const dateVal = formData.ngay || formatBizDateServer(new Date());
    const noiMua = String(formData.noiMua || "").trim();
    const trangThaiKho = String(formData.trangThaiKho || "Chờ Ship").trim();
    const items = formData.items || [];
    const nguonTien = String(formData.nguonTien || "").trim();
    const isPreOrder = Boolean(formData.isPreOrder);
    const isMuonThe = Boolean(formData.isMuonThe);
    const doiTacMuon = String(formData.doiTacMuon || "").trim();

    let totalPurchaseAmt = 0;
    const rowsToAppend = [];

    items.forEach(it => {
      const tenSP = String(it.tenSP || "").trim();
      if (!tenSP) return;
      const qty = Number(it.qty) || 1;
      const price = Number(it.price) || 0;
      const itemTotal = qty * price;
      totalPurchaseAmt += itemTotal;

      let ghiChu = "";
      if (isPreOrder) ghiChu += "[Pre-order/Chờ trừ thẻ] ";
      if (isMuonThe) ghiChu += `[Mượn thẻ đối tác: ${doiTacMuon}] `;
      if (it.ghiChu) ghiChu += it.ghiChu;

      rowsToAppend.push([
        newId,
        dateVal,
        noiMua,
        trangThaiKho,
        tenSP,
        qty,
        price,
        itemTotal,
        nguonTien,
        ghiChu.trim()
      ]);
    });

    if (rowsToAppend.length > 0) {
      const startRow = pSheet.getLastRow() + 1;
      pSheet.getRange(startRow, 1, rowsToAppend.length, 10).setValues(rowsToAppend);
    }

    // Nếu không phải Pre-order hay Mượn thẻ -> trừ tiền Ví/Thẻ và ghi nhận vào Business Sheet
    if (!isPreOrder && !isMuonThe && totalPurchaseAmt > 0) {
      let bSheet = ss.getSheetByName(SHEET_BUSINESS) || ss.getSheetByName("KinhDoanh");
      if (!bSheet) {
        bSheet = ss.insertSheet(SHEET_BUSINESS);
        bSheet.appendRow(["ID", "Ngày", "Loại", "Số Tiền", "Nguồn tiền", "Nội Dung / Diễn Giải"]);
      }
      bSheet.appendRow([
        newId,
        dateVal,
        "Chi",
        totalPurchaseAmt,
        nguonTien,
        `Nhập hàng từ ${noiMua} (${items.length} SP)`
      ]);

      if (typeof updateWalletBalanceHelper === 'function' && nguonTien) {
        updateWalletBalanceHelper(nguonTien, -totalPurchaseAmt);
      }
    }

    // Nếu mượn tiền đối tác -> Tự động sinh công nợ bên Sheet Debt
    if (isMuonThe && doiTacMuon && totalPurchaseAmt > 0) {
      let debtSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
      if (debtSheet) {
        const debtId = "CN" + Date.now().toString().slice(-6);
        debtSheet.appendRow([
          debtId,
          dateVal,
          doiTacMuon,
          "TRA",
          `Mượn thẻ mua hàng: ${noiMua}`,
          totalPurchaseAmt,
          nguonTien,
          0,
          "",
          totalPurchaseAmt,
          "DANG_NO"
        ]);
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, message: "✅ Đã lưu đơn nhập mua hàng thành công!" };
  } catch (err) {
    return { success: false, message: "❌ Lỗi khi lưu đơn mua: " + err.toString() };
  }
}

/**
 * 3. LƯU ĐƠN XUẤT BÁN HÀNG (SALES)
 */
function saveSalesOrder(formData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    let sSheet = ss.getSheetByName(SHEET_SALES) || ss.getSheetByName("BanHang");
    if (!sSheet) {
      sSheet = ss.insertSheet(SHEET_SALES);
      sSheet.appendRow(["ID", "Ngày Bán", "Tên Sản Phẩm", "Nơi Trừ Kho", "Số Lượng Xuất", "Giá Bán (1 cái)", "Tổng Tiền Bán", "Tồn kho", "Nhận Tiền Vào", "Ghi Chú"]);
    }

    const newId = "SO" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90);
    const dateVal = formData.ngay || formatBizDateServer(new Date());
    const items = formData.items || [];
    const nhanTienVao = String(formData.nhanTienVao || "").trim();
    const isKhachNo = Boolean(formData.isKhachNo);

    let totalSalesAmt = 0;
    const rowsToAppend = [];

    items.forEach(it => {
      const tenSP = String(it.tenSP || "").trim();
      if (!tenSP) return;
      const qty = Number(it.qty) || 1;
      const price = Number(it.price) || 0;
      const itemTotal = qty * price;
      totalSalesAmt += itemTotal;
      const noiTru = String(it.noiTru || "Kho Nhật").trim();

      let ghiChu = isKhachNo ? "[Khách Nợ]" : "";
      if (it.ghiChu) ghiChu += " " + it.ghiChu;

      rowsToAppend.push([
        newId,
        dateVal,
        tenSP,
        noiTru,
        qty,
        price,
        itemTotal,
        0,
        isKhachNo ? "Khách Nợ" : nhanTienVao,
        ghiChu.trim()
      ]);
    });

    if (rowsToAppend.length > 0) {
      const startRow = sSheet.getLastRow() + 1;
      sSheet.getRange(startRow, 1, rowsToAppend.length, 10).setValues(rowsToAppend);
    }

    // Nếu không phải Khách Nợ -> cộng tiền Ví/Thẻ và ghi nhận vào Business Sheet
    if (!isKhachNo && totalSalesAmt > 0) {
      let bSheet = ss.getSheetByName(SHEET_BUSINESS) || ss.getSheetByName("KinhDoanh");
      if (!bSheet) {
        bSheet = ss.insertSheet(SHEET_BUSINESS);
        bSheet.appendRow(["ID", "Ngày", "Loại", "Số Tiền", "Nguồn tiền", "Nội Dung / Diễn Giải"]);
      }
      bSheet.appendRow([
        newId,
        dateVal,
        "Thu",
        totalSalesAmt,
        nhanTienVao,
        `Bán hàng (${items.length} SP)`
      ]);

      if (typeof updateWalletBalanceHelper === 'function' && nhanTienVao) {
        updateWalletBalanceHelper(nhanTienVao, totalSalesAmt);
      }
    }

    // Nếu Khách Nợ -> Sinh công nợ bên Sheet Debt
    if (isKhachNo && totalSalesAmt > 0) {
      let debtSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
      if (debtSheet) {
        const debtId = "CN" + Date.now().toString().slice(-6);
        debtSheet.appendRow([
          debtId,
          dateVal,
          "Khách Bán Hàng",
          "THU",
          `Tiền bán hàng: ${items.map(i => i.tenSP).join(", ")}`,
          totalSalesAmt,
          "Chờ Thu",
          0,
          "",
          totalSalesAmt,
          "DANG_NO"
        ]);
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, message: "✅ Đã xuất bán đơn hàng thành công!" };
  } catch (err) {
    return { success: false, message: "❌ Lỗi khi xuất bán: " + err.toString() };
  }
}
