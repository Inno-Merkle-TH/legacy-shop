const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('./server');
test('demo API and static pages',async()=>{
  const server=createServer(); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  try {
    for(const route of ['/','/products.html','/register.html','/cart.html','/checkout.html','/app.js','/style.css']) assert.equal((await fetch(base+route)).status,200);
    const login=body=>fetch(base+'/api/login',{method:'POST',body:JSON.stringify(body)});
    assert.equal((await login({email:'demo@legacy.test',password:'wrong'})).status,401);
    assert.equal((await login({email:'demo@legacy.test',password:'demo1234'})).status,200);
    for (const route of ['/api/login', '/api/register', '/api/checkout']) {
      assert.equal((await fetch(base+route,{method:'POST',body:'{'})).status,400);
      assert.equal((await fetch(base+route,{method:'POST',body:'x'.repeat(9000)})).status,413);
    }
    const started=Date.now(); const response=await fetch(base+'/api/products');
    assert.equal(response.status,200); assert.equal((await response.json()).products.length,6);
    assert.ok(Date.now()-started>=850,'product endpoint must actually delay');
    assert.equal((await fetch(base+'/server.js')).status,404);
  }finally{await new Promise(r=>server.close(r));}
});

async function withApi(run) {
  const server = createServer({slow:false});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const post = (route, body) => fetch('http://127.0.0.1:' + server.address().port + route, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
  });
  try { await run(post); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('registration creates a login and rejects duplicate or invalid accounts', () => withApi(async post => {
  const account = {name:'Test Nomad', email:'NOMAD@example.test', password:'nomad1234'};
  const response = await post('/api/register', account);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).name, 'Test Nomad');
  assert.equal((await post('/api/login', {...account, email:'nomad@example.test'})).status, 200);
  assert.equal((await post('/api/login', {...account, password:'incorrect'})).status, 401);
  assert.equal((await post('/api/register', {...account, email:'nomad@example.test'})).status, 409);
  for (const invalid of [null, {}, {...account, name:' '}, {...account, email:'bad'}, {...account, password:'short'}]) {
    assert.equal((await post('/api/register', invalid)).status, 400);
  }
}));

const checkout = {requestId:'test-order-1', customer:{name:'Demo Nomad', email:'nomad@example.test', address:'123 Demo Road'}, items:[{id:1, quantity:2}, {id:2, quantity:1}]};
test('checkout computes catalog totals and retries return the same order', () => withApi(async post => {
  const response = await post('/api/checkout', {...checkout, total:1});
  assert.equal(response.status, 201);
  const order = await response.json();
  assert.equal(order.total, 2870);
  assert.ok(order.id);
  const repeat = await post('/api/checkout', checkout);
  assert.equal(repeat.status, 200);
  assert.deepEqual(await repeat.json(), order);
  assert.equal((await post('/api/checkout', {...checkout, items:[{id:2, quantity:2}]})).status, 409);
}));
test('checkout rejects empty, malformed, unavailable and excessive items', () => withApi(async post => {
  for (const items of [[], [{id:99, quantity:1}], [{id:5, quantity:1}], [{id:1, quantity:13}], [{id:1, quantity:0}], [{id:1, quantity:-1}], [{id:1, quantity:1.5}], [{id:1, quantity:'1'}], [{id:1, quantity:7}, {id:1, quantity:7}], [null]]) {
    assert.equal((await post('/api/checkout', {...checkout, items})).status, 400);
  }
  for (const input of [null, {}, {...checkout, customer:{}}, {...checkout, requestId:''}]) {
    assert.equal((await post('/api/checkout', input)).status, 400);
  }
}));

