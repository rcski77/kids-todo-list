async function api(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error ${res.status} on ${path}`);
  return res.status === 204 ? null : res.json();
}

function escapeAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

async function loadKids() {
  const kids = await api('/kids');
  const el = document.getElementById('kidsList');
  el.innerHTML = '';
  for (const kid of kids) {
    const tasks = await api(`/kids/${kid.id}/tasks`);
    const block = document.createElement('div');
    block.className = 'kid-block';
    block.innerHTML = `
      <div class="kid-title">
        <span>${kid.emoji} ${kid.name}
          <span class="esp-url">GET /api/kids/${kid.id}/display</span>
        </span>
        <button class="danger" data-delete-kid="${kid.id}">Delete kid</button>
      </div>
      <table>
        <colgroup>
          <col style="width:24px"><col style="width:60px"><col style="width:22%">
          <col style="width:32%"><col style="width:140px"><col style="width:64px"><col style="width:36px">
        </colgroup>
        <thead><tr><th></th><th>Emoji</th><th>Name</th><th>Detail</th><th>Timer</th><th></th><th></th></tr></thead>
        <tbody data-tasks-for-kid="${kid.id}">
          ${tasks
            .map(
              (t) => `
            <tr draggable="true" data-task-id="${t.id}">
              <td class="drag-handle" title="Drag to reorder">☰</td>
              <td><input class="f-emoji" data-task-id="${t.id}" value="${escapeAttr(t.emoji)}" maxlength="4"></td>
              <td><input class="f-name" data-task-id="${t.id}" value="${escapeAttr(t.name)}"></td>
              <td><input class="f-detail" data-task-id="${t.id}" value="${escapeAttr(t.detail)}"></td>
              <td class="timer-cell">
                <label class="timer-inline">
                  <input type="checkbox" class="timer-enabled" data-task-id="${t.id}" ${t.has_timer ? 'checked' : ''}>
                  <input type="number" class="timer-secs" data-task-id="${t.id}" value="${t.timer_seconds}" min="1">s
                </label>
              </td>
              <td><button data-save-task="${t.id}">Save</button></td>
              <td><button class="danger" data-delete-task="${t.id}">✕</button></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      <form class="inline" data-add-task="${kid.id}">
        <input name="emoji" placeholder="Emoji" value="⭐" style="width:50px" maxlength="4">
        <input name="name" placeholder="Task name" required>
        <input name="detail" placeholder="Detail (optional)">
        <label style="font-size:0.8rem"><input type="checkbox" name="hasTimer"> has timer</label>
        <input name="timerSeconds" type="number" placeholder="secs" value="120" style="width:70px">
        <button type="submit">Add task</button>
      </form>
    `;
    el.appendChild(block);
  }

  el.querySelectorAll('[data-delete-kid]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Delete this kid and all their tasks/progress?')) return;
      await api(`/kids/${btn.dataset.deleteKid}`, { method: 'DELETE' });
      loadKids();
    };
  });
  el.querySelectorAll('[data-delete-task]').forEach((btn) => {
    btn.onclick = async () => {
      await api(`/tasks/${btn.dataset.deleteTask}`, { method: 'DELETE' });
      loadKids();
    };
  });
  el.querySelectorAll('[data-save-task]').forEach((btn) => {
    btn.onclick = async () => {
      const taskId = btn.dataset.saveTask;
      const emoji = el.querySelector(`.f-emoji[data-task-id="${taskId}"]`).value;
      const name = el.querySelector(`.f-name[data-task-id="${taskId}"]`).value;
      const detail = el.querySelector(`.f-detail[data-task-id="${taskId}"]`).value;
      const hasTimer = el.querySelector(`.timer-enabled[data-task-id="${taskId}"]`).checked;
      const secs = el.querySelector(`.timer-secs[data-task-id="${taskId}"]`).value;
      await api(`/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ emoji, name, detail, hasTimer, timerSeconds: Number(secs) || 120 }),
      });
      loadKids();
    };
  });
  el.querySelectorAll('[data-add-task]').forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      await api(`/kids/${form.dataset.addTask}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          emoji: fd.get('emoji'),
          name: fd.get('name'),
          detail: fd.get('detail'),
          hasTimer: fd.get('hasTimer') === 'on',
          timerSeconds: Number(fd.get('timerSeconds')) || 120,
        }),
      });
      loadKids();
    };
  });

  el.querySelectorAll('[data-tasks-for-kid]').forEach((tbody) => {
    enableDragReorder(tbody, tbody.dataset.tasksForKid);
  });
}

function enableDragReorder(tbody, kidId) {
  let draggedRow = null;

  tbody.querySelectorAll('tr').forEach((row) => {
    row.addEventListener('dragstart', () => {
      draggedRow = row;
      row.classList.add('dragging');
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!draggedRow || draggedRow === row) return;
      const bounds = row.getBoundingClientRect();
      const after = e.clientY - bounds.top > bounds.height / 2;
      row.parentNode.insertBefore(draggedRow, after ? row.nextSibling : row);
    });
  });

  tbody.addEventListener('dragend', async () => {
    if (draggedRow) draggedRow.classList.remove('dragging');
    draggedRow = null;
    const taskIds = [...tbody.querySelectorAll('tr')].map((r) => Number(r.dataset.taskId));
    await api(`/kids/${kidId}/tasks/reorder`, {
      method: 'POST',
      body: JSON.stringify({ taskIds }),
    });
    loadKids();
  });
}

document.getElementById('addKidForm').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await api('/kids', {
    method: 'POST',
    body: JSON.stringify({
      name: fd.get('name'),
      emoji: fd.get('emoji'),
      color: fd.get('color'),
    }),
  });
  e.target.reset();
  e.target.querySelector('[name=emoji]').value = '🧒';
  loadKids();
};

loadKids();
