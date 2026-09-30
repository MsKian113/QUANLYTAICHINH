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
  if (!val) {
    const d = new Date();
    return typeof Utilities !== 'undefined' && Utilities.formatDate ? Utilities.formatDate(d, "Asia/Tokyo", "dd/MM/yyyy") : String(d.getDate()).padStart(2, '0') + "/" + String(d.getMonth() + 1).padStart(2, '0') + "/" + d.getFullYear();
  }
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    return typeof Utilities !== 'undefined' && Utilities.formatDate ? Utilities.formatDate(val, "Asia/Tokyo", "dd/MM/yyyy") : String(val.getDate()).padStart(2, '0') + "/" + String(val.getMonth() + 1).padStart(2, '0') + "/" + val.getFullYear();
  }
  const str = String(val).trim();
  if (!str) return "";

  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) {
    const parts = str.split(' ')[0].split('/');
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    let y = parts[2];
    if (y.length === 2) y = "20" + y;
    return `${d}/${m}/${y}`;
  }

  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
    const parts = str.split(' ')[0].split('-');
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${d}/${m}/${y}`;
  }

  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return typeof Utilities !== 'undefined' && Utilities.formatDate ? Utilities.formatDate(d, "Asia/Tokyo", "dd/MM/yyyy") : String(d.getDate()).padStart(2, '0') + "/" + String(d.getMonth() + 1).padStart(2, '0') + "/" + d.getFullYear();
    }
  } catch(e) {}

  return str;
}

/**
 * 1. LẤY DỮ LIỆU KINH DOANH, KHO HÀNG & DANH SÁCH KHO TỪ CATEGORIES CỘT H
 */
function getBusinessData(month, year, ssTarget, forceRefresh) {
  const cacheKey = "biz_data_" + String(month || "ALL") + "_" + String(year || "ALL");
  if (!forceRefresh && typeof CacheService !== 'undefined' && CacheService.getScriptCache && !ssTarget) {
    const cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch(e) {}
    }
  }

  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    
    let warehouses = ["Chờ Ship", "Kho Nhật (Kho 1)", "Kho VN (Kho 2)"];
    let products = [];
    let finalProductsList = [];
    let suppliers = [];      // Đối tác / Khách hàng từ DanhMuc
    let purchasePlaces = []; // Nơi mua từ lịch sử Purchase sheet
    let sources = [];
    let preOrders = [];
    let debtSales = [];
    let inventory = [];
    let groupedInventory = [];

    let totalSales = 0;
    let totalCogs = 0;
    let totalStockValue = 0;

    const isAllMonth = (!month || month === "ALL" || String(month).toUpperCase() === "ALL");
    const isAllYear = (!year || year === "ALL" || String(year).toUpperCase() === "ALL");
    const targetMonth = isAllMonth ? null : parseInt(month, 10);
    const targetYear = isAllYear ? null : parseInt(year, 10);

    const parseServerDate = (val) => {
      if (!val) return null;
      if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
      const str = String(val).trim();
      if (!str) return null;
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) {
        const p = str.split(' ')[0].split('/');
        let yr = parseInt(p[2], 10);
        if (yr < 100) yr += 2000;
        return new Date(yr, parseInt(p[1], 10) - 1, parseInt(p[0], 10));
      }
      if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
        const p = str.split(' ')[0].split('-');
        return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
      }
      const d = new Date(str);
      return isNaN(d.getTime()) ? null : d;
    };

    if (ss) {
      // 1. Load kho từ Sheet Categories (Cột F: Danh sách Kho) và Khách / Đối tác từ Cột A
      const catSheet = ss.getSheetByName(SHEET_CATEGORIES_T3) || ss.getSheetByName("DanhMuc");
      if (catSheet && catSheet.getLastRow() >= 2) {
        const lastRow = catSheet.getLastRow();
        const lastCol = Math.max(catSheet.getLastColumn(), 6);
        const catData = catSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
        const customWh = [];
        catData.forEach(r => {
          // Kho từ Cột F (Column 6, index 5) hoặc fallback Cột H (index 7)
          const whName = String(r[5] || r[7] || "").trim();
          if (whName && !["Kho", "Trạng Thái Kho", "Danh sách Kho"].includes(whName) && !customWh.includes(whName)) {
            customWh.push(whName);
          }

          // Đối tác / Khách hàng từ Cột A (Column 1, index 0) — dùng cho mượn thẻ
          const suppName = String(r[0] || r[2] || "").trim();
          if (suppName && !["Nơi mua", "Nơi Mua", "Ví", "Ví/Thẻ", "Danh sách Khách / Đối tác", "Khách / Đối tác"].includes(suppName) && !suppliers.includes(suppName)) {
            suppliers.push(suppName);
          }
        });
        if (customWh.length > 0) warehouses = customWh;
      }

      // 2. Load Purchase Sheet & Extract UNIQUE product names from Column E
      const pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
      if (pSheet && pSheet.getLastRow() >= 2) {
        const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 10).getValues();
        pData.forEach((r, index) => {
          const rowIndex = index + 2;
          const rawId = String(r[0] || "").trim();
          const id = rawId || String(rowIndex);
          const ngayMua = formatBizDateServer(r[1]);
          try {
            if (typeof r[1] === 'string' && /^\d{4}-\d{1,2}-\d{1,2}/.test(r[1].trim())) {
              pSheet.getRange(rowIndex, 2).setValue(ngayMua);
            }
          } catch(e) {}
          const noiMua = String(r[2] || "").trim();
          const trangThaiKho = String(r[3] || "").trim();
          const tenSP = String(r[4] || "").trim(); // Column E (index 4)
          if (!tenSP || tenSP === "Tên Sản Phẩm") return; // Bỏ qua hàng trống / tiêu đề
          const qty = parseBizMoney(r[5]);
          const price = parseBizMoney(r[6]);
          const total = parseBizMoney(r[7]) || (qty * price);
          const nguonTien = String(r[8] || "").trim();
          const ghiChu = String(r[9] || "").trim();

          // purchasePlaces: chỉ lấy từ lịch sử mua hàng thực tế
          if (noiMua && !purchasePlaces.includes(noiMua)) purchasePlaces.push(noiMua);
          // Lấy Tên Sản Phẩm duy nhất từ Cột E
          if (!products.includes(tenSP)) {
            products.push(tenSP);
          }
          if (nguonTien && !sources.includes(nguonTien)) sources.push(nguonTien);

          const dP = parseServerDate(r[1]);
          const mP = dP ? (dP.getMonth() + 1) : null;
          const yP = dP ? dP.getFullYear() : null;
          const matchMonthP = isAllMonth || !mP || mP === targetMonth;
          const matchYearP = isAllYear || !yP || yP === targetYear;

          if (matchMonthP && matchYearP) {
            // Phân loại Pre-order (chờ trừ thẻ / mượn tiền)
            if (ghiChu.toLowerCase().includes("pre-order") || ghiChu.toLowerCase().includes("chờ trừ thẻ")) {
              preOrders.push({
                id, ngayMua, noiMua, trangThaiKho, tenSP, qty, price, total, nguonTien, ghiChu
              });
            }

            inventory.push({
              id, ngayMua, noiMua, trangThaiKho, tenSP, qty, price, total, nguonTien
            });
          }
        });
      }

      // 3. Load Sales Sheet & Track Sales per Product / Warehouse / Channel
      const soldQtyMap = {};
      const soldWhMap = {};
      const soldValueMap = {};
      const soldPlacesMap = {};

      const sSheet = ss.getSheetByName(SHEET_SALES) || ss.getSheetByName("BanHang");
      if (sSheet && sSheet.getLastRow() >= 2) {
        const sData = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, 10).getValues();
        sData.forEach((r, rIdx) => {
          const id = String(r[0] || "").trim();
          if (!id) return;
          const ngayBan = formatBizDateServer(r[1]);
          try {
            if (typeof r[1] === 'string' && /^\d{4}-\d{1,2}-\d{1,2}/.test(r[1].trim())) {
              sSheet.getRange(rIdx + 2, 2).setValue(ngayBan);
            }
          } catch(e) {}
          const tenSP = String(r[2] || "").trim();
          const noiTru = String(r[3] || "").trim();
          const qty = parseBizMoney(r[4]);
          const price = parseBizMoney(r[5]);
          const total = parseBizMoney(r[6]) || (qty * price);
          const tonKho = parseBizMoney(r[7]);
          const nhanTien = String(r[8] || "").trim();
          const ghiChu = String(r[9] || "").trim();

          const dS = parseServerDate(r[1]);
          const mS = dS ? (dS.getMonth() + 1) : null;
          const yS = dS ? dS.getFullYear() : null;
          const matchMonthS = isAllMonth || !mS || mS === targetMonth;
          const matchYearS = isAllYear || !yS || yS === targetYear;

          if (matchMonthS && matchYearS) {
            totalSales += total;

            if (tenSP) {
              const cleanSP = tenSP.toLowerCase();
              soldQtyMap[cleanSP] = (soldQtyMap[cleanSP] || 0) + qty;
              soldValueMap[cleanSP] = (soldValueMap[cleanSP] || 0) + total;

              if (noiTru) {
                const keyWh = cleanSP + "___" + noiTru.toLowerCase();
                soldWhMap[keyWh] = (soldWhMap[keyWh] || 0) + qty;
              }

              if (nhanTien) {
                if (!soldPlacesMap[cleanSP]) soldPlacesMap[cleanSP] = [];
                if (!soldPlacesMap[cleanSP].includes(nhanTien)) {
                  soldPlacesMap[cleanSP].push(nhanTien);
                }
              }
            }

            if (nhanTien.toLowerCase().includes("nợ") || ghiChu.toLowerCase().includes("khách nợ")) {
              debtSales.push({
                id, ngayBan, tenSP, noiTru, qty, price, total, nhanTien, ghiChu
              });
            }
          }
        });
      }

      // 4. Load Business Sheet (TỔNG HỢP THU CHI BIZ)
      const bSheet = ss.getSheetByName(SHEET_BUSINESS) || ss.getSheetByName("KinhDoanh");
      if (bSheet && bSheet.getLastRow() >= 2) {
        const bData = bSheet.getRange(2, 1, bSheet.getLastRow() - 1, 6).getValues();
        bData.forEach(r => {
          const dB = parseServerDate(r[1]);
          const mB = dB ? (dB.getMonth() + 1) : null;
          const yB = dB ? dB.getFullYear() : null;
          const matchMonthB = isAllMonth || !mB || mB === targetMonth;
          const matchYearB = isAllYear || !yB || yB === targetYear;

          if (matchMonthB && matchYearB) {
            const loai = String(r[2] || "").trim().toUpperCase();
            const amt = parseBizMoney(r[3]);
            if (loai === "CHI") totalCogs += amt;
          }
        });
      }

      // Compute Grouped Inventory Stock by Product+Warehouse
      // Same product name + same warehouse = 1 row; different warehouse = separate row
      const groupedMap = {};
      inventory.forEach(item => {
        const key = item.tenSP;
        if (!key) return;
        const wh = item.trangThaiKho || "Chờ Ship";
        const cleanKey = key.toLowerCase() + "___" + wh.toLowerCase();

        if (!groupedMap[cleanKey]) {
          groupedMap[cleanKey] = {
            tenSP: key,
            warehouse: wh,
            purchasedQty: 0,
            purchasedValue: 0,
            purchasePlaces: []
          };
        }
        groupedMap[cleanKey].purchasedQty += item.qty;
        groupedMap[cleanKey].purchasedValue += item.total;
        if (item.noiMua && !groupedMap[cleanKey].purchasePlaces.includes(item.noiMua)) {
          groupedMap[cleanKey].purchasePlaces.push(item.noiMua);
        }
      });

      totalStockValue = 0;
      groupedInventory = Object.keys(groupedMap).map(cleanKey => {
        const g = groupedMap[cleanKey];
        const spLower = g.tenSP.toLowerCase();
        const whLower = g.warehouse.toLowerCase();
        const soldKey = spLower + "___" + whLower;
        const totalSold = soldWhMap[soldKey] || soldQtyMap[spLower] || 0;
        const totalSoldVal = soldValueMap[spLower] || 0;
        const remainingStock = Math.max(0, g.purchasedQty - totalSold);
        const avgPrice = g.purchasedQty > 0 ? Math.round(g.purchasedValue / g.purchasedQty) : 0;
        const avgSellPrice = totalSold > 0 ? Math.round(totalSoldVal / totalSold) : 0;
        const stockVal = remainingStock * avgPrice;
        totalStockValue += stockVal;

        return {
          tenSP: g.tenSP,
          warehouse: g.warehouse,
          totalQty: remainingStock,
          totalValue: stockVal,
          avgPrice: avgPrice,
          avgSellPrice: avgSellPrice,
          purchasePlaces: g.purchasePlaces || []
        };
      }).filter(g => g.totalQty > 0);

      // Suggestion product list: ONLY products that currently have remaining stock > 0
      const inStockProductsList = groupedInventory.map(g => ({ tenSP: g.tenSP, qty: g.totalQty }));

      // If no remaining stock items yet, fallback to all products for display
      finalProductsList = inStockProductsList.length > 0 ? inStockProductsList : products.map(p => ({ tenSP: p, qty: 0 }));
    }

    const parseBizDateSort = (val) => {
      if (!val) return 0;
      if (val instanceof Date) return isNaN(val.getTime()) ? 0 : val.getTime();
      const str = String(val).trim();
      if (!str) return 0;
      if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
        const p = str.split(' ')[0].split('-');
        return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)).getTime() || 0;
      }
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) {
        const p = str.split(' ')[0].split('/');
        let y = parseInt(p[2], 10);
        if (y < 100) y += 2000;
        return new Date(y, parseInt(p[1], 10) - 1, parseInt(p[0], 10)).getTime() || 0;
      }
      const d = new Date(str);
      return isNaN(d.getTime()) ? 0 : d.getTime();
    };

    preOrders.sort((a, b) => parseBizDateSort(b.ngayMua) - parseBizDateSort(a.ngayMua));
    debtSales.sort((a, b) => parseBizDateSort(b.ngayBan) - parseBizDateSort(a.ngayBan));
    inventory.sort((a, b) => parseBizDateSort(b.ngayMua) - parseBizDateSort(a.ngayMua));

    const netProfit = totalSales - totalCogs;

    const result = {
      success: true,
      summary: {
        net: netProfit,
        sales: totalSales,
        cogs: totalCogs,
        stockValue: totalStockValue
      },
      warehouses: warehouses,
      products: finalProductsList,
      allProducts: products,
      suppliers: suppliers,
      purchasePlaces: purchasePlaces,
      sources: sources,
      preOrders: preOrders,
      debtSales: debtSales,
      inventory: inventory,
      groupedInventory: groupedInventory || []
    };

    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache && !ssTarget) {
      try {
        CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 300);
      } catch(e) {}
    }

    return result;
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
    const dateVal = formatBizDateServer(formData.ngay);
    const noiMua = String(formData.noiMua || "").trim();
    const trangThaiKho = String(formData.trangThaiKho || "Chờ Ship").trim();
    const items = formData.items || [];
    const nguonTien = String(formData.nguonTien || "").trim();
    const isPreOrder = Boolean(formData.isPreOrder);
    const isMuonThe = Boolean(formData.isMuonThe);
    const doiTacMuon = String(formData.doiTacMuon || "").trim();
    const ghiChuOrder = String(formData.ghiChuOrder || "").trim(); // Ghi chú tùy chọn → Cột K

    let totalPurchaseAmt = 0;
    const rowsToAppend = [];

    items.forEach((it, idx) => {
      const tenSP = String(it.tenSP || "").trim();
      if (!tenSP) return;
      const qty = Number(it.qty) || 1;
      const price = Number(it.price) || 0;
      const itemTotal = qty * price;
      totalPurchaseAmt += itemTotal;

      const itemId = items.length > 1 ? `${newId}-${idx + 1}` : newId;

      let ghiChu = "";
      if (isPreOrder) ghiChu += "[Pre-order/Chờ trừ thẻ] ";
      if (isMuonThe) ghiChu += `[Mượn thẻ đối tác: ${doiTacMuon}] `;
      if (it.ghiChu) ghiChu += it.ghiChu;

      rowsToAppend.push([
        itemId,
        dateVal,
        noiMua,
        trangThaiKho,
        tenSP,
        qty,
        price,
        itemTotal,
        nguonTien,
        ghiChu.trim(),
        ghiChuOrder   // Cột K — Ghi chú đặt hàng
      ]);
    });

    if (rowsToAppend.length > 0) {
      // Đảm bảo header có đủ 11 cột
      if (pSheet.getLastRow() === 1) {
        const headerRow = pSheet.getRange(1, 1, 1, 11).getValues()[0];
        if (!headerRow[10]) {
          pSheet.getRange(1, 11).setValue("Ghi Chú Đặt Hàng");
        }
      }
      const startRow = pSheet.getLastRow() + 1;
      pSheet.getRange(startRow, 1, rowsToAppend.length, 11).setValues(rowsToAppend);
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
    const freshData = getBusinessData(null, null, ss);
    return { success: true, message: "✅ Đã lưu đơn nhập mua hàng thành công!", freshData: freshData };
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
    const dateVal = formatBizDateServer(formData.ngay);
    const items = formData.items || [];
    const nhanTienVao = String(formData.nhanTienVao || "").trim();
    const isKhachNo = Boolean(formData.isKhachNo);

    let totalSalesAmt = 0;
    const rowsToAppend = [];

    items.forEach((it, idx) => {
      const tenSP = String(it.tenSP || "").trim();
      if (!tenSP) return;
      const qty = Number(it.qty) || 1;
      const price = Number(it.price) || 0;
      const itemTotal = qty * price;
      totalSalesAmt += itemTotal;
      const noiTru = String(it.noiTru || "Kho Nhật").trim();

      let ghiChu = isKhachNo ? "[Khách Nợ]" : "";
      if (it.ghiChu) ghiChu += " " + it.ghiChu;

      const itemId = items.length > 1 ? `${newId}-${idx + 1}` : newId;

      rowsToAppend.push([
        itemId,
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

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return { success: true, message: "✅ Đã xuất bán đơn hàng thành công!", freshData: freshData };
  } catch (err) {
    return { success: false, message: "❌ Lỗi khi xuất bán: " + err.toString() };
  }
}

/**
 * 4. BÁO TRỪ THỂ THỰC TẾ CHO ĐƠN PRE-ORDER (BATCH UPDATE)
 */
function confirmBatchPreOrdersPayment(itemIds) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet MuaHang." };

    const idArray = Array.isArray(itemIds) ? itemIds : [itemIds];
    if (idArray.length === 0) return { success: false, message: "❌ Chưa chọn đơn hàng pre-order nào." };

    const idSet = new Set(idArray.map(id => String(id).trim()));
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 10).getValues();

    let totalAmt = 0;
    const itemsMapByWallet = {};
    let hasChanges = false;
    let dateVal = formatBizDateServer(new Date());

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndexStr = String(i + 2);
      if (idSet.has(rowId) || idSet.has(rowIndexStr)) {
        let ghiChu = String(data[i][9] || "").trim();
        ghiChu = ghiChu.replace(/\[Pre-order\/Chờ trừ thẻ\]/gi, '').replace(/\[Pre-order\]/gi, '').trim();
        data[i][9] = ghiChu;

        const qty = parseBizMoney(data[i][5]);
        const price = parseBizMoney(data[i][6]);
        const itemTotal = parseBizMoney(data[i][7]) || (qty * price);
        totalAmt += itemTotal;

        const nguonTien = String(data[i][8] || "").trim() || "Thẻ";
        itemsMapByWallet[nguonTien] = (itemsMapByWallet[nguonTien] || 0) + itemTotal;
        if (data[i][1]) dateVal = formatBizDateServer(data[i][1]);
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      return { success: false, message: "❌ Không tìm thấy đơn hàng pre-order nào để xác nhận trừ thẻ." };
    }

    pSheet.getRange(2, 1, data.length, 10).setValues(data);

    if (totalAmt > 0) {
      let bSheet = ss.getSheetByName(SHEET_BUSINESS) || ss.getSheetByName("KinhDoanh");
      if (!bSheet) {
        bSheet = ss.insertSheet(SHEET_BUSINESS);
        bSheet.appendRow(["ID", "Ngày", "Loại", "Số Tiền", "Nguồn tiền", "Nội Dung / Diễn Giải"]);
      }

      Object.keys(itemsMapByWallet).forEach((w, idx) => {
        const amt = itemsMapByWallet[w];
        const bId = "PO_CONF_" + Date.now().toString().slice(-4) + (idx + 1);
        bSheet.appendRow([
          bId,
          dateVal,
          "Chi",
          amt,
          w,
          `Trừ thẻ thực tế pre-order (${idSet.size} đơn)`
        ]);

        if (typeof updateWalletBalanceHelper === 'function' && w) {
          updateWalletBalanceHelper(w, -amt);
        }
      });
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return { success: true, message: `✅ Đã xác nhận trừ thẻ thực tế ${totalAmt.toLocaleString()} ¥ cho ${idSet.size} đơn pre-order!`, freshData: freshData };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

function confirmPreOrderPayment(targetId) {
  return confirmBatchPreOrdersPayment([targetId]);
}

/**
 * BÁO THU TIỀN CHO CÁC ĐƠN KHÁCH NỢ (SALES) - BATCH UPDATE TỐI ƯU TỐC ĐỘ
 */
function confirmBatchDebtSalesPayment(itemIds, walletName) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const sSheet = ss.getSheetByName(SHEET_SALES) || ss.getSheetByName("BanHang");
    if (!sSheet || sSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet BanHang." };

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return { success: false, message: "❌ Chưa chọn đơn hàng nào." };
    }

    const wallet = String(walletName || "Ví Tiền Mặt").trim();
    const idSet = new Set(itemIds.map(id => String(id).trim()));

    const data = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, 10).getValues();
    let totalCollected = 0;
    const collectedItems = [];
    let hasChanges = false;

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      if (idSet.has(rowId)) {
        // Cập nhật Cột I (Column 9, index 8) sang Tên Ví nhận tiền
        data[i][8] = wallet;
        
        let ghiChu = String(data[i][9] || "").trim();
        ghiChu = (ghiChu.replace(/\[Khách Nợ\]/gi, '').trim() + " [Đã thu tiền]").trim();
        data[i][9] = ghiChu;

        const qty = parseBizMoney(data[i][4]);
        const price = parseBizMoney(data[i][5]);
        const total = parseBizMoney(data[i][6]) || (qty * price);
        totalCollected += total;
        if (data[i][2]) collectedItems.push(String(data[i][2]).trim());
        hasChanges = true;
      }
    }

    if (hasChanges) {
      // Ghi hàng loạt vào Google Sheets chỉ với 1 call duy nhất -> siêu nhanh!
      sSheet.getRange(2, 1, data.length, 10).setValues(data);
    }

    if (collectedItems.length > 0 && totalCollected > 0) {
      let bSheet = ss.getSheetByName(SHEET_BUSINESS) || ss.getSheetByName("KinhDoanh");
      if (!bSheet) {
        bSheet = ss.insertSheet(SHEET_BUSINESS);
        bSheet.appendRow(["ID", "Ngày", "Loại", "Số Tiền", "Nguồn tiền", "Nội Dung / Diễn Giải"]);
      }
      const bId = "SO_PAY_" + Date.now().toString().slice(-6);
      const dateVal = formatBizDateServer(new Date());
      bSheet.appendRow([
        bId,
        dateVal,
        "Thu",
        totalCollected,
        wallet,
        `Thu tiền đơn khách nợ (${collectedItems.length} SP)`
      ]);

      if (typeof updateWalletBalanceHelper === 'function' && wallet) {
        updateWalletBalanceHelper(wallet, totalCollected);
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return { 
      success: true, 
      message: `✅ Đã ghi nhận thu ${totalCollected.toLocaleString()} ¥ từ ${collectedItems.length} đơn hàng vào ${wallet}!`,
      freshData: freshData
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi thu tiền đơn khách nợ: " + err.toString() };
  }
}

/**
 * 4.2. HỦY ĐƠN PRE-ORDER
 */
function cancelBatchPreOrders(itemIds) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet MuaHang." };

    const idArray = Array.isArray(itemIds) ? itemIds : [itemIds];
    if (idArray.length === 0) return { success: false, message: "❌ Chưa chọn đơn hàng pre-order nào." };

    const idSet = new Set(idArray.map(id => String(id).trim()));
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 10).getValues();

    const remainingRows = [];
    let deletedCount = 0;

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndexStr = String(i + 2);
      if (idSet.has(rowId) || idSet.has(rowIndexStr)) {
        deletedCount++;
      } else {
        remainingRows.push(data[i]);
      }
    }

    if (deletedCount > 0) {
      pSheet.clearContents();
      pSheet.appendRow(["ID", "Ngày Mua", "Nơi mua", "Trạng Thái Kho", "Tên Sản Phẩm", "Số Lượng", "Giá Mua (1 cái)", "Tổng Tiền", "Nguồn Tiền Mua", "Ghi Chú"]);
      if (remainingRows.length > 0) {
        pSheet.getRange(2, 1, remainingRows.length, 10).setValues(remainingRows);
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return { success: true, message: `✅ Đã hủy ${deletedCount} đơn hàng pre-order!`, freshData: freshData };
  } catch (err) {
    return { success: false, message: "❌ Lỗi hủy đơn pre-order: " + err.toString() };
  }
}

function cancelPreOrderOrder(targetId) {
  return cancelBatchPreOrders([targetId]);
}


/**
 * 5. CẬP NHẬT TRẠNG THÁI KHO CHO SẢN PHẨM INVENTORY
 */
function updateWarehouseStatus(targetId, newStatus) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet MuaHang." };

    const targetStr = String(targetId || "").trim();
    const isCancel = (newStatus === 'CANCEL' || newStatus === 'BỊ HỦY');
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 10).getValues();

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndexStr = String(i + 2);
      if ((rowId && rowId === targetStr) || rowIndexStr === targetStr) {
        const currentWh = String(data[i][3] || "").trim();
        if (isCancel && currentWh !== "Chờ Ship") {
          return { success: false, message: "❌ Chỉ đơn hàng ở trạng thái 'Chờ Ship' mới được Hủy!" };
        }
        const rowIndex = i + 2;
        pSheet.getRange(rowIndex, 4).setValue(newStatus); // Column D (Trạng Thái Kho)
        break;
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, message: `✅ Đã chuyển trạng thái kho sang ${newStatus}` };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

/**
 * 5.2. CHUYỂN KHO THÔNG MINH THEO SẢN PHẨM & KHO NGUỒN
 */
function transferWarehouseBatch(spName, fromWarehouse, toWarehouse) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet MuaHang." };

    const spTarget = String(spName || "").trim();
    const fromWh = String(fromWarehouse || "").trim();
    const toWh = String(toWarehouse || "").trim();

    if (!spTarget || !toWh) return { success: false, message: "❌ Vui lòng chọn sản phẩm và kho đích hợp lệ!" };

    const isCancel = (toWh === 'CANCEL' || toWh === 'BỊ HỦY');
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 10).getValues();

    if (isCancel) {
      for (let i = 0; i < data.length; i++) {
        const rowSp = String(data[i][4] || "").trim();
        const rowWh = String(data[i][3] || "").trim();
        if (rowSp === spTarget && (!fromWh || fromWh === 'ALL' || rowWh === fromWh)) {
          if (rowWh !== 'Chờ Ship') {
            return { success: false, message: "❌ Chỉ đơn hàng ở trạng thái 'Chờ Ship' mới được Hủy!" };
          }
        }
      }
    }

    let updatedCount = 0;
    for (let i = 0; i < data.length; i++) {
      const rowSp = String(data[i][4] || "").trim();
      const rowWh = String(data[i][3] || "").trim();
      if (rowSp === spTarget && (!fromWh || fromWh === 'ALL' || rowWh === fromWh)) {
        const rowIndex = i + 2;
        pSheet.getRange(rowIndex, 4).setValue(toWh);
        updatedCount++;
      }
    }

    if (updatedCount === 0) {
      return { success: false, message: "❌ Không tìm thấy sản phẩm phù hợp ở kho nguồn." };
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, message: `✅ Đã chuyển ${updatedCount} đơn hàng sản phẩm "${spTarget}" sang ${toWh}!` };
  } catch (err) {
    return { success: false, message: "❌ Lỗi chuyển kho: " + err.toString() };
  }
}

/**
 * 5.3. CẬP NHẬT TRẠNG THÁI KHO CHO NHIỀU ĐƠN HÀNG CÙNG LÚC
 */
function updateBatchWarehouseStatus(itemIds, newStatus) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet MuaHang." };

    const idsToUpdate = Array.isArray(itemIds) ? itemIds.map(id => String(id).trim()) : [String(itemIds).trim()];
    const newWh = String(newStatus || "").trim();
    if (idsToUpdate.length === 0 || !newWh) return { success: false, message: "❌ Thông tin chuyển kho không hợp lệ." };

    const isCancel = (newWh === 'CANCEL' || newWh === 'BỊ HỦY');
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 10).getValues();

    if (isCancel) {
      for (let i = 0; i < data.length; i++) {
        const rowId = String(data[i][0] || "").trim();
        const rowIndexStr = String(i + 2);
        if (idsToUpdate.includes(rowId) || idsToUpdate.includes(rowIndexStr)) {
          const currentWh = String(data[i][3] || "").trim();
          if (currentWh !== "Chờ Ship") {
            return { success: false, message: "❌ Chỉ đơn hàng ở trạng thái 'Chờ Ship' mới được Hủy!" };
          }
        }
      }
    }

    let updatedCount = 0;
    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndexStr = String(i + 2);
      if (idsToUpdate.includes(rowId) || idsToUpdate.includes(rowIndexStr)) {
        const rowIndex = i + 2;
        pSheet.getRange(rowIndex, 4).setValue(newWh);
        updatedCount++;
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    const statusDisp = newWh === 'CANCEL' ? 'Hủy' : newWh;
    return { success: true, message: `✅ Đã chuyển ${updatedCount} đơn hàng sang "${statusDisp}"!`, freshData: freshData };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

/**
 * 6. CẬP NHẬT CHI TIẾT ĐƠN HÀNG MUA (SỬA KHO, SỐ LƯỢNG, GIÁ, GHI CHÚ)
 */
function updatePurchaseItemDetail(itemId, newWh, newQty, newPrice, newGhiChu) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet MuaHang." };

    const targetStr = String(itemId || "").trim();
    if (!targetStr) return { success: false, message: "❌ Mã đơn không hợp lệ." };

    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 10).getValues();
    let found = false;

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndexStr = String(i + 2);
      if ((rowId && rowId === targetStr) || rowIndexStr === targetStr) {
        const rowIndex = i + 2;
        if (newWh !== undefined) pSheet.getRange(rowIndex, 4).setValue(String(newWh).trim());
        if (newQty !== undefined && !isNaN(Number(newQty))) {
          const qtyVal = Number(newQty);
          pSheet.getRange(rowIndex, 6).setValue(qtyVal);
          const priceVal = (newPrice !== undefined && !isNaN(Number(newPrice))) ? Number(newPrice) : parseBizMoney(data[i][6]);
          pSheet.getRange(rowIndex, 8).setValue(qtyVal * priceVal);
        }
        if (newPrice !== undefined && !isNaN(Number(newPrice))) {
          const priceVal = Number(newPrice);
          pSheet.getRange(rowIndex, 7).setValue(priceVal);
          const qtyVal = (newQty !== undefined && !isNaN(Number(newQty))) ? Number(newQty) : parseBizMoney(data[i][5]);
          pSheet.getRange(rowIndex, 8).setValue(qtyVal * priceVal);
        }
        if (newGhiChu !== undefined) pSheet.getRange(rowIndex, 10).setValue(String(newGhiChu).trim());
        found = true;
        break;
      }
    }

    if (!found) return { success: false, message: "❌ Không tìm thấy đơn hàng cần sửa." };

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, message: "✅ Đã cập nhật chi tiết đơn hàng thành công!" };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}
