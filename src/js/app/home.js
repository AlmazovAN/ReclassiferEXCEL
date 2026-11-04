  function renderHome() {
    const homeArtwork = assets.homeArtwork || {};
    setHeader('Продвинутая обработка файлов Excel', 'Главная', 'Файлы обрабатываются только на Вашем компьютере. Все сетевые обращения принудительно заблокированы.');
    el.pageContent.innerHTML = `
      <article class="card home-start-guide" style="margin-bottom:18px">
        <h2>Рекомендуемый рабочий процесс</h2>
        <p>${build.coreBuild
          ? 'В CORE-сборке нет стартовых рабочих данных. Подключите существующую Reclassifier.db. Если её пока нет, загрузите наборы в текущую вкладку и сохраните переносимый HTML с данными.'
          : 'Проверьте актуальность подключённых справочников и базы перед обработкой.'}</p>
        <ol style="margin:10px 0 16px 20px; padding:0">
          <li>Подключите существующую SQLite. При работе без базы загрузите справочники через раздел «Справочники», а оборудование и классификатор — в их разделах.</li>
          <li>Если доступны свежие выгрузки Мобильных бригад, обработайте их для обогащения ITSM и KPI. Без Dataset МБ обработка ITSM возможна, но поля обогащения останутся пустыми.</li>
          <li>Если нужно обновить классификацию, запустите «Реклассификацию», проверьте диагностику и примените подготовленное обновление ReClass.</li>
          <li>Запустите «ITSM» для обогащения заявок текущими справочниками и накопления данных для отчёта.</li>
          <li>Откройте «Отчёт по надёжности» и сформируйте PDF, когда нужные источники подключены.</li>
        </ol>
        <div class="action-row">
          <button class="button primary" id="homeOpenDatabaseButton">База данных</button>
          <button class="button" id="homeOpenReferencesButton">Справочники</button>
          <button class="button ghost" id="homeOpenReportButton">Отчёт по надёжности</button>
        </div>
      </article>
      <div class="grid cols-3">
        ${Object.entries(moduleConfig).map(([id, item]) => `
          <article class="card module-card">
            <div class="module-card-main">
              <div class="module-card-copy">
                <h2>${escapeHtml(item.title)}</h2>
                <p>${escapeHtml(item.description)}</p>
              </div>
              ${homeArtwork[id]
                ? `<img class="module-card-artwork" src="data:image/webp;base64,${homeArtwork[id]}" alt="" aria-hidden="true" decoding="async" />`
                : ''}
            </div>
            <div class="spacer"></div>
            <button class="button" data-open-module="${id}">Открыть модуль</button>
          </article>
        `).join('')}
      </div>
    `;
    el.pageContent.querySelectorAll('[data-open-module]').forEach(btn =>
      btn.addEventListener('click', () => navigate(btn.dataset.openModule)));
    document.getElementById('homeOpenDatabaseButton')?.addEventListener('click', () => navigate('database'));
    document.getElementById('homeOpenReferencesButton')?.addEventListener('click', () => navigate('references'));
    document.getElementById('homeOpenReportButton')?.addEventListener('click', () => navigate('reliability_dashboard'));
  }
