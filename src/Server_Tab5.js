function normalizeTab5Store(cuaHang) {
  if (!cuaHang) return "Cửa Hàng Mặc Định";
  const stLower = String(cuaHang).trim().toLowerCase();
  if (stLower.includes("yodo") || stLower.includes("yodobashi")) {
    return "Yodo";
  }
  if (stLower.includes("joshin")) return "Joshin";
  if (stLower.includes("edion")) return "Edion";
  if (stLower.includes("fuji")) return "Fuji";
  if (stLower.includes("amazon") || stLower.includes("amz")) return "Amazon";
  return String(cuaHang).trim();
}

function removeAccentsTab5(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function getAccountCleanKey(accName, storeName) {
  let str = String(accName || "").trim();
  if (!str) return "";
  str = str.replace(/^tk\s*/i, "");
  let lower = removeAccentsTab5(str).toLowerCase();
  let stLower = removeAccentsTab5(storeName || "").toLowerCase();
  if (stLower && !lower.includes("joshin") && !lower.includes("yodo") && !lower.includes("edion") && !lower.includes("fuji") && !lower.includes("amazon")) {
    str = storeName + " " + str;
    lower = removeAccentsTab5(str).toLowerCase();
  }
  let cleanKey = lower.replace(/[\s\-_]/g, "");
  if (cleanKey.endsWith("chitis")) cleanKey = cleanKey.replace("chitis", "chit");
  return cleanKey;
}

// ==========================================
// FILE: Server_Tab5.js
// NHIỆM VỤ: Quản Lý Lịch Mua Hàng, Giới Hạn Tài Khoản & Cooldown Đặt Hàng
// ==========================================

function getTab5Sheet(ssTarget) {
  const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss ? (ss.getSheetByName("Calendar") || ss.getSheetByName("LichMua")) : null;
  if (ss && !sheet) {
    sheet = ss.insertSheet("Calendar");
    sheet.appendRow([
      "ID",             // A
      "NgayMua",        // B
      "TaiKhoan",       // C
      "CuaHang",        // D
      "TenSanPham",     // E
      "SoNgayCooldown", // F
      "NgayKhaDung",    // G
      "TrangThai",      // H: THANH_CONG / DA_HUY
      "MaDonTab3",      // I: ID đơn từ Tab 3 (nếu có)
      "GhiChu"          // J
    ]);
    sheet.getRange(1, 1, 1, 10).setFontWeight("bold").setBackground("#e2e8f0");
  }
  return sheet;
}

function parseTab5Date(dateStr) {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) return dateStr;
  const str = String(dateStr).trim();
  if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const parts = str.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }
  const matchDMY = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (matchDMY) {
    return new Date(parseInt(matchDMY[3], 10), parseInt(matchDMY[2], 10) - 1, parseInt(matchDMY[1], 10));
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? new Date() : d;
}

