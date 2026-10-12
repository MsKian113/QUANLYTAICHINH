// ==========================================
// FILE: Server_Tab3.js
// NHIỆM VỤ: Backend Logic cho Tab 3 (Kinh Doanh & QL Kho)
// Schemas:
// - Sheet Purchase: A: ID | B: Ngày Mua | C: Nơi mua | D: Trạng Thái Kho | E: Tên Sản Phẩm | F: Số Lượng | G: Giá Mua (1 cái) | H: Tổng Tiền | I: Nguồn Tiền Mua | J: Trạng thái thẻ | K: Ghi Chú | L: Tồn kho | M: Ngày sao kê
// - Sheet Sales:    A: ID | B: Ngày Bán | C: Tên Sản Phẩm | D: Nơi Trừ Kho | E: Số Lượng Xuất | F: Giá Bán (1 cái) | G: Tổng Tiền Bán | H: Tồn kho | I: Nhận Tiền Vào | J: Ghi Chú
// ==========================================

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
    
    let warehouses = [];
    let products = [];
    let finalProductsList = [];
    let allHistoricalProducts = [];
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

    let accountsList = [];

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
          if (!warehouses.some(w => w.toLowerCase() === "chờ ship" || w.toLowerCase() === "cho ship")) {
            warehouses.unshift("Chờ Ship");
          }
          if (!warehouses.some(w => w.toLowerCase() === "đặt trước" || w.toLowerCase() === "dat truoc" || w.toLowerCase().includes("preorder"))) {
            warehouses.unshift("Đặt trước");
          }
        } else {
          warehouses = ["Đặt trước", "Chờ Ship"];
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
      const pSheet = ss.getSheetByName(SHEET_PURCHASE);
      if (pSheet && pSheet.getLastRow() >= 2) {
        const lastColP = Math.max(pSheet.getLastColumn(), 13);
        const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP).getValues();
        pData.forEach((r, index) => {
          const rowIndex = index + 2;
          const rawId = String(r[0] || "").trim();
          const id = rawId || String(rowIndex);
          const ngayMua = formatBizDateServer(r[1]);
          const noiMua = String(r[2] || "").trim();
          const trangThaiKho = String(r[3] || "").trim();
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
          const isDatTruoc = lowerWh.includes("đặt trước") || lowerWh.includes("dat truoc") || lowerWh.includes("preorder") || lowerWh.includes("pre-order");
          const isChoShipOrChusen = lowerWh.includes("chờ ship") || lowerWh.includes("chusen") || isDatTruoc;
          const isPreOrder = isDatTruoc || lowerCardStatus.includes("pre-order") || lowerCardStatus.includes("preorder") || lowerGhiChu.includes("pre-order") || lowerGhiChu.includes("đặt trước");

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

          const isCreditCard = isCreditCardWallet(nguonTien, ss, creditMap);

          const pItem = { id, ngayMua, noiMua, trangThaiKho, tenSP, qty, price, total, nguonTien, trangThaiThe, ghiChu, tonKho, ngaySaoKe, taiKhoan };

          if (!isCreditCard && (lowerCardStatus.includes("pre-order") || lowerCardStatus.includes("preorder") || lowerCardStatus.includes("chờ_ship") || lowerCardStatus.includes("cho_ship"))) {
            pItem.trangThaiThe = "HOAN_TAT";
          }

          const isCardDone = lowerCardStatus.includes("hoan_tat") || lowerCardStatus.includes("da_tru") || lowerCardStatus.includes("đã trừ") || lowerCardStatus.includes("hoàn tất");

          // Tự động gán kho Đặt trước cho các đơn pre-order chưa trừ thẻ
          if (!isCancelled && !isCardDone && isCreditCard && (isDatTruoc || lowerCardStatus.includes("pre-order") || lowerCardStatus.includes("preorder") || lowerGhiChu.includes("pre-order") || lowerGhiChu.includes("đặt trước") || lowerGhiChu.includes("chờ trừ"))) {
            if (trangThaiKho === "Chờ Ship" || !trangThaiKho) {
              pItem.trangThaiKho = "Đặt trước";
            }
          }

          allTimePurchases.push(pItem);

          const isPreOrderMatch = !isCancelled && !isCardDone && isCreditCard && (
            isDatTruoc ||
            pItem.trangThaiKho === "Đặt trước" ||
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
            lowerWh.includes("chusen")
          );

          const isRefunded = lowerCardStatus === "da_hoan_tien" || lowerCardStatus.includes("da_hoan") || lowerCardStatus.includes("đã hoàn") || lowerCardStatus.includes("refunded");

          const isPendingRefund = isCancelled && !isRefunded && (
            lowerCardStatus === "cho_hoan_tien" ||
            lowerCardStatus.includes("cho_hoan") ||
            lowerCardStatus.includes("chờ hoàn") ||
            lowerCardStatus.includes("cần hoàn") ||
            lowerCardStatus.includes("refund") ||
            (isCreditCard && !lowerCardStatus.includes("hoan_tat"))
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

      const sSheet = ss.getSheetByName(SHEET_SALES);
      if (sSheet && sSheet.getLastRow() >= 2) {
        const lastColS = Math.max(sSheet.getLastColumn(), 11);
        const sHeaderRow = sSheet.getRange(1, 1, 1, lastColS).getValues()[0].map(h => String(h || "").trim().toLowerCase());
        
        let colIdIdx = sHeaderRow.findIndex(h => h === "id" || h.includes("mã"));
        let colDateIdx = sHeaderRow.findIndex(h => h.includes("ngày"));
        let colSpIdx = sHeaderRow.findIndex(h => h.includes("sản phẩm") || h.includes("tên sp") || h.includes("mặt hàng"));
        let colWhIdx = sHeaderRow.findIndex(h => h.includes("kho") || h.includes("nơi trừ") || h.includes("trừ kho") || h.includes("vị trí"));
        let colQtyIdx = sHeaderRow.findIndex(h => h.includes("số lượng") || h === "sl" || h.includes("xuất"));
        let colPriceIdx = sHeaderRow.findIndex(h => (h.includes("giá") || h.includes("đơn giá")) && !h.includes("tổng"));
        let colTotalIdx = sHeaderRow.findIndex(h => h.includes("tổng tiền") || h.includes("thành tiền"));
        let colTonIdx = sHeaderRow.findIndex(h => h.includes("tồn"));
        let colWalletIdx = sHeaderRow.findIndex(h => h.includes("nhận tiền") || h.includes("ví") || h.includes("tài khoản"));
        let colStatusIdx = sHeaderRow.findIndex(h => h.includes("trạng thái") || h.includes("thanh toán") || h.includes("tình trạng"));
        let colNoteIdx = sHeaderRow.findIndex(h => h.includes("ghi chú") || h.includes("note"));

        if (colIdIdx === -1) colIdIdx = 0;
        if (colDateIdx === -1) colDateIdx = 1;
        if (colSpIdx === -1) colSpIdx = 2;
        if (colWhIdx === -1) colWhIdx = 3;
        if (colQtyIdx === -1) colQtyIdx = 4;
        if (colPriceIdx === -1) colPriceIdx = 5;
        if (colTotalIdx === -1) colTotalIdx = 6;
        if (colTonIdx === -1) colTonIdx = 7;
        if (colWalletIdx === -1) colWalletIdx = 8;
        if (colStatusIdx === -1) colStatusIdx = 9;
        if (colNoteIdx === -1) colNoteIdx = 10;

        const sData = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, lastColS).getValues();
        sData.forEach((r, rIdx) => {
          const rowIndex = rIdx + 2;
          const rawId = String(r[colIdIdx] || "").trim();
          const id = rawId || String(rowIndex);
          const tenSP = String(r[colSpIdx] || "").trim();
          if (!tenSP && !rawId) return;
          const ngayBan = formatBizDateServer(r[colDateIdx]);
          const noiTru = String(r[colWhIdx] || "").trim();
          const qty = parseBizMoney(r[colQtyIdx]);
          const price = parseBizMoney(r[colPriceIdx]);
          const total = parseBizMoney(r[colTotalIdx]) || (qty * price);
          const tonKho = parseBizMoney(r[colTonIdx]);
          const nhanTien = String(r[colWalletIdx] || "").trim();
          const trangThai = String(r[colStatusIdx] || "").trim();
          const ghiChu = String(r[colNoteIdx] || r[colStatusIdx] || "").trim();

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

          const dS = parseServerDate(r[colDateIdx]);
          const mS = dS ? (dS.getMonth() + 1) : null;
          const yS = dS ? dS.getFullYear() : null;
          const matchMonthS = isAllMonth || !mS || mS === targetMonth;
          const matchYearS = isAllYear || !yS || yS === targetYear;

          let cogsVal = parseBizMoney(r[colStatusIdx + 1] || r[7] || 0); // COGS column if present
          if (cogsVal === 0 && price > 0) {
            // Fallback estimation if not allocated
            cogsVal = Math.round(total * 0.8);
          }

          if (matchMonthS && matchYearS) {
            totalSales += total;
            totalCogs += cogsVal;
          }
        });
      }

      // 4. (Đã gỡ bỏ quét Business sheet - Doanh thu & Giá vốn lấy chuẩn từ Sales & FIFO)

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

      const stockMap = new Map();
      groupedInventory.forEach(g => {
        if (g.tenSP) {
          stockMap.set(g.tenSP, { qty: g.totalQty, warehouse: g.warehouse });
        }
      });

      const allProductNames = Array.from(new Set([...products, ...groupedInventory.map(g => g.tenSP)])).filter(Boolean);
      allHistoricalProducts = allProductNames.map(pName => {
        const stockInfo = stockMap.get(pName);
        return {
          tenSP: pName,
          qty: stockInfo ? stockInfo.qty : 0,
          warehouse: stockInfo ? stockInfo.warehouse : ''
        };
      });
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
      allProducts: allHistoricalProducts || finalProductsList,
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
      warehouses: ["Chờ Ship"],
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
function savePurchaseOrder(formData, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const ss = ssTarget || (formData && formData.ssTarget) || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null);
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const requestId = formData ? (formData.requestId || formData.clientRequestId) : null;

    // 1. Idempotency Check
    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    let pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet) {
      pSheet = ss.insertSheet(SHEET_PURCHASE);
    }

    const newId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("PO-") : ("PO-" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90));
    const dateVal = formatBizDateServer(formData.ngay);
    const noiMua = String(formData.noiMua || "").trim();
    let trangThaiKho = String(formData.trangThaiKho || "").trim();
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
    if (!trangThaiKho || (isPreOrder && trangThaiKho === "Chờ Ship")) {
      trangThaiKho = isPreOrder ? "Đặt trước" : "Chờ Ship";
    }
    const ghiChuOrder = String(formData.ghiChuOrder || "").trim();

    // Tính toán Cooldown cho Tab 5 / Lịch Mua Cooldown
    const cooldownDays = (typeof getDefaultCooldownDays === 'function') ? getDefaultCooldownDays(noiMua) : (noiMua.toLowerCase().includes("yodo") ? 13 : 30);
    const ngayMuaDate = (typeof parseTab5Date === 'function') ? parseTab5Date(dateVal) : new Date(dateVal);
    const ngayKhaDungDate = new Date(ngayMuaDate.getTime());
    ngayKhaDungDate.setDate(ngayKhaDungDate.getDate() + cooldownDays);
    const ngayKhaDung = (typeof formatDateTab5Standard === 'function') ? formatDateTab5Standard(ngayKhaDungDate) : formatBizDateServer(ngayKhaDungDate);

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
      const itemTotal = it.total ? Math.round(Number(it.total)) : Math.round(qty * price);
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
      const startRow = pSheet.getLastRow() + 1;
      pSheet.getRange(startRow, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
    }

    const updatedWallets = [];

    // Nếu không phải Pre-order -> Ghi nhận Financial Event vào WalletLedger
    if (!isPreOrder && totalPurchaseAmt > 0) {
      if (typeof postFinancialEvents === 'function') {
        const pSourceType = isMuonThe ? "PARTNER_CARD" : (isCreditWallet ? "CREDIT" : "DEBIT");
        const pSourceId = isMuonThe ? doiTacMuon : nguonTien;
        
        let direction = "OUT";
        let effectType = "CASH";
        let eventType = "PURCHASE_CHARGE";

        if (pSourceType === "CREDIT") {
          direction = "INCREASE";
          effectType = "CARD_DEBT";
        } else if (pSourceType === "PARTNER_CARD") {
          direction = "INCREASE";
          effectType = "PARTNER_DEBT";
          eventType = "PARTNER_BORROW";
        }

        postFinancialEvents([{
          walletId: pSourceId,
          walletName: pSourceId,
          direction: direction,
          amount: totalPurchaseAmt,
          type: effectType,
          eventType: eventType,
          sourceModule: "Purchase",
          sourceId: newId,
          note: isMuonThe ? `Mượn thẻ ${doiTacMuon} mua hàng ${noiMua}` : `Nhập hàng từ ${noiMua} (${items.length} SP)`
        }], ss);
      }
    }

    // Nếu mượn tiền đối tác -> Tự động sinh công nợ bên Sheet Debt để đối soát
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
          nguonTien || "Thẻ đối tác",
          0,
          "",
          totalPurchaseAmt,
          "DANG_NO"
        ]);
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;
    let freshData = null;
    try { freshData = getBusinessData(null, null, ss); } catch(eFresh) {}

    const res = {
      success: true,
      message: "✅ Đã lưu đơn nhập mua hàng thành công!",
      savedItem: { id: newId, date: dateVal, totalAmount: totalPurchaseAmt, itemsCount: items.length },
      updatedWallets: updatedWallets,
      dataVersion: nextVersion,
      freshData: freshData
    };

    if (requestId && typeof recordProcessedRequest === 'function') {
      recordProcessedRequest(requestId, "DONE", res, ss);
    }

    return res;
  });
}

