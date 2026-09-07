/* Deliberately legacy: globals, inline handlers, structural selectors, full innerHTML rerender. */
var busy = false;
var catalog = [];
var catalogFresh = false;
var catalogLoading = false;
var cart = readStorage('demo_cart', []);
var toastTimer;
if (!Array.isArray(cart)) cart = [];
cart = cart.filter(function(item) {
  return item && Number.isInteger(item.id) && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 100;
}).filter(function(item, index, all) {
  return all.findIndex(function(other) { return other.id === item.id; }) === index;
});
function readStorage(key, fallback) {
  try { var value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
  catch (error) { return fallback; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (error) { return false; }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function(character) { return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]; });
}
function money(value) { return '฿' + value.toLocaleString('th-TH'); }
function requireUser() {
  if (!sessionStorage.getItem('legacy_user')) { location.replace('index.html'); return false; }
  return true;
}
async function requestApi(path, input) {
  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, 10000);
  try {
    var response = await fetch(path, input === undefined ? {signal:controller.signal} : {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input), signal:controller.signal
    });
    var data = await response.json();
    if (!response.ok) throw new Error(data.message || 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง');
    return data;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('เชื่อมต่อไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง');
    throw error;
  } finally { clearTimeout(timeout); }
}
async function doLogin(event) {
  event.preventDefault();
  if (busy) return;
  busy = true;
  var button = document.querySelector('table tr:last-child button');
  var message = document.querySelector('.box .inner > .msg');
  button.disabled = true; button.innerHTML = '<span>กำลังเข้าสู่ระบบ…</span>'; message.textContent = '';
  try {
    var data = await requestApi('/api/login', {email:document.getElementById('u').value, password:document.getElementById('p').value});
    sessionStorage.setItem('legacy_user', data.name);
    location.href = 'products.html';
  } catch (error) { message.textContent = error.message; }
  finally { busy = false; button.disabled = false; button.innerHTML = '<span>เข้าสู่ระบบ →</span>'; }
}
async function doRegister(event) {
  event.preventDefault();
  if (busy) return;
  var message = document.querySelector('.box .inner > .msg');
  var password = document.getElementById('password').value;
  if (password.length !== document.getElementById('confirm').value.length) { message.textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน'; return; }
  var button = event.target.querySelector('button');
  busy = true; button.disabled = true; button.textContent = 'กำลังสร้างบัญชี…'; message.textContent = '';
  try {
    var data = await requestApi('/api/register', {name:document.getElementById('name').value, email:document.getElementById('email').value, password:password});
    sessionStorage.setItem('legacy_user', data.name);
    location.href = 'products.html';
  } catch (error) { message.textContent = error.message; }
  finally { busy = false; button.disabled = false; button.textContent = 'สร้างบัญชี →'; }
}
function updateCartCount() {
  document.querySelectorAll('.cart-count').forEach(function(element) {
    element.textContent = cart.reduce(function(sum, item) { return sum + item.quantity; }, 0);
  });
}
function saveCart() {
  var saved = writeStorage('demo_cart', cart);
  sessionStorage.removeItem('demo_pending_order');
  updateCartCount();
  if (!saved) showNotice('ไม่สามารถบันทึกตะกร้าในเบราว์เซอร์ได้ ตะกร้าจะอยู่เฉพาะหน้านี้');
}
function showNotice(message, retry) {
  var element = document.querySelector('.notice');
  if (!element) return;
  element.textContent = message;
  if (retry) {
    var button = document.createElement('button');
    button.className = 'retry'; button.textContent = 'ลองอีกครั้ง'; button.onclick = retry;
    element.appendChild(button);
  }
}
function validCatalog(value) {
  return Array.isArray(value) && value.length > 0 && value.every(function(product) {
    return product && Number.isInteger(product.id) && typeof product.name === 'string' && typeof product.description === 'string' &&
      typeof product.category === 'string' && typeof product.icon === 'string' && Number.isFinite(product.price) &&
      product.price >= 0 && Number.isInteger(product.stock) && product.stock >= 0;
  });
}
async function fetchCatalog(retry) {
  catalogFresh = false;
  showNotice('กำลังโหลดสินค้า…');
  try {
    var data = await requestApi('/api/products');
    if (!validCatalog(data.products)) throw new Error('ข้อมูลสินค้าไม่ถูกต้อง');
    catalog = data.products;
    catalogFresh = true;
    writeStorage('demo_catalog', catalog);
    showNotice('');
  } catch (error) {
    var cached = readStorage('demo_catalog', []);
    catalog = validCatalog(cached) ? cached : [];
    showNotice(catalog.length ? 'ออฟไลน์หรือเชื่อมต่อไม่ได้ · แสดงสินค้าที่บันทึกไว้ ตรวจสอบราคาและสต็อกอีกครั้งเมื่อเชื่อมต่อ' : error.message, retry);
  }
  return catalog.length > 0;
}
function skeletons(count) {
  return Array.from({length:count}, function() { return '<div class="skeleton" aria-hidden="true"></div>'; }).join('');
}
async function loadProducts() {
  if (!requireUser() || catalogLoading) return;
  catalogLoading = true;
  updateCartCount();
  var list = document.querySelector('.items > div > div');
  list.setAttribute('aria-busy', 'true'); list.innerHTML = skeletons(6);
  await fetchCatalog(loadProducts);
  list.innerHTML = catalog.map(function(product) {
    var quantity = cart.find(function(item) { return item.id === product.id; });
    var full = quantity && quantity.quantity >= product.stock;
    return '<article class="product"><div><div class="visual" aria-hidden="true">' + escapeHtml(product.icon) + '</div></div><div><div class="body"><span class="category">' + escapeHtml(product.category) + '</span><div><h2>' + escapeHtml(product.name) + '</h2></div><p>' + escapeHtml(product.description) + '</p><div class="product-meta"><span class="price">' + money(product.price) + '</span><span class="stock ' + (product.stock ? '' : 'out') + '">' + (product.stock ? '● พร้อมส่ง' : '— สินค้าหมด') + '</span></div><button class="btn" onclick="addToCart(' + product.id + ', this)" ' + (!product.stock || full ? 'disabled' : '') + '>' + (!product.stock ? 'สินค้าหมด' : full ? 'ครบจำนวนที่มีแล้ว' : 'เพิ่มลงตะกร้า ＋') + '</button></div></div></article>';
  }).join('');
  list.setAttribute('aria-busy', 'false');
  document.querySelector('.count').textContent = catalog.length + ' รายการ';
  catalogLoading = false;
}
function addToCart(id, button) {
  var product = catalog.find(function(product) { return product.id === id; });
  if (!product || !product.stock) return;
  var item = cart.find(function(item) { return item.id === id; });
  if (item && item.quantity >= product.stock) return;
  if (item) item.quantity++; else { item = {id:id, quantity:1}; cart.push(item); }
  saveCart();
  if (item.quantity >= product.stock) { button.disabled = true; button.textContent = 'ครบจำนวนที่มีแล้ว'; }
  var toast = document.querySelector('.toast');
  toast.textContent = '✓ เพิ่ม ' + product.name + ' ลงตะกร้าแล้ว';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { toast.textContent = ''; }, 3500);
}
function cartLines() {
  return cart.map(function(item) {
    var product = catalog.find(function(product) { return product.id === item.id; });
    return {id:item.id, quantity:item.quantity, product:product};
  });
}
function cartValid() {
  return cart.length > 0 && cartLines().every(function(line) { return line.product && line.quantity <= line.product.stock; });
}
function totalPrice() {
  return cartLines().reduce(function(sum, line) { return sum + (line.product ? line.product.price * line.quantity : 0); }, 0);
}
function emptyCart() {
  return '<section class="empty"><div class="empty-icon" aria-hidden="true">◇</div><h2>พื้นที่สำหรับสิ่งที่ใช่</h2><p>ตะกร้าของคุณยังว่าง เลือกของใช้ชิ้นโปรดกันเลย</p><a class="btn" href="products.html">สำรวจสินค้าทั้งหมด →</a></section>';
}
function summary(checkout) {
  var lines = checkout ? cartLines().map(function(line) { return '<div class="summary-line"><span>' + escapeHtml(line.product ? line.product.name : 'สินค้าไม่พร้อมจำหน่าย') + ' × ' + line.quantity + '</span><span>' + money(line.product ? line.product.price * line.quantity : 0) + '</span></div>'; }).join('') : '<div class="summary-line"><span>ยอดสินค้า</span><span>' + money(totalPrice()) + '</span></div>';
  return '<div class="summary"><h2>สรุปคำสั่งซื้อ</h2>' + lines + '<div class="summary-line"><span>ค่าจัดส่ง</span><span class="free">ฟรี</span></div><div class="summary-line total"><span>ยอดรวม</span><span>' + money(totalPrice()) + '</span></div>' +
    (!checkout ? (cartValid() ? '<a class="btn" href="checkout.html">ดำเนินการสั่งซื้อ →</a>' : '<p class="msg">ปรับจำนวนหรือลบสินค้าที่ไม่พร้อมจำหน่ายก่อนสั่งซื้อ</p>') : '') +
    '<p class="small muted">DEMO ORDER · ไม่มีการเรียกเก็บเงินจริง</p></div>';
}
async function loadCartPage() {
  if (!requireUser() || catalogLoading) return;
  catalogLoading = true;
  updateCartCount();
  document.getElementById('cart-content').innerHTML = skeletons(1);
  if (cart.length) await fetchCatalog(loadCartPage); else showNotice('');
  renderCart();
  catalogLoading = false;
}
function renderCart() {
  document.querySelector('.count').textContent = cart.reduce(function(sum, item) { return sum + item.quantity; }, 0) + ' ชิ้น';
  if (!cart.length) { document.getElementById('cart-content').innerHTML = emptyCart(); return; }
  if (!catalog.length) {
    document.getElementById('cart-content').innerHTML = '<section class="empty"><h2>ตะกร้าของคุณยังถูกบันทึกไว้</h2><p>เชื่อมต่ออีกครั้งเพื่อดูราคาและรายการสินค้า</p></section>'; return;
  }
  document.getElementById('cart-content').innerHTML = '<div class="shopping-grid"><section class="cart-items" aria-label="สินค้าในตะกร้า">' + cartLines().map(function(line) {
    var product = line.product;
    var invalid = !product || line.quantity > product.stock;
    var name = product ? product.name : 'สินค้าไม่พร้อมจำหน่าย';
    return '<article class="cart-row"><div class="cart-icon" aria-hidden="true">' + escapeHtml(product ? product.icon : '◇') + '</div><div class="cart-detail"><h2>' + escapeHtml(name) + '</h2><p>' + money(product ? product.price : 0) + ' / ชิ้น</p>' +
      (invalid ? '<p class="msg">จำนวนเกินสต็อกหรือสินค้าไม่พร้อมจำหน่าย</p>' : '') +
      '<div class="quantity"><button aria-label="ลดจำนวน ' + escapeHtml(name) + '" onclick="changeQuantity(' + line.id + ', -1)" ' + (line.quantity <= 1 ? 'disabled' : '') + '>−</button><span aria-label="จำนวน">' + line.quantity + '</span><button aria-label="เพิ่มจำนวน ' + escapeHtml(name) + '" onclick="changeQuantity(' + line.id + ', 1)" ' + (!product || line.quantity >= product.stock ? 'disabled' : '') + '>+</button></div></div><div class="row-end"><strong>' + money(product ? product.price * line.quantity : 0) + '</strong><button class="remove" aria-label="ลบ ' + escapeHtml(name) + '" onclick="removeItem(' + line.id + ')">ลบรายการ</button></div></article>';
  }).join('') + '</section><aside>' + summary(false) + '</aside></div>';
}
function changeQuantity(id, change) {
  var item = cart.find(function(item) { return item.id === id; });
  var product = catalog.find(function(product) { return product.id === id; });
  if (!item || item.quantity + change < 1 || (change > 0 && (!product || item.quantity + change > product.stock))) return;
  item.quantity += change; saveCart(); renderCart();
}
function removeItem(id) {
  cart = cart.filter(function(item) { return item.id !== id; });
  sessionStorage.removeItem('demo_pending_order');
  updateCartCount(); renderCart();
}
async function loadCheckout() {
  if (!requireUser() || catalogLoading) return;
  catalogLoading = true;
  updateCartCount();
  if (!cart.length) {
    document.getElementById('checkout-content').innerHTML = emptyCart();
    catalogLoading = false; return;
  }
  var recipient = document.getElementById('recipient');
  if (!recipient.value) recipient.value = sessionStorage.getItem('legacy_user');
  document.getElementById('place-order').disabled = true;
  document.getElementById('order-summary').innerHTML = skeletons(1);
  await fetchCatalog(loadCheckout);
  document.getElementById('order-summary').innerHTML = catalog.length ? summary(true) : '';
  updateCheckoutButton();
  catalogLoading = false;
}
function updateCheckoutButton() {
  var button = document.getElementById('place-order');
  if (!button) return;
  button.disabled = busy || !catalogFresh || !navigator.onLine || !cartValid();
  var message = document.querySelector('#checkout-form .msg');
  if (!catalogFresh || !navigator.onLine) message.textContent = 'เชื่อมต่ออินเทอร์เน็ตและโหลดสินค้าอีกครั้งก่อนยืนยันคำสั่งซื้อ';
  else if (!cartValid()) message.textContent = 'กรุณากลับไปปรับรายการในตะกร้าให้ถูกต้อง';
  else if (!busy) message.textContent = '';
}
async function placeOrder(event) {
  event.preventDefault();
  if (busy || !catalogFresh || !navigator.onLine || !cartValid()) return;
  var form = event.target;
  var customer = {name:document.getElementById('recipient').value.trim(), email:document.getElementById('delivery-email').value.trim(), address:document.getElementById('address').value.trim()};
  var fingerprint = JSON.stringify({customer:customer, items:cart});
  var pending;
  try { pending = JSON.parse(sessionStorage.getItem('demo_pending_order')); } catch (error) {}
  if (!pending || pending.fingerprint !== fingerprint) {
    pending = {fingerprint:fingerprint, requestId:crypto.randomUUID()};
    sessionStorage.setItem('demo_pending_order', JSON.stringify(pending));
  }
  busy = true;
  form.querySelectorAll('input, textarea, button').forEach(function(element) { element.disabled = true; });
  var button = document.getElementById('place-order');
  button.textContent = 'กำลังยืนยันคำสั่งซื้อ…';
  form.querySelector('.msg').textContent = '';
  try {
    var order = await requestApi('/api/checkout', {requestId:pending.requestId, customer:customer, items:cart});
    cart = []; saveCart();
    showNotice('');
    document.getElementById('checkout-content').hidden = true;
    var confirmation = document.getElementById('confirmation');
    confirmation.hidden = false;
    confirmation.innerHTML = '<div class="success-icon" aria-hidden="true">✓</div><div class="tag" style="justify-content:center;margin-top:25px">ALL SET FOR YOUR NEXT CHAPTER</div><h2>สั่งซื้อสำเร็จแล้ว!</h2><p>ขอบคุณที่เลือก Demo Store</p><p class="order-id">' + escapeHtml(order.id) + '</p><p>ยอดรวม <strong>' + money(order.total) + '</strong></p><p class="muted small">นี่คือคำสั่งซื้อทดลอง ไม่มีการเรียกเก็บเงินหรือจัดส่งสินค้า</p><a class="btn" href="products.html">กลับไปเลือกสินค้า →</a>';
    confirmation.focus();
  } catch (error) { form.querySelector('.msg').textContent = error.message; }
  finally {
    busy = false;
    form.querySelectorAll('input, textarea, button').forEach(function(element) { element.disabled = false; });
    button.disabled = !catalogFresh || !navigator.onLine || !cartValid();
    button.textContent = 'ยืนยันคำสั่งซื้อ →';
  }
}
function logout() {
  sessionStorage.removeItem('legacy_user');
  sessionStorage.removeItem('demo_pending_order');
  location.href = 'index.html';
}
window.addEventListener('offline', function() {
  showNotice('ออฟไลน์ · ตะกร้ายังถูกบันทึกไว้ สามารถสั่งซื้อได้เมื่อเชื่อมต่ออีกครั้ง');
  updateCheckoutButton();
});
window.addEventListener('online', function() {
  var retry = document.getElementById('checkout-form') ? loadCheckout : document.getElementById('cart-content') ? loadCartPage : loadProducts;
  showNotice('เชื่อมต่อแล้ว · โหลดข้อมูลล่าสุดก่อนสั่งซื้อ', retry);
  updateCheckoutButton();
});
updateCartCount();
