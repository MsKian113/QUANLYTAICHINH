// ==========================================
// FILE: Server_Tab3.js
// NHIỆM VỤ: Backend Logic cho Tab 3 (Kinh Doanh & QL Kho)
// Schemas:
// - Sheet Business: A: ID | B: Ngày | C: Loại | D: Số Tiền | E: Nguồn tiền | F: Nội Dung / Diễn Giải | G: ID liên kết
// - Sheet Purchase: A: ID | B: Ngày Mua | C: Nơi mua | D: Trạng Thái Kho | E: Tên Sản Phẩm | F: Số Lượng | G: Giá Mua (1 cái) | H: Tổng Tiền | I: Nguồn Tiền Mua | J: Trạng thái thẻ | K: Ghi Chú | L: Tồn kho | M: Ngày sao kê
// - Sheet Sales:    A: ID | B: Ngày Bán | C: Tên Sản Phẩm | D: Nơi Trừ Kho | E: Số Lượng Xuất | F: Giá Bán (1 cái) | G: Tổng Tiền Bán | H: Tồn kho | I: Nhận Tiền Vào | J: Ghi Chú
// ==========================================

const SHEET_BUSINESS = "Business";
const SHEET_PURCHASE = "Purchase";
const SHEET_SALES = "Sales";
const SHEET_CATEGORIES_T3 = "Categories";
const SHEET_STOCK_TRANSFER = "STOCK_TRANSFER";

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

