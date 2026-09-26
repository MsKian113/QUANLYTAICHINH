const test = require('node:test');
const assert = require('node:assert/strict');

// Simulated Tab 2 suggest and auto-fill logic
function filterItems(query, list, removeAccentsFn) {
  if (!list || !Array.isArray(list)) return [];
  const rawQ = (query || "").toString().trim();
  if (!rawQ) return list;
  const qClean = removeAccentsFn(rawQ.toLowerCase());
  return list.filter(item => item && removeAccentsFn(String(item).toLowerCase()).includes(qClean));
}

function removeAccents(str) {
  if (!str) return "";
  return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

function checkAutoFillLogic(val, categoriesRaw) {
  if (!val) return { source: null, jar: null, filled: false };
  const qVal = removeAccents(String(val).trim().toLowerCase());
  
  let matched = (categoriesRaw || []).find(c => c && removeAccents(String(c.name || "").trim().toLowerCase()) === qVal);
  if (!matched) {
    matched = (categoriesRaw || []).find(c => c && c.name && removeAccents(String(c.name).toLowerCase()).includes(qVal));
  }

  if (matched) {
    return {
      source: matched.source || null,
      jar: matched.jar || null,
      filled: !!(matched.source || matched.jar)
    };
  }

  // Fallback rules
  if (qVal.includes('xang') || qVal.includes('eneos')) {
    return { source: 'Thẻ Rakuten', jar: 'Thiết yếu', filled: true };
  } else if (qVal.includes('sieu thi') || qVal.includes('aeon')) {
    return { source: 'Ví Tiền Mặt', jar: 'Thiết yếu', filled: true };
  } else if (qVal.includes('tien nha') || qVal.includes('nha leo')) {
    return { source: 'Thẻ Ufj', jar: 'Thiết yếu', filled: true };
  }

  return { source: null, jar: null, filled: false };
}

test('Tab2 suggest filterItems matches query case & accent insensitively', () => {
  const list = ["Đổ xăng Eneos", "Đi siêu thị Aeon", "Tiền nhà Leo", "Cà phê Starbucks"];
  const matches = filterItems("do xang", list, removeAccents);
  assert.deepEqual(matches, ["Đổ xăng Eneos"]);
});

test('Tab2 checkAutoFillLogic auto-fills source and jar from categories data', () => {
  const categoriesRaw = [
    { name: "Đổ xăng Eneos", jar: "Thiết yếu", source: "Thẻ Rakuten" },
    { name: "Đi siêu thị Aeon", jar: "Thiết yếu", source: "Ví Tiền Mặt" }
  ];
  
  const res = checkAutoFillLogic("do xang eneos", categoriesRaw);
  assert.equal(res.filled, true);
  assert.equal(res.source, "Thẻ Rakuten");
  assert.equal(res.jar, "Thiết yếu");
});

test('Tab2 checkAutoFillLogic falls back when categories dataset has missing item', () => {
  const res = checkAutoFillLogic("Đi siêu thị", []);
  assert.equal(res.filled, true);
  assert.equal(res.source, "Ví Tiền Mặt");
  assert.equal(res.jar, "Thiết yếu");
});