const vm = require('node:vm');
const fs = require('node:fs');
function browserFixture(saved = {}) {
  const storage = new Map(Object.entries(saved));
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {textContent:'', innerHTML:'', disabled:false, value:'', setAttribute() {}, appendChild() {}, focus() {}});
    return elements.get(selector);
  }
  const session = new Map([['legacy_user', 'Demo Nomad']]);
  const context = vm.createContext({
    localStorage:{getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value)},
    sessionStorage:{getItem:key => session.get(key) ?? null, setItem:(key, value) => session.set(key, value), removeItem:key => session.delete(key)},
    document:{querySelector:element, querySelectorAll:() => [element('count')], getElementById:element, createElement:() => element('retry')},
    window:{addEventListener() {}}, navigator:{onLine:true}, location:{replace(url) { this.href = url; }},
    setTimeout:() => 1, clearTimeout() {}, AbortController, crypto:require('node:crypto').webcrypto,
    fetch:async () => { throw new TypeError('Offline'); }
  });
  vm.runInContext(fs.readFileSync(require.resolve('./public/app.js'), 'utf8'), context);
  return {context, storage, elements, session};
}
const sampleCatalog = [{id:1, name:'Demo Headphones', category:'AUDIO', description:'Demo product', price:1290, stock:2, icon:'🎧'}];
test('cart persists additions, limits stock and updates totals', () => {
  const {context, storage} = browserFixture();
  context.catalog = sampleCatalog;
  const button = {};
  context.addToCart(1, button);
  context.addToCart(1, button);
  context.addToCart(1, button);
  assert.equal(context.cart[0].quantity, 2);
  assert.equal(button.disabled, true);
  assert.equal(context.totalPrice(), 2580);
  const refreshed = browserFixture(Object.fromEntries(storage)).context;
  assert.equal(refreshed.cart[0].quantity, 2);
  context.changeQuantity(1, -1);
  assert.equal(context.totalPrice(), 1290);
  context.changeQuantity(1, -1);
  assert.equal(context.cart[0].quantity, 1);
});
test('corrupt saved carts recover without crashing and unavailable items block checkout', () => {
  assert.equal(browserFixture({demo_cart:'{'}).context.cart.length, 0);
  assert.equal(browserFixture({demo_cart:'null'}).context.cart.length, 0);
  const {context} = browserFixture({demo_cart:'[null,{"id":1,"quantity":-1},{"id":1,"quantity":3}]'});
  context.catalog = sampleCatalog;
  assert.equal(context.cart.length, 1);
  assert.equal(context.cartValid(), false);
  context.catalog = [];
  assert.equal(context.cartValid(), false);
});
test('failed catalog requests use cached products and prevent checkout', async () => {
  const {context, elements} = browserFixture({demo_catalog:JSON.stringify(sampleCatalog), demo_cart:'[{"id":1,"quantity":1}]'});
  context.requestApi = async () => { throw new Error('Offline'); };
  assert.equal(await context.fetchCatalog(() => {}), true);
  assert.equal(context.catalog[0].name, 'Demo Headphones');
  assert.equal(context.catalogFresh, false);
  context.updateCheckoutButton();
  assert.equal(elements.get('place-order').disabled, true);
  context.requestApi = async () => ({products:sampleCatalog});
  assert.equal(await context.fetchCatalog(() => {}), true);
  context.updateCheckoutButton();
  assert.equal(elements.get('place-order').disabled, false);
});
test('logout clears the demo session and protected pages redirect to login', () => {
  const {context, session} = browserFixture();
  context.logout();
  assert.equal(session.has('legacy_user'), false);
  assert.equal(context.location.href, 'index.html');
  assert.equal(context.requireUser(), false);
});
test('checkout failure preserves cart and retry identity; success clears cart', async () => {
  const {context, storage, session} = browserFixture({demo_cart:'[{"id":1,"quantity":1}]'});
  context.catalog = sampleCatalog;
  context.catalogFresh = true;
  context.document.getElementById('recipient').value = 'Demo Nomad';
  context.document.getElementById('delivery-email').value = 'nomad@example.test';
  context.document.getElementById('address').value = '123 Demo Road';
  const message = {textContent:''};
  const button = context.document.getElementById('place-order');
  const form = {querySelectorAll:() => [button], querySelector:() => message};
  const event = {preventDefault() {}, target:form};
  const requests = [];
  context.requestApi = async (path, input) => {
    requests.push(JSON.parse(JSON.stringify(input)));
    if (requests.length === 1) throw new Error('Connection lost');
    return {id:'DEMO-order', total:1290};
  };
  await context.placeOrder(event);
  assert.equal(context.cart.length, 1);
  assert.equal(message.textContent, 'Connection lost');
  assert.equal(button.disabled, false);
  assert.ok(session.has('demo_pending_order'));
  await context.placeOrder(event);
  assert.equal(requests[0].requestId, requests[1].requestId);
  assert.equal(context.cart.length, 0);
  assert.equal(storage.get('demo_cart'), '[]');
  assert.equal(session.has('demo_pending_order'), false);
  assert.equal(context.document.getElementById('confirmation').hidden, false);
  assert.equal(context.document.getElementById('checkout-content').hidden, true);
});
test('checkout catalog retry preserves delivery details already entered', async () => {
  const {context} = browserFixture({demo_cart:'[{"id":1,"quantity":1}]'});
  context.document.getElementById('recipient').value = 'Different Recipient';
  context.requestApi = async () => ({products:sampleCatalog});
  await context.loadCheckout();
  assert.equal(context.document.getElementById('recipient').value, 'Different Recipient');
});