/**
 * 3. LƯU ĐƠN XUẤT BÁN HÀNG (SALES)
 */
function saveSalesOrder(formData, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const ss = ssTarget || (formData && formData.ssTarget) || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null);
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const requestId = formData ? (formData.requestId || formData.clientRequestId) : null;

    // 1. Idempotency Check
    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    let sSheet = ss.getSheetByName(SHEET_SALES);
    if (!sSheet) {
      sSheet = ss.insertSheet(SHEET_SALES);
    }

    const newId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("SO-") : ("SO-" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90));
    const dateVal = formatBizDateServer(formData.ngay);
    const items = formData.items || [];
    const nhanTienVao = String(formData.nhanTienVao || "").trim();
    const isKhachNo = Boolean(formData.isKhachNo);

    let totalSalesAmt = 0;
    let totalOrderCOGS = 0;
    const rowsToAppend = [];
    const allocatedItemIds = [];

    items.forEach((it, idx) => {
      const tenSP = String(it.tenSP || "").trim();
      if (!tenSP) return;
      const qty = Number(it.qty) || 1;
      const price = Number(it.price) || 0;
      const itemTotal = qty * price;
      totalSalesAmt += itemTotal;
      const noiTru = String(it.noiTru || "").trim();

      let ghiChu = isKhachNo ? "[Khách Nợ]" : "";
      if (it.ghiChu) ghiChu += " " + it.ghiChu;

      const itemId = items.length > 1 ? `${newId}-${idx + 1}` : newId;
      const statusThanhToan = isKhachNo ? "CHO_THU" : "HOAN_TAT";

      // Phân bổ FIFO & Tính COGS
      let itemCOGS = 0;
      if (typeof allocateSaleFIFOCost === 'function') {
        const allocRes = allocateSaleFIFOCost(itemId, tenSP, qty, noiTru, dateVal, ss);
        if (allocRes && allocRes.success) {
          itemCOGS = allocRes.totalCOGS;
          allocatedItemIds.push(itemId);
        }
      }
      totalOrderCOGS += itemCOGS;
      const itemLoiNhuan = itemTotal - itemCOGS;

      rowsToAppend.push([
        itemId,
        dateVal,
        tenSP,
        noiTru,
        qty,
        price,
        itemTotal,
        0, // Tồn kho cột H
        isKhachNo ? "Khách Nợ" : nhanTienVao,
        statusThanhToan,
        ghiChu.trim(),
        itemCOGS,
        itemLoiNhuan
      ]);
    });

    if (rowsToAppend.length > 0) {
      const startRow = sSheet.getLastRow() + 1;
      sSheet.getRange(startRow, 1, rowsToAppend.length, Math.max(sSheet.getLastColumn(), 13)).setValues(rowsToAppend);
    }

    const updatedWallets = [];

    // Nếu không phải Khách Nợ -> Ghi nhận Financial Event vào WalletLedger
    if (!isKhachNo && totalSalesAmt > 0 && nhanTienVao) {
      if (typeof postFinancialEvents === 'function') {
        const postRes = postFinancialEvents([{
          walletId: nhanTienVao,
          walletName: nhanTienVao,
          direction: "IN",
          amount: totalSalesAmt,
          type: "CASH",
          eventType: "SALE_COLLECT",
          sourceModule: "Sales",
          sourceId: newId,
          note: `Bán hàng (${items.length} SP)`
        }], ss);

        if (postRes && !postRes.success) {
          // Rollback FIFO nếu post event thất bại
          if (typeof rollbackSaleFIFOCost === 'function') {
            allocatedItemIds.forEach(id => rollbackSaleFIFOCost(id, ss));
          }
          return { success: false, message: "❌ Lỗi ghi nhận dòng tiền: " + postRes.message };
        }
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;
    let freshData = null;
    try { freshData = getBusinessData(null, null, ss); } catch(eFresh) {}

    const res = {
      success: true,
      message: `✅ Đã xuất bán đơn hàng thành công! (Doanh thu: ${totalSalesAmt.toLocaleString()} ¥, Giá vốn: ${totalOrderCOGS.toLocaleString()} ¥)`,
      savedItem: { id: newId, date: dateVal, totalSales: totalSalesAmt, totalCOGS: totalOrderCOGS, itemsCount: items.length },
      updatedWallets: updatedWallets,
      dataVersion: nextVersion,
      freshData: freshData
    };

    if (requestId && typeof recordProcessedRequest === 'function') {
      recordProcessedRequest(requestId, "DONE", res, ss);
    }

    return res;
  });
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

    const idSet = new Set(idArray.flatMap(id => String(id).split(',')).map(s => s.trim()).filter(Boolean));
    let totalAmt = 0;
    let purchaseTotalAmt = 0;
    const purchaseMapByWallet = {};
    let hasChanges = false;
    let dateVal = customDate ? formatBizDateServer(customDate) : formatBizDateServer(new Date());

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
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

          // Tự động chuyển kho từ Đặt trước sang Chờ Ship
          const curWh = String(data[i][3] || "").trim().toLowerCase();
          if (curWh.includes("đặt trước") || curWh.includes("dat truoc") || curWh.includes("preorder") || curWh.includes("pre-order")) {
            data[i][3] = "Chờ Ship";
          }

          const qty = parseBizMoney(data[i][5]);
          const price = parseBizMoney(data[i][6]);
          const itemTotal = parseBizMoney(data[i][7]) || (qty * price);
          totalAmt += itemTotal;
          purchaseTotalAmt += itemTotal;

          const nguonTien = String(data[i][8] || "").trim() || "Thẻ";
          purchaseMapByWallet[nguonTien] = (purchaseMapByWallet[nguonTien] || 0) + itemTotal;
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

    // Ghi nhận Financial Event cho các đơn hàng Purchase đã trừ thẻ
    if (purchaseTotalAmt > 0 && typeof postFinancialEvents === 'function') {
      const linkedIdsStr = Array.from(idSet).join(", ");
      const events = [];
      Object.keys(purchaseMapByWallet).forEach((w) => {
        const amt = purchaseMapByWallet[w];
        const isCredit = isCreditCardWallet(w, ss);
        events.push({
          walletId: w,
          walletName: w,
          transactionDate: dateVal,
          direction: isCredit ? "INCREASE" : "OUT",
          amount: amt,
          type: isCredit ? "CARD_DEBT" : "CASH",
          eventType: "PREORDER_CHARGE",
          sourceModule: "Purchase",
          sourceId: linkedIdsStr,
          note: `Trừ thẻ thực tế pre-order (${idSet.size} đơn)`
        });
      });
      postFinancialEvents(events, ss);
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

    const sSheet = ss.getSheetByName(SHEET_SALES);
    if (!sSheet || sSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Sales." };

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

    if (collectedItems.length > 0 && totalCollected > 0 && typeof postFinancialEvents === 'function') {
      const logDate = (dateStr && String(dateStr).trim()) ? String(dateStr).trim() : formatBizDateServer(new Date());
      postFinancialEvents([{
        walletId: wallet,
        walletName: wallet,
        transactionDate: logDate,
        direction: "IN",
        amount: totalCollected,
        type: "CASH",
        eventType: "CUSTOMER_COLLECT",
        sourceModule: "Sales",
        sourceId: itemIds.join(", "),
        note: `Thu tiền đơn khách nợ (${collectedItems.length} SP)`
      }], ss);
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

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Purchase." };

    const idArray = Array.isArray(itemIds) ? itemIds : [itemIds];
    if (idArray.length === 0) return { success: false, message: "❌ Chưa chọn đơn hàng pre-order nào." };

    const idSet = new Set(idArray.flatMap(id => String(id).split(',')).map(s => s.trim()).filter(Boolean));
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
        const cardStatusRaw = String(data[i][9] || "").trim().toLowerCase();
        const cardDone = cardStatusRaw.includes("hoan_tat") || cardStatusRaw.includes("da_tru") || cardStatusRaw.includes("đã trừ");

        pSheet.getRange(rowIndex, 4).setValue("Hủy");
        pSheet.getRange(rowIndex, 10).setValue(cardDone ? "CHO_HOAN_TIEN" : "HUY");
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
    return { success: true, message: `✅ Đã hủy ${cancelledCount} đơn hàng đặt trước!`, freshData: freshData };
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
function updateWarehouseStatus(targetId, newStatus, reason, ssTarget) {
  try {
    const ss = ssTarget || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Purchase." };

    const targetStr = String(targetId || "").trim();
    const isCancel = (newStatus === 'CANCEL' || newStatus === 'Hủy' || newStatus === 'BỊ HỦY' || newStatus === 'BỊ HỦY - CHỜ HOÀN');
    const maxCol = Math.max(pSheet.getLastColumn(), 17);
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, maxCol).getValues();

    let matched = false;
    const targetStatus = isCancel ? "Hủy" : newStatus;
    const ckSheet = getOrCreateStockTransferSheetHelper(ss);
    const ckRows = [];
    let cancelLimitId = null;

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndexStr = String(i + 2);
      const rIdLower = rowId.toLowerCase();
      const targetLower = targetStr.toLowerCase();

      const isMatch = (
        (rowId && rIdLower === targetLower) ||
        rowIndexStr === targetStr ||
        (rowId && (rIdLower.startsWith(targetLower + "-") || rIdLower.startsWith(targetLower + "_"))) ||
        (rowId && (targetLower.startsWith(rIdLower + "-") || targetLower.startsWith(rIdLower + "_")))
      );

      if (isMatch) {
        const currentWh = String(data[i][3] || "").trim();
        const currentWhLower = currentWh.toLowerCase();
        const isPendingWh = (currentWh === "Chờ Ship" || currentWhLower.includes("chờ ship") || currentWhLower.includes("chusen") || currentWhLower.includes("đặt trước") || currentWhLower.includes("preorder"));
        if (isCancel && !isPendingWh) {
          return { success: false, message: "❌ Chỉ đơn hàng ở trạng thái 'Đặt trước', 'Chờ Ship' hoặc 'Chusen' mới được Hủy!" };
        }
        const rowIndex = i + 2;
        const fromWh = currentWh || "Chờ Ship";
        const spName = String(data[i][4] || "").trim();
        const origQty = parseBizMoney(data[i][5]);

        data[i][3] = targetStatus;

        const lowerWhCheck = targetStatus.toLowerCase();
        const isWhInStock = !lowerWhCheck.includes("chờ ship") && !lowerWhCheck.includes("chusen") && !lowerWhCheck.includes("đặt trước") && !lowerWhCheck.includes("preorder") && !lowerWhCheck.includes("hủy") && !lowerWhCheck.includes("cancel");

        if (isWhInStock) {
          const curTon = parseBizMoney(data[i][11]);
          if (!curTon || curTon <= 0) {
            data[i][11] = origQty || 1;
          }
        } else if (!isCancel) {
          data[i][11] = "";
        }

        if (ckSheet) {
          const nowStr = typeof Utilities !== 'undefined' && Utilities.formatDate 
            ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy HH:mm:ss")
            : new Date().toLocaleString("vi-VN");
          ckRows.push([
            "CK_" + Date.now() + "_1",
            nowStr,
            rowId || rowIndexStr,
            spName,
            fromWh,
            targetStatus,
            origQty || 1,
            "Admin",
            reason || `Chuyển đơn hàng từ ${fromWh} sang ${targetStatus}`
          ]);
        }

        if (isCancel) {
          const wasDatTruoc = currentWhLower.includes("đặt trước") || currentWhLower.includes("preorder");
          const cardStatusRaw = String(data[i][9] || "").trim().toLowerCase();
          const cardDone = cardStatusRaw.includes("hoan_tat") || cardStatusRaw.includes("da_tru") || cardStatusRaw.includes("đã trừ");
          if (wasDatTruoc && !cardDone) {
            data[i][9] = "HUY";
          } else {
            data[i][9] = "CHO_HOAN_TIEN";
          }
          data[i][11] = 0;
          if (maxCol >= 17) data[i][16] = "KET_THUC";
          cancelLimitId = rowId;
        }
        matched = true;
        break;
      }
    }

    if (!matched) return { success: false, message: "❌ Không tìm thấy đơn hàng cần chuyển kho." };

    pSheet.getRange(2, 1, data.length, data[0].length).setValues(data);
    if (ckSheet && ckRows.length > 0) {
      ckSheet.getRange(ckSheet.getLastRow() + 1, 1, ckRows.length, ckRows[0].length).setValues(ckRows);
    }
    if (cancelLimitId && typeof updatePurchaseLimitStatus === 'function') {
      updatePurchaseLimitStatus(cancelLimitId, "KET_THUC");
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return { success: true, message: `✅ Đã chuyển trạng thái kho sang ${isCancel ? "Hủy" : newStatus}`, freshData: freshData };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

/**
 * Helper to safely get or create STOCK_TRANSFER sheet with standard headers
 */
function getOrCreateStockTransferSheetHelper(ssTarget) {
  try {
    var ss = ssTarget || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
    if (!ss) return null;

    var existing = ss.getSheetByName("STOCK_TRANSFER") || 
                   ss.getSheetByName("STOCK TRANSFER") || 
                   ss.getSheetByName("CHUYEN_KHO") || 
                   ss.getSheetByName("Chuyển Kho") || 
                   ss.getSheetByName("Chuyen Kho");
    if (existing) return existing;

    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var name = String(sheets[i].getName() || "").trim().toUpperCase();
      if (name.includes("STOCK_TRANSFER") || name.includes("STOCK TRANSFER") || name.includes("CHUYEN") || name.includes("CHUYỂN")) {
        return sheets[i];
      }
    }

    var ckSheet = ss.insertSheet("STOCK_TRANSFER");
    return ckSheet;
  } catch (err) {
    try {
      var ssFallback = ssTarget || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
      if (ssFallback) {
        return ssFallback.getSheetByName("STOCK_TRANSFER") || 
               ssFallback.getSheetByName("STOCK TRANSFER") || 
               ssFallback.getSheetByName("CHUYEN_KHO") || 
               ssFallback.getSheetByName("Chuyển Kho") || null;
      }
    } catch(e2) {}
    return null;
  }
}

/**
 * 5.2. CHUYỂN KHO THÔNG MINH THEO SẢN PHẨM & KHO NGUỒN
 */
function transferWarehouseBatch(spName, fromWarehouse, toWarehouse, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Purchase." };

    const spTarget = String(spName || "").trim();
    const spTargetLower = spTarget.toLowerCase();
    const fromWh = String(fromWarehouse || "").trim();
    const fromWhLower = fromWh.toLowerCase();
    const toWh = String(toWarehouse || "").trim();

    if (!spTarget || !toWh) return { success: false, message: "❌ Vui lòng chọn sản phẩm và kho đích hợp lệ!" };

    const isCancel = (toWh === 'CANCEL' || toWh === 'BỊ HỦY' || toWh === 'BỊ HỦY - CHỜ HOÀN' || toWh === 'Hủy');
    const maxCol = Math.max(pSheet.getLastColumn(), 17);
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, maxCol).getValues();

    if (isCancel) {
      for (let i = 0; i < data.length; i++) {
        const rowSp = String(data[i][4] || "").trim().toLowerCase();
        const rowWh = String(data[i][3] || "").trim();
        const rowWhLower = rowWh.toLowerCase();
        const isRowPendingWh = (rowWh === 'Chờ Ship' || rowWhLower.includes('chờ ship') || rowWhLower.includes('chusen'));
        if (rowSp === spTargetLower && (!fromWh || fromWh === 'ALL' || fromWhLower === 'all' || rowWhLower === fromWhLower)) {
          if (!isRowPendingWh) {
            return { success: false, message: "❌ Chỉ đơn hàng ở trạng thái 'Chờ Ship' hoặc 'Chusen' mới được Hủy!" };
          }
        }
      }
    }

    let updatedCount = 0;
    const targetStatus = isCancel ? "Hủy" : toWh;
    const ckSheet = getOrCreateStockTransferSheetHelper(ss);
    const nowStr = typeof Utilities !== 'undefined' && Utilities.formatDate 
      ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy HH:mm:ss")
      : new Date().toLocaleString("vi-VN");

    const ckRows = [];
    const cancelLimitRowIds = [];

    for (let i = 0; i < data.length; i++) {
      const rowSp = String(data[i][4] || "").trim().toLowerCase();
      const rowWh = String(data[i][3] || "").trim();
      const rowWhLower = rowWh.toLowerCase();
      const rowId = String(data[i][0] || "").trim();
      if (rowSp === spTargetLower && (!fromWh || fromWh === 'ALL' || fromWhLower === 'all' || rowWhLower === fromWhLower)) {
        const rowIndex = i + 2;
        const fromWhActual = rowWh || "Chờ Ship";
        data[i][3] = targetStatus;
        updatedCount++;

        if (ckSheet) {
          const qtyVal = parseBizMoney(data[i][5]) || 1;
          ckRows.push([
            "CK_" + Date.now() + "_" + updatedCount,
            nowStr,
            rowId || String(rowIndex),
            spTarget,
            fromWhActual,
            targetStatus,
            qtyVal,
            "Admin",
            `Chuyển kho sản phẩm "${spTarget}" từ ${fromWhActual} sang ${targetStatus}`
          ]);
        }

        if (isCancel) {
          data[i][9] = "CHO_HOAN_TIEN";
          data[i][11] = 0;
          if (maxCol >= 17) data[i][16] = "KET_THUC";
          cancelLimitRowIds.push(rowId);
        } else if (targetStatus !== "Chờ Ship" && !targetStatus.toLowerCase().includes("chusen")) {
          const curTon = parseBizMoney(data[i][11]);
          if (!curTon || curTon <= 0) {
            data[i][11] = parseBizMoney(data[i][5]);
          }
        } else {
          data[i][11] = "";
        }
      }
    }

    if (updatedCount === 0) {
      return { success: false, message: "❌ Không tìm thấy sản phẩm phù hợp ở kho nguồn." };
    }

    pSheet.getRange(2, 1, data.length, data[0].length).setValues(data);
    if (ckSheet && ckRows.length > 0) {
      ckSheet.getRange(ckSheet.getLastRow() + 1, 1, ckRows.length, ckRows[0].length).setValues(ckRows);
    }
    if (cancelLimitRowIds.length > 0 && typeof updatePurchaseLimitStatus === 'function') {
      cancelLimitRowIds.forEach(id => updatePurchaseLimitStatus(id, "KET_THUC"));
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
function updateBatchWarehouseStatus(itemIds, newStatus, ssTarget) {
  try {
    const ss = ssTarget || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Purchase." };

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
        let isTargetRow = false;

        for (let k in transferMap) {
          const kClean = String(k || "").trim().toLowerCase();
          const kNoRow = kClean.replace(/^row_/i, "");
          const rIdLower = rowId.toLowerCase();
          if (
            (rowId && rIdLower === kClean) ||
            kClean === rowIndexStr ||
            kNoRow === rowIndexStr ||
            (rowId && (rIdLower.startsWith(kClean + "-") || rIdLower.startsWith(kClean + "_"))) ||
            (rowId && (kClean.startsWith(rIdLower + "-") || kClean.startsWith(rIdLower + "_")))
          ) {
            isTargetRow = true;
            break;
          }
        }

        if (isTargetRow) {
          const currentWh = String(data[i][3] || "").trim().toLowerCase();
          const isPendingWh = (currentWh === "chờ ship" || currentWh.includes("chờ ship") || currentWh.includes("chusen") || currentWh.includes("đặt trước") || currentWh.includes("preorder"));
          if (!isPendingWh) {
            return { success: false, message: "❌ Chỉ đơn hàng ở trạng thái 'Đặt trước', 'Chờ Ship' hoặc 'Chusen' mới được Hủy!" };
          }
        }
      }
    }

    // Ensure STOCK_TRANSFER sheet exists safely without exception
    const ckSheet = getOrCreateStockTransferSheetHelper(ss);

    let updatedCount = 0;
    const nowStr = typeof Utilities !== 'undefined' && Utilities.formatDate 
      ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy HH:mm:ss")
      : new Date().toLocaleString("vi-VN");

    const ckRows = [];
    const newSplitRows = [];
    const cancelLimitRowIds = [];

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndexStr = String(i + 2);
      let matchKey = null;

      if (rowId && Object.prototype.hasOwnProperty.call(transferMap, rowId)) {
        matchKey = rowId;
      } else if (Object.prototype.hasOwnProperty.call(transferMap, rowIndexStr)) {
        matchKey = rowIndexStr;
      } else {
        for (let k in transferMap) {
          const kClean = String(k || "").trim().toLowerCase();
          const kNoRow = kClean.replace(/^row_/i, "");
          const rIdLower = rowId.toLowerCase();

          if (
            (rowId && rIdLower === kClean) ||
            kClean === rowIndexStr ||
            kNoRow === rowIndexStr ||
            (rowId && (rIdLower.startsWith(kClean + "-") || rIdLower.startsWith(kClean + "_"))) ||
            (rowId && (kClean.startsWith(rIdLower + "-") || kClean.startsWith(rIdLower + "_")))
          ) {
            matchKey = k;
            break;
          }
        }
      }

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
          data[i][3] = targetStatus;
          updatedCount++;

          if (ckSheet) {
            ckRows.push([
              "CK_" + Date.now() + "_" + updatedCount,
              nowStr,
              rowId || rowIndexStr,
              spName,
              fromWh,
              targetStatus,
              origQty,
              "Admin",
              `Chuyển toàn bộ ${origQty} SP từ ${fromWh} sang ${targetStatus}`
            ]);
          }

          if (isCancel) {
            const wasDatTruoc = fromWh.toLowerCase().includes("đặt trước") || fromWh.toLowerCase().includes("preorder");
            const cardStatusRaw = String(data[i][9] || "").trim().toLowerCase();
            const cardDone = cardStatusRaw.includes("hoan_tat") || cardStatusRaw.includes("da_tru") || cardStatusRaw.includes("đã trừ");
            if (wasDatTruoc && !cardDone) {
              data[i][9] = "HUY";
            } else {
              data[i][9] = "CHO_HOAN_TIEN";
            }
            data[i][11] = 0;
            if (lastCol >= 17) data[i][16] = "KET_THUC";
            cancelLimitRowIds.push(rowId || rowIndexStr);
          } else if (targetStatus.toLowerCase().includes("chờ ship") || targetStatus.toLowerCase().includes("chusen") || targetStatus.toLowerCase().includes("đặt trước") || targetStatus.toLowerCase().includes("preorder")) {
            data[i][11] = "";
          } else {
            const curTon = parseBizMoney(data[i][11]);
            if (!curTon || curTon <= 0) {
              data[i][11] = origQty;
            }
          }
        } else {
          // Partial transfer -> Row Splitting (Option A)
          const remainingQty = origQty - reqQty;
          const remainingTotal = remainingQty * origPrice;
          const newTonKhoOrig = Math.max(0, origTonKho - reqQty);

          data[i][5] = remainingQty;
          data[i][7] = remainingTotal;
          data[i][11] = newTonKhoOrig;

          const newRowId = (rowId ? rowId : rowIndexStr) + "_CK";
          const newGhiChu = (String(data[i][10] || "").trim() + ` [Tách từ #${rowId || rowIndexStr}]`).trim();
          const isTargetInStock = !targetStatus.toLowerCase().includes("chờ ship") && !targetStatus.toLowerCase().includes("chusen") && !targetStatus.toLowerCase().includes("đặt trước") && !targetStatus.toLowerCase().includes("preorder") && !targetStatus.toLowerCase().includes("hủy") && !targetStatus.toLowerCase().includes("cancel");
          const splitTonKho = isTargetInStock ? reqQty : "";

          const newRow = [...data[i]];
          newRow[0] = newRowId;
          newRow[3] = targetStatus;
          newRow[5] = reqQty;
          newRow[7] = reqQty * origPrice;
          newRow[10] = newGhiChu;
          newRow[11] = splitTonKho;

          if (isCancel) {
            const wasDatTruoc = fromWh.toLowerCase().includes("đặt trước") || fromWh.toLowerCase().includes("preorder");
            const cardStatusRaw = String(data[i][9] || "").trim().toLowerCase();
            const cardDone = cardStatusRaw.includes("hoan_tat") || cardStatusRaw.includes("da_tru") || cardStatusRaw.includes("đã trừ");
            if (wasDatTruoc && !cardDone) {
              newRow[9] = "HUY";
            } else {
              newRow[9] = "CHO_HOAN_TIEN";
            }
            newRow[11] = 0;
            if (lastCol >= 17) newRow[16] = "KET_THUC";
            cancelLimitRowIds.push(newRowId);
          }

          newSplitRows.push(newRow);
          updatedCount++;

          if (ckSheet) {
            ckRows.push([
              "CK_" + Date.now() + "_" + updatedCount,
              nowStr,
              rowId || rowIndexStr,
              spName,
              fromWh,
              targetStatus,
              reqQty,
              "Admin",
              `Tách dòng: Chuyển ${reqQty}/${origQty} SP từ ${fromWh} sang ${targetStatus}`
            ]);
          }
        }
      }
    }

    if (updatedCount === 0) {
      return { success: false, message: "❌ Không tìm thấy đơn hàng phù hợp để chuyển kho." };
    }

    // Batch write updated data
    pSheet.getRange(2, 1, data.length, data[0].length).setValues(data);

    // Batch append new split rows if any
    if (newSplitRows.length > 0) {
      pSheet.getRange(lastRow + 1, 1, newSplitRows.length, newSplitRows[0].length).setValues(newSplitRows);
    }

    // Batch append stock transfer logs if any
    if (ckSheet && ckRows.length > 0) {
      ckSheet.getRange(ckSheet.getLastRow() + 1, 1, ckRows.length, ckRows[0].length).setValues(ckRows);
    }

    if (cancelLimitRowIds.length > 0 && typeof updatePurchaseLimitStatus === 'function') {
      cancelLimitRowIds.forEach(id => updatePurchaseLimitStatus(id, "KET_THUC"));
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    const statusDisp = isCancel ? 'Hủy' : newWh;
    return { success: true, message: `✅ Đã chuyển ${updatedCount} đơn hàng sang "${statusDisp}"!`, freshData: freshData };
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

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Purchase." };

    let targetIds = [];
    if (Array.isArray(orderId)) {
      targetIds = orderId.map(id => String(id || '').trim()).filter(Boolean);
    } else {
      targetIds = String(orderId || '').split(',').map(id => String(id || '').trim()).filter(Boolean);
    }

    if (targetIds.length === 0) return { success: false, message: "❌ Chưa chọn mã đơn hàng cần nhận hoàn tiền." };

    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 11).getValues();
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
      const currentCardStatus = String(targetRow[9] || "").trim().toUpperCase();
      if (currentCardStatus === "DA_HOAN_TIEN" || currentCardStatus === "ĐÃ HOÀN TIỀN") continue;

      const totalAmt = parseMoneyNumber(targetRow[7]);
      const walletName = String(targetWallet || targetRow[8] || "Ví Tiền Mặt").trim();
      const tenSP = String(targetRow[4] || "Sản phẩm").trim();

      // Cột D (trạng thái kho) vẫn phải là Hủy, chỉ đổi Cột J (trạng thái thẻ) là đã hoàn tiền
      pSheet.getRange(foundIndex, 4).setValue("Hủy");
      pSheet.getRange(foundIndex, 10).setValue("DA_HOAN_TIEN");
      const existingGhiChu = String(targetRow[10] || "");
      pSheet.getRange(foundIndex, 11).setValue((existingGhiChu + ` [DA_HOAN_TIEN - Ngày: ${dateStrFormatted} - Ví: ${walletName}]`).trim());

      if (typeof postFinancialEvents === 'function') {
        const isCredit = isCreditCardWallet(walletName, ss);
        const direction = isCredit ? "DECREASE" : "IN";
        const effectType = isCredit ? "CARD_DEBT" : "CASH";
        const eventType = isCredit ? "REFUND_CARD_DEBT" : "REFUND_CASH";

        postFinancialEvents([{
          walletId: walletName,
          walletName: walletName,
          transactionDate: dateStrFormatted,
          direction: direction,
          amount: totalAmt,
          type: effectType,
          eventType: eventType,
          sourceModule: "Purchase",
          sourceId: String(targetRow[0] || ""),
          note: `Hoàn tiền đơn hủy #${targetRow[0]} (${tenSP})`
        }], ss);
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

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Purchase." };

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
        pSheet.getRange(rowIndex, 8).setValue(Math.round(qtyVal * priceVal));
        
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

        const targetCardStatus = (newCardStatus !== undefined && newCardStatus !== null && String(newCardStatus).trim()) ? String(newCardStatus).trim() : String(data[i][9] || "").trim();
        const targetNguonTien = (newNguonTien !== undefined && newNguonTien !== null && String(newNguonTien).trim()) ? String(newNguonTien).trim() : String(data[i][8] || "").trim();
        const oldNguonTien = String(data[i][8] || "").trim();
        const oldTotal = (parseBizMoney(data[i][5]) || 1) * (parseBizMoney(data[i][6]) || 0);
        const newTotal = qtyVal * priceVal;
        const purchaseOrderId = rowId || targetStr;

        // Đồng bộ sự kiện vào WalletLedger khi sửa đơn mua
        if (typeof replaceFinancialEvents === 'function' && purchaseOrderId) {
          const isDone = (targetCardStatus === "HOAN_TAT" || targetCardStatus === "ĐÃ TRỪ" || targetCardStatus === "ĐÃ SAO KÊ");
          if (isDone && targetNguonTien && newTotal > 0) {
            const isCredit = isCreditCardWallet(targetNguonTien, ss);
            const direction = isCredit ? "INCREASE" : "OUT";
            const effectType = isCredit ? "CARD_DEBT" : "CASH";
            replaceFinancialEvents(purchaseOrderId, [{
              walletId: targetNguonTien,
              walletName: targetNguonTien,
              date: formattedDate || rawNgayMua,
              amount: newTotal,
              direction: direction,
              effectType: effectType,
              eventType: "PURCHASE_CHARGE",
              sourceModule: "Purchase",
              sourceId: purchaseOrderId,
              note: `Nhập hàng từ ${currentNoi} (${targetSp})`
            }], "Sửa đơn mua Purchase", ss);
          } else if (typeof reverseFinancialEvents === 'function' && (targetCardStatus === "PRE-ORDER" || targetCardStatus === "CHO_HOAN_TIEN" || isCancelled)) {
            reverseFinancialEvents(purchaseOrderId, "Chuyển trạng thái Purchase", ss);
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

function saveBatchPurchaseOrderEdit(payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
      return { success: false, message: "❌ Không có danh sách sản phẩm để cập nhật!" };
    }

    const { ngayMua, noiMua, nguonTien, trangThaiThe, taiKhoan, items } = payload;
    let updatedCount = 0;

    items.forEach(it => {
      const res = updatePurchaseItemDetail(
        it.id,
        it.trangThaiKho,
        it.qty,
        it.price,
        it.ghiChu,
        noiMua,
        it.tenSP,
        ngayMua,
        nguonTien,
        trangThaiThe,
        taiKhoan
      );
      if (res && res.success) updatedCount++;
    });

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return {
      success: true,
      message: `✅ Đã cập nhật thành công ${updatedCount} món của đơn hàng!`,
      freshData: freshData
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

