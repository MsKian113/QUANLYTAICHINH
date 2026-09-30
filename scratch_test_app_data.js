const mockGas = require('./tests/mockGas.js');

try {
  const res = mockGas.getAppData('ALL', 'ALL');
  console.log('getAppData success:', res.success);
  console.log('wallets count:', res.wallets ? res.wallets.length : 0);
  console.log('categories count:', res.categories ? res.categories.length : 0);
  console.log('tab2 summary:', res.tab2 ? res.tab2.summary : null);
  console.log('tab3:', res.tab3 ? res.tab3.success : null);
  console.log('tab4:', res.tab4 ? res.tab4.success : null);
  console.log('tab5:', res.tab5 ? res.tab5.success : null);
} catch (err) {
  console.error('getAppData FAILED with error:', err);
}
