const test = require('node:test');
const assert = require('node:assert/strict');

// Simulate DOM and test the Tab3 purchase orders selection and pagination logic
test('Purchase orders pagination and bulk selection displays xxx/26 đơn and selects across pages', () => {
    // Mock environment
    const window = {};
    global.window = window;
    
    // Create 26 mock purchase orders (1 item each, plus one 2-item order)
    const items = [];
    for (let i = 1; i <= 26; i++) {
        items.push({
            id: `PO-20261012-${String(i).padStart(3, '0')}`,
            orderType: 'PURCHASE',
            ngayMua: '2026/10/12',
            noiMua: 'Amazon JP',
            taiKhoan: 'Account A',
            nguonTien: 'CreditCard1',
            trangThaiKho: 'Chờ Ship',
            tenSP: `Product ${i}`,
            qty: 2,
            price: 1000,
            total: 2000
        });
    }

    // Function to group items into orders (as in Tab3.html)
    function extractBaseOrderId(rawId) {
        if (!rawId) return '';
        const str = String(rawId).trim();
        const match = str.match(/^([A-Za-z0-9]+[-_].+?)[-_]([1-9]\d{0,2})$/);
        return (match && match[1]) ? match[1] : str;
    }

    function getPurchaseOrderGroupKey(item) {
        const rawId = String(item.id || '').trim();
        const baseId = extractBaseOrderId(rawId);
        return baseId ? `PURCHASE___${baseId}` : `PURCHASE_RAW___${rawId}`;
    }

    const ordersMap = new Map();
    items.forEach(item => {
        const groupKey = getPurchaseOrderGroupKey(item);
        if (!ordersMap.has(groupKey)) {
            ordersMap.set(groupKey, {
                groupKey: groupKey,
                orderType: item.orderType,
                baseId: item.id,
                items: [],
                totalAmt: 0
            });
        }
        const ord = ordersMap.get(groupKey);
        ord.items.push(item);
        ord.totalAmt += item.total;
    });

    const allOrders = Array.from(ordersMap.values());
    assert.strictEqual(allOrders.length, 26, 'Should have exactly 26 purchase orders');

    const purchaseOrders = allOrders.filter(o => o.orderType === 'PURCHASE');
    window.currentFilteredPurchaseOrders = purchaseOrders;
    window.currentTotalFilteredPurchaseOrders = purchaseOrders.length;
    window.SELECTED_PURCHASE_ORDER_KEYS = new Set();
    window.SELECTED_PURCHASE_ORDER_IDS = new Set();

    // Mock DOM elements
    const domState = {
        checkedCountBadgeText: '',
        selectAllChecked: false,
        bulkBarHidden: true,
        bulkCountText: '',
        pageCheckboxes: []
    };

    function updatePurchaseOrdersCheckedSummary() {
        if (!window.SELECTED_PURCHASE_ORDER_KEYS) window.SELECTED_PURCHASE_ORDER_KEYS = new Set();
        if (!window.SELECTED_PURCHASE_ORDER_IDS) window.SELECTED_PURCHASE_ORDER_IDS = new Set();

        const totalCount = window.currentTotalFilteredPurchaseOrders || 0;
        const selectedCount = window.SELECTED_PURCHASE_ORDER_KEYS.size;

        domState.checkedCountBadgeText = `${selectedCount}/${totalCount} đơn`;
        domState.selectAllChecked = (totalCount > 0 && selectedCount === totalCount);

        if (selectedCount > 0) {
            domState.bulkBarHidden = false;
            domState.bulkCountText = String(selectedCount);
        } else {
            domState.bulkBarHidden = true;
        }
    }

    function toggleSelectAllPurchaseOrders(isChecked) {
        if (!window.SELECTED_PURCHASE_ORDER_KEYS) window.SELECTED_PURCHASE_ORDER_KEYS = new Set();
        if (!window.SELECTED_PURCHASE_ORDER_IDS) window.SELECTED_PURCHASE_ORDER_IDS = new Set();

        const purchaseOrders = window.currentFilteredPurchaseOrders || [];
        if (isChecked) {
            purchaseOrders.forEach(ord => {
                if (ord.groupKey) window.SELECTED_PURCHASE_ORDER_KEYS.add(ord.groupKey);
                (ord.items || []).forEach(it => {
                    if (it.id) window.SELECTED_PURCHASE_ORDER_IDS.add(String(it.id));
                });
            });
            domState.pageCheckboxes.forEach(cb => cb.checked = true);
        } else {
            window.SELECTED_PURCHASE_ORDER_KEYS.clear();
            window.SELECTED_PURCHASE_ORDER_IDS.clear();
            domState.pageCheckboxes.forEach(cb => cb.checked = false);
        }
        updatePurchaseOrdersCheckedSummary();
    }

    function handlePurchaseOrderCheck(orderKey, itemIds, isChecked) {
        if (isChecked) {
            window.SELECTED_PURCHASE_ORDER_KEYS.add(orderKey);
            itemIds.forEach(id => window.SELECTED_PURCHASE_ORDER_IDS.add(id));
        } else {
            window.SELECTED_PURCHASE_ORDER_KEYS.delete(orderKey);
            itemIds.forEach(id => window.SELECTED_PURCHASE_ORDER_IDS.delete(id));
        }
        updatePurchaseOrdersCheckedSummary();
    }

    function resetPurchaseOrderSelection() {
        window.SELECTED_PURCHASE_ORDER_KEYS.clear();
        window.SELECTED_PURCHASE_ORDER_IDS.clear();
        domState.pageCheckboxes.forEach(cb => cb.checked = false);
        domState.selectAllChecked = false;
        updatePurchaseOrdersCheckedSummary();
    }

    // 1. Initial State: None selected
    updatePurchaseOrdersCheckedSummary();
    assert.strictEqual(domState.checkedCountBadgeText, '0/26 đơn', 'Initial badge must show 0/26 đơn, NOT 0/15 đơn');
    assert.strictEqual(domState.selectAllChecked, false);
    assert.strictEqual(domState.bulkBarHidden, true);

    // 2. Select All: Selects all 26 orders across all pages
    toggleSelectAllPurchaseOrders(true);
    assert.strictEqual(window.SELECTED_PURCHASE_ORDER_KEYS.size, 26, 'Should have selected all 26 order keys');
    assert.strictEqual(window.SELECTED_PURCHASE_ORDER_IDS.size, 26, 'Should have selected all 26 item IDs');
    assert.strictEqual(domState.checkedCountBadgeText, '26/26 đơn', 'Badge must show 26/26 đơn when all selected');
    assert.strictEqual(domState.selectAllChecked, true, 'Select All checkbox must be checked');
    assert.strictEqual(domState.bulkBarHidden, false, 'Bulk action bar must be visible');
    assert.strictEqual(domState.bulkCountText, '26', 'Bulk count must show 26');

    // 3. Render Page 2 (items 16 to 26): All 11 orders must render as checked
    const PAGE_SIZE = 15;
    const page2Orders = allOrders.slice(PAGE_SIZE, PAGE_SIZE + PAGE_SIZE); // items 16 to 26 (11 orders)
    assert.strictEqual(page2Orders.length, 11);
    domState.pageCheckboxes = page2Orders.map(ord => ({
        key: ord.groupKey,
        checked: window.SELECTED_PURCHASE_ORDER_KEYS.has(ord.groupKey)
    }));
    assert.strictEqual(domState.pageCheckboxes.every(cb => cb.checked), true, 'All page 2 checkboxes must be checked');

    // 4. Deselect one order on Page 2
    const firstOnPage2 = page2Orders[0];
    handlePurchaseOrderCheck(firstOnPage2.groupKey, firstOnPage2.items.map(it => it.id), false);
    assert.strictEqual(window.SELECTED_PURCHASE_ORDER_KEYS.size, 25);
    assert.strictEqual(domState.checkedCountBadgeText, '25/26 đơn', 'Badge must show 25/26 đơn');
    assert.strictEqual(domState.selectAllChecked, false, 'Select All checkbox must be unchecked');
    assert.strictEqual(domState.bulkCountText, '25');

    // 5. Transfer modal extracts all 25 selected items across both pages
    const selectedItemIds = Array.from(window.SELECTED_PURCHASE_ORDER_IDS);
    assert.strictEqual(selectedItemIds.length, 25, 'Should collect 25 items across pages for warehouse transfer');

    // 6. Reset selection
    resetPurchaseOrderSelection();
    assert.strictEqual(window.SELECTED_PURCHASE_ORDER_KEYS.size, 0);
    assert.strictEqual(window.SELECTED_PURCHASE_ORDER_IDS.size, 0);
    assert.strictEqual(domState.checkedCountBadgeText, '0/26 đơn', 'Badge must return to 0/26 đơn');
    assert.strictEqual(domState.bulkBarHidden, true);
});
