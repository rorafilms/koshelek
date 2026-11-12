import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const section = (from, to) => script.slice(script.indexOf(from), script.indexOf(to, script.indexOf(from)));

function app() {
  const messages = [], acks = [], values = new Map();
  const context = vm.createContext({
    messages, acks, values, window: {},
    localStorage: {
      getItem: key => values.get(key),
      setItem(key, value) {
        if (context.full) throw Error("QuotaExceededError");
        values.set(key, value);
      }
    }
  });
  vm.runInContext(section("const pad=", "const human=") + section("const human=", "// ---------- state") +
    'const LS="wallet";' + section("function emptyState()", "let today=") +
    section("function plansFor(", "function spentOn(") +
    'const $=()=>({value:""}); let sheet=null;' +
    'function toast(message){messages.push(message)} function inboxAck(ids){acks.push(...ids)}' +
    'function renderImp(){} function openSheet(){} function closeSheet(){} function render(){}' +
    section("const MERCH_CATS=", "const TYPE_LBL=") +
    section("function suggestedPayment(", "async function pasteSms") +
    section("const BRANDS=", "function initials(") +
    'const CAT={food:[0,0,"Продукты"],home:[0,0,"Дом"],other:[0,0,"Другое"]}, EMO=["target"], CARD_COLORS=["orange"];' +
    section("function decodeBackup(", "let backupPreview") +
    section("function debtsList(", "function simulate(") +
    'const avgSpend=()=>0, cushionGoal=()=>null, graceSoon=()=>false;' +
    section("function tipsModel(", "function rTips(") +
    'const MG=Array(12).fill("мес"), WD=Array(7).fill("день"), MONTHS=MG;' +
    section("function spentOn(", "function countTo(") +
    section("function aiContext(", "function md("), context);
  return { run: code => vm.runInContext(code, context), context, messages, acks, values };
}

test("SMS остаётся в ящике при ошибке записи, повторная доставка не дублирует покупку", () => {
  const {run, context, messages, acks, values} = app();
  run('const sms={id:"first",at:"2025-05-12T12:00:00Z",text:"MIR-1234 10:10 Покупка 150р Пятерочка Баланс: 500р"};openImport("",[sms]);');
  assert.equal(run("impOps.length"), 1);
  context.full = true;
  run("saveImport()");
  assert.match(messages.at(-1), /Не удалось сохранить/);
  assert.deepEqual(acks, []);
  assert.equal(values.has("wallet"), false);
  assert.equal(run("Object.keys(state.months).length"), 0);
  context.full = false;
  run('saveImport();openImport("",[sms]);');
  assert.equal(run('state.months["2025-05"].length'), 1);
  assert.deepEqual(acks, ["first", "first"]);
  assert.equal(JSON.parse(values.get("wallet")).smsSeen.length, 2);
});

test("Нераспознанная SMS остаётся в ящике, категория магазина запоминается", () => {
  const {run, acks} = app();
  run('const text="MIR-1234 10:10 Покупка 150р Пятерочка Баланс: 500р";openImport("",[{id:"unknown",at:"2025-05-12",text:"Неизвестный текст"}]);');
  assert.deepEqual(acks, []);
  run('openImport(text);impOps[0].cat="home";impOps[0].catEdited=true;saveImport();openImport(text.replace("150р","120р"));');
  assert.equal(run("impOps[0].cat"), "home");
  run('openImport(text);');
  assert.equal(run("impOps[0].dupe"), true);
});

test("Переводы в разные дни не связываются, возвраты требуют проверки", () => {
  const {run} = app();
  run('state.cards={"MIR-1234":{},"MIR-4321":{}};const outgoing="MIR-1234 10:10 Перевод 150р";const incoming="MIR-4321 10:20 Перевод от АЛЕКСЕЙ +150р";' +
    'openImport("",[{id:"a",at:"2025-05-12T12:00:00Z",text:outgoing},{id:"b",at:"2025-05-13T12:00:00Z",text:incoming}]);');
  assert.equal(run("impOps.length"), 2);
  assert.equal(run('impOps.some(o=>o.on||o.note.includes("между"))'), false);
  run('openImport("",[{id:"a",at:"2025-05-12T12:00:00Z",text:outgoing},{id:"b",at:"2025-05-12T12:00:00Z",text:incoming}]);');
  assert.equal(run('impOps.every(o=>o.note.includes("между"))'), true);
  run('openImport("MIR-1234 10:10 Возврат +150р Магазин");');
  assert.equal(run("impOps[0].on"), false);
  assert.equal(run("impOps[0].refund"), true);
});