if (typeof parseMoneyNumber === 'undefined') {
  var parseMoneyNumber = parseBizMoney;
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
function getBusinessData(month, year, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    
    let warehouses = ["Chờ Ship"];
    let products = [];
    let finalProductsList = [];
    let suppliers = [];
    let purchasePlaces = [];
    let sources = [];
    let preOrders = [];
    let cancelledRefundPending = [];
    let debtSales = [];
    let inventory = [];
    let groupedInventory = [];
    let allSales = [];

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

    let accountsList = ["Joshin KA", "Joshin Chi", "Joshin Giao", "Edion Ka", "Edion Chi", "Yodo KA", "Yodo Chi", "Yodo Chít", "Yodo 602", "Yodo 303", "Yodo Trinh", "Yodo Giao"];

    if (ss) {
      // 1. Categories
      const catSheet = ss.getSheetByName(SHEET_CATEGORIES_T3) || ss.getSheetByName("DanhMuc");
      if (catSheet && catSheet.getLastRow() >= 2) {
        const lastRow = catSheet.getLastRow();
        const lastCol = Math.max(catSheet.getLastColumn(), 11);
        const catData = catSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
        const customWh = [];
        const customAccounts = [];
        catData.forEach(r => {
          const whName = String(r[5] || "").trim();
          const ignoredWhHeaders = ["Kho", "Trạng Thái Kho", "Danh sách Kho", "Tên Kho", "KHO", "Danh sách kho", "Trạng thái kho"];
          if (whName && !ignoredWhHeaders.includes(whName) && !customWh.includes(whName)) {
            customWh.push(whName);
          }

          const suppName = String(r[0] || r[2] || "").trim();
          if (suppName && !["Nơi mua", "Nơi Mua", "Ví", "Ví/Thẻ", "Danh sách Khách / Đối tác", "Khách / Đối tác"].includes(suppName) && !suppliers.includes(suppName)) {
            suppliers.push(suppName);
          }

          const accG = String(r[6] || "").trim();
          const ignoredAccHeaders = ["Tài khoản mua", "Tài khoản", "Tài khoản đặt hàng", "TK Mua", "Danh sách Tài khoản", "Tài Khoản Đặt Hàng", "Tài Khoản", "Danh sách tài khoản"];
          if (accG && !ignoredAccHeaders.includes(accG) && !customAccounts.includes(accG)) {
            customAccounts.push(accG);
          }
        });
        if (customWh.length > 0) {
          warehouses = customWh;
        }
        if (customAccounts.length > 0) accountsList = customAccounts;
      }

      // Wallets / Sources strictly loaded from Column B of Wallets sheet
      const creditMap = new Map();
      const walletSheet = ss.getSheetByName("Wallets") || ss.getSheetByName("ViThe") || ss.getSheetByName("Ví");
      if (walletSheet && walletSheet.getLastRow() >= 2) {
        const wData = walletSheet.getRange(2, 1, walletSheet.getLastRow() - 1, 3).getValues();
        wData.forEach(r => {
          let wName = String(r[1] || "").trim();
          let type = String(r[2] || "").trim().toUpperCase();
          const ignoredHeaders = ["Tên Ví", "Tên Ví / Thẻ", "Tên ví", "ID", "Tên Ví/Thẻ Giao Dịch", "Tên Ví / Thẻ Giao Dịch"];
          if (wName && !ignoredHeaders.includes(wName)) {
            if (!sources.includes(wName)) sources.push(wName);
            creditMap.set(wName.toLowerCase(), type === "CREDIT");
          }
        });
      }
      // sources populated strictly from Wallets sheet

      // 2. Load ALL-TIME Purchase Sheet
      const allTimePurchases = [];
      const pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
      if (pSheet && pSheet.getLastRow() >= 2) {
        const lastColP = Math.max(pSheet.getLastColumn(), 13);
        const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP).getValues();
        pData.forEach((r, index) => {
          const rowIndex = index + 2;
          const rawId = String(r[0] || "").trim();
          const id = rawId || String(rowIndex);
          const ngayMua = formatBizDateServer(r[1]);
          const noiMua = String(r[2] || "").trim();
          const trangThaiKho = String(r[3] || "").trim() || "Chờ Ship";
          const tenSP = String(r[4] || "").trim();
          if (!tenSP || tenSP === "Tên Sản Phẩm") return;
          const qty = parseBizMoney(r[5]);
          const price = parseBizMoney(r[6]);
          const total = parseBizMoney(r[7]) || (qty * price);
          const nguonTien = String(r[8] || "").trim();
          const trangThaiThe = String(r[9] || "").trim();
          const ghiChu = String(r[10] || "").trim();
          const rawTonKho = r[11];
          
          const lowerWh = trangThaiKho.toLowerCase();
          const lowerGhiChu = ghiChu.toLowerCase();
          const lowerCardStatus = trangThaiThe.toLowerCase();
          const isCancelled = lowerWh.includes("hủy") || lowerWh.includes("bị hủy") || lowerWh.includes("cancel");
          const isChoShipOrChusen = lowerWh.includes("chờ ship") || lowerWh.includes("chusen");
          const isPreOrder = lowerCardStatus.includes("pre-order") || lowerCardStatus.includes("preorder") || lowerGhiChu.includes("pre-order");

          let tonKho = 0;
          if (rawTonKho !== "" && rawTonKho !== null && rawTonKho !== undefined) {
            tonKho = parseBizMoney(rawTonKho);
          } else if (!isCancelled && !isChoShipOrChusen && !isPreOrder) {
            tonKho = qty;
          }
          const ngaySaoKe = String(r[12] || "").trim();
          const taiKhoan = String(r[13] || "").trim();

          if (noiMua && !purchasePlaces.includes(noiMua)) purchasePlaces.push(noiMua);
          if (!products.includes(tenSP)) products.push(tenSP);

          const pItem = { id, ngayMua, noiMua, trangThaiKho, tenSP, qty, price, total, nguonTien, trangThaiThe, ghiChu, tonKho, ngaySaoKe, taiKhoan };
          allTimePurchases.push(pItem);

          const isCreditCard = isCreditCardWallet(nguonTien, ss, creditMap);

          if (!isCreditCard && (lowerCardStatus.includes("pre-order") || lowerCardStatus.includes("preorder") || lowerCardStatus.includes("chờ_ship") || lowerCardStatus.includes("cho_ship"))) {
            pItem.trangThaiThe = "HOAN_TAT";
          }

          const isPreOrderMatch = !isCancelled && isCreditCard && (
            lowerCardStatus.includes("pre-order") ||
            lowerCardStatus.includes("preorder") ||
            lowerCardStatus.includes("pre_order") ||
            lowerCardStatus.includes("pre order") ||
            lowerCardStatus.includes("sao kê") ||
            lowerCardStatus.includes("chờ trừ") ||
            lowerGhiChu.includes("pre-order") ||
            lowerGhiChu.includes("preorder") ||
            lowerGhiChu.includes("pre order") ||
            lowerGhiChu.includes("chờ trừ thẻ") ||
            lowerGhiChu.includes("chờ sao kê") ||
            lowerGhiChu.includes("chờ trừ tiền") ||
            lowerGhiChu.includes("đặt trước") ||
            lowerWh.includes("pre-order") ||
            lowerWh.includes("chờ ship") ||
            lowerWh.includes("chusen")
          );

          const isPendingRefund = isCancelled && (
            lowerCardStatus === "cho_hoan_tien" ||
            lowerCardStatus.includes("cho_hoan") ||
            lowerCardStatus.includes("chờ hoàn") ||
            lowerCardStatus.includes("cần hoàn") ||
            lowerCardStatus.includes("refund") ||
            lowerWh.includes("hoàn") ||
            (isCreditCard && !lowerCardStatus.includes("hoan_tat") && !lowerCardStatus.includes("đã hoàn"))
          );
          if (isPendingRefund) {
            cancelledRefundPending.push(pItem);
          }

          if (isPreOrderMatch) {
            preOrders.push(pItem);
          }
          inventory.push(pItem);
        });
      }

      // 3. Load ALL-TIME Sales Sheet
      const salesByProductTotal = {};
      const salesByProductAndWh = {};
      allSales = [];

      const sSheet = ss.getSheetByName(SHEET_SALES) || ss.getSheetByName("BanHang");
      if (sSheet && sSheet.getLastRow() >= 2) {
        const lastColS = Math.max(sSheet.getLastColumn(), 11);
        const sData = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, lastColS).getValues();
        sData.forEach((r, rIdx) => {
          const rowIndex = rIdx + 2;
          const rawId = String(r[0] || "").trim();
          const id = rawId || String(rowIndex);
          const tenSP = String(r[2] || "").trim();
          if (!tenSP && !rawId) return;
          const ngayBan = formatBizDateServer(r[1]);
          const noiTru = String(r[3] || "").trim();
          const qty = parseBizMoney(r[4]);
          const price = parseBizMoney(r[5]);
          const total = parseBizMoney(r[6]) || (qty * price);
          const tonKho = parseBizMoney(r[7]);
          const nhanTien = String(r[8] || "").trim();
          const trangThai = String(r[9] || "").trim();
          const ghiChu = String(r[10] || r[9] || "").trim();

          if (tenSP) {
            const cleanSP = tenSP.toLowerCase();
            salesByProductTotal[cleanSP] = (salesByProductTotal[cleanSP] || 0) + qty;
            if (noiTru) {
              const keyWh = cleanSP + "___" + noiTru.toLowerCase();
              salesByProductAndWh[keyWh] = (salesByProductAndWh[keyWh] || 0) + qty;
            }
          }

          const sItem = { id, ngayBan, tenSP, noiTru, qty, price, total, tonKho, nhanTien, trangThai, ghiChu };
          allSales.push(sItem);

          const lowerNhan = nhanTien.toLowerCase();
          const lowerGhiChuS = ghiChu.toLowerCase();
          const isChoThu = trangThai === "CHO_THU" || (trangThai !== "HOAN_TAT" && (lowerNhan.includes("nợ") || lowerGhiChuS.includes("khách nợ")));
          if (isChoThu) {
            debtSales.push(sItem);
          }

          const dS = parseServerDate(r[1]);
          const mS = dS ? (dS.getMonth() + 1) : null;
          const yS = dS ? dS.getFullYear() : null;
          const matchMonthS = isAllMonth || !mS || mS === targetMonth;
          const matchYearS = isAllYear || !yS || yS === targetYear;

          if (matchMonthS && matchYearS) {
            totalSales += total;
          }
        });
      }

      // 4. Business Sheet
      const bSheet = ss.getSheetByName(SHEET_BUSINESS) || ss.getSheetByName("KinhDoanh");
      if (bSheet && bSheet.getLastRow() >= 2) {
        const bData = bSheet.getRange(2, 1, bSheet.getLastRow() - 1, Math.max(bSheet.getLastColumn(), 7)).getValues();
        bData.forEach(r => {
          const dB = parseServerDate(r[1]);
          const mB = dB ? (dB.getMonth() + 1) : null;
          const yB = dB ? dB.getFullYear() : null;
          const matchMonthB = isAllMonth || !mB || mB === targetMonth;
          const matchYearB = isAllYear || !yB || yB === targetYear;

          if (matchMonthB && matchYearB) {
            const loai = String(r[2] || "").trim().toUpperCase();
            const amt = parseBizMoney(r[3]);
            if (loai === "CHI" || loai === "MUA" || loai === "CHI TIÊU" || loai.includes("CHI")) totalCogs += amt;
          }
        });
      }

      // 5. GROUPED INVENTORY BASED DIRECTLY ON COLUMN L (TỒN KHO)
      const productPurchaseGroups = {}; // cleanSP -> { origName, warehouses: { cleanWh -> { origWh, remQty, value, places, itemIds } } }

      allTimePurchases.forEach(item => {
        const spName = item.tenSP;
        if (!spName) return;
        const cleanSP = spName.toLowerCase();
        const origWh = (item.trangThaiKho && String(item.trangThaiKho).trim()) ? String(item.trangThaiKho).trim() : "Chờ Ship";
        const cleanWh = origWh.toLowerCase();

        const lowerNoiMua = String(item.noiMua || "").toLowerCase();
        const lowerGhiChu = String(item.ghiChu || "").toLowerCase();
        const lowerTaiKhoan = String(item.taiKhoan || "").toLowerCase();

        // ONLY load products with Column L (Tồn kho) > 0 and in physical in-stock warehouse
        const remQty = Number(item.tonKho) || 0;
        if (remQty <= 0) return;

        // Skip "Chờ Ship", "Chusen", and cancelled items for Subtab 3 Tồn kho
        if (cleanWh.includes("chờ ship") || cleanWh.includes("chusen") || cleanWh.includes("hủy") || cleanWh.includes("bị hủy") || cleanWh.includes("cancel")) return;

        // Skip Pre-order items for Subtab 3 Tồn kho
        const lowerCardStatus = String(item.trangThaiThe || "").toLowerCase();
        const isPreOrder = lowerCardStatus.includes("pre-order") || lowerCardStatus.includes("preorder") || lowerCardStatus.includes("pre order") || lowerGhiChu.includes("pre-order") || lowerGhiChu.includes("preorder") || lowerGhiChu.includes("pre order");
        if (isPreOrder) return;

        if (!productPurchaseGroups[cleanSP]) {
          productPurchaseGroups[cleanSP] = { origName: spName, warehouses: {} };
        }
        if (!productPurchaseGroups[cleanSP].warehouses[cleanWh]) {
          productPurchaseGroups[cleanSP].warehouses[cleanWh] = {
            origWh: origWh,
            remQty: 0,
            value: 0,
            places: [],
            itemIds: []
          };
        }

        const whObj = productPurchaseGroups[cleanSP].warehouses[cleanWh];
        whObj.remQty += remQty;
        whObj.value += (remQty * item.price);
        if (item.id) whObj.itemIds.push(item.id);
        if (item.noiMua && !whObj.places.includes(item.noiMua)) whObj.places.push(item.noiMua);
      });

      groupedInventory = [];
      Object.keys(productPurchaseGroups).forEach(cleanSP => {
        const pObj = productPurchaseGroups[cleanSP];
        const whList = [];
        let totalQty = 0;
        let totalValue = 0;
        const allPlaces = [];
        const allItemIds = [];

        Object.keys(pObj.warehouses).forEach(cleanWh => {
          const whObj = pObj.warehouses[cleanWh];
          if (whObj.remQty > 0) {
            totalQty += whObj.remQty;
            totalValue += whObj.value;
            whList.push({
              name: whObj.origWh,
              qty: whObj.remQty
            });
            (whObj.places || []).forEach(p => {
              if (!allPlaces.includes(p)) allPlaces.push(p);
            });
            (whObj.itemIds || []).forEach(id => {
              if (!allItemIds.includes(id)) allItemIds.push(id);
            });
          }
        });

        if (totalQty > 0) {
          const avgPrice = Math.round(totalValue / totalQty);
          groupedInventory.push({
            tenSP: pObj.origName,
            warehouse: whList.map(w => w.name).join(', '),
            warehouses: whList,
            totalQty: totalQty,
            totalValue: totalValue,
            avgPrice: avgPrice,
            purchasePlaces: allPlaces,
            itemIds: allItemIds
          });
        }
      });

      // Calculate total stock value for items physically in stock (excluding Chờ Ship & Chusen)
      totalStockValue = groupedInventory
        .filter(g => {
          const wh = (g.warehouse || "").trim().toLowerCase();
          return !wh.includes("chờ ship") && !wh.includes("chusen");
        })
        .reduce((sum, g) => sum + (g.totalValue || 0), 0);

      const inStockProductsList = groupedInventory.map(g => ({ tenSP: g.tenSP, qty: g.totalQty, warehouse: g.warehouse }));
      finalProductsList = inStockProductsList.length > 0 ? inStockProductsList : products.map(p => ({ tenSP: p, qty: 0 }));
    }

    const result = {
      success: true,
      summary: {
        sales: totalSales,
        cogs: totalCogs,
        net: totalSales - totalCogs,
        stockValue: totalStockValue
      },
      warehouses: warehouses,
      suppliers: suppliers,
      purchasePlaces: purchasePlaces,
      sources: sources,
      accounts: accountsList,
      products: finalProductsList,
      preOrders: preOrders,
      cancelledRefundPending: cancelledRefundPending,
      debtSales: debtSales,
      inventory: inventory,
      allSales: allSales,
      groupedInventory: groupedInventory
    };

    try {
      if (!forceRefresh && typeof CacheService !== 'undefined' && CacheService.getScriptCache && !ssTarget) {
        CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 21600);
      }
    } catch(e) {}

    return result;

  } catch(err) {
    return {
      success: false,
      message: err.toString(),
      summary: { sales: 0, cogs: 0, net: 0, stockValue: 0 },
      warehouses: ["Chờ Ship", "Kho Nhật", "Kho VN"],
      suppliers: [],
      purchasePlaces: [],
      sources: [],
      accounts: [],
      products: [],
      preOrders: [],
      cancelledRefundPending: [],
      debtSales: [],
      inventory: [],
      allSales: [],
      groupedInventory: []
    };
  }
}

