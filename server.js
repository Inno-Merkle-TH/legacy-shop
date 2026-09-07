// No dependencies. Deliberately weak demo authentication; bind locally by default.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID, scryptSync, timingSafeEqual} = require('node:crypto');
const products = [
  {id:1,name:'หูฟังไร้สาย Everyday',category:'AUDIO',description:'ฟังเพลงเพลิน ๆ ระหว่างทำงานและเดินทาง',price:1290,stock:12,icon:'🎧'},
  {id:2,name:'แก้วกาแฟ Morning',category:'LIFESTYLE',description:'แก้วเซรามิกสำหรับกาแฟแก้วแรกของวัน',price:290,stock:24,icon:'☕'},
  {id:3,name:'คีย์บอร์ด Compact',category:'WORKSPACE',description:'ขนาดกะทัดรัด เหลือพื้นที่บนโต๊ะให้มากขึ้น',price:1590,stock:8,icon:'⌨️'},
  {id:4,name:'สมุดบันทึก Daily',category:'STATIONERY',description:'เก็บไอเดียและเรื่องเล็ก ๆ ในแต่ละวัน',price:159,stock:30,icon:'📓'},
  {id:5,name:'กระเป๋าเป้ City',category:'LIFESTYLE',description:'ใส่ของจำเป็นสำหรับวันทำงานและวันหยุด',price:890,stock:0,icon:'🎒'},
  {id:6,name:'โคมไฟอ่านหนังสือ',category:'WORKSPACE',description:'เติมแสงให้มุมอ่านหนังสือและโต๊ะทำงาน',price:690,stock:6,icon:'💡'}
];
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function createServer({slow=true}={}) {
  const accounts = new Map();
  const orders = new Map();
  function addAccount(name, email, password) {
    const salt = randomUUID();
    accounts.set(email, {name, salt, hash:scryptSync(password, salt, 64)});
  }
  addAccount('Demo Customer', 'demo@legacy.test', 'demo1234');
  const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  const validEmail = value => validText(value, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  return http.createServer(async(req,res)=>{
    try {
      const url = new URL(req.url,'http://localhost');
      if(['/api/login', '/api/register', '/api/checkout'].includes(url.pathname) && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 8192) { json(res, 413, {message:'ข้อมูลยาวเกินไป'}); return; }
        }
        let input;
        try { input = JSON.parse(body); } catch { json(res, 400, {message:'JSON ไม่ถูกต้อง'}); return; }
        if (slow) await pause(500 + Math.floor(Math.random() * 701));
        if (url.pathname === '/api/register') {
          if (!validText(input?.name, 80) || !validEmail(input?.email) || typeof input?.password !== 'string' || input.password.length < 8 || input.password.length > 128) {
            json(res, 400, {message:'กรอกชื่อ อีเมล และรหัสผ่าน 8–128 ตัวอักษรให้ถูกต้อง'}); return;
          }
          const email = input.email.trim().toLowerCase();
          if (accounts.has(email)) { json(res, 409, {message:'อีเมลนี้สมัครสมาชิกแล้ว กรุณาเข้าสู่ระบบ'}); return; }
          addAccount(input.name.trim(), email, input.password);
          json(res, 201, {name:input.name.trim()}); return;
        }
        if (url.pathname === '/api/login') {
          const account = typeof input?.email === 'string' ? accounts.get(input.email.trim().toLowerCase()) : null;
          if (account && typeof input?.password === 'string' && input.password.length <= 128 && timingSafeEqual(account.hash, scryptSync(input.password, account.salt, 64))) {
            json(res, 200, {name:account.name});
          } else json(res, 401, {message:'อีเมลหรือรหัสผ่านไม่ถูกต้อง'});
          return;
        }
        const customer = input?.customer;
        if (!validText(input?.requestId, 100) || !validText(customer?.name, 80) || !validEmail(customer?.email) || !validText(customer?.address, 500) || !Array.isArray(input?.items) || !input.items.length || input.items.length > 6) {
          json(res, 400, {message:'กรอกข้อมูลจัดส่งและเลือกสินค้าให้ครบถ้วน'}); return;
        }
        const seen = new Set();
        const items = [];
        for (const item of input.items) {
          const product = products.find(product => product.id === item?.id);
          if (!product || seen.has(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > product.stock) {
            json(res, 400, {message:'สินค้าไม่พร้อมจำหน่ายหรือจำนวนไม่ถูกต้อง กรุณาตรวจสอบตะกร้า'}); return;
          }
          seen.add(item.id);
          items.push({id:product.id, name:product.name, price:product.price, quantity:item.quantity});
        }
        const fingerprint = JSON.stringify({customer, items});
        const previous = orders.get(input.requestId);
        if (previous) {
          if (previous.fingerprint !== fingerprint) { json(res, 409, {message:'ข้อมูลคำสั่งซื้อเปลี่ยน กรุณาเริ่มรายการใหม่'}); return; }
          json(res, 200, previous.order); return;
        }
        const order = {id:'DEMO-' + randomUUID(), items, total:items.reduce((sum, item) => sum + item.price * item.quantity, 0)};
        if (order.total < 1000) order.total += 50;
        orders.set(input.requestId, {fingerprint, order});
        json(res, 201, order); return;
      }
      if(url.pathname==='/api/products' && req.method==='GET') {
        // Intentional: no server-side auth and variable latency, visible in Network tab.
        if(slow) await pause(900+Math.floor(Math.random()*1301));
        json(res,200,{products});return;
      }
      const files={'/':'index.html','/index.html':'index.html','/products.html':'products.html','/register.html':'register.html','/cart.html':'cart.html','/checkout.html':'checkout.html','/style.css':'style.css','/app.js':'app.js'};
      const file=files[url.pathname];
      if(!file || !['GET','HEAD'].includes(req.method)){json(res,404,{message:'Not found'});return;}
      const content=await fs.readFile(path.join(__dirname,'public',file));
      const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript'};
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]+'; charset=utf-8'});res.end(req.method==='HEAD'?undefined:content);
    }catch{json(res,500,{message:'Server error'});}
  });
}
if(require.main===module)createServer().listen(Number(process.env.PORT)||3000,'127.0.0.1',()=>console.log('Demo Store: http://127.0.0.1:'+(process.env.PORT||3000)));
module.exports={createServer};
