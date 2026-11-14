function createRcaAttachmentGallery({record, ownerType, ownerId, repository, canWrite, mutate}) {
  const panel = rcaElement('section', '', 'card rca-gallery');
  const status = rcaElement('p');
  status.setAttribute('role', 'status');
  const list = rcaElement('ul');
  const urls = new Map();
  let disposed = false;
  const viewer = rcaElement('dialog', '', 'rca-dialog rca-photo-viewer');
  viewer.setAttribute('aria-label', 'Просмотр фотографии');
  const close = rcaButton('Закрыть', () => viewer.close());
  const large = rcaElement('img');
  viewer.append(close, large);
  viewer.addEventListener('close', () => large.removeAttribute('src'));
  panel.append(rcaElement('h2', 'Фотографии'), status, list, viewer);

  const controls = rcaElement('div', '', 'rca-photo-controls');
  const files = rcaElement('input');
  files.type = 'file';
  files.multiple = true;
  files.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
  const picker = rcaElement('label', 'Выберите фотографии');
  picker.append(files);
  const description = rcaElement('input');
  const caption = rcaElement('label', 'Описание для выбранных файлов');
  caption.append(description);
  const add = rcaButton('Добавить фото', () => {
    const selected = Array.from(files.files);
    const remaining = RCA_PHOTO_COUNT - repository.attachments.listAttachments(record, ownerType, ownerId).length;
    if (selected.length > remaining) {
      status.textContent = 'Можно добавить ещё ' + remaining + ' фото.';
      return;
    }
    void change(async (store, current, publish) => {
      for (const file of selected) {
        try {
          current = await store.add(current, current.problem.revision, {ownerType, ownerId, file, description: description.value});
          publish(current);
        } catch (error) {
          throw new Error(file.name + ' · ' + error.message);
        }
      }
    });
  }, 'primary');
  add.disabled = true;
  files.addEventListener('change', () => { add.disabled = !files.files.length; });
  controls.append(picker, caption, add);
  panel.append(controls);
  controls.hidden = true;

  async function change(operation) {
    controls.inert = list.inert = true;
    status.textContent = 'Сохранение фотографий…';
    const previous = record;
    let failure = '';
    try {
      await mutate(operation, saved => { record = saved; });
      files.value = '';
      add.disabled = true;
    } catch (error) {
      failure = error.message;
    } finally {
      controls.inert = list.inert = false;
      if (!disposed && record !== previous) {
        files.value = '';
        add.disabled = true;
        void renderPhotos();
      }
      status.textContent = failure || 'Изменения сохранены.';
    }
  }

  async function renderPhotos() {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    list.replaceChildren();
    for (const item of repository.attachments.listAttachments(record, ownerType, ownerId)) {
      const entry = rcaElement('li');
      const image = rcaElement('img');
      image.alt = item.description || item.name;
      const preview = rcaButton('', () => {
        large.alt = image.alt;
        large.src = image.src;
        viewer.showModal();
      });
      preview.disabled = true;
      preview.setAttribute('aria-label', 'Увеличить фото ' + item.name);
      preview.append(image);
      const note = rcaElement('small', item.description || item.name);
      const remove = rcaButton('Снять привязку', () => {
        if (window.confirm('Снять привязку фотографии к карточке?')) {
          void change(async (store, current, publish) => publish(
            await store.unlinkAttachment(current, current.problem.revision, item.id)));
        }
      });
      remove.hidden = controls.hidden;
      entry.append(preview, note, remove);
      list.append(entry);
      try {
        const blob = await repository.attachments.loadBinary(record, item.id);
        if (disposed || !list.contains(entry)) return;
        const url = URL.createObjectURL(blob);
        urls.set(item.id, url);
        image.src = url;
        preview.disabled = false;
      } catch (error) {
        if (disposed || !list.contains(entry)) return;
        preview.hidden = true;
        note.textContent = item.name + ' · ' + error.message;
      }
    }
  }

  void canWrite().then(writable => {
    if (disposed) return;
    controls.hidden = !writable;
    status.textContent = writable ? 'До 20 фото на карточку, до 20 МБ на файл.' :
      'Для добавления фото нужна сохранённая карточка в папке с разрешением на запись.';
    void renderPhotos();
  }).catch(error => {
    if (disposed) return;
    status.textContent = error.message;
    void renderPhotos();
  });
  return {panel, dispose() {
    disposed = true;
    if (viewer.open) viewer.close();
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  }};
}
