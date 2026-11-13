const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../dist/ReclassifierEXCEL.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

test('RCA prints only the selected problem as text and leaves its data intact', () => {
  const tags = [];
  const body = {
    classList: new Set(),
    append(report) { this.report = report; }
  };
  body.classList.remove = value => body.classList.delete(value);
  let output;
  const context = vm.createContext({
    crypto,
    document: {
      body,
      createElement(tag) {
        tags.push(tag);
        return {
          children: [],
          append(...children) { this.children.push(...children); },
          remove() { delete body.report; },
          set innerHTML(_) { assert.fail('Report must render user data as text'); }
        };
      }
    },
    window: {
      print() {
        assert.equal(body.classList.has('rca-printing'), true);
        const collect = node => [node.textContent, ...node.children.flatMap(collect)];
        output = collect(body.report).filter(Boolean).join('\n');
      }
    }
  });
  vm.runInContext(script.slice(0, script.lastIndexOf("\n(() => {")), context);
  const selected = context.createRcaProblem({title: '<img src=x onerror=alert(1)>', prbNumber: 'PRB42'});
  context.createRcaProblem({title: 'Другая проблема', prbNumber: 'PRB43'});
  selected.problem.occurrence = 'Обстоятельства отказа';
  selected.symptoms.push({id: 'symptom', title: 'Нет сигнала'});
  const root = context.addRcaWhy(selected, 'symptom', null, 'Потеря питания');
  const child = context.addRcaWhy(selected, 'symptom', root.id, 'Повреждение клеммы');
  selected.evidence.push({id: 'test', nodeId: child.id, method: 'Лаборатория', verdict: 'confirmed'});
  selected.actions.push({id: 'action', nodeIds: [child.id], text: 'Заменить клемму',
    assignee: 'Инженер', dueDate: '2026-11-30', status: 'planned', sector: 'technical'});
  const before = JSON.stringify(selected);
  context.printRcaReport(selected);
  for (const value of ['PRB42', selected.problem.title, 'Паспорт', 'Обстоятельства отказа', 'Нет сигнала',
    'Почему 2 · Повреждение клеммы', 'Потеря питания', 'Доказательства', 'Подтверждено',
    'Мероприятия', 'Заменить клемму', 'Инженер', '2026-11-30', 'Запланировано', 'Нет записей.']) {
    assert.ok(output.includes(value), value);
  }
  assert.doesNotMatch(output, /Утверждено|Другая проблема|PRB43/);
  assert.ok(!tags.includes('img'));
  assert.equal(JSON.stringify(selected), before);
  assert.equal(body.report, undefined);
  assert.equal(body.classList.has('rca-printing'), false);
});