function formatDateTab5Standard(d) {
  if (!d || isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateTab5Display(d) {
  if (!d || isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}`;
}

function getProductCategory(tenSP, storeName) {
  if (!tenSP) return "Khác";
  const clean = removeAccentsTab5(String(tenSP)).trim().toLowerCase();

  const isWhite = clean === "film mini instax" || clean.includes("trang") || clean.includes("white") || clean.includes("monochrome");

  return isWhite ? "Film MINI Trắng" : "Film MINI Màu";
}

function isFilmProduct(productName) {
  if (!productName) return false;
  const clean = removeAccentsTab5(String(productName)).trim().toLowerCase();
  return clean.startsWith("film");
}

function getStoreCooldownSettings() {
  const defaultSettings = {
    "Fuji": 30,
    "Yodo": 13,
    "Joshin": 30
  };
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      const props = PropertiesService.getScriptProperties();
      const raw = props.getProperty("STORE_COOLDOWN_SETTINGS");
      if (raw) {
        const parsed = JSON.parse(raw);
        return Object.assign({}, defaultSettings, parsed);
      }
    }
  } catch (e) {}
  return defaultSettings;
}

function saveStoreCooldownSettings(newSettings) {
  try {
    if (!newSettings || typeof newSettings !== 'object') {
      return { success: false, message: "❌ Dữ liệu cấu hình không hợp lệ!" };
    }
    const current = getStoreCooldownSettings();
    for (const key in newSettings) {
      const num = parseInt(newSettings[key], 10);
      if (!isNaN(num) && num >= 0) {
        current[key] = num;
      }
    }
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      PropertiesService.getScriptProperties().setProperty("STORE_COOLDOWN_SETTINGS", JSON.stringify(current));
    }
    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, message: "✅ Đã lưu số ngày Cooldown theo cửa hàng thành công!", settings: current };
  } catch (err) {
    return { success: false, message: "❌ Lỗi lưu cấu hình: " + err.toString() };
  }
}

function getDefaultCooldownDays(storeName, productName) {
  if (productName && !isFilmProduct(productName)) return 0;
  if (!storeName) return 0;
  const settings = getStoreCooldownSettings();
  const clean = String(storeName).toLowerCase();
  for (const storeKey in settings) {
    if (clean.includes(storeKey.toLowerCase())) {
      return settings[storeKey];
    }
  }
  return 0;
}

function isRealAccountName(name) {
  if (!name) return false;
  const str = String(name).trim();
  if (!str) return false;
  const lower = removeAccentsTab5(str).toLowerCase();

  const ignoredHeaders = ["tai khoan mua", "tài khoản mua", "tai khoan", "tài khoản", "tai khoan dat hang", "tài khoản đặt hàng", "tk mua", "danh sach tai khoan", "danh sách tài khoản", "tk mac dinh", "tk mặc định"];
  if (ignoredHeaders.includes(lower)) return false;

  const ignoredStatuses = ["cho ship", "chờ ship", "chusen", "huy", "hủy", "pre-order", "preorder", "da_huy", "ket_thuc", "kết thúc", "dang_cho", "đang chờ", "thanh_cong", "thành công", "tk mac dinh", "tk mặc định"];
  if (ignoredStatuses.includes(lower)) return false;

  const ignoredWarehouses = ["kho 1f", "kho 2f", "kho 3f", "ton kho", "tồn kho", "vemaybay", "vé máy bay", "an uong", "ăn uống", "tieu dung", "tiêu dùng", "gia dinh", "gia đình"];
  if (ignoredWarehouses.includes(lower)) return false;

  const parts = str.split(/\s+/);
  if (parts.length === 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) {
    const knownStoresRepeated = ["7net", "aeon", "anhyo", "bandai", "doratsuya", "iris", "itoyo", "jfa", "jump", "nike", "rakuten", "tiem", "tiệm"];
    if (knownStoresRepeated.includes(removeAccentsTab5(parts[0]).toLowerCase())) {
      return false;
    }
  }

  const nonCooldownStores = ["7net", "aeon", "bandai", "doratsuya", "edion", "amazon", "amz", "bicamera", "pokecenta", "family", "iris", "itoyo", "jfa", "jump", "nike", "rakuten", "tiem", "tiệm"];
  if (nonCooldownStores.includes(lower)) return false;

  return true;
}

function getTab5Data(ssTarget) {
  const cacheKey = "tab5_data_v7";
  if (!ssTarget && typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
    try {
      const cached = CacheService.getScriptCache().get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch(e) {}
  }

  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const accountsSet = new Set();
    const storesSet = new Set(["Fuji", "Yodo", "Joshin"]);

    // Đọc danh sách Tài Khoản mua CHỈ từ Sheet Categories Cột G (Column 7, index 6)
    if (ss) {
      const catSheet = ss.getSheetByName("Categories") || ss.getSheetByName("DanhMuc");
      if (catSheet && catSheet.getLastRow() >= 2) {
        const lastRow = catSheet.getLastRow();
        const lastCol = Math.max(catSheet.getLastColumn(), 11);
        const catData = catSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
        catData.forEach(r => {
          const accG = String(r[6] || "").trim(); // Column G (Index 6)
          if (accG && isRealAccountName(accG)) {
            accountsSet.add(accG);
          }
        });
      }
    }

    // Nếu Categories trống, nạp mặc định các tài khoản mẫu từ người dùng
    if (accountsSet.size === 0) {
      ["Joshin KA", "Joshin Chi", "Joshin Giao", "Edion Ka", "Edion Chi", "Yodo KA", "Yodo Chi", "Yodo Chít", "Yodo 602", "Yodo 303", "Yodo Trinh", "Yodo Giao"].forEach(a => accountsSet.add(a));
    }

    const items = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. ĐỌC TRỰC TIẾP TỪ SHEET PURCHASE (MUAHANG) 17 CỘT (ƯU TIÊN HÀNG ĐẦU)
    const pSheet = ss ? (ss.getSheetByName("Purchase") || ss.getSheetByName("MuaHang")) : null;
    if (pSheet && pSheet.getLastRow() >= 2) {
      const lastColP = Math.max(pSheet.getLastColumn(), 17);
      const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP).getValues();

      pData.forEach(row => {
        if (!row || !row[0]) return;
        const tenSP = String(row[4] || "").trim();
        if (!tenSP || tenSP === "Tên Sản Phẩm") return;

        // Tài khoản mua ở Cột 14 (index 13), tự động fallback Nơi Mua / Nguồn Tiền nếu trống
        let rawTk = String(row[13] || "").trim();
        if (!rawTk) {
          const noiMua = String(row[2] || "").trim();
          const nguonTien = String(row[8] || "").trim();
          rawTk = noiMua || nguonTien || "";
        }

        const id = String(row[0]).trim();
        const ngayMuaDate = parseTab5Date(row[1]);
        const ngayMua = formatDateTab5Standard(ngayMuaDate);
        const cuaHangRaw = String(row[2] || "").trim() || "Cửa Hàng Mặc Định";
        const cuaHang = normalizeTab5Store(cuaHangRaw);
        const stLower = cuaHang.toLowerCase();
        
        // Tự động ghép tên tiệm + tên tài khoản nếu chưa có tên tiệm
        let taiKhoan = rawTk;
        const lowerTk = rawTk.toLowerCase();
        if (cuaHang && !lowerTk.includes("joshin") && !lowerTk.includes("yodo") && !lowerTk.includes("edion") && !lowerTk.includes("fuji") && !lowerTk.includes("amazon")) {
          taiKhoan = cuaHang + " " + rawTk;
        }

        const isFilm = isFilmProduct(tenSP);
        const cooldownDays = isFilm ? (parseInt(row[14], 10) || getDefaultCooldownDays(cuaHang, tenSP)) : 0;
        
        let ngayKhaDungDate = parseTab5Date(row[15]);
        if (!isFilm) {
          ngayKhaDungDate = new Date(ngayMuaDate.getTime());
        } else if (!row[15]) {
          ngayKhaDungDate = new Date(ngayMuaDate.getTime());
          ngayKhaDungDate.setDate(ngayKhaDungDate.getDate() + cooldownDays);
        }
        const ngayKhaDung = formatDateTab5Standard(ngayKhaDungDate);
        const rawTrangThaiKho = removeAccentsTab5(String(row[3] || "")).trim().toLowerCase();
        const rawTrangThaiColQ = String(row[16] || "").trim().toUpperCase();
        let trangThai = "KET_THUC";
        if (rawTrangThaiKho.includes("huy") || rawTrangThaiKho.includes("cancel") || rawTrangThaiColQ === "DA_HUY" || rawTrangThaiColQ === "HUY" || rawTrangThaiColQ === "KET_THUC") {
          trangThai = "KET_THUC";
        } else if (isFilm && ngayKhaDungDate.getTime() > today.getTime()) {
          trangThai = "DANG_CHO";
        } else {
          trangThai = "KET_THUC";
        }
        const ghiChu = String(row[10] || "").trim();

        accountsSet.add(taiKhoan);
        storesSet.add(cuaHang);

        items.push({
          id: id,
          ngayMua: ngayMua,
          ngayMuaDisplay: formatDateTab5Display(ngayMuaDate),
          taiKhoan: taiKhoan,
          cuaHang: cuaHang,
          tenSanPham: tenSP,
          category: getProductCategory(tenSP, cuaHang),
          cooldownDays: cooldownDays,
          ngayKhaDung: ngayKhaDung,
          ngayKhaDungDisplay: formatDateTab5Display(ngayKhaDungDate),
          trangThai: trangThai,
          maDonTab3: id,
          ghiChu: ghiChu
        });
      });
    }

    // 2. ĐỌC DỰ PHÒNG TỪ SHEET CALENDAR (NẾU CÓ DỮ LIỆU CŨ)
    const calSheet = ss ? (ss.getSheetByName("Calendar") || ss.getSheetByName("LichMua")) : null;
    if (calSheet && calSheet.getLastRow() >= 2) {
      const calData = calSheet.getRange(2, 1, calSheet.getLastRow() - 1, Math.max(calSheet.getLastColumn(), 10)).getValues();
      const existingIds = new Set(items.map(it => it.id));

      calData.forEach(row => {
        if (!row || !row[0]) return;
        const id = String(row[0]).trim();
        if (existingIds.has(id)) return;

        const ngayMuaDate = parseTab5Date(row[1]);
        const ngayMua = formatDateTab5Standard(ngayMuaDate);
        const taiKhoan = String(row[2] || "").trim();
        const cuaHangRaw = String(row[3] || "").trim() || "Cửa Hàng Mặc Định";
        const cuaHang = normalizeTab5Store(cuaHangRaw);
        const tenSanPham = String(row[4] || "").trim();
        const stLower = cuaHang.toLowerCase();
        const isFilmCal = isFilmProduct(tenSanPham);
        const cooldownDays = isFilmCal ? (parseInt(row[5], 10) || getDefaultCooldownDays(cuaHang, tenSanPham)) : 0;
        
        let ngayKhaDungDate = parseTab5Date(row[6]);
        if (!isFilmCal) {
          ngayKhaDungDate = new Date(ngayMuaDate.getTime());
        } else if (!row[6]) {
          ngayKhaDungDate = new Date(ngayMuaDate.getTime());
          ngayKhaDungDate.setDate(ngayKhaDungDate.getDate() + cooldownDays);
        }
        const ngayKhaDung = formatDateTab5Standard(ngayKhaDungDate);
        const rawTrangThai = String(row[7] || "").trim().toUpperCase();
        let trangThai = "KET_THUC";
        if (rawTrangThai === "DA_HUY" || rawTrangThai === "HUY" || rawTrangThai === "KET_THUC") {
          trangThai = "KET_THUC";
        } else if (isFilmCal && ngayKhaDungDate.getTime() > today.getTime()) {
          trangThai = "DANG_CHO";
        } else {
          trangThai = "KET_THUC";
        }
        const maDonTab3 = String(row[8] || "").trim();
        const ghiChu = String(row[9] || "").trim();

        accountsSet.add(taiKhoan);
        storesSet.add(cuaHang);

        items.push({
          id: id,
          ngayMua: ngayMua,
          ngayMuaDisplay: formatDateTab5Display(ngayMuaDate),
          taiKhoan: taiKhoan,
          cuaHang: cuaHang,
          tenSanPham: tenSanPham,
          category: getProductCategory(tenSanPham, cuaHang),
          cooldownDays: cooldownDays,
          ngayKhaDung: ngayKhaDung,
          ngayKhaDungDisplay: formatDateTab5Display(ngayKhaDungDate),
          trangThai: trangThai,
          maDonTab3: maDonTab3,
          ghiChu: ghiChu
        });
      });
    }

    // Sắp xếp items mới nhất lên đầu (để lấy dòng cuối cùng/mới nhất cho từng tài khoản)
    items.sort((a, b) => new Date(b.ngayMua).getTime() - new Date(a.ngayMua).getTime());

    // Tính toán Ma Trận Cooldown (Store -> Account Status & Last Purchase)
    const accounts = Array.from(accountsSet);
    const storeMap = {};

    accounts.forEach(acc => {
      const trimmed = String(acc).trim();
      if (!trimmed || !isRealAccountName(trimmed)) return;

      let clean = trimmed.replace(/^tk\s*/i, "").trim();
      let lower = removeAccentsTab5(clean).toLowerCase();

      let targetStores = [];
      let subName = "";

      if (lower.includes("fuji")) {
        targetStores = ["Fuji"];
        subName = clean.replace(/(yodobashi|yodo|joshin|edion|fuji|amazon|amz|bicamera|pokecenta|family)[\s\-_:]*/gi, "").trim();
      } else if (lower.includes("joshin")) {
        targetStores = ["Joshin"];
        subName = clean.replace(/(yodobashi|yodo|joshin|edion|fuji|amazon|amz|bicamera|pokecenta|family)[\s\-_:]*/gi, "").trim();
      } else if (lower.includes("yodo") || lower.includes("yodobashi")) {
        targetStores = ["Yodo"];
        subName = clean.replace(/(yodobashi|yodo|joshin|edion|fuji|amazon|amz|bicamera|pokecenta|family)[\s\-_:]*/gi, "").trim();
      } else if (lower.includes("edion") || lower.includes("amazon") || lower.includes("amz") || lower.includes("bicamera") || lower.includes("pokecenta") || lower.includes("family")) {
        // Cửa hàng khác không có Cooldown -> Bỏ qua không hiển thị ở Tab 5
        return;
      } else {
        // Tài khoản không có tiền tố cửa hàng (ví dụ: KA, Chi, 602, Giao) -> dùng chung cho các tiệm Cooldown
        targetStores = ["Fuji", "Yodo", "Joshin"];
        subName = clean;
      }

      targetStores.forEach(storeName => {
        let shortName = subName;
        if (!shortName || shortName.toLowerCase() === storeName.toLowerCase() || shortName.toLowerCase() === "tk mặc định" || shortName.toLowerCase() === "tk mac dinh") {
          return;
        }

        let fullName = shortName.toLowerCase().startsWith(storeName.toLowerCase()) ? shortName : (storeName + " " + shortName);

        if (!storeMap[storeName]) {
          storeMap[storeName] = [];
        }

        const cleanKey = getAccountCleanKey(fullName, storeName);
        if (!storeMap[storeName].some(item => getAccountCleanKey(item.fullName, storeName) === cleanKey)) {
          storeMap[storeName].push({
            fullName: fullName,
            shortName: shortName,
            store: storeName
          });
        }
      });
    });

    const matrix = [];
    const allowedStores = ["Fuji", "Yodo", "Joshin"];

    allowedStores.forEach(store => {
      const accList = storeMap[store] || [];
      if (accList.length === 0) return;
      const storeStatusList = [];

      accList.forEach(accObj => {
        const account = accObj.fullName;
        const shortName = accObj.shortName;
        const targetAccKey = getAccountCleanKey(account, store);

        // Tìm các đơn mua Film đang trong thời gian Cooldown (DANG_CHO) cho tài khoản này
        const activeOrders = items.filter(it => {
          const st = String(it.trangThai || "").toUpperCase();
          if (st !== "DANG_CHO") return false;
          if (!isFilmProduct(it.tenSanPham)) return false;
          const itemAccKey = getAccountCleanKey(it.taiKhoan, it.cuaHang);
          return itemAccKey === targetAccKey;
        });

        if (activeOrders.length === 0) {
          // Chưa có lịch sử mua -> Mặc định Sẵn Sàng Mua cho cả Trắng & Màu
          ["Film MINI Trắng", "Film MINI Màu"].forEach(cat => {
            storeStatusList.push({
              account: account,
              shortName: shortName,
              category: cat,
              isCooldown: false,
              daysLeft: 0,
              nextAvailableDate: "",
              lastPurchaseDate: "Chưa từng mua",
              lastProduct: "",
              lastPrice: 0
            });
          });
        } else {
          // Group active orders by category
          const categoryOrdersMap = {};
          activeOrders.forEach(ord => {
            const cat = ord.category || getProductCategory(ord.tenSanPham, store);
            if (!categoryOrdersMap[cat]) categoryOrdersMap[cat] = [];
            categoryOrdersMap[cat].push(ord);
          });

          // Duyệt từng danh mục đã mua
          Object.keys(categoryOrdersMap).forEach(cat => {
            const catOrders = categoryOrdersMap[cat];
            const lastOrder = catOrders[0];
            const khaDungDate = parseTab5Date(lastOrder.ngayKhaDung);
            khaDungDate.setHours(0, 0, 0, 0);

            let isCooldown = false;
            let daysLeft = 0;
            let nextAvailableDate = "";

            if (khaDungDate.getTime() > today.getTime()) {
              isCooldown = true;
              const diffTime = khaDungDate.getTime() - today.getTime();
              daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              nextAvailableDate = lastOrder.ngayKhaDungDisplay;
            }

            // Tiệm Yodo: Film Màu KHÔNG tính cooldown
            if (store === "Yodo" && cat.includes("Màu")) {
              isCooldown = false;
              daysLeft = 0;
            }

            storeStatusList.push({
              account: account,
              shortName: shortName,
              category: cat,
              isCooldown: isCooldown,
              daysLeft: daysLeft,
              nextAvailableDate: nextAvailableDate,
              lastPurchaseDate: lastOrder.ngayMuaDisplay,
              lastProduct: lastOrder.tenSanPham,
              lastPrice: lastOrder.price || 0
            });
          });

          // Bổ sung các danh mục Trắng/Màu chưa mua ở trạng thái Sẵn Sàng
          ["Film MINI Trắng", "Film MINI Màu"].forEach(cat => {
            if (!categoryOrdersMap[cat]) {
              storeStatusList.push({
                account: account,
                shortName: shortName,
                category: cat,
                isCooldown: false,
                daysLeft: 0,
                nextAvailableDate: "",
                lastPurchaseDate: "Chưa từng mua",
                lastProduct: "",
                lastPrice: 0
              });
            }
          });
        }
      });

      if (storeStatusList.length > 0) {
        matrix.push({
          store: store,
          accountsStatus: storeStatusList
        });
      }
    });

    const result = {
      success: true,
      items: items,
      matrix: matrix,
      accounts: accounts,
      stores: Object.keys(storeMap),
      storeCooldowns: getStoreCooldownSettings()
    };

    if (!ssTarget && typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      try {
        CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 300);
      } catch(e) {}
    }

    return result;
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function savePurchaseLimitRecord(formData, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, error: "Không tìm thấy Spreadsheet!" };

    let pSheet = ss.getSheetByName("Purchase") || ss.getSheetByName("MuaHang");
    let isPurchaseSheet = true;
    if (!pSheet) {
      pSheet = getTab5Sheet(ss);
      isPurchaseSheet = false;
    }
    if (!pSheet) return { success: false, error: "Không tìm thấy sheet lưu trữ" };

    const baseId = formData.id || ((typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("PO-") : ("PO-" + Date.now().toString().slice(-6)));
    const ngayMuaDate = parseTab5Date(formData.ngayMua || new Date());
    const ngayMua = formatDateTab5Standard(ngayMuaDate);
    const taiKhoan = String(formData.taiKhoan || "").trim();
    const cuaHang = String(formData.cuaHang || "").trim() || "Cửa Hàng Mặc Định";
    const cooldownDays = String(cuaHang).toLowerCase().includes("yodo") ? 13 : (parseInt(formData.cooldownDays, 10) || 30);

    const ngayKhaDungDate = new Date(ngayMuaDate.getTime());
    ngayKhaDungDate.setDate(ngayKhaDungDate.getDate() + cooldownDays);
    const ngayKhaDung = formatDateTab5Standard(ngayKhaDungDate);

    const trangThai = String(formData.trangThai || "THANH_CONG").trim().toUpperCase();
    const maDonTab3 = String(formData.maDonTab3 || baseId).trim();
    const ghiChu = String(formData.ghiChu || "").trim();

    const rawItems = Array.isArray(formData.items) && formData.items.length > 0
      ? formData.items
      : [{
          tenSP: formData.tenSanPham || "",
          qty: Number(formData.soLuong) || 1,
          price: formData.giaMua || 0
        }];

    const items = rawItems.map(it => {
      let priceNum = 0;
      const priceStr = String(it.price || it.giaMua || 0).trim();
      if (priceStr.startsWith('=')) {
        try { priceNum = eval(priceStr.substring(1)); } catch(e) { priceNum = Number(priceStr) || 0; }
      } else if (priceStr.includes('/')) {
        try { priceNum = eval(priceStr); } catch(e) { priceNum = Number(priceStr) || 0; }
      } else {
        priceNum = Number(priceStr) || 0;
      }
      return {
        tenSP: String(it.tenSP || it.tenSanPham || "").trim(),
        qty: Number(it.qty || it.soLuong) || 1,
        price: Math.round(priceNum)
      };
    }).filter(it => it.tenSP !== "");

    if (items.length === 0) {
      return { success: false, error: "Không có sản phẩm hợp lệ để lưu!" };
    }

    if (isPurchaseSheet) {
      const lastColP = Math.max(pSheet.getLastColumn(), 17);
      const pData = pSheet.getLastRow() >= 2 ? pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP).getValues() : [];

      const rowsToAdd = [];
      items.forEach((it, idx) => {
        const itemId = items.length > 1 ? `${baseId}-${idx + 1}` : baseId;
        const itemTotal = it.qty * it.price;

        let foundRowIndex = -1;
        for (let i = 0; i < pData.length; i++) {
          if (String(pData[i][0]).trim() === itemId || (maDonTab3 && String(pData[i][12]).trim() === maDonTab3)) {
            foundRowIndex = i + 2;
            break;
          }
        }

        const rowData = [
          itemId,              // 1: ID
          ngayMua,             // 2: Ngày Mua
          cuaHang,             // 3: Nơi mua
          "Chờ Ship",          // 4: Trạng Thái Kho
          it.tenSP,            // 5: Tên Sản Phẩm
          it.qty,              // 6: Số Lượng
          it.price,            // 7: Giá Mua (1 cái)
          itemTotal,           // 8: Tổng Tiền
          "Ví Tiền Mặt",       // 9: Nguồn Tiền Mua
          "HOAN_TAT",          // 10: Trạng thái thẻ
          ghiChu,              // 11: Note
          0,                   // 12: Tồn kho
          ngayMua,             // 13: Ngày Sao kê / SubID
          taiKhoan,            // 14: Thông tin tài khoản mua
          cooldownDays,        // 15: SoNgayCooldown
          ngayKhaDung,         // 16: NgayKhaDung
          trangThai            // 17: TrangThai (THANH_CONG)
        ];

        if (foundRowIndex > 0) {
          pSheet.getRange(foundRowIndex, 1, 1, 17).setValues([rowData]);
        } else {
          rowsToAdd.push(rowData);
        }
      });

      if (rowsToAdd.length > 0) {
        if (pSheet.getLastRow() <= 1) {
          const headers = ["MÃ ĐƠN", "Ngày Mua", "Nơi mua", "Trạng Thái Kho", "Tên Sản Phẩm", "Số Lượng", "Giá Mua (1 cái)", "Tổng Tiền", "Nguồn Tiền Mua", "Tình trạng thẻ", "Note", "Tồn kho", "Ngày sao kê", "Tài khoản mua", "SoNgayCooldown", "NgayKhaDung", "Tình trạngCooldown"];
          pSheet.getRange(1, 1, 1, 17).setValues([headers]);
        }
        pSheet.getRange(pSheet.getLastRow() + 1, 1, rowsToAdd.length, 17).setValues(rowsToAdd);
      }
    } else {
      // Fallback LichMua sheet
      const data = pSheet.getDataRange().getValues();
      const rowsToAdd = [];
      items.forEach((it, idx) => {
        const itemId = items.length > 1 ? `${baseId}-${idx + 1}` : baseId;
        let foundRowIndex = -1;
        for (let i = 1; i < data.length; i++) {
          if (String(data[i][0]).trim() === itemId || (maDonTab3 && String(data[i][8]).trim() === maDonTab3)) {
            foundRowIndex = i + 1;
            break;
          }
        }
        const rowData = [itemId, ngayMua, taiKhoan, cuaHang, it.tenSP, cooldownDays, ngayKhaDung, trangThai, maDonTab3, ghiChu];
        if (foundRowIndex > 0) {
          pSheet.getRange(foundRowIndex, 1, 1, 10).setValues([rowData]);
        } else {
          rowsToAdd.push(rowData);
        }
      });
      if (rowsToAdd.length > 0) {
        pSheet.getRange(pSheet.getLastRow() + 1, 1, rowsToAdd.length, 10).setValues(rowsToAdd);
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, id: baseId, count: items.length };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function updatePurchaseLimitStatus(id, newStatus, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const targetStatus = String(newStatus || "DA_HUY").trim().toUpperCase();
    let updated = false;

    // 1. Cập nhật trực tiếp Cột Q (Col 17) trong Sheet Purchase / MuaHang
    if (ss) {
      const pSheet = ss.getSheetByName("Purchase") || ss.getSheetByName("MuaHang");
      if (pSheet && pSheet.getLastRow() >= 2) {
        const lastColP = Math.max(pSheet.getLastColumn(), 17);
        const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP).getValues();
        for (let i = 0; i < pData.length; i++) {
          const rowId = String(pData[i][0] || "").trim();
          const subId = String(pData[i][12] || "").trim();
          if (rowId === id || (id && (subId === id || rowId.includes(id)))) {
            pData[i][16] = targetStatus; // Cột Q: TrangThai
            if (targetStatus === "DA_HUY") {
              pData[i][3] = "Hủy"; // Cột D: Trạng Thái Kho
              pData[i][9] = "CHO_HOAN_TIEN"; // Cột J: Trạng thái thẻ
              pData[i][11] = 0; // Cột L: Tồn kho = 0
            } else if (targetStatus === "THANH_CONG") {
              pData[i][3] = "Chờ Ship"; // Cột D: Trạng Thái Kho
              pData[i][9] = "HOAN_TAT"; // Cột J: Trạng thái thẻ
              pData[i][11] = ""; // Cột L: Tồn kho để trống khi Chờ Ship
            }
            updated = true;
          }
        }
        if (updated) {
          pSheet.getRange(2, 1, pData.length, lastColP).setValues(pData);
        }
      }

      // 2. Cập nhật trong Sheet Calendar (nếu có)
      const calSheet = ss.getSheetByName("Calendar") || ss.getSheetByName("LichMua");
      if (calSheet && calSheet.getLastRow() >= 2) {
        const calData = calSheet.getDataRange().getValues();
        let calUpdated = false;
        for (let i = 1; i < calData.length; i++) {
          if (String(calData[i][0]).trim() === id || String(calData[i][8]).trim() === id) {
            calData[i][7] = targetStatus;
            calUpdated = true;
          }
        }
        if (calUpdated) {
          calSheet.getRange(1, 1, calData.length, calData[0].length).setValues(calData);
        }
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, id: id, newStatus: targetStatus };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function deletePurchaseLimitRecord(id) {
  try {
    const sheet = getTab5Sheet();
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === id) {
        sheet.deleteRow(i + 1);
        return { success: true, id: id };
      }
    }
    return { success: false, error: "Không tìm thấy mã bản ghi: " + id };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/**
 * TỰ ĐỘNG ĐỒNG BỘ ĐƠN MUA HÀNG TỪ TAB 3 SANG SHEET CALENDAR (TAB 5)
 */
function syncPurchaseToTab5(formData, rowsToAppend, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return;

    const taiKhoanMua = String(formData.taiKhoanMua || "").trim();
    if (!taiKhoanMua) return; // Không chọn tài khoản mua thì không cần đẩy sang Lịch Mua Cooldown Tab 5

    const calSheet = getTab5Sheet(ss);
    if (!calSheet) return;

    const calRows = [];
    const dateVal = formatBizDateServer ? formatBizDateServer(formData.ngay) : String(formData.ngay || "");
    const storeName = String(formData.noiMua || "").trim();

    rowsToAppend.forEach(r => {
      const itemId = String(r[0]);
      const tenSP = String(r[4]);
      const cardStatus = String(r[9] || "HOAN_TAT");
      const ghiChu = String(r[10] || "");
      const tkMua = String(r[13] || taiKhoanMua);
      const cooldownDays = Number(r[14]) || getDefaultCooldownDays(storeName);
      const ngayKhaDung = String(r[15] || "");
      const recStatus = (cardStatus === "PRE-ORDER") ? "PRE-ORDER" : "THANH_CONG";

      calRows.push([
        "CAL_" + itemId,     // A: ID
        dateVal,            // B: NgayMua
        tkMua,              // C: TaiKhoan
        storeName,          // D: CuaHang
        tenSP,              // E: TenSanPham
        cooldownDays,       // F: SoNgayCooldown
        ngayKhaDung,        // G: NgayKhaDung
        recStatus,          // H: TrangThai
        itemId,             // I: MaDonTab3
        ghiChu              // J: GhiChu
      ]);
    });

    if (calRows.length > 0) {
      const startRow = calSheet.getLastRow() + 1;
      calSheet.getRange(startRow, 1, calRows.length, 10).setValues(calRows);
      if (typeof clearAppDataCache === 'function') clearAppDataCache();
    }
  } catch(err) {
    console.error("Lỗi syncPurchaseToTab5: " + err.toString());
  }
}

/**
 * THÊM TÀI KHOẢN MỚI VÀO SHEET CATEGORIES CỘT G (COLUMN 7)
 */
function addTab5Account(storeName, accountName, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, error: "Không tìm thấy Spreadsheet!" };

    const catSheet = ss.getSheetByName("Categories") || ss.getSheetByName("DanhMuc");
    if (!catSheet) return { success: false, error: "Không tìm thấy sheet Categories!" };

    const store = String(storeName || "").trim();
    const acc = String(accountName || "").trim();

    if (!store || !acc) {
      return { success: false, error: "Tên Tiệm và Tên Tài Khoản không được để trống!" };
    }

    let fullAccount = acc;
    const lowerAcc = removeAccentsTab5(acc).toLowerCase();
    const knownStores = ["joshin", "yodo", "yodobashi", "edion", "fuji", "amazon", "amz"];
    const hasKnownStore = knownStores.some(s => lowerAcc.includes(s));

    if (!hasKnownStore) {
      fullAccount = store + " " + acc;
    }

    // Tìm dòng trống tiếp theo trong Cột G (Column 7) của Sheet Categories
    const lastRowSheet = Math.max(catSheet.getLastRow(), 1);
    const gValues = catSheet.getRange(1, 7, lastRowSheet, 1).getValues();
    let lastRowG = 0;
    for (let i = gValues.length - 1; i >= 0; i--) {
      if (gValues[i][0] && String(gValues[i][0]).trim() !== "") {
        lastRowG = i + 1;
        break;
      }
    }
    const targetRowG = lastRowG > 0 ? (lastRowG + 1) : 2;
    catSheet.getRange(targetRowG, 7).setValue(fullAccount);

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, account: fullAccount };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}