function getCreditCardWalletsMap(ssTarget) {
  const creditMap = new Map();
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return creditMap;
    const sheet = ss.getSheetByName("Wallets") || ss.getSheetByName("Ví") || ss.getSheetByName("ViThe");
    if (!sheet || sheet.getLastRow() < 2) return creditMap;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    for (let i = 0; i < data.length; i++) {
      const colA = String(data[i][0] || "").trim().toLowerCase();
      const colB = String(data[i][1] || "").trim().toLowerCase();
      const type = String(data[i][2] || "").trim().toUpperCase();
      const isCredit = (type === "CREDIT");
      
      if (colB) creditMap.set(colB, isCredit);
      if (colA) creditMap.set(colA, isCredit);
    }
  } catch(e) {}
  return creditMap;
}

function isCreditCardWallet(walletName, ssTarget, creditMap) {
  if (!walletName) return false;
  const nameClean = String(walletName).trim().toLowerCase();
  
  const map = (creditMap && creditMap instanceof Map) ? creditMap : getCreditCardWalletsMap(ssTarget);
  if (map && map.has(nameClean)) {
    return map.get(nameClean);
  }

  return nameClean.startsWith("c-") || nameClean.startsWith("c_") || nameClean.includes("credit") || nameClean.includes("tín dụng") || nameClean.includes("thẻ") || nameClean.includes("card");
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
      pSheet.appendRow(["ID", "Ngày Mua", "Nơi mua", "Trạng Thái Kho", "Tên Sản Phẩm", "Số Lượng", "Giá Mua (1 cái)", "Tổng Tiền", "Nguồn Tiền Mua", "Trạng thái thẻ", "Ghi chú", "Tồn kho"]);
    }

    const newId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("PO-") : ("PO-" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90));
    const dateVal = formatBizDateServer(formData.ngay);
    const noiMua = String(formData.noiMua || "").trim();
    const trangThaiKho = String(formData.trangThaiKho || "Chờ Ship").trim();
    const items = formData.items || [];
    const nguonTien = String(formData.nguonTien || "").trim();
    const taiKhoanMua = String(formData.taiKhoanMua || "").trim();
    const isMuonThe = Boolean(formData.isMuonThe);
    const doiTacMuon = String(formData.doiTacMuon || "").trim();

    if (!nguonTien && (!isMuonThe || !doiTacMuon)) {
      return { success: false, message: "❌ Vui lòng chọn Nguồn tiền mua hoặc Mượn thẻ đối tác!" };
    }

    const isCreditWallet = isCreditCardWallet(nguonTien, ss);
    const isPreOrder = Boolean(formData.isPreOrder) || isCreditWallet;
    const ghiChuOrder = String(formData.ghiChuOrder || "").trim();

    // Tính toán Cooldown cho Tab 5 / Lịch Mua Cooldown
    const cooldownDays = (typeof getDefaultCooldownDays === 'function') ? getDefaultCooldownDays(noiMua) : (noiMua.toLowerCase().includes("yodo") ? 13 : 30);
    const ngayMuaDate = (typeof parseTab5Date === 'function') ? parseTab5Date(dateVal) : new Date(dateVal);
    const ngayKhaDungDate = new Date(ngayMuaDate.getTime());
    ngayKhaDungDate.setDate(ngayKhaDungDate.getDate() + cooldownDays);
    const ngayKhaDung = (typeof formatDateTab5Standard === 'function') ? formatDateTab5Standard(ngayKhaDungDate) : ngayKhaDungDate.toISOString().split('T')[0];

    let totalPurchaseAmt = 0;
    const rowsToAppend = [];

    const lowerWh = trangThaiKho.toLowerCase();
    const lowerNoi = noiMua.toLowerCase();
    const lowerNotes = ghiChuOrder.toLowerCase();
    const isChoShipOrChusen = lowerWh.includes("chờ ship") || lowerWh.includes("chusen") || lowerNoi.includes("chusen") || lowerNotes.includes("chusen") || lowerNotes.includes("chờ ship");

    items.forEach((it, idx) => {
      const tenSP = String(it.tenSP || "").trim();
      if (!tenSP) return;
      const qty = Number(it.qty) || 1;
      const price = Number(it.price) || 0;
      const itemTotal = qty * price;
      totalPurchaseAmt += itemTotal;

      const itemId = items.length > 1 ? `${newId}-${idx + 1}` : newId;

      let ghiChu = "";
      if (isMuonThe) ghiChu += `[Mượn thẻ đối tác: ${doiTacMuon}] `;
      if (ghiChuOrder) ghiChu += `${ghiChuOrder} `;
      if (it.ghiChu) ghiChu += it.ghiChu;

      const isFilm = (typeof isFilmProduct === 'function') ? isFilmProduct(tenSP) : (removeAccentsTab5(String(tenSP)).trim().toLowerCase().startsWith("film"));
      const cooldownDays = isFilm ? ((typeof getDefaultCooldownDays === 'function') ? getDefaultCooldownDays(noiMua, tenSP) : (noiMua.toLowerCase().includes("yodo") ? 13 : 30)) : 0;
      const cardStatus = isPreOrder ? "PRE-ORDER" : "HOAN_TAT";
      const initialTonKho = (isPreOrder || isChoShipOrChusen) ? "" : qty;
      const ngaySaoKe = isPreOrder ? "" : dateVal;
      const recordStatus = (isFilm && cooldownDays > 0) ? "DANG_CHO" : "KET_THUC";

      rowsToAppend.push([
        itemId,           // 1: ID
        dateVal,          // 2: Ngày Mua
        noiMua,           // 3: Nơi mua
        trangThaiKho,     // 4: Trạng Thái Kho
        tenSP,            // 5: Tên Sản Phẩm
        qty,              // 6: Số Lượng
        price,            // 7: Giá Mua (1 cái)
        itemTotal,        // 8: Tổng Tiền
        nguonTien,        // 9: Nguồn Tiền Mua
        cardStatus,       // 10: Trạng thái thẻ
        ghiChu.trim(),    // 11: Note / Ghi chú
        initialTonKho,    // 12: Tồn kho
        ngaySaoKe,        // 13: Ngày Sao kê
        taiKhoanMua,      // 14: Thông tin tài khoản mua
        cooldownDays,     // 15: SoNgayCooldown
        ngayKhaDung,      // 16: NgayKhaDung
        recordStatus      // 17: TrangThai
      ]);
    });

    if (rowsToAppend.length > 0) {
      const headers = ["MÃ ĐƠN", "Ngày Mua", "Nơi mua", "Trạng Thái Kho", "Tên Sản Phẩm", "Số Lượng", "Giá Mua (1 cái)", "Tổng Tiền", "Nguồn Tiền Mua", "Tình trạng thẻ", "Note", "Tồn kho", "Ngày sao kê", "Tài khoản mua", "SoNgayCooldown", "NgayKhaDung", "Tình trạngCooldown"];
      if (pSheet.getLastRow() <= 1) {
        pSheet.getRange(1, 1, 1, 17).setValues([headers]);
      }
      const startRow = pSheet.getLastRow() + 1;
      pSheet.getRange(startRow, 1, rowsToAppend.length, 17).setValues(rowsToAppend);

      // TỰ ĐỘNG ĐỒNG BỘ SANG TAB 5 (LỊCH MUA & COOLDOWN / SHEET CALENDAR) NẾU CÓ TÀI KHOẢN MUA
      try {
        if (typeof syncPurchaseToTab5 === 'function') {
          syncPurchaseToTab5(formData, rowsToAppend, ss);
        }
      } catch(e) {
        console.error("Lỗi syncPurchaseToTab5: " + e.toString());
      }
    }

    // Nếu không phải Pre-order hay Mượn thẻ -> trừ tiền Ví/Thẻ và ghi nhận ngay vào Business Sheet (KinhDoanh)
    if (!isPreOrder && !isMuonThe && totalPurchaseAmt > 0) {
      let bSheet = ss.getSheetByName(SHEET_BUSINESS) || ss.getSheetByName("KinhDoanh");
      if (!bSheet) {
        bSheet = ss.insertSheet(SHEET_BUSINESS);
        bSheet.appendRow(["ID", "Ngày", "Loại", "Số Tiền", "Nguồn tiền", "Nội Dung / Diễn Giải", "ID liên kết"]);
      }
      const bId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("BO-") : ("BO-" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90));
      bSheet.appendRow([
        bId,
        dateVal,
        "Chi",
        totalPurchaseAmt,
        nguonTien,
        `Nhập hàng từ ${noiMua} (${items.length} SP)`,
        newId
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
      sSheet.appendRow(["ID", "Ngày Bán", "Tên Sản Phẩm", "Nơi Trừ Kho", "Số Lượng Xuất", "Giá Bán (1 cái)", "Tổng Tiền Bán", "Tồn kho", "Nhận Tiền Vào", "Trạng thái thanh toán", "Ghi Chú"]);
    }

    const newId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("SO-") : ("SO-" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90));
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
      const statusThanhToan = isKhachNo ? "CHO_THU" : "HOAN_TAT";

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
        statusThanhToan,
        ghiChu.trim()
      ]);
    });

    if (rowsToAppend.length > 0) {
      const startRow = sSheet.getLastRow() + 1;
      sSheet.getRange(startRow, 1, rowsToAppend.length, 11).setValues(rowsToAppend);

      // THUẬT TOÁN KHẤU TRỪ FIFO TRỰC TIẾP VÀO CỘT L (TỒN KHO) SHEET PURCHASE
      const pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
      if (pSheet && pSheet.getLastRow() >= 2) {
        const lastRowP = pSheet.getLastRow();
        const lastColP = Math.max(pSheet.getLastColumn(), 12);
        const pRange = pSheet.getRange(2, 1, lastRowP - 1, lastColP);
        const pData = pRange.getValues();
        let pModified = false;

        items.forEach(it => {
          const tenSP = String(it.tenSP || "").trim();
          if (!tenSP) return;
          const noiTru = String(it.noiTru || "").trim();
          let qtyToDeduct = Number(it.qty) || 1;

          // 1. Khấu trừ ưu tiên đúng Kho nguồn (Bỏ qua Chờ Ship & Pre-order)
          for (let i = 0; i < pData.length; i++) {
            if (qtyToDeduct <= 0) break;
            const pTenSP = String(pData[i][4] || "").trim();
            const pWh = String(pData[i][3] || "").trim();
            const pWhClean = pWh.toLowerCase();

            if (pWhClean.includes("hủy") || pWhClean.includes("bị hủy") || pWhClean.includes("cancel")) continue;
            if (pWhClean === "chờ ship" || pWhClean.includes("chờ ship")) continue;

            const pCardStatus = String(pData[i][9] || "").toLowerCase();
            const pGhiChu = String(pData[i][10] || "").toLowerCase();
            const isPreOrder = (
              pCardStatus.includes("pre-order") ||
              pCardStatus.includes("preorder") ||
              pCardStatus.includes("pre_order") ||
              pGhiChu.includes("pre-order") ||
              pGhiChu.includes("preorder") ||
              pGhiChu.includes("chờ trừ thẻ") ||
              pGhiChu.includes("chờ sao kê")
            );
            if (isPreOrder) continue;

            if (pTenSP.toLowerCase() === tenSP.toLowerCase()) {
              const whMatch = !noiTru || noiTru.toLowerCase() === "all" || pWhClean === noiTru.toLowerCase();
              if (whMatch) {
                const origQty = parseBizMoney(pData[i][5]);
                const rawTon = pData[i][11];
                let curTon = (rawTon !== "" && rawTon !== null && rawTon !== undefined) ? parseBizMoney(rawTon) : origQty;

                if (curTon > 0) {
                  const deduct = Math.min(curTon, qtyToDeduct);
                  curTon -= deduct;
                  qtyToDeduct -= deduct;
                  pData[i][11] = curTon;
                  pModified = true;
                }
              }
            }
          }

          // 2. Dự phòng: Khấu trừ vào đợt mua của SP bất kỳ nếu kho không khớp đủ (Bỏ qua Chờ Ship & Pre-order)
          if (qtyToDeduct > 0) {
            for (let i = 0; i < pData.length; i++) {
              if (qtyToDeduct <= 0) break;
              const pTenSP = String(pData[i][4] || "").trim();
              const pWhClean = String(pData[i][3] || "").trim().toLowerCase();
              if (pWhClean.includes("hủy") || pWhClean.includes("bị hủy") || pWhClean.includes("cancel")) continue;
              if (pWhClean === "chờ ship" || pWhClean.includes("chờ ship")) continue;

              const pCardStatus = String(pData[i][9] || "").toLowerCase();
              const pGhiChu = String(pData[i][10] || "").toLowerCase();
              const isPreOrder = (
                pCardStatus.includes("pre-order") ||
                pCardStatus.includes("preorder") ||
                pCardStatus.includes("pre_order") ||
                pGhiChu.includes("pre-order") ||
                pGhiChu.includes("preorder") ||
                pGhiChu.includes("chờ trừ thẻ") ||
                pGhiChu.includes("chờ sao kê")
              );
              if (isPreOrder) continue;

              if (pTenSP.toLowerCase() === tenSP.toLowerCase()) {
                const origQty = parseBizMoney(pData[i][5]);
                const rawTon = pData[i][11];
                let curTon = (rawTon !== "" && rawTon !== null && rawTon !== undefined) ? parseBizMoney(rawTon) : origQty;

                if (curTon > 0) {
                  const deduct = Math.min(curTon, qtyToDeduct);
                  curTon -= deduct;
                  qtyToDeduct -= deduct;
                  pData[i][11] = curTon;
                  pModified = true;
                }
              }
            }
          }
        });

        if (pModified) {
          pRange.setValues(pData);
        }
      }
    }

    // Nếu không phải Khách Nợ -> cộng tiền Ví/Thẻ và ghi nhận vào Business Sheet
    if (!isKhachNo && totalSalesAmt > 0) {
      let bSheet = ss.getSheetByName(SHEET_BUSINESS) || ss.getSheetByName("KinhDoanh");
      if (!bSheet) {
        bSheet = ss.insertSheet(SHEET_BUSINESS);
        bSheet.appendRow(["ID", "Ngày", "Loại", "Số Tiền", "Nguồn tiền", "Nội Dung / Diễn Giải", "ID liên kết"]);
      }
      const bId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("BO-") : ("BO-" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90));
      bSheet.appendRow([
        bId,
        dateVal,
        "Thu",
        totalSalesAmt,
        nhanTienVao,
        `Bán hàng (${items.length} SP)`,
        newId
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
 * 4. BÁO TRỪ THẺ THỰC TẾ CHO ĐƠN PRE-ORDER (BATCH UPDATE)
 */
function confirmBatchPreOrdersPayment(itemIds, customDate) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const idArray = Array.isArray(itemIds) ? itemIds : [itemIds];
    if (idArray.length === 0) return { success: false, message: "❌ Chưa chọn đơn hàng pre-order nào." };

    const idSet = new Set(idArray.map(id => String(id).trim()));
    let totalAmt = 0;
    const itemsMapByWallet = {};
    let hasChanges = false;
    let dateVal = customDate ? formatBizDateServer(customDate) : formatBizDateServer(new Date());

    const pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
    if (pSheet && pSheet.getLastRow() >= 2) {
      const lastColP = Math.max(pSheet.getLastColumn(), 13);
      const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP).getValues();
      let pChanged = false;
      for (let i = 0; i < data.length; i++) {
        const rowId = String(data[i][0] || "").trim();
        const rowIndexStr = String(i + 2);
        if (idSet.has(rowId) || idSet.has(rowIndexStr)) {
          data[i][9] = "HOAN_TAT";
          data[i][12] = dateVal; // Col M: Ngày sao kê
          let ghiChu = String(data[i][10] || "").trim();
          ghiChu = ghiChu.replace(/\[Pre-order\/Chờ trừ thẻ\]/gi, '').replace(/\[Pre-order\/Chờ sao kê\]/gi, '').replace(/\[Pre-order\]/gi, '').trim();
          data[i][10] = ghiChu;

          const qty = parseBizMoney(data[i][5]);
          const price = parseBizMoney(data[i][6]);
          const itemTotal = parseBizMoney(data[i][7]) || (qty * price);
          totalAmt += itemTotal;

          const nguonTien = String(data[i][8] || "").trim() || "Thẻ";
          itemsMapByWallet[nguonTien] = (itemsMapByWallet[nguonTien] || 0) + itemTotal;
          if (!customDate && data[i][1]) dateVal = formatBizDateServer(data[i][1]);
          hasChanges = true;
          pChanged = true;
        }
      }
      if (pChanged) {
        pSheet.getRange(2, 1, data.length, lastColP).setValues(data);
      }
    }

    // Check Family Sheet for pre-orders
    const fSheet = ss.getSheetByName("Family") || ss.getSheetByName("ThuChi");
    if (fSheet && fSheet.getLastRow() >= 2) {
      const lastColF = Math.max(fSheet.getLastColumn(), 11);
      const fData = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, lastColF).getValues();
      let fChanged = false;
      for (let i = 0; i < fData.length; i++) {
        const rowId = String(fData[i][0] || "").trim();
        const rowIndexStr = String(i + 2);
        if (idSet.has(rowId) || idSet.has(rowIndexStr)) {
          fData[i][9] = "HOAN_TAT";
          fData[i][10] = dateVal; // Col K: Ngày sao kê
          let ghiChu = String(fData[i][8] || "").trim();
          ghiChu = ghiChu.replace(/\[Pre-order\/Chờ sao kê\]/gi, '').replace(/\[Pre-order\/Chờ trừ thẻ\]/gi, '').replace(/\[Pre-order\]/gi, '').trim();
          fData[i][8] = ghiChu;

          let noiDung = String(fData[i][4] || "").trim();
          noiDung = noiDung.replace(/\[Pre-order\/Chờ sao kê\]/gi, '').replace(/\[Pre-order\/Chờ trừ thẻ\]/gi, '').replace(/\[Pre-order\]/gi, '').trim();
          fData[i][4] = noiDung;

          const itemTotal = parseBizMoney(fData[i][5]);
          totalAmt += itemTotal;
          const w = String(fData[i][6] || "").trim() || "Thẻ";
          itemsMapByWallet[w] = (itemsMapByWallet[w] || 0) + itemTotal;
          hasChanges = true;
          fChanged = true;
        }
      }
      if (fChanged) {
        fSheet.getRange(2, 1, fData.length, lastColF).setValues(fData);
      }
    }

    // Check Debt Sheet for pre-orders
    const dSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
    if (dSheet && dSheet.getLastRow() >= 2) {
      const lastColD = Math.max(dSheet.getLastColumn(), 13);
      const dData = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, lastColD).getValues();
      let dChanged = false;
      for (let i = 0; i < dData.length; i++) {
        const rowId = String(dData[i][0] || "").trim();
        const rowIndexStr = String(i + 2);
        if (idSet.has(rowId) || idSet.has(rowIndexStr)) {
          const duNo = Number(dData[i][9]) || 0;
          dData[i][10] = duNo <= 0 ? "DA_TRA" : "DANG_NO";
          dData[i][11] = "HOAN_TAT";
          dData[i][12] = dateVal; // Col M: Ngày sao kê
          let noiDung = String(dData[i][4] || "").trim();
          noiDung = noiDung.replace(/\[Pre-order\/Chờ sao kê\]/gi, '').replace(/\[Pre-order\/Chờ trừ thẻ\]/gi, '').replace(/\[Pre-order\]/gi, '').trim();
          dData[i][4] = noiDung;

          const itemTotal = parseBizMoney(dData[i][5]);
          totalAmt += itemTotal;
          const w = String(dData[i][6] || "").trim() || "Thẻ";
          itemsMapByWallet[w] = (itemsMapByWallet[w] || 0) + itemTotal;
          hasChanges = true;
          dChanged = true;
        }
      }
      if (dChanged) {
        dSheet.getRange(2, 1, dData.length, lastColD).setValues(dData);
      }
    }

    if (!hasChanges) {
      return { success: false, message: "❌ Không tìm thấy đơn hàng pre-order nào để xác nhận trừ thẻ." };
    }

    if (totalAmt > 0) {
      let bSheet = ss.getSheetByName(SHEET_BUSINESS) || ss.getSheetByName("KinhDoanh");
      if (!bSheet) {
        bSheet = ss.insertSheet(SHEET_BUSINESS);
        bSheet.appendRow(["ID", "Ngày", "Loại", "Số Tiền", "Nguồn tiền", "Nội Dung / Diễn Giải", "ID liên kết"]);
      }

      const linkedIdsStr = Array.from(idSet).join(", ");
      Object.keys(itemsMapByWallet).forEach((w, idx) => {
        const amt = itemsMapByWallet[w];
        const bId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("BO-") : ("BO-" + Date.now().toString().slice(-4) + (idx + 1));
        bSheet.appendRow([
          bId,
          dateVal,
          "Chi",
          amt,
          w,
          `Trừ thẻ thực tế pre-order (${idSet.size} đơn)`,
          linkedIdsStr
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

function confirmPreOrderPayment(targetId, customDate) {
  return confirmBatchPreOrdersPayment([targetId], customDate);
}

/**
 * BÁO THU TIỀN CHO CÁC ĐƠN KHÁCH NỢ (SALES) - BATCH UPDATE TỐI ƯU TỐC ĐỘ
 */
function confirmBatchDebtSalesPayment(itemIds, walletName, dateStr) {
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

    const numCols = Math.max(sSheet.getLastColumn(), 11);
    const data = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, numCols).getValues();
    let totalCollected = 0;
    const collectedItems = [];
    let hasChanges = false;

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      if (idSet.has(rowId)) {
        // Cập nhật Cột I (Column 9, index 8) sang Tên Ví nhận tiền
        data[i][8] = wallet;
        
        // Cập nhật Cột J (Column 10, index 9) sang HOAN_TAT
        data[i][9] = "HOAN_TAT";

        // Cập nhật Cột K (Column 11, index 10) sang Ghi chú
        let ghiChu = String(data[i][10] || data[i][9] || "").trim();
        if (!ghiChu.includes("[Đã thu tiền]")) {
          ghiChu = (ghiChu.replace(/\[Khách Nợ\]/gi, '').trim() + " [Đã thu tiền]").trim();
        }
        data[i][10] = ghiChu;

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
      sSheet.getRange(2, 1, data.length, numCols).setValues(data);
    }

    if (collectedItems.length > 0 && totalCollected > 0) {
      let bSheet = ss.getSheetByName(SHEET_BUSINESS) || ss.getSheetByName("KinhDoanh");
      if (!bSheet) {
        bSheet = ss.insertSheet(SHEET_BUSINESS);
        bSheet.appendRow(["ID", "Ngày", "Loại", "Số Tiền", "Nguồn tiền", "Nội Dung / Diễn Giải", "ID liên kết"]);
      }
      const bId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("BO-") : ("BO-" + Date.now().toString().slice(-6));
      const logDate = (dateStr && String(dateStr).trim()) ? String(dateStr).trim() : formatBizDateServer(new Date());
      bSheet.appendRow([
        bId,
        logDate,
        "Thu",
        totalCollected,
        wallet,
        `Thu tiền đơn khách nợ (${collectedItems.length} SP)`,
        itemIds.join(", ")
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

const SHEET_CANCEL_LOG = "Log_HuyDon";

function logCancelledOrderToSheet(logItem, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return;

    let sheet = getSheetByNameSafely(SHEET_CANCEL_LOG, ss);
    if (!sheet) return; // Do not auto-create Log_HuyDon sheet

    const dStr = formatBizDateServer(logItem.date || new Date());
    sheet.appendRow([
      dStr,
      logItem.id || "",
      logItem.tenSP || "",
      logItem.qty || 0,
      logItem.price || 0,
      logItem.total || 0,
      logItem.wallet || "",
      logItem.orderType || "PRE-ORDER",
      logItem.paymentMethod || "CREDIT",
      logItem.refundStatus || "Chờ Hoàn",
      logItem.reason || "Người dùng hủy đơn"
    ]);
  } catch (e) {
    Logger.log("Lỗi logCancelledOrderToSheet: " + e);
  }
}

/**
 * 4.2. HỦY ĐƠN PRE-ORDER
 */
function cancelBatchPreOrders(itemIds, reason) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet MuaHang." };

    const idArray = Array.isArray(itemIds) ? itemIds : [itemIds];
    if (idArray.length === 0) return { success: false, message: "❌ Chưa chọn đơn hàng pre-order nào." };

    const idSet = new Set(idArray.map(id => String(id).trim()));
    const maxCol = Math.max(pSheet.getLastColumn(), 17);
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, maxCol).getValues();
    const creditMap = getCreditCardWalletsMap(ss);

    let cancelledCount = 0;

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndexStr = String(i + 2);
      if (idSet.has(rowId) || idSet.has(rowIndexStr)) {
        cancelledCount++;
        const rowIndex = i + 2;
        const walletName = String(data[i][8] || "").trim();
        const isCredit = isCreditCardWallet(walletName, ss, creditMap);

        pSheet.getRange(rowIndex, 4).setValue("Hủy");
        pSheet.getRange(rowIndex, 10).setValue("CHO_HOAN_TIEN");
        pSheet.getRange(rowIndex, 12).setValue(0);
        if (pSheet.getLastColumn() >= 17) {
          pSheet.getRange(rowIndex, 17).setValue("KET_THUC");
        }

        if (typeof updatePurchaseLimitStatus === 'function') {
          updatePurchaseLimitStatus(rowId, "KET_THUC");
        }
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return { success: true, message: `✅ Đã hủy ${cancelledCount} đơn hàng pre-order và chuyển sang Chờ Hoàn Tiền!`, freshData: freshData };
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
function updateWarehouseStatus(targetId, newStatus, reason) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet MuaHang." };

    const targetStr = String(targetId || "").trim();
    const isCancel = (newStatus === 'CANCEL' || newStatus === 'Hủy' || newStatus === 'BỊ HỦY' || newStatus === 'BỊ HỦY - CHỜ HOÀN');
    const maxCol = Math.max(pSheet.getLastColumn(), 17);
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, maxCol).getValues();

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndexStr = String(i + 2);
      if ((rowId && rowId === targetStr) || rowIndexStr === targetStr) {
        const currentWh = String(data[i][3] || "").trim();
        const currentWhLower = currentWh.toLowerCase();
        const isPendingWh = (currentWh === "Chờ Ship" || currentWhLower.includes("chusen"));
        if (isCancel && !isPendingWh) {
          return { success: false, message: "❌ Chỉ đơn hàng ở trạng thái 'Chờ Ship' hoặc 'Chusen' mới được Hủy!" };
        }
        const rowIndex = i + 2;
        const targetStatus = isCancel ? "Hủy" : newStatus;
        pSheet.getRange(rowIndex, 4).setValue(targetStatus);

        if (isCancel) {
          pSheet.getRange(rowIndex, 10).setValue("CHO_HOAN_TIEN");
          pSheet.getRange(rowIndex, 12).setValue(0);
          if (pSheet.getLastColumn() >= 17) {
            pSheet.getRange(rowIndex, 17).setValue("KET_THUC");
          }

          if (typeof updatePurchaseLimitStatus === 'function') {
            updatePurchaseLimitStatus(rowId, "KET_THUC");
          }
        }
        break;
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return { success: true, message: `✅ Đã chuyển trạng thái kho sang ${isCancel ? "Hủy" : newStatus}`, freshData: freshData };
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

    const isCancel = (toWh === 'CANCEL' || toWh === 'BỊ HỦY' || toWh === 'BỊ HỦY - CHỜ HOÀN');
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 10).getValues();

    if (isCancel) {
      for (let i = 0; i < data.length; i++) {
        const rowSp = String(data[i][4] || "").trim();
        const rowWh = String(data[i][3] || "").trim();
        const rowWhLower = rowWh.toLowerCase();
        const isRowPendingWh = (rowWh === 'Chờ Ship' || rowWhLower.includes('chusen'));
        if (rowSp === spTarget && (!fromWh || fromWh === 'ALL' || rowWh === fromWh)) {
          if (!isRowPendingWh) {
            return { success: false, message: "❌ Chỉ đơn hàng ở trạng thái 'Chờ Ship' hoặc 'Chusen' mới được Hủy!" };
          }
        }
      }
    }

    let updatedCount = 0;
    const targetStatus = isCancel ? "Hủy" : toWh;

    for (let i = 0; i < data.length; i++) {
      const rowSp = String(data[i][4] || "").trim();
      const rowWh = String(data[i][3] || "").trim();
      const rowId = String(data[i][0] || "").trim();
      if (rowSp === spTarget && (!fromWh || fromWh === 'ALL' || rowWh === fromWh)) {
        const rowIndex = i + 2;
        pSheet.getRange(rowIndex, 4).setValue(targetStatus);
        updatedCount++;

        if (isCancel) {
          pSheet.getRange(rowIndex, 10).setValue("CHO_HOAN_TIEN");
          pSheet.getRange(rowIndex, 12).setValue(0);
          if (pSheet.getLastColumn() >= 17) {
            pSheet.getRange(rowIndex, 17).setValue("KET_THUC");
          }

          if (typeof updatePurchaseLimitStatus === 'function') {
            updatePurchaseLimitStatus(rowId, "KET_THUC");
          }
        } else if (targetStatus !== "Chờ Ship" && !targetStatus.toLowerCase().includes("chusen")) {
          const curTon = parseBizMoney(data[i][11]);
          if (!curTon || curTon <= 0) {
            pSheet.getRange(rowIndex, 12).setValue(parseBizMoney(data[i][5]));
          }
        }
      }
    }

    if (updatedCount === 0) {
      return { success: false, message: "❌ Không tìm thấy sản phẩm phù hợp ở kho nguồn." };
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return { success: true, message: `✅ Đã chuyển ${updatedCount} đơn hàng sản phẩm "${spTarget}" sang ${targetStatus}!`, freshData: freshData };
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

    const newWh = String(newStatus || "").trim();
    if (!newWh) return { success: false, message: "❌ Thông tin kho mới không hợp lệ." };

    // Process inputs into transfer map: id -> qtyToTransfer (null if full transfer)
    const items = Array.isArray(itemIds) ? itemIds : [itemIds];
    const transferMap = {};
    items.forEach(item => {
      if (typeof item === 'object' && item !== null) {
        const idStr = String(item.id || item.itemId || '').trim();
        const qtyVal = Number(item.qty || item.transferQty || 0);
        if (idStr) transferMap[idStr] = qtyVal > 0 ? qtyVal : null;
      } else if (item !== undefined && item !== null) {
        const idStr = String(item).trim();
        if (idStr) transferMap[idStr] = null;
      }
    });

    const targetIds = Object.keys(transferMap);
    if (targetIds.length === 0) return { success: false, message: "❌ Chưa chọn đơn hàng nào." };

    const isCancel = (newWh === 'CANCEL' || newWh === 'BỊ HỦY' || newWh === 'BỊ HỦY - CHỜ HOÀN' || newWh === 'Hủy');
    const targetStatus = isCancel ? "Hủy" : newWh;

    const lastRow = pSheet.getLastRow();
    const lastCol = Math.max(pSheet.getLastColumn(), 17);
    const data = pSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    if (isCancel) {
      for (let i = 0; i < data.length; i++) {
        const rowId = String(data[i][0] || "").trim();
        const rowIndexStr = String(i + 2);
        if (Object.prototype.hasOwnProperty.call(transferMap, rowId) || Object.prototype.hasOwnProperty.call(transferMap, rowIndexStr)) {
          const currentWh = String(data[i][3] || "").trim();
          if (currentWh !== "Chờ Ship" && !currentWh.toLowerCase().includes("chờ ship")) {
            return { success: false, message: "❌ Chỉ đơn hàng ở trạng thái 'Chờ Ship' mới được Hủy!" };
          }
        }
      }
    }

    // Ensure STOCK_TRANSFER sheet exists
    let ckSheet = ss.getSheetByName(SHEET_STOCK_TRANSFER) || ss.getSheetByName("CHUYEN_KHO") || ss.getSheetByName("ChuyenKho");
    if (!ckSheet) {
      ckSheet = ss.insertSheet(SHEET_STOCK_TRANSFER);
      ckSheet.appendRow([
        "ID Chuyển", "Ngày Giờ", "ID Mua", "Sản Phẩm", "Kho Đi", "Kho Đến", "Số Lượng", "Người Thao Tác", "Ghi Chú"
      ]);
      const ckHeaderRange = ckSheet.getRange(1, 1, 1, 9);
      if (typeof ckHeaderRange.setFontWeight === 'function') ckHeaderRange.setFontWeight("bold");
      if (typeof ckHeaderRange.setBackground === 'function') ckHeaderRange.setBackground("#e2e8f0");
    }

    let updatedCount = 0;
    const nowStr = typeof Utilities !== 'undefined' && Utilities.formatDate 
      ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy HH:mm:ss")
      : new Date().toLocaleString("vi-VN");

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndexStr = String(i + 2);
      const matchKey = Object.prototype.hasOwnProperty.call(transferMap, rowId) ? rowId : (Object.prototype.hasOwnProperty.call(transferMap, rowIndexStr) ? rowIndexStr : null);

      if (matchKey !== null) {
        const rowIndex = i + 2;
        const origQty = parseBizMoney(data[i][5]);
        const origPrice = parseBizMoney(data[i][6]);
        const origTonKho = (data[i][11] !== "" && data[i][11] !== null && data[i][11] !== undefined) ? parseBizMoney(data[i][11]) : origQty;
        const fromWh = String(data[i][3] || "").trim() || "Chờ Ship";
        const reqQty = transferMap[matchKey];
        const spName = String(data[i][4] || "").trim();

        if (reqQty === null || reqQty >= origQty || origQty <= 1) {
          // Full transfer
          pSheet.getRange(rowIndex, 4).setValue(targetStatus);
          updatedCount++;

          ckSheet.appendRow([
            "CK_" + Date.now() + "_" + updatedCount,
            nowStr,
            rowId || rowIndexStr,
            spName,
            fromWh,
            targetStatus,
            origQty,
            "Admin",
            `Chuyển toàn bộ ${origQty} SP`
          ]);

          if (isCancel) {
            pSheet.getRange(rowIndex, 10).setValue("CHO_HOAN_TIEN");
            pSheet.getRange(rowIndex, 12).setValue(0);
            if (pSheet.getLastColumn() >= 17) {
              pSheet.getRange(rowIndex, 17).setValue("KET_THUC");
            }

            if (typeof updatePurchaseLimitStatus === 'function') {
              updatePurchaseLimitStatus(rowId || rowIndexStr, "KET_THUC");
            }
          } else if (targetStatus.toLowerCase().includes("chờ ship") || targetStatus.toLowerCase().includes("chusen")) {
            pSheet.getRange(rowIndex, 12).setValue("");
          } else {
            const curTon = parseBizMoney(data[i][11]);
            if (!curTon || curTon <= 0) {
              pSheet.getRange(rowIndex, 12).setValue(origQty);
            }
          }
        } else {
          // Partial transfer -> Row Splitting (Option A)
          const remainingQty = origQty - reqQty;
          const remainingTotal = remainingQty * origPrice;
          const newTonKhoOrig = Math.max(0, origTonKho - reqQty);

          // 1. Update original row
          pSheet.getRange(rowIndex, 6).setValue(remainingQty);
          pSheet.getRange(rowIndex, 8).setValue(remainingTotal);
          pSheet.getRange(rowIndex, 12).setValue(newTonKhoOrig);

          // 2. Append split row for transferred items
          const newRowId = (rowId ? rowId : rowIndexStr) + "_CK";
          const newGhiChu = (String(data[i][10] || "").trim() + ` [Tách từ #${rowId || rowIndexStr}]`).trim();
          pSheet.appendRow([
            newRowId,
            data[i][1], // Date
            data[i][2], // Store
            targetStatus, // Target warehouse
            spName,
            reqQty, // Transferred Qty
            origPrice, // Unit Price
            reqQty * origPrice, // Transferred Total
            data[i][8], // Wallet
            data[i][9], // Card Status
            newGhiChu,
            reqQty, // Transferred TonKho
            data[i][12], // Statement Date
            data[i][13], // Account
            data[i][14], // Cooldown
            data[i][15], // Available Date
            data[i][16]  // Status
          ]);

          updatedCount++;

          ckSheet.appendRow([
            "CK_" + Date.now() + "_" + updatedCount,
            nowStr,
            rowId || rowIndexStr,
            spName,
            fromWh,
            targetStatus,
            reqQty,
            "Admin",
            `Tách dòng: Chuyển ${reqQty}/${origQty} SP`
          ]);
        }
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const statusDisp = isCancel ? 'Hủy' : newWh;
    return { success: true, message: `✅ Đã chuyển ${updatedCount} đơn hàng sang "${statusDisp}"!` };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

/**
 * 5.4. XÁC NHẬN ĐÃ NHẬN HOÀN TIỀN (BẢO VỆ CHỐNG CỘNG TIỀN 2 LẦN)
 */
function confirmRefundOrderPayment(orderId, targetWallet, customDate) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet MuaHang." };

    let targetIds = [];
    if (Array.isArray(orderId)) {
      targetIds = orderId.map(id => String(id || '').trim()).filter(Boolean);
    } else {
      targetIds = String(orderId || '').split(',').map(id => String(id || '').trim()).filter(Boolean);
    }

    if (targetIds.length === 0) return { success: false, message: "❌ Chưa chọn mã đơn hàng cần nhận hoàn tiền." };

    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 11).getValues();
    const bSheet = ss.getSheetByName(SHEET_BUSINESS) || ss.getSheetByName("KinhDoanh");
    const dateVal = parseServerDate(customDate) || new Date();
    const dateStrFormatted = dateVal instanceof Date ? dateVal.toISOString().split('T')[0] : String(dateVal);

    let countSuccess = 0;
    let totalRefunded = 0;

    for (let idx = 0; idx < targetIds.length; idx++) {
      const targetStr = targetIds[idx];
      let foundIndex = -1;
      let targetRow = null;

      for (let i = 0; i < data.length; i++) {
        const rowId = String(data[i][0] || "").trim();
        const rowIndexStr = String(i + 2);
        if (rowId === targetStr || rowIndexStr === targetStr) {
          foundIndex = i + 2;
          targetRow = data[i];
          break;
        }
      }

      if (foundIndex === -1 || !targetRow) continue;

      const currentStatus = String(targetRow[3] || "").trim().toUpperCase();
      if (currentStatus === "ĐÃ HOÀN TIỀN") continue;

      const totalAmt = parseMoneyNumber(targetRow[7]);
      const walletName = String(targetWallet || targetRow[8] || "Ví Tiền Mặt").trim();
      const tenSP = String(targetRow[4] || "Sản phẩm").trim();

      pSheet.getRange(foundIndex, 4).setValue("ĐÃ HOÀN TIỀN");
      pSheet.getRange(foundIndex, 10).setValue("ĐÃ HOÀN TIỀN");
      const existingGhiChu = String(targetRow[10] || "");
      pSheet.getRange(foundIndex, 11).setValue((existingGhiChu + ` [Đã Hoàn Tiền - Ngày: ${dateStrFormatted} - Ví: ${walletName}]`).trim());

      if (bSheet) {
        const bId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("BO-") : ("BO-" + Date.now().toString().slice(-6) + idx);
        bSheet.appendRow([
          bId,
          dateVal,
          "Thu",
          totalAmt,
          walletName,
          `Hoàn tiền đơn hủy #${targetRow[0]} (${tenSP})`,
          String(targetRow[0] || "")
        ]);
      }

      if (typeof updateWalletBalanceHelper === 'function' && walletName) {
        updateWalletBalanceHelper(walletName, totalAmt);
      }

      countSuccess++;
      totalRefunded += totalAmt;
    }

    if (countSuccess === 0) {
      return { success: false, message: "❌ Không có đơn hàng nào được hoàn tiền (đơn hàng đã được xác nhận hoàn tiền trước đó)." };
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return {
      success: true,
      message: `✅ Đã nhận hoàn tiền ${totalRefunded.toLocaleString()} ¥ về ${targetWallet || 'Ví/Thẻ'} cho ${countSuccess} đơn!`,
      freshData: freshData
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi xác nhận hoàn tiền: " + err.toString() };
  }
}

/**
 * 6. CẬP NHẬT CHI TIẾT ĐƠN HÀNG MUA (SỬA TOÀN BỘ THÔNG TIN ĐƠN)
 */
function updatePurchaseItemDetail(itemId, newWh, newQty, newPrice, newGhiChu, newNoiMua, newTenSP, newNgayMua, newNguonTien, newCardStatus, newTaiKhoan) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE) || ss.getSheetByName("MuaHang");
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet MuaHang." };

    const targetStr = String(itemId || "").trim();
    if (!targetStr) return { success: false, message: "❌ Mã đơn không hợp lệ." };

    const maxCol = Math.max(pSheet.getLastColumn(), 17);
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, maxCol).getValues();
    let found = false;

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndexStr = String(i + 2);
      if ((rowId && rowId === targetStr) || rowIndexStr === targetStr) {
        const rowIndex = i + 2;
        const currentNoi = (newNoiMua !== undefined && newNoiMua !== null && String(newNoiMua).trim()) 
          ? String(newNoiMua).trim() 
          : String(data[i][2] || "").trim();

        const rawNgayMua = (newNgayMua !== undefined && newNgayMua !== null && String(newNgayMua).trim()) 
          ? newNgayMua 
          : data[i][1];
        const formattedDate = formatBizDateServer(rawNgayMua);

        if (formattedDate) {
          pSheet.getRange(rowIndex, 2).setValue(formattedDate);
          pSheet.getRange(rowIndex, 13).setValue(formattedDate);
        }

        if (newNoiMua !== undefined && newNoiMua !== null) pSheet.getRange(rowIndex, 3).setValue(currentNoi);
        const currentWh = (newWh !== undefined && newWh !== null) ? String(newWh).trim() : String(data[i][3] || "").trim();
        const lowerWhCheck = currentWh.toLowerCase();
        const isWhInStock = !lowerWhCheck.includes("chờ ship") && !lowerWhCheck.includes("chusen") && !lowerWhCheck.includes("hủy") && !lowerWhCheck.includes("cancel");

        if (newWh !== undefined && newWh !== null) {
          const whStr = String(newWh).trim();
          pSheet.getRange(rowIndex, 4).setValue(whStr);
          if (isWhInStock) {
            const curTon = parseBizMoney(data[i][11]);
            if (!curTon || curTon <= 0) {
              const qtyVal = (newQty !== undefined && !isNaN(Number(newQty))) ? Number(newQty) : parseBizMoney(data[i][5]);
              pSheet.getRange(rowIndex, 12).setValue(qtyVal);
            }
          } else {
            pSheet.getRange(rowIndex, 12).setValue("");
          }
        }
        if (newTenSP !== undefined && newTenSP !== null && String(newTenSP).trim()) pSheet.getRange(rowIndex, 5).setValue(String(newTenSP).trim());
        
        const qtyVal = (newQty !== undefined && !isNaN(Number(newQty))) ? Number(newQty) : parseBizMoney(data[i][5]);
        const priceVal = (newPrice !== undefined && !isNaN(Number(newPrice))) ? Number(newPrice) : parseBizMoney(data[i][6]);
        
        if (newQty !== undefined && !isNaN(Number(newQty))) {
          pSheet.getRange(rowIndex, 6).setValue(qtyVal);
          if (isWhInStock) {
            pSheet.getRange(rowIndex, 12).setValue(qtyVal);
          } else {
            pSheet.getRange(rowIndex, 12).setValue("");
          }
        }
        if (newPrice !== undefined && !isNaN(Number(newPrice))) {
          pSheet.getRange(rowIndex, 7).setValue(priceVal);
        }
        pSheet.getRange(rowIndex, 8).setValue(qtyVal * priceVal);
        
        if (newNguonTien !== undefined && newNguonTien !== null) pSheet.getRange(rowIndex, 9).setValue(String(newNguonTien).trim());
        if (newCardStatus !== undefined && newCardStatus !== null && String(newCardStatus).trim()) {
          pSheet.getRange(rowIndex, 10).setValue(String(newCardStatus).trim());
        }
        if (newTaiKhoan !== undefined && newTaiKhoan !== null && String(newTaiKhoan).trim()) {
          pSheet.getRange(rowIndex, 14).setValue(String(newTaiKhoan).trim());
        }
        if (newGhiChu !== undefined && newGhiChu !== null) pSheet.getRange(rowIndex, 11).setValue(String(newGhiChu).trim());
        
        // Recalculate Cooldown, NgayKhaDung & TrangThaiCooldown (Col 15, 16, 17)
        const targetSp = (newTenSP !== undefined && newTenSP !== null && String(newTenSP).trim()) ? String(newTenSP).trim() : String(data[i][4] || "").trim();
        const isFilm = (typeof isFilmProduct === 'function') ? isFilmProduct(targetSp) : (removeAccentsTab5(String(targetSp)).trim().toLowerCase().startsWith("film"));
        const cooldownDays = isFilm ? ((typeof getDefaultCooldownDays === 'function') ? getDefaultCooldownDays(currentNoi, targetSp) : (currentNoi.toLowerCase().includes("yodo") ? 13 : 30)) : 0;
        const parsedDate = (typeof parseServerDate === 'function') ? parseServerDate(formattedDate) : new Date();

        if (parsedDate && !isNaN(parsedDate.getTime())) {
          const khaDungDate = new Date(parsedDate.getTime());
          if (isFilm) khaDungDate.setDate(khaDungDate.getDate() + cooldownDays);
          const formattedKhaDung = formatBizDateServer(khaDungDate);
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const currentWh = String(newWh || data[i][3] || "").trim();
          const isCancelled = currentWh.toLowerCase().includes("hủy") || currentWh.toLowerCase().includes("cancel");
          const cooldownStatus = (!isCancelled && isFilm && khaDungDate.getTime() > today.getTime()) ? "DANG_CHO" : "KET_THUC";

          pSheet.getRange(rowIndex, 15).setValue(cooldownDays);
          pSheet.getRange(rowIndex, 16).setValue(formattedKhaDung);
          pSheet.getRange(rowIndex, 17).setValue(cooldownStatus);
        }

        // Đồng bộ sửa đổi dòng tiền sang Business Sheet (KinhDoanh) liên kết bằng ID đơn mua (PO-) nếu là đơn HOAN_TAT
        const targetCardStatus = (newCardStatus !== undefined && newCardStatus !== null && String(newCardStatus).trim()) ? String(newCardStatus).trim() : String(data[i][9] || "").trim();
        const targetNguonTien = (newNguonTien !== undefined && newNguonTien !== null && String(newNguonTien).trim()) ? String(newNguonTien).trim() : String(data[i][8] || "").trim();
        const oldNguonTien = String(data[i][8] || "").trim();
        const oldTotal = (parseBizMoney(data[i][5]) || 1) * (parseBizMoney(data[i][6]) || 0);
        const newTotal = qtyVal * priceVal;
        const purchaseOrderId = rowId || targetStr;

        if (targetCardStatus === "HOAN_TAT") {
          let bSheet = ss.getSheetByName(SHEET_BUSINESS) || ss.getSheetByName("KinhDoanh");
          if (!bSheet) {
            bSheet = ss.insertSheet(SHEET_BUSINESS);
            bSheet.appendRow(["ID", "Ngày", "Loại", "Số Tiền", "Nguồn tiền", "Nội Dung / Diễn Giải", "ID liên kết"]);
          }
          const bLastRow = bSheet.getLastRow();
          const bData = bLastRow >= 2 ? bSheet.getRange(2, 1, bLastRow - 1, Math.max(bSheet.getLastColumn(), 7)).getValues() : [];
          let bFoundIndex = -1;

          for (let bIdx = 0; bIdx < bData.length; bIdx++) {
            const bId = String(bData[bIdx][0] || "").trim();
            const linkId = String(bData[bIdx][6] || "").trim();
            if (linkId === purchaseOrderId || bId === purchaseOrderId) {
              bFoundIndex = bIdx + 2;
              break;
            }
          }

          if (bFoundIndex > 0) {
            bSheet.getRange(bFoundIndex, 2).setValue(formattedDate);
            bSheet.getRange(bFoundIndex, 4).setValue(newTotal);
            bSheet.getRange(bFoundIndex, 5).setValue(targetNguonTien);
            bSheet.getRange(bFoundIndex, 6).setValue(`Nhập hàng từ ${currentNoi} (${targetSp})`);
            bSheet.getRange(bFoundIndex, 7).setValue(purchaseOrderId);

            if (oldNguonTien === targetNguonTien) {
              const diff = newTotal - oldTotal;
              if (diff !== 0 && typeof updateWalletBalanceHelper === 'function') {
                updateWalletBalanceHelper(targetNguonTien, -diff);
              }
            } else {
              if (typeof updateWalletBalanceHelper === 'function') {
                if (oldNguonTien) updateWalletBalanceHelper(oldNguonTien, oldTotal);
                if (targetNguonTien) updateWalletBalanceHelper(targetNguonTien, -newTotal);
              }
            }
          } else {
            const bId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("BO-") : ("BO-" + Date.now().toString().slice(-6));
            bSheet.appendRow([
              bId,
              formattedDate,
              "Chi",
              newTotal,
              targetNguonTien,
              `Nhập hàng từ ${currentNoi} (${targetSp})`,
              purchaseOrderId
            ]);
            if (typeof updateWalletBalanceHelper === 'function' && targetNguonTien) {
              updateWalletBalanceHelper(targetNguonTien, -newTotal);
            }
          }
        }

        found = true;
        break;
      }
    }

    if (!found) return { success: false, message: "❌ Không tìm thấy đơn hàng cần sửa." };

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return { success: true, message: "✅ Đã cập nhật chi tiết đơn hàng thành công!", freshData: freshData };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}
