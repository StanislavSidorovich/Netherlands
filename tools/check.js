#!/usr/bin/env node
/*
 * Проверки курса. Запуск из корня репозитория:
 *
 *     node tools/check.js
 *
 * Курс — один index.html на несколько тысяч строк, и почти все поломки в нём
 * тихие: забытый регистр не роняет страницу, а просто выключает тему; слово
 * без словарной статьи не переводится по тапу, но выглядит как обычное;
 * неверная форма глагола в спрягателе учит неправильному нидерландскому,
 * а ученик проверить не может. Глазами это не ловится, поэтому шесть
 * проверок ниже.
 *
 * ВАЖНО: скрипт не хранит копию данных приложения. И словарь, и порождение
 * словоформ, и таблицу неправильных глаголов, и сам движок спряжения он
 * ВЫРЕЗАЕТ ИЗ index.html и исполняет — иначе копии разошлись бы, и проверка
 * начала бы врать раньше, чем приложение сломается.
 *
 * Ещё три проверки требуют браузера и живут в tools/browser-checks.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(path.resolve(__dirname, '..'), 'index.html');
const html = fs.readFileSync(FILE, 'utf8');

let failed = 0;
const ok   = (msg) => console.log('  ok   ' + msg);
const bad  = (msg) => { failed++; console.log('  ФЕЙЛ ' + msg); };
const head = (msg) => console.log('\n' + msg);

/* ============ вырезаем движок из самого index.html ============ */

function slice(from, to, what) {
  const a = html.indexOf(from);
  if (a < 0) throw new Error(`не нашёл начало блока «${what}»: ${from}`);
  const b = html.indexOf(to, a);
  if (b < 0) throw new Error(`не нашёл конец блока «${what}»: ${to}`);
  return html.slice(a, b);
}