test("Связанный платёж учитывается по конкретному долгу и отмечается после подтверждения", () => {
  const {run} = app();
  run('state.debts=[{id:"d1",type:"loan",name:"Кредит",balance:40000,minPay:2000},{id:"d2",type:"loan",name:"Второй",balance:30000,minPay:3000}];' +
    'state.plans=[{id:"p1",type:"expense",repeat:"monthly",day:12,debtId:"d1",amount:1500,name:"Платёж"}];');
  assert.equal(run("tipsModel().mins"), 3500);
  run('openImport("",[{id:"loan",at:"2025-05-12T12:00:00Z",text:"MIR-1234 10:10 Погашение кредита 1500р"}]);');
  assert.equal(run("impOps[0].on"), false);
  assert.equal(run('suggestedPayment(impOps[0],"2025-05-12").id'), "p1");
  run('impOps[0].on=true;impOps[0].paidPlanId="p1";saveImport();');
  assert.equal(run('state.months["2025-05"][0].paidPlanId'), "p1");
  assert.equal(run('suggestedPayment(impOps[0],"2025-05-12")'), null);
});

test("Восстановление принимает старые копии и отклоняет повреждённые записи", () => {
  const {run} = app();
  assert.equal(run('decodeBackup({app:"koshelek",v:1,plans:[]}).smsSeen.length'), 0);
  assert.throws(() => run('decodeBackup({app:"koshelek",v:2,plans:[]})'), /backup/);
  assert.throws(() => run('decodeBackup({app:"koshelek",v:1,plans:[],months:{"2025-05":{}}})'), /backup/);
  assert.throws(() => run('decodeBackup({app:"koshelek",v:1,plans:[{id:"bad",type:"expense",repeat:"once",date:"2025-02-30",name:"Кредит",amount:5}]})'), /backup/);
  run('const valid={app:"koshelek",v:2,...emptyState(),cards:{"КАРТА*1234":{balance:50,at:"2025-05-12T10:10",color:"orange"}}};');
  assert.equal(run('decodeBackup(valid).cards["КАРТА*1234"].balance'), 50);
});

test("Подробности советника требуют явного выбора", () => {
  const {run} = app();
  run('const today=ymd(new Date());state.plans=[{id:"x",name:"Личное название",type:"expense",repeat:"monthly",day:1,amount:50}];' +
    'state.months[today.slice(0,7)]=[{date:today,amount:20,cat:"food",note:"Личная заметка"}];state.cards={"MIR-1234":{balance:75}};');
  const privateText = /Личное название|Личная заметка|MIR-1234/;
  assert.doesNotMatch(run("aiContext()"), privateText);
  assert.match(run("aiContext()"), /Продукты/);
  assert.match(run("aiContext(true)"), /Личная заметка/);
  assert.match(run("aiContext(true)"), /MIR-1234/);
});

test("Офлайн после обновления на GitHub Pages и защита кэша от ответа 503", async () => {
  const worker = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const scope = "https://example.test/koshelek/";
  const entries = new Map([["koshelek-v9",new Map()], ["unrelated",new Map()]]);
  const handlers = new Map();
  let server = "release A";
  const fetch = async () => {
    if (server === null) throw Error("offline");
    return server === 503 ? new Response("unavailable", {status:503}) : new Response(server);
  };
  const context = vm.createContext({
    URL, Request, Response, fetch,
    self: {
      registration: {scope}, location: new URL(scope),
      addEventListener: (name, callback) => handlers.set(name, callback),
      skipWaiting: async () => {}, clients: {claim: async () => {}}
    },
    caches: {
      keys: async () => [...entries.keys()], delete: async key => entries.delete(key),
      open: async key => {
        if (!entries.has(key)) entries.set(key,new Map());
        const cache = entries.get(key);
        return {
          addAll: async requests => {
            for(const request of requests) cache.set(request.url, await fetch(request));
          },
          put: async (url, response) => cache.set(url, response),
          match: async request => cache.get(request.url || request)?.clone()
        };
      }
    }
  });
  async function dispatch(name, extra = {}) {
    let result;
    const attach = promise => {result = promise};
    handlers.get(name)({...extra,waitUntil:attach,respondWith:attach});
    return result;
  }
  const openHome = () => dispatch("fetch",{request:{url:scope,method:"GET",mode:"navigate"}});
  vm.runInContext(worker, context);
  await dispatch("install");
  await dispatch("activate");
  server = null;
  assert.equal(await (await openHome()).text(),"release A");
  server = "release B";
  vm.runInContext(worker.replace(/^const VERSION = "[^"]+";/m, 'const VERSION = "new-release";'), vm.createContext({
    ...context
  }));
  await dispatch("install");
  await dispatch("activate");
  server = 503;
  assert.equal(await (await openHome()).text(),"release B");
  server = null;
  assert.equal(await (await openHome()).text(),"release B");
  assert.equal(entries.has("unrelated"), true);
  assert.equal(entries.size, 2);
});
