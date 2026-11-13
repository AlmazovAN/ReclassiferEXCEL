function renderRcaTree(record, commit, viewport, targetNode, dictionaries) {
  const pane = rcaElement('div');
  const tools = rcaElement('div', '', 'rca-tree-tools');
  const scroll = rcaElement('div', '', 'rca-tree-scroll');
  const board = rcaElement('div', '', 'rca-tree-board');
  const svgNS = 'http://www.w3.org/2000/svg';
  const lines = document.createElementNS(svgNS, 'svg');
  lines.setAttribute('aria-hidden', 'true');
  board.append(lines);
  const cards = new Map();

  function scale(value) {
    viewport.scale = Math.max(.2, Math.min(2, value));
    board.style.zoom = viewport.scale;
    percent.textContent = Math.round(viewport.scale * 100) + '%';
    drawLinks();
  }

  function drawLinks() {
    if (!board.isConnected) return;
    lines.replaceChildren();
    const area = board.getBoundingClientRect();
    for (const node of record.rcaNodes) {
      const from = cards.get(node.parentId ?? node.symptomId).getBoundingClientRect();
      const to = cards.get(node.id).getBoundingClientRect();
      const x1 = (from.right - area.left) / viewport.scale;
      const x2 = (to.left - area.left) / viewport.scale;
      const y1 = (from.top + from.height / 2 - area.top) / viewport.scale;
      const y2 = (to.top + to.height / 2 - area.top) / viewport.scale;
      const mid = (x1 + x2) / 2;
      const line = document.createElementNS(svgNS, 'path');
      line.setAttribute('d', `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`);
      lines.append(line);
    }
  }

  const percent = rcaButton('100%', () => scale(1));
  const symptomFields = RCA_PASSPORT_COLLECTIONS.find(([, key]) => key === 'symptoms')[2];
  tools.append(rcaButton('+ Ветка / Симптом', () => editRcaCollection(record, 'symptoms', 'Симптом', symptomFields, commit)),
    rcaButton('−', () => scale(viewport.scale - .1)), percent, rcaButton('+', () => scale(viewport.scale + .1)),
    rcaButton('Вписать', () => {
      scale(Math.min(1, scroll.clientWidth * viewport.scale / board.getBoundingClientRect().width));
      scroll.scrollTo(0, 0);
    }));
  const states = {hypothesis: 'Гипотеза', confirmed: 'Подтверждено', refuted: 'Опровергнуто'};
  for (const [level, entries] of rcaTreeColumns(record).entries()) {
    const column = rcaElement('section', '', 'rca-tree-column');
    column.append(rcaElement('h2', level ? 'Почему ' + level : 'Симптом'));
    for (const node of entries) {
      const card = rcaElement('article', '', 'rca-tree-card');
      cards.set(node.id, card);
      card.append(rcaElement('strong', node.title));
      const assessment = level ? rcaEvidenceState(record, node.id) : 'unknown';
      if (level) card.append(rcaElement('small', [states[assessment === 'unknown' ? 'hypothesis' : assessment],
        node.category].filter(Boolean).join(' · ')));
      if (node.flagK) card.classList.add('rca-root-cause');
      const controls = rcaElement('div', '', 'rca-tree-actions');
      controls.append(rcaButton('+ Почему', () => rcaEditor('Новая гипотеза', [['Формулировка', 'title', '', {required: true}]],
        values => commit(next => {
          if (!values.title.trim()) throw new Error('Введите формулировку.');
          addRcaWhy(next, level ? node.symptomId : node.id, level ? node.id : null, values.title.trim());
        }))));
      controls.append(rcaButton('Редактировать', () => {
        if (!level) return editRcaCollection(record, 'symptoms', 'Симптом', symptomFields, commit, node);
        rcaEditor('Причина', [
          ['Формулировка', 'title', node.title, {required: true}], ['Категория', 'category', node.category],
          ['Статус гипотезы', 'hypothesisState', assessment === 'unknown' ? 'hypothesis' : assessment,
            {choices: assessment === 'conflict' ? {...states, conflict:'Противоречие'} : states}]
        ], async (values, form) => {
          if (!values.title.trim()) throw new Error('Введите формулировку.');
          const change = next => Object.assign(next.rcaNodes.find(item => item.id === node.id),
            {title: values.title.trim(), category:values.category, updatedAt: new Date().toISOString()});
          const desired = values.hypothesisState;
          if (['confirmed','refuted'].includes(desired) && desired !== assessment) {
            const draft = record.evidence.find(item => item.nodeId === node.id &&
              (!item.verdict || item.verdict === 'unknown') && item.status !== 'cancelled');
            const dialog = form.closest('dialog');
            dialog.addEventListener('close', () => editRcaEvidence(record, mutate => commit(next => {
              change(next);
              mutate(next);
            }), dictionaries, draft, node.id, desired), {once:true});
            return;
          }
          if (desired === 'hypothesis' && assessment !== 'unknown') {
            throw new Error('Чтобы изменить оценку причины, обновите связанные проверки.');
          }
          await commit(change);
        });
      }));
      controls.append(rcaButton('Удалить', async () => {
        if (!window.confirm('Удалить выбранный элемент дерева?')) return;
        try { await commit(next => removeRcaTreeItem(next, node.id, !level)); }
        catch (error) { window.alert(error.message); }
      }));
      if (level) {
        const flag = rcaButton('К', async () => {
          try {
            await commit(next => toggleRcaActionFlag(next, node.id, 'flagK'));
          } catch (error) { window.alert(error.message); }
        });
        flag.setAttribute('aria-label', 'Предполагаемая коренная причина');
        flag.setAttribute('aria-pressed', String(node.flagK));
        controls.append(flag);
        for (const [label, key, description] of [
          ['М', 'actions', 'Требуется мероприятие'], ['Д', 'evidence', 'Требуется доказательство']
        ]) {
          const button = rcaButton(label, async () => {
            try { await commit(next => toggleRcaLinkedFlag(next, key, node.id)); }
            catch (error) { window.alert(error.message); }
          });
          button.setAttribute('aria-label', description);
          button.setAttribute('aria-pressed', String(node[RCA_LINKED_FLAGS[key].flag]));
          controls.append(button);
        }
        const verdict = rcaEvidenceVerdict(record, node.id);
        if (node.flagD || record.evidence.some(item => item.nodeId === node.id)) {
          card.append(rcaElement('small', 'Доказательства: ' + verdict));
        }
        if (node.flagK && verdict !== RCA_VERDICTS.confirmed) {
          card.append(rcaElement('small', 'Коренная причина требует подтверждения.'));
        }
        if (node.flagK || node.flagM) card.append(rcaElement('small', 'Мероприятия: ' + rcaActionCoverage(record, node.id)));
      }
      card.append(controls);
      column.append(card);
    }
    board.append(column);
  }
  scroll.append(board);
  pane.append(tools, scroll);
  const position = {...viewport};
  requestAnimationFrame(() => {
    if (!board.isConnected) return;
    scale(position.scale);
    scroll.scrollTo(position.left, position.top);
    const target = cards.get(targetNode);
    if (target) {
      target.tabIndex = -1;
      target.focus({preventScroll: true});
      target.scrollIntoView({block: 'nearest', inline: 'nearest'});
    }
  });
  scroll.addEventListener('scroll', () => {
    viewport.left = scroll.scrollLeft;
    viewport.top = scroll.scrollTop;
  });
  return pane;
}