let APP = null;
try {
  const engine = slice('var PERSONS = [', '/* ================= ДВИЖОК ПОРЯДКА СЛОВ', 'движок глагола');
  const vocab  = slice('var VOCAB = {', '// Наборы «Woorden N', 'словарь и словоформы');
  const sandbox = { module: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(
    engine + '\n' + vocab + '\n' +
    'module.exports = { VOCAB, lookupWord, conjugate, stemOf, IRREG, nlCandidates };',
    sandbox
  );
  APP = sandbox.module.exports;
} catch (e) {
  bad('движок не вырезается из index.html: ' + e.message);
}

/* ============ 1. баланс тегов ============ */

function checkBalance() {
  head('1. Баланс HTML');
  const VOID = new Set(['br','img','input','meta','link','hr','source','area','base','col','embed','param','track','wbr']);
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  let errors = 0;
  for (const m of clean.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (VOID.has(tag) || m[3].trim().endsWith('/')) continue;
    if (!closing) { stack.push(tag); continue; }
    const top = stack.pop();
    if (top !== tag) {
      bad(`</${tag}> там, где ожидался </${top || '—'}>: …${clean.slice(Math.max(0, m.index - 90), m.index + 30).replace(/\s+/g, ' ')}`);
      if (++errors > 3) return;
    }
  }
  if (errors) return;
  if (stack.length) bad('незакрытые теги: ' + stack.join(', '));
  else ok('все теги закрыты');
}

/* ============ 2. связность тем ============ */

// Тема живёт в пяти местах сразу, и забытое место не роняет страницу,
// а просто выключает часть темы. Поэтому проверяем все пять.
function checkStructure() {
  head('2. Связность тем');

  const screenIds = [...html.matchAll(/id="(screen-[^"]+)"/g)].map((m) => m[1]);
  const dups = screenIds.filter((v, i) => screenIds.indexOf(v) !== i);
  if (dups.length) bad('повторяющиеся id экранов: ' + [...new Set(dups)].join(', '));
  else ok(`${screenIds.length} экранов, id уникальны`);

  const opens = [...new Set([...html.matchAll(/data-open="([^"]+)"/g)].map((m) => m[1]))]
    .filter((o) => !o.includes("'"));
  const orphan = opens.filter((o) => !screenIds.includes('screen-' + o));
  if (orphan.length) bad('data-open без экрана: ' + orphan.join(', '));
  else ok(`${opens.length} переходов ведут на существующие экраны`);

  const topics = [...new Set(
    [...html.matchAll(/<div class="screen topic-screen"[^>]*data-topic="([^"]+)"/g)].map((m) => m[1])
  )];
  let broken = 0;
  for (const t of topics) {
    const missing = [];
    if (!html.includes(`data-badge="${t}"`))            missing.push('значка «пройдено»');
    if (!html.includes(`data-check="${t}"`))            missing.push('строки на главной');
    if (!html.includes(`pane-quiz" data-topic="${t}"`)) missing.push('вкладки заданий');
    if (!new RegExp(`"${t}"\\s*:\\s*\\d+`).test(html))  missing.push('минут в TOPIC_MINUTES');
    if (!new RegExp(`_TOPICS\\s*=\\s*\\[[^\\]]*"${t}"`).test(html)) missing.push('регистра <БЛОК>_TOPICS');
    if (missing.length) { bad(`тема «${t}» без ${missing.join(', ')}`); broken++; }
  }
  if (!broken) ok(`${topics.length} тем подключены целиком`);

  // Строка на главной, ведущая в тему, которой ещё нет, должна быть disabled —
  // иначе кнопка нажимается и молча ничего не делает.
  const deadRows = [...html.matchAll(/<button type="button" class="topic-row" data-open="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((id) => !screenIds.includes('screen-' + id));
  if (deadRows.length) bad('строки главной без экрана (нужен disabled): ' + deadRows.join(', '));
  else ok('все активные строки главной ведут в готовые темы');

  // Цепочка «дальше» не должна обрываться и не должна вести назад.
  const order = (html.match(/var START_TOPICS\s*=\s*\[([^\]]*)\]/) || [, ''])[1]
    .split(',').map((x) => x.trim().replace(/"/g, '')).filter(Boolean);
  let chainBad = 0;
  for (let i = 0; i < order.length - 1; i++) {
    const screen = slice(`id="screen-${order[i]}"`, '</div>\n<!--', 'экран ' + order[i]);
    if (!screen.includes(`class="next-card" data-open="${order[i + 1]}"`)) {
      bad(`тема «${order[i]}» не ведёт в «${order[i + 1]}» (.next-card)`);
      chainBad++;
    }
  }
  if (!chainBad) ok(`цепочка «дальше» по ${order.length} темам не рвётся`);
}

/* ============ 3. тап-перевод ============ */

// Слово в тексте, которого нет в словаре, не подсвечивает ошибку — оно
// просто молча не переводится по тапу. Для новичка это дыра в тексте.
function checkVocabCoverage() {
  head('3. Тап-перевод текстов');
  if (!APP) { bad('пропущено: движок не загрузился'); return; }

  // Досыпаем словарь из наборов «Woorden N» ровно так же, как это делает
  // приложение, — второго списка лексики нет ни там, ни здесь.
  // Строку набора нельзя ловить одним выражением с [^<]* внутри .t:
  // в переводе встречается вложенный <span class="nl">, и жадность уводит
  // совпадение в следующую строку — слово тихо теряется, а соседнее
  // получает чужой перевод. Поэтому сначала строка целиком, потом разбор.
  let seeded = 0;
  for (const m of html.matchAll(/<div><span class="w">([^<]+)<\/span>([\s\S]*?)<\/div>/g)) {
    const key = m[1].trim().toLowerCase();
    const tPos = m[2].indexOf('<span class="t">');
    if (tPos < 0) continue;
    const val = m[2].slice(tPos).replace(/<[^>]*>/g, '').replace(/^\s*[—-]\s*/, '').trim();
    if (!APP.VOCAB[key]) { APP.VOCAB[key] = val; seeded++; }
    for (const part of key.split(/\s+/)) {
      if (part.length > 1 && !APP.VOCAB[part]) APP.VOCAB[part] = val;
    }
  }

  // Читаемые зоны: то, что приложение оборачивает в тап-перевод.
  const zones = [];
  for (const re of [
    /<p class="storytext">([\s\S]*?)<\/p>/g,
    /<p class="dline">([\s\S]*?)<\/p>/g,
    /<span class="phrase-nl">([\s\S]*?)<\/span>/g,
  ]) {
    for (const m of html.matchAll(re)) {
      zones.push(m[1].replace(/<[^>]*>/g, ' '));
    }
  }

  const NL_WORD = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;
  const missing = new Map();
  for (const text of zones) {
    for (const m of text.matchAll(NL_WORD)) {
      const w = m[0].toLowerCase();
      // Одиночные буквы — это диктовка фамилии по буквам и инициалы,
      // а не слова. Единственная настоящая однобуквенная лексема — «u»,
      // и она лежит в словаре как обычное слово.
      if (w.length < 2 && w !== 'u') continue;
      if (!APP.lookupWord(w)) missing.set(w, (missing.get(w) || 0) + 1);
    }
  }

  if (missing.size) {
    bad(`${missing.size} слов не переводятся — добавь их в VOCAB целиком:`);
    console.log('       ' + [...missing.keys()].sort().join(', '));
  } else {
    ok(`${zones.length} текстов и реплик, каждое слово переводится (${seeded} слов досыпано из наборов)`);
  }
}

/* ============ 4. целостность заданий ============ */

// Опечатка в data-answer делает задание нерешаемым: правильного варианта
// либо нет среди опций, либо нет в банке слов.
function checkQuizData() {
  head('4. Задания');
  let problems = 0;

  for (const m of html.matchAll(/data-answer="([^"]*)" data-words="([^"]*)"/g)) {
    const answer = m[1].toLowerCase().replace(/[.,!?;:—–]/g, '').split(/\s+/).filter(Boolean).sort().join(' ');
    const words  = m[2].toLowerCase().split('|').filter(Boolean).sort().join(' ');
    if (answer !== words) {
      bad(`сборка предложения: ответ «${m[1]}» не собирается из банка «${m[2]}»`);
      problems++;
    }
  }

  for (const m of html.matchAll(/<select class="mc" data-answer="([^"]*)">([\s\S]*?)<\/select>/g)) {
    const answer  = m[1];
    const options = [...m[2].matchAll(/<option value="([^"]*)"/g)].map((o) => o[1]);
    if (!answer) { bad('у выпадающего списка пустой data-answer'); problems++; continue; }
    if (!options.includes(answer)) {
      bad(`выбор из списка: правильного варианта «${answer}» нет среди опций (${options.filter(Boolean).join(', ')})`);
      problems++;
    }
  }

  const blanks = [...html.matchAll(/<input class="blank" data-answer="([^"]*)"/g)];
  for (const m of blanks) {
    if (!m[1].trim()) { bad('у поля ввода пустой data-answer'); problems++; }
  }

  // Разбор ошибки — обязательная часть задания, а не украшение: без него
  // после проверки человек видит только «неверно» и не знает, что делать.
  const items = [...html.matchAll(/<div class="qitem">([\s\S]*?)<\/div>\s*(?=<div class="qitem"|<div class="quiz-actions")/g)];
  const noWhy = items.filter((m) => !m[1].includes('class="qwhy"')).length;
  if (noWhy) { bad(`${noWhy} заданий без разбора .qwhy`); problems++; }

  // Кнопка подсказки обязана быть у каждого набора заданий и обязана стоять
  // ЛЕВЕЕ кнопки «показать ответы»: иначе самый заметный призыв ведёт мимо
  // первого успеха.
  for (const m of html.matchAll(/<div class="quiz-actions">([\s\S]*?)<\/div>/g)) {
    const hint = m[1].indexOf('btn-hint');
    const rev  = m[1].indexOf('btn-reveal');
    if (hint < 0) { bad('набор заданий без кнопки «Подсказка»'); problems++; }
    else if (rev >= 0 && hint > rev) { bad('«Показать ответы» стоит раньше «Подсказки»'); problems++; }
  }

  if (!problems) {
    const builds  = [...html.matchAll(/data-words="/g)].length;
    const selects = [...html.matchAll(/<select class="mc"/g)].length;
    ok(`${blanks.length} полей, ${selects} списков, ${builds} сборок — ответы согласованы`);
    ok(`${items.length} заданий, у каждого есть разбор`);
  }
}

/* ============ 5. таблица неправильных глаголов ============ */

// Пропущенное поле не роняет страницу: спрягатель молча построит форму по
// правилу и покажет неверный нидерландский как правильный.
function checkIrregulars() {
  head('5. Таблица неправильных глаголов');
  if (!APP) { bad('пропущено: движок не загрузился'); return; }

  let problems = 0, verbs = 0;
  for (const [inf, data] of Object.entries(APP.IRREG)) {
    verbs++;
    if (!/n$/.test(inf)) { bad(`${inf}: не похоже на инфинитив`); problems++; }
    if (data.pres && data.pres.length && data.pres.length !== 3) {
      bad(`${inf}: ${data.pres.length} формы настоящего вместо трёх`); problems++;
    }
    if (!data.imp || data.imp.length !== 2) {
      bad(`${inf}: прошедшее должно быть парой [ед., мн.]`); problems++;
    }
    if (!data.part) { bad(`${inf}: нет причастия`); problems++; }
    if (!data.aux || (data.aux !== 'hebben' && data.aux !== 'zijn')) {
      bad(`${inf}: вспомогательный глагол должен быть hebben или zijn`); problems++;
    }
    // Причастие без ge- законно только у глаголов с безударной приставкой.
    if (data.part && data.part !== '—' && !/^ge/.test(data.part)) {
      if (!/^(be|ver|ont|er|her)/.test(inf)) {
        bad(`${inf}: причастие «${data.part}» без ge-, хотя приставки нет`); problems++;
      }
    }
  }
  if (!problems) ok(`${verbs} глаголов, все поля на месте`);
}

/* ============ 6. движок спряжения на эталонных формах ============ */

// Единственная проверка, которая ловит НЕВЕРНЫЙ НИДЕРЛАНДСКИЙ, а не битую
// разметку. Формы взяты из Van Dale и Groene Boekje; если правило вывода
// основы поедет, тут будет видно сразу.
const GOLDEN = [
  // основа: удлинение, удвоение, оглушение
  ['werken',      'presens',     ['werk', 'werkt', 'werken']],
  ['wonen',       'presens',     ['woon', 'woont', 'wonen']],
  ['pakken',      'presens',     ['pak', 'pakt', 'pakken']],
  ['zitten',      'presens',     ['zit', 'zit', 'zitten']],
  ['lezen',       'presens',     ['lees', 'leest', 'lezen']],
  ['leven',       'presens',     ['leef', 'leeft', 'leven']],
  ['reizen',      'presens',     ['reis', 'reist', 'reizen']],
  ['praten',      'presens',     ['praat', 'praat', 'praten']],
  ['spelen',      'presens',     ['speel', 'speelt', 'spelen']],
  ['wandelen',    'presens',     ['wandel', 'wandelt', 'wandelen']],
  ['luisteren',   'presens',     ['luister', 'luistert', 'luisteren']],
  ['studeren',    'presens',     ['studeer', 'studeert', 'studeren']],
  ['openen',      'presens',     ['open', 'opent', 'openen']],
  ['betalen',     'presens',     ['betaal', 'betaalt', 'betalen']],
  ['antwoorden',  'presens',     ['antwoord', 'antwoordt', 'antwoorden']],
  ['schrijven',   'presens',     ['schrijf', 'schrijft', 'schrijven']],
  ['kopen',       'presens',     ['koop', 'koopt', 'kopen']],
  ['zoeken',      'presens',     ['zoek', 'zoekt', 'zoeken']],
  ['kosten',      'presens',     ['kost', 'kost', 'kosten']],
  // неправильные в настоящем
  ['zijn',        'presens',     ['ben', 'bent / hij is', 'zijn']],
  ['hebben',      'presens',     ['heb', 'hebt / hij heeft', 'hebben']],
  ['komen',       'presens',     ['kom', 'komt', 'komen']],
  ['gaan',        'presens',     ['ga', 'gaat', 'gaan']],
  ['doen',        'presens',     ['doe', 'doet', 'doen']],
  ['zien',        'presens',     ['zie', 'ziet', 'zien']],
  ['weten',       'presens',     ['weet', 'weet', 'weten']],
  ['kunnen',      'presens',     ['kan', 'kan', 'kunnen']],
  // прошедшее: правило 't kofschip проверяется по ЗВУКУ основы
  ['werken',      'imperfectum', ['werkte', 'werkte', 'werkten']],
  ['wonen',       'imperfectum', ['woonde', 'woonde', 'woonden']],
  ['leven',       'imperfectum', ['leefde', 'leefde', 'leefden']],
  ['reizen',      'imperfectum', ['reisde', 'reisde', 'reisden']],
  ['praten',      'imperfectum', ['praatte', 'praatte', 'praatten']],
  ['antwoorden',  'imperfectum', ['antwoordde', 'antwoordde', 'antwoordden']],
  ['studeren',    'imperfectum', ['studeerde', 'studeerde', 'studeerden']],
  ['zijn',        'imperfectum', ['was', 'was', 'waren']],
  ['hebben',      'imperfectum', ['had', 'had', 'hadden']],
  ['gaan',        'imperfectum', ['ging', 'ging', 'gingen']],
];

// Причастия и вспомогательный глагол проверяем отдельно: в perfectum они
// склеены со строкой формы, и сверять по строке было бы менее читаемо.
const GOLDEN_PART = [
  ['werken', 'gewerkt', 'hebben'],
  ['wonen', 'gewoond', 'hebben'],
  ['leven', 'geleefd', 'hebben'],
  ['reizen', 'gereisd', 'hebben'],
  ['praten', 'gepraat', 'hebben'],
  ['antwoorden', 'geantwoord', 'hebben'],
  ['studeren', 'gestudeerd', 'hebben'],
  ['betalen', 'betaald', 'hebben'],
  ['herhalen', 'herhaald', 'hebben'],
  ['verdienen', 'verdiend', 'hebben'],
  ['bellen', 'gebeld', 'hebben'],
  ['zijn', 'geweest', 'zijn'],
  ['gaan', 'gegaan', 'zijn'],
  ['komen', 'gekomen', 'zijn'],
  ['blijven', 'gebleven', 'zijn'],
  ['worden', 'geworden', 'zijn'],
  ['beginnen', 'begonnen', 'zijn'],
  ['kopen', 'gekocht', 'hebben'],
  ['zeggen', 'gezegd', 'hebben'],
  ['vragen', 'gevraagd', 'hebben'],
];

function checkEngine() {
  head('6. Движок спряжения на эталонных формах');
  if (!APP) { bad('пропущено: движок не загрузился'); return; }
  let problems = 0;

  for (const [inf, tense, expect] of GOLDEN) {
    const r = APP.conjugate(inf, tense);
    if (!r || r.error) { bad(`${inf} · ${tense}: ${r ? r.error : 'нет результата'}`); problems++; continue; }
    for (let i = 0; i < 3; i++) {
      if (r.forms[i] !== expect[i]) {
        bad(`${inf} · ${tense} · строка ${i + 1}: «${r.forms[i]}», ожидалось «${expect[i]}»`);
        problems++;
      }
    }
  }

  for (const [inf, part, aux] of GOLDEN_PART) {
    const r = APP.conjugate(inf, 'perfectum');
    if (!r || r.error) { bad(`${inf} · perfectum: ${r ? r.error : 'нет результата'}`); problems++; continue; }
    if (r.part !== part) { bad(`${inf}: причастие «${r.part}», ожидалось «${part}»`); problems++; }
    if (r.aux !== aux)   { bad(`${inf}: вспомогательный «${r.aux}», ожидалось «${aux}»`); problems++; }
  }

  // Отделяемые глаголы спрягатель обязан ОТКАЗАТЬСЯ строить, а не выдать
  // «ik opsta». Отказ — правильное поведение, молчаливая неверная форма — нет.
  for (const inf of ['opstaan', 'meegaan', 'uitgaan', 'opbellen']) {
    const r = APP.conjugate(inf, 'presens');
    if (!r || !r.error) { bad(`${inf}: спрягатель построил форму, хотя глагол отделяемый`); problems++; }
  }
  // А похожие по написанию — обязан строить как обычные.
  for (const inf of ['openen', 'informeren', 'inleveren']) {
    const r = APP.conjugate(inf, 'presens');
    if (!r || r.error) { bad(`${inf}: спрягатель принял за отделяемый, хотя приставки нет`); problems++; }
  }

  if (!problems) ok(`${GOLDEN.length} форм и ${GOLDEN_PART.length} причастий сошлись с эталоном`);
}

/* ============ прогон ============ */

console.log('Проверка index.html · ' + (html.length / 1024).toFixed(0) + ' КБ');
checkBalance();
checkStructure();
checkVocabCoverage();
checkQuizData();
checkIrregulars();
checkEngine();

console.log('');
if (failed) {
  console.log(`Проверки не прошли: ${failed}`);
  process.exit(1);
}
console.log('Всё сошлось.');
